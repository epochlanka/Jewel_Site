package main

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
)

// ---------- Categories ----------

func (a *App) categories(w http.ResponseWriter, r *http.Request) error {
	cats, err := listCategories(r.Context(), a.db, true)
	if err != nil {
		return err
	}
	return ok(w, cats)
}

func (a *App) categoryByID(r *http.Request, id string) (Category, error) {
	var c Category
	var img sql.NullString
	err := a.db.QueryRowContext(r.Context(), `SELECT id, name, slug, image_url, sort FROM categories WHERE id = ?`, id).Scan(&c.ID, &c.Name, &c.Slug, &img, &c.Sort)
	c.ImageURL = strPtr(img)
	return c, err
}

// multipart/form-data: name, sort, image?
func (a *App) saveCategory(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("id")
	isNew := id == ""
	if err := parseMultipart(w, r); err != nil {
		return err
	}
	var set []string
	var args []any
	name, hasName := formValue(r, "name")
	if hasName || isNew {
		name = strings.TrimSpace(name)
		if name == "" || len([]rune(name)) > 60 {
			return badField("name", "Enter a name (up to 60 characters)")
		}
		slug := slugify(name)
		if n, err := countRows(r.Context(), a.db, `SELECT COUNT(*) FROM categories WHERE slug = ? AND id <> ?`, slug, id); err != nil {
			return err
		} else if n > 0 {
			return httpErr(http.StatusConflict, "A category with this name already exists.")
		}
		set, args = append(set, "name", "slug"), append(args, name, slug)
	}
	if v, has := formValue(r, "sort"); has {
		n, err := strconv.ParseFloat(orZero(v), 64)
		if err != nil || !isInt(n) {
			return badField("sort", "Enter a whole number")
		}
		set, args = append(set, "sort"), append(args, int(n))
	}
	img, err := formImage(r, "image")
	if err != nil {
		return err
	}
	if img != nil {
		url, err := a.saveUpload(img)
		if err != nil {
			return err
		}
		set, args = append(set, "image_url"), append(args, url)
	}

	if isNew {
		id = newID()
		cols := append([]string{"id"}, set...)
		if _, err := a.db.ExecContext(r.Context(), `INSERT INTO categories (`+strings.Join(cols, ", ")+`) VALUES (`+placeholders(len(cols))+`)`, append([]any{id}, args...)...); err != nil {
			return err
		}
	} else if len(set) > 0 {
		sets := make([]string, len(set))
		for i, c := range set {
			sets[i] = c + " = ?"
		}
		res, err := a.db.ExecContext(r.Context(), `UPDATE categories SET `+strings.Join(sets, ", ")+` WHERE id = ?`, append(args, id)...)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return errNotFound
		}
	}
	c, err := a.categoryByID(r, id)
	if err != nil {
		return err
	}
	status := http.StatusOK
	if isNew {
		status = http.StatusCreated
	}
	return writeJSON(w, status, c)
}

func (a *App) deleteCategory(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("id")
	n, err := countRows(r.Context(), a.db, `SELECT COUNT(*) FROM products WHERE category_id = ?`, id)
	if err != nil {
		return err
	}
	if n > 0 {
		plural := "s"
		if n == 1 {
			plural = ""
		}
		return httpErr(http.StatusConflict, "This category has %d product%s. Move them to another category first.", n, plural)
	}
	return a.execOne(w, r, `DELETE FROM categories WHERE id = ?`, id)
}

// ---------- Settings ----------

func (a *App) settings(w http.ResponseWriter, r *http.Request) error {
	s, err := getSettings(r.Context(), a.db)
	if err != nil {
		return err
	}
	return ok(w, s)
}

func (a *App) saveSettings(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r)
	if err != nil {
		return err
	}
	var set []string
	var args []any
	field := func(col string, v any) { set = append(set, col+" = ?"); args = append(args, v) }

	texts := []struct {
		key, col string
		min, max int
	}{
		{"shopName", "shop_name", 1, 80}, {"tagline", "tagline", 0, 200}, {"phone", "phone", 0, 30}, {"whatsapp", "whatsapp", 0, 30},
		{"email", "email", 0, 120}, {"address", "address", 0, 300}, {"bankDetails", "bank_details", 0, 1000},
		{"bankName", "bank_name", 0, 80}, {"bankBranch", "bank_branch", 0, 80}, {"accountName", "account_name", 0, 120}, {"accountNumber", "account_number", 0, 40},
	}
	for _, t := range texts {
		v, has, err := b.str(t.key)
		if err != nil {
			return err
		}
		if !has {
			continue
		}
		if n := len([]rune(v)); n < t.min || n > t.max {
			return badField(t.key, "")
		}
		field(t.col, v)
	}
	if n, has, err := b.num("deliveryFee"); err != nil {
		return err
	} else if has {
		if !isInt(n) || n < 0 {
			return badField("deliveryFee", "Enter a delivery fee of 0 or more")
		}
		field("delivery_fee", int(n))
	}
	if b.isNull("freeDeliveryOver") {
		field("free_delivery_over", nil)
	} else if n, has, err := b.num("freeDeliveryOver"); err != nil {
		return err
	} else if has {
		if !isInt(n) || n < 0 {
			return badField("freeDeliveryOver", "Enter an amount of 0 or more")
		}
		field("free_delivery_over", int(n))
	}
	for _, f := range [][2]string{{"pickupEnabled", "pickup_enabled"}} {
		if v, has, err := b.boolean(f[0]); err != nil {
			return err
		} else if has {
			field(f[1], boolInt(v))
		}
	}
	for _, f := range []struct {
		key, col string
		allowed  []string
	}{{"themeMode", "theme_mode", []string{"system", "light", "dark"}}, {"themeAccent", "theme_accent", []string{"emerald", "gold", "rose", "blue"}}} {
		v, has, err := b.str(f.key)
		if err != nil {
			return err
		}
		if has {
			if !oneOf(v, f.allowed...) {
				return badField(f.key, "")
			}
			field(f.col, v)
		}
	}

	if _, err := getSettings(r.Context(), a.db); err != nil {
		return err
	}
	if len(set) > 0 {
		if _, err := a.db.ExecContext(r.Context(), `UPDATE shop_settings SET `+strings.Join(set, ", ")+` WHERE id = 1`, args...); err != nil {
			return err
		}
	}
	return a.settings(w, r)
}

// ---------- Wishlist ----------

func (a *App) wishlist(w http.ResponseWriter, r *http.Request) error {
	u, err := a.requireUser(r)
	if err != nil {
		return err
	}
	items, err := queryProducts(r.Context(), a.db, `SELECT `+productCols+` FROM wishlist_items wi JOIN products p ON p.id = wi.product_id
	  WHERE wi.user_id = ? AND p.is_active = 1 ORDER BY wi.id DESC`, u.ID)
	if err != nil {
		return err
	}
	if err := attachImages(r.Context(), a.db, items, true); err != nil {
		return err
	}
	if err := withPricing(r.Context(), a.db, items); err != nil {
		return err
	}
	return ok(w, items)
}

func (a *App) wishlistIDs(w http.ResponseWriter, r *http.Request) error {
	u, err := a.requireUser(r)
	if err != nil {
		return err
	}
	rows, err := a.db.QueryContext(r.Context(), `SELECT product_id FROM wishlist_items WHERE user_id = ?`, u.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return ok(w, ids)
}

func (a *App) addWish(w http.ResponseWriter, r *http.Request) error {
	u, err := a.requireUser(r)
	if err != nil {
		return err
	}
	pid := r.PathValue("productId")
	if n, err := countRows(r.Context(), a.db, `SELECT COUNT(*) FROM products WHERE id = ? AND is_active = 1`, pid); err != nil {
		return err
	} else if n == 0 {
		return httpErr(http.StatusNotFound, "Product not found")
	}
	if _, err := a.db.ExecContext(r.Context(), `INSERT OR IGNORE INTO wishlist_items (id, user_id, product_id) VALUES (?, ?, ?)`, newID(), u.ID, pid); err != nil {
		return err
	}
	return noContent(w)
}

func (a *App) removeWish(w http.ResponseWriter, r *http.Request) error {
	u, err := a.requireUser(r)
	if err != nil {
		return err
	}
	if _, err := a.db.ExecContext(r.Context(), `DELETE FROM wishlist_items WHERE user_id = ? AND product_id = ?`, u.ID, r.PathValue("productId")); err != nil {
		return err
	}
	return noContent(w)
}
