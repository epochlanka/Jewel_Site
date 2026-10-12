package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"mime/multipart"
	"net/http"
	"net/mail"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ---------- Errors ----------

type HTTPError struct {
	Status  int
	Message string
	Field   string
}

func (e *HTTPError) Error() string { return e.Message }

func httpErr(status int, format string, args ...any) *HTTPError {
	return &HTTPError{Status: status, Message: fmt.Sprintf(format, args...)}
}

// badField is a validation error that points the form at the field to fix.
func badField(field, msg string) *HTTPError {
	if msg == "" {
		msg = "Check the " + field + " field"
	}
	return &HTTPError{Status: http.StatusBadRequest, Message: msg, Field: field}
}

var errNotFound = httpErr(http.StatusNotFound, "That item no longer exists.")

// handler returns an error instead of writing one, so every route reports errors the same way.
type handler func(w http.ResponseWriter, r *http.Request) error

func (h handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	err := h(w, r)
	if err == nil {
		return
	}
	var he *HTTPError
	var mbe *http.MaxBytesError
	switch {
	case errors.As(err, &he):
		body := map[string]any{"error": he.Message}
		if he.Field != "" {
			body["field"] = he.Field
		}
		writeJSON(w, he.Status, body)
	case errors.Is(err, sql.ErrNoRows):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": errNotFound.Message})
	case isUniqueViolation(err):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "That value is already in use."})
	case errors.As(err, &mbe):
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "That upload is too large. Choose smaller images."})
	default:
		log.Printf("%s %s: %v", r.Method, r.URL.Path, err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "Something went wrong on our side. Try again."})
	}
}

// ---------- Responses ----------

func writeJSON(w http.ResponseWriter, status int, v any) error {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(v)
}

func ok(w http.ResponseWriter, v any) error { return writeJSON(w, http.StatusOK, v) }

func noContent(w http.ResponseWriter) error {
	w.WriteHeader(http.StatusNoContent)
	return nil
}

type paged[T any] struct {
	Items []T `json:"items"`
	Total int `json:"total"`
	Page  int `json:"page"`
	Pages int `json:"pages"`
}

func pageCount(total, per int) int { return max(1, int(math.Ceil(float64(total)/float64(per)))) }

// ---------- Request bodies ----------

// body is a decoded JSON object. Values are read with the typed helpers below, which
// also accept numbers and booleans sent as strings (form data arrives as text).
type body map[string]json.RawMessage

func readBody(r *http.Request) (body, error) {
	b := body{}
	data, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return b, nil
	}
	if err := json.Unmarshal(data, &b); err != nil {
		return nil, httpErr(http.StatusBadRequest, "That request wasn't valid. Refresh the page and try again.")
	}
	return b, nil
}

func (b body) has(k string) bool {
	v, ok := b[k]
	return ok && string(v) != "null"
}

func (b body) isNull(k string) bool {
	v, ok := b[k]
	return ok && string(v) == "null"
}

// str returns the value as text; present is false when the key is missing or null.
func (b body) str(k string) (s string, present bool, err error) {
	if !b.has(k) {
		return "", false, nil
	}
	if err := json.Unmarshal(b[k], &s); err != nil {
		return "", true, badField(k, "")
	}
	return s, true, nil
}

func (b body) num(k string) (n float64, present bool, err error) {
	if !b.has(k) {
		return 0, false, nil
	}
	if err := json.Unmarshal(b[k], &n); err == nil {
		return n, true, nil
	}
	var s string
	if json.Unmarshal(b[k], &s) == nil {
		if f, perr := strconv.ParseFloat(strings.TrimSpace(orZero(s)), 64); perr == nil {
			return f, true, nil
		}
	}
	return 0, true, badField(k, "")
}

func (b body) boolean(k string) (v bool, present bool, err error) {
	if !b.has(k) {
		return false, false, nil
	}
	if err := json.Unmarshal(b[k], &v); err != nil {
		return false, true, badField(k, "")
	}
	return v, true, nil
}

// jsonField decodes a required value of any shape, such as a list of ids.
func jsonField(b body, k string, dst any) error {
	if !b.has(k) || json.Unmarshal(b[k], dst) != nil {
		return badField(k, "")
	}
	return nil
}

func orZero(s string) string {
	if strings.TrimSpace(s) == "" {
		return "0"
	}
	return s
}

// ---------- Validation ----------

var (
	mobileRe = regexp.MustCompile(`^0\d{9}$`)
	slugRe   = regexp.MustCompile(`[^a-z0-9]+`)
)

func slugify(s string) string {
	return strings.Trim(slugRe.ReplaceAllString(strings.ToLower(strings.TrimSpace(s)), "-"), "-")
}

func validEmail(s string) bool {
	a, err := mail.ParseAddress(s)
	return err == nil && a.Address == s && strings.Contains(s[strings.LastIndex(s, "@"):], ".")
}

func isInt(f float64) bool { return f == math.Trunc(f) && !math.IsInf(f, 0) }

func oneOf(v string, allowed ...string) bool {
	for _, a := range allowed {
		if v == a {
			return true
		}
	}
	return false
}

func truthy(v string) bool { return v == "true" || v == "on" || v == "1" }

// queryInt parses an optional positive whole number from the query string.
func queryInt(r *http.Request, key string, def, lo, hi int) (int, error) {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return def, nil
	}
	f, err := strconv.ParseFloat(raw, 64)
	if err != nil || !isInt(f) || f < float64(lo) || f > float64(hi) {
		return 0, badField(key, "")
	}
	return int(f), nil
}

// ---------- Uploads ----------

const maxUpload = 8 << 20

var imageExt = map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}

func parseMultipart(w http.ResponseWriter, r *http.Request) error {
	r.Body = http.MaxBytesReader(w, r.Body, 12*maxUpload)
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return err
		}
		return httpErr(http.StatusBadRequest, "That upload didn't work. Try another image.")
	}
	return nil
}

func formValue(r *http.Request, key string) (string, bool) {
	if r.MultipartForm == nil {
		return "", false
	}
	v, ok := r.MultipartForm.Value[key]
	if !ok || len(v) == 0 {
		return "", false
	}
	return v[0], true
}

// formImages returns the JPG, PNG and WebP files sent under key. Other file types are
// skipped, matching how the shop has always treated them.
func formImages(r *http.Request, key string, limit int) ([]*multipart.FileHeader, error) {
	if r.MultipartForm == nil {
		return nil, nil
	}
	var out []*multipart.FileHeader
	for _, fh := range r.MultipartForm.File[key] {
		if _, ok := imageExt[fh.Header.Get("Content-Type")]; !ok {
			continue
		}
		if fh.Size > maxUpload {
			return nil, httpErr(http.StatusBadRequest, "That image is over 8 MB. Choose a smaller one.")
		}
		out = append(out, fh)
	}
	if len(out) > limit {
		return nil, httpErr(http.StatusBadRequest, "That upload didn't work. Try another image.")
	}
	return out, nil
}

func formImage(r *http.Request, key string) (*multipart.FileHeader, error) {
	files, err := formImages(r, key, 1)
	if err != nil || len(files) == 0 {
		return nil, err
	}
	return files[0], nil
}

// saveUpload stores the file in the upload folder and returns the URL it is served from.
func (a *App) saveUpload(fh *multipart.FileHeader) (string, error) {
	ext := strings.ToLower(filepath.Ext(fh.Filename))
	if !oneOf(ext, ".jpg", ".jpeg", ".png", ".webp") {
		ext = imageExt[fh.Header.Get("Content-Type")]
	}
	name := fmt.Sprintf("%d-%d%s", time.Now().UnixMilli(), randInt(1e9), ext)
	src, err := fh.Open()
	if err != nil {
		return "", err
	}
	defer src.Close()
	dst, err := os.Create(filepath.Join(a.cfg.UploadDir, name))
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		return "", err
	}
	return "/uploads/" + name, dst.Close()
}
