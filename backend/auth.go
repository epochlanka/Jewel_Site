package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type AuthUser struct {
	ID   string `json:"id"`
	Role string `json:"role"`
}

type PublicUser struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Email string  `json:"email"`
	Phone *string `json:"phone"`
	Role  string  `json:"role"`
}

// ---------- JWT (HS256) ----------

var b64 = base64.RawURLEncoding

func (a *App) signToken(u AuthUser) string {
	header := b64.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	now := time.Now()
	claims, _ := json.Marshal(map[string]any{"id": u.ID, "role": u.Role, "iat": now.Unix(), "exp": now.Add(7 * 24 * time.Hour).Unix()})
	unsigned := header + "." + b64.EncodeToString(claims)
	return unsigned + "." + a.sign(unsigned)
}

func (a *App) sign(s string) string {
	m := hmac.New(sha256.New, []byte(a.cfg.JWTSecret))
	m.Write([]byte(s))
	return b64.EncodeToString(m.Sum(nil))
}

func (a *App) verifyToken(token string) (*AuthUser, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || !hmac.Equal([]byte(a.sign(parts[0]+"."+parts[1])), []byte(parts[2])) {
		return nil, false
	}
	raw, err := b64.DecodeString(parts[1])
	if err != nil {
		return nil, false
	}
	var c struct {
		ID  string `json:"id"`
		Exp int64  `json:"exp"`
	}
	if json.Unmarshal(raw, &c) != nil || c.ID == "" || time.Now().Unix() >= c.Exp {
		return nil, false
	}
	return &AuthUser{ID: c.ID}, true
}

// currentUser reads the login token if there is one. A token for a user that no longer
// exists (for example after the database was reset) is ignored, so the request continues as a guest.
func (a *App) currentUser(r *http.Request) *AuthUser {
	t := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if t == "" {
		return nil
	}
	claims, valid := a.verifyToken(t)
	if !valid {
		return nil
	}
	u := &AuthUser{}
	if err := a.db.QueryRowContext(r.Context(), `SELECT id, role FROM users WHERE id = ?`, claims.ID).Scan(&u.ID, &u.Role); err != nil {
		return nil
	}
	return u
}

func (a *App) requireUser(r *http.Request) (*AuthUser, error) {
	if u := a.currentUser(r); u != nil {
		return u, nil
	}
	return nil, httpErr(http.StatusUnauthorized, "Sign in required")
}

// adminOnly wraps a route so only signed-in admins reach it.
func (a *App) adminOnly(next handler) handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		u, err := a.requireUser(r)
		if err != nil {
			return err
		}
		if u.Role != "ADMIN" {
			return httpErr(http.StatusForbidden, "Admin only")
		}
		return next(w, r)
	}
}

func hashPassword(pw string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(pw), 10)
	return string(h), err
}

func checkPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

func (a *App) publicUser(r *http.Request, id string) (*PublicUser, error) {
	u := &PublicUser{}
	var phone sql.NullString
	err := a.db.QueryRowContext(r.Context(), `SELECT id, name, email, phone, role FROM users WHERE id = ?`, id).Scan(&u.ID, &u.Name, &u.Email, &phone, &u.Role)
	u.Phone = strPtr(phone)
	return u, err
}

// optionalPhone accepts an empty value (no phone) or a mobile number like 07XXXXXXXX.
func optionalPhone(b body) (*string, error) {
	s, present, err := b.str("phone")
	if err != nil || !present || s == "" {
		return nil, err
	}
	if !mobileRe.MatchString(s) {
		return nil, badField("phone", "Use a mobile number like 07XXXXXXXX")
	}
	return &s, nil
}

// ---------- Routes ----------

func (a *App) register(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r)
	if err != nil {
		return err
	}
	name, _, err := b.str("name")
	if err != nil {
		return err
	}
	name = strings.TrimSpace(name)
	if len([]rune(name)) < 2 {
		return badField("name", "Enter your name")
	}
	email, _, err := b.str("email")
	if err != nil {
		return err
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if !validEmail(email) {
		return badField("email", "Enter a valid email")
	}
	phone, err := optionalPhone(b)
	if err != nil {
		return err
	}
	pw, _, err := b.str("password")
	if err != nil {
		return err
	}
	if len(pw) < 6 {
		return badField("password", "Password needs at least 6 characters")
	}
	if n, _ := countRows(r.Context(), a.db, `SELECT COUNT(*) FROM users WHERE email = ?`, email); n > 0 {
		return httpErr(http.StatusConflict, "An account with this email already exists. Sign in instead.")
	}
	hash, err := hashPassword(pw)
	if err != nil {
		return err
	}
	id := newID()
	if _, err := a.db.ExecContext(r.Context(), `INSERT INTO users (id, name, email, phone, password, role, created_at) VALUES (?, ?, ?, ?, ?, 'CUSTOMER', ?)`,
		id, name, email, nullStr(phone), hash, nowTS()); err != nil {
		return err
	}
	u, err := a.publicUser(r, id)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusCreated, map[string]any{"token": a.signToken(AuthUser{ID: u.ID, Role: u.Role}), "user": u})
}

func (a *App) login(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r)
	if err != nil {
		return err
	}
	email, _, err := b.str("email")
	if err != nil {
		return err
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if !validEmail(email) {
		return badField("email", "Enter a valid email")
	}
	pw, _, err := b.str("password")
	if err != nil {
		return err
	}
	var id, hash string
	err = a.db.QueryRowContext(r.Context(), `SELECT id, password FROM users WHERE email = ?`, email).Scan(&id, &hash)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !checkPassword(hash, pw)) {
		return httpErr(http.StatusUnauthorized, "Wrong email or password.")
	}
	if err != nil {
		return err
	}
	u, err := a.publicUser(r, id)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"token": a.signToken(AuthUser{ID: u.ID, Role: u.Role}), "user": u})
}

func (a *App) me(w http.ResponseWriter, r *http.Request) error {
	au, err := a.requireUser(r)
	if err != nil {
		return err
	}
	u, err := a.publicUser(r, au.ID)
	if err != nil {
		return httpErr(http.StatusUnauthorized, "Sign in required")
	}
	return ok(w, u)
}

func (a *App) updateMe(w http.ResponseWriter, r *http.Request) error {
	au, err := a.requireUser(r)
	if err != nil {
		return err
	}
	b, err := readBody(r)
	if err != nil {
		return err
	}
	name, hasName, err := b.str("name")
	if err != nil {
		return err
	}
	name = strings.TrimSpace(name)
	if hasName && len([]rune(name)) < 2 {
		return badField("name", "Enter your name")
	}
	phone, err := optionalPhone(b)
	if err != nil {
		return err
	}
	if hasName {
		_, err = a.db.ExecContext(r.Context(), `UPDATE users SET name = ?, phone = ? WHERE id = ?`, name, nullStr(phone), au.ID)
	} else {
		_, err = a.db.ExecContext(r.Context(), `UPDATE users SET phone = ? WHERE id = ?`, nullStr(phone), au.ID)
	}
	if err != nil {
		return err
	}
	u, err := a.publicUser(r, au.ID)
	if err != nil {
		return err
	}
	return ok(w, u)
}

func (a *App) changePassword(w http.ResponseWriter, r *http.Request) error {
	au, err := a.requireUser(r)
	if err != nil {
		return err
	}
	b, err := readBody(r)
	if err != nil {
		return err
	}
	current, _, err := b.str("current")
	if err != nil {
		return err
	}
	next, _, err := b.str("next")
	if err != nil {
		return err
	}
	if len(next) < 6 {
		return badField("next", "New password needs at least 6 characters")
	}
	var hash string
	if err := a.db.QueryRowContext(r.Context(), `SELECT password FROM users WHERE id = ?`, au.ID).Scan(&hash); err != nil || !checkPassword(hash, current) {
		return httpErr(http.StatusBadRequest, "Current password is wrong.")
	}
	newHash, err := hashPassword(next)
	if err != nil {
		return err
	}
	if _, err := a.db.ExecContext(r.Context(), `UPDATE users SET password = ? WHERE id = ?`, newHash, au.ID); err != nil {
		return err
	}
	return noContent(w)
}

// PATCH /api/auth/account: change the sign-in email, name and/or password.
// Body: { currentPassword, email?, name?, newPassword? }. The current password is always required.
func (a *App) updateAccount(w http.ResponseWriter, r *http.Request) error {
	au, err := a.requireUser(r)
	if err != nil {
		return err
	}
	b, err := readBody(r)
	if err != nil {
		return err
	}
	current, _, err := b.str("currentPassword")
	if err != nil {
		return err
	}
	var hash string
	if err := a.db.QueryRowContext(r.Context(), `SELECT password FROM users WHERE id = ?`, au.ID).Scan(&hash); err != nil || !checkPassword(hash, current) {
		return badField("currentPassword", "Your current password is wrong.")
	}
	var set []string
	var args []any
	if email, has, err := b.str("email"); err != nil {
		return err
	} else if has {
		email = strings.ToLower(strings.TrimSpace(email))
		if !validEmail(email) {
			return badField("email", "Enter a valid email")
		}
		if n, _ := countRows(r.Context(), a.db, `SELECT COUNT(*) FROM users WHERE email = ? AND id <> ?`, email, au.ID); n > 0 {
			return badField("email", "Another account already uses this email.")
		}
		set, args = append(set, "email = ?"), append(args, email)
	}
	if name, has, err := b.str("name"); err != nil {
		return err
	} else if has {
		name = strings.TrimSpace(name)
		if len([]rune(name)) < 2 {
			return badField("name", "Enter your name")
		}
		set, args = append(set, "name = ?"), append(args, name)
	}
	if next, has, err := b.str("newPassword"); err != nil {
		return err
	} else if has && next != "" {
		if len(next) < 8 {
			return badField("newPassword", "Use at least 8 characters for the new password")
		}
		h, err := hashPassword(next)
		if err != nil {
			return err
		}
		set, args = append(set, "password = ?"), append(args, h)
	}
	if len(set) > 0 {
		if _, err := a.db.ExecContext(r.Context(), `UPDATE users SET `+strings.Join(set, ", ")+` WHERE id = ?`, append(args, au.ID)...); err != nil {
			return err
		}
	}
	u, err := a.publicUser(r, au.ID)
	if err != nil {
		return err
	}
	return ok(w, u)
}
