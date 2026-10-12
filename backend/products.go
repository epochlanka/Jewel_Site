package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
)

// ---------- Shop ----------

// GET /api/products?ids=a,b&category=earrings&q=&minPrice=&maxPrice=&style=&colour=&inStock=1&newArrivals=1&onSale=1&type=EARRINGS&sort=price_asc&page=1&limit=24
func (a *App) listProducts(w http.ResponseWriter, r *http.Request) error {
	ctx, qs := r.Context(), r.URL.Query()
	page, err := queryInt(r, "page", 1, 1, math32)
	if err != nil {
		return err
	}
	limit, err := queryInt(r, "limit", 24, 1, 60)
	if err != nil {
		return err
	}
	where, args := []string{"p.is_active = 1"}, []any{}
	add := func(cond string, vals ...any) { where = append(where, cond); args = append(args, vals...) }

	if v := qs.Get("category"); v != "" {
		add("p.category_id IN (SELECT id FROM categories WHERE slug = ?)", v)
	}
	if v := qs.Get("q"); v != "" {
		l := likeArg(v)
		add(`(p.name LIKE ? ESCAPE '\' OR p.code LIKE ? ESCAPE '\' OR p.description LIKE ? ESCAPE '\')`, l, l, l)
	}
	for _, k := range []string{"minPrice", "maxPrice"} {
		if v := qs.Get(k); v != "" {
			n, err := strconv.ParseFloat(v, 64)
			if err != nil {
				return badField(k, "")
			}
			if k == "minPrice" {
				add(effPrice+" >= ?", n)
			} else {
				add(effPrice+" <= ?", n)
			}
		}
	}
	if v := qs.Get("style"); v != "" {
		add("p.style = ?", v)
	}
	if v := qs.Get("colour"); v != "" {
		add("p.colour = ?", v)
	}
	if qs.Get("inStock") != "" {
		add("p.stock > 0")
	}
	if qs.Get("rent") != "" {
		add("p.for_rent = 1")
	}
	if qs.Get("newArrivals") != "" {
		add("p.is_new_arrival = 1")
	}
	if v := qs.Get("type"); v != "" {
		if !oneOf(v, jewelleryTypes...) {
			return badField("type", "")
		}
		add("p.jewellery_type = ?", v)
	}
	if v := qs.Get("ids"); v != "" {
		var ids []string
		for _, id := range strings.Split(v, ",") {
			if id != "" && len(ids) < 20 {
				ids = append(ids, id)
			}
		}
		add("p.id IN ("+placeholders(len(ids))+")", toAny(ids)...)
	}
	order := map[string]string{"new": "p.created_at DESC", "price_asc": effPrice + " ASC", "price_desc": effPrice + " DESC", "name": "p.name ASC"}
	sort := qs.Get("sort")
	if sort == "" {
		sort = "new"
	}
	if order[sort] == "" {
		return badField("sort", "")
	}
	base := ` FROM products p WHERE ` + strings.Join(where, " AND ")

	if qs.Get("onSale") != "" {
		// Offers can target products, categories or the whole shop, so filter after pricing.
		all, err := queryProducts(ctx, a.db, `SELECT `+productCols+base+` ORDER BY `+order[sort]+`, p.id`, args...)
		if err != nil {
			return err
		}
		if err := withPricing(ctx, a.db, all); err != nil {
			return err
		}
		onSale := []Product{}
		for _, p := range all {
			if p.SalePrice != nil {
				onSale = append(onSale, p)
			}
		}
		start, end := min((page-1)*limit, len(onSale)), min(page*limit, len(onSale))
		items := onSale[start:end]
		if err := attachImages(ctx, a.db, items, true); err != nil {
			return err
		}
		return ok(w, paged[Product]{Items: items, Total: len(onSale), Page: page, Pages: pageCount(len(onSale), limit)})
	}

	total, err := countRows(ctx, a.db, `SELECT COUNT(*)`+base, args...)
	if err != nil {
		return err
	}
	items, err := queryProducts(ctx, a.db, `SELECT `+productCols+base+` ORDER BY `+order[sort]+`, p.id LIMIT ? OFFSET ?`, append(args, limit, (page-1)*limit)...)
	if err != nil {
		return err
	}
	if err := attachImages(ctx, a.db, items, true); err != nil {
		return err
	}
	if err := withPricing(ctx, a.db, items); err != nil {
		return err
	}
	return ok(w, paged[Product]{Items: items, Total: total, Page: page, Pages: pageCount(total, limit)})
}

const math32 = 1<<31 - 1

// Values for the filter panel
func (a *App) productFilters(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	distinct := func(col string) ([]string, error) {
		rows, err := a.db.QueryContext(ctx, `SELECT DISTINCT `+col+` FROM products WHERE is_active = 1 AND `+col+` IS NOT NULL AND `+col+` <> '' ORDER BY `+col)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		out := []string{}
		for rows.Next() {
			var s string
			if err := rows.Scan(&s); err != nil {
				return nil, err
			}
			out = append(out, s)
		}
		return out, rows.Err()
	}
	styles, err := distinct("style")
	if err != nil {
		return err
	}
	colours, err := distinct("colour")
	if err != nil {
		return err
	}
	var lo, hi sql.NullInt64
	if err := a.db.QueryRowContext(ctx, `SELECT MIN(`+effPrice+`), MAX(`+effPrice+`) FROM products p WHERE p.is_active = 1`).Scan(&lo, &hi); err != nil {
		return err
	}
	return ok(w, map[string]any{"styles": styles, "colours": colours, "minPrice": lo.Int64, "maxPrice": hi.Int64})
}

func (a *App) productBySlug(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	list, err := queryProducts(ctx, a.db, `SELECT `+productCols+` FROM products p WHERE p.slug = ? AND p.is_active = 1`, r.PathValue("slug"))
	if err != nil {
		return err
	}
	if len(list) == 0 {
		return httpErr(http.StatusNotFound, "This product isn't available.")
	}
	if err := attachImages(ctx, a.db, list, false); err != nil {
		return err
	}
	if err := attachCategories(ctx, a.db, list); err != nil {
		return err
	}
	if err := withPricing(ctx, a.db, list); err != nil {
		return err
	}
	return ok(w, list[0])
}

func (a *App) relatedProducts(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	var id, categoryID string
	err := a.db.QueryRowContext(ctx, `SELECT id, category_id FROM products WHERE slug = ?`, r.PathValue("slug")).Scan(&id, &categoryID)
	if errors.Is(err, sql.ErrNoRows) {
		return ok(w, []Product{})
	}
	if err != nil {
		return err
	}
	items, err := queryProducts(ctx, a.db, `SELECT `+productCols+` FROM products p WHERE p.is_active = 1 AND p.category_id = ? AND p.id <> ? ORDER BY p.created_at DESC LIMIT 4`, categoryID, id)
	if err != nil {
		return err
	}
	if err := attachImages(ctx, a.db, items, true); err != nil {
		return err
	}
	if err := withPricing(ctx, a.db, items); err != nil {
		return err
	}
	return ok(w, items)
}

// ---------- Admin ----------

type productInput struct {
	set   []string
	args  []any
	code  string
	name  string
	sizes *[]Size // nil when the form didn't send sizes; empty removes them
}

// readProductForm validates the product fields that were sent. When partial is false
// (adding a product) the required fields must all be there.
func readProductForm(r *http.Request, partial bool) (*productInput, error) {
	in := &productInput{}
	field := func(col string, v any) { in.set = append(in.set, col); in.args = append(in.args, v) }
	get := func(k string) (string, bool) { return formValue(r, k) }
	need := func(k string) (string, bool, error) {
		v, ok := get(k)
		if !ok && !partial {
			return "", false, badField(k, "")
		}
		return v, ok, nil
	}

	if v, has, err := need("code"); err != nil {
		return nil, err
	} else if has {
		v = strings.TrimSpace(v)
		if v == "" || len([]rune(v)) > 30 {
			return nil, badField("code", "Enter a product code (up to 30 characters)")
		}
		in.code = v
		field("code", v)
	}
	if v, has, err := need("name"); err != nil {
		return nil, err
	} else if has {
		v = strings.TrimSpace(v)
		if n := len([]rune(v)); n < 2 || n > 120 {
			return nil, badField("name", "Enter a product name (2 to 120 characters)")
		}
		in.name = v
		field("name", v)
	}
	if v, has := get("description"); has {
		if len([]rune(v)) > 4000 {
			return nil, badField("description", "Keep the description under 4000 characters")
		}
		field("description", v)
	}
	// Buy and rent options. A piece can be sold, rented or both.
	forSale, forRent := !partial, false
	saleSent, rentSent := false, false
	if v, has := get("forSale"); has {
		forSale, saleSent = truthy(v), true
	}
	if v, has := get("forRent"); has {
		forRent, rentSent = truthy(v), true
	}
	if saleSent || !partial {
		field("for_sale", boolInt(forSale))
	}
	if rentSent || !partial {
		field("for_rent", boolInt(forRent))
	}
	if (saleSent || !partial) && (rentSent || !partial) && !forSale && !forRent {
		return nil, badField("forSale", "Choose whether this piece can be bought, rented or both")
	}
	wholeNumber := func(k, msg string, lo int) (int, bool, error) {
		v, has := get(k)
		if !has {
			return 0, false, nil
		}
		n, err := strconv.ParseFloat(orZero(v), 64)
		if err != nil || !isInt(n) || n < float64(lo) {
			return 0, true, badField(k, msg)
		}
		return int(n), true, nil
	}
	if v, has := get("price"); has || !partial {
		n, err := strconv.ParseFloat(orZero(v), 64)
		if err != nil || !isInt(n) || n < 0 || (n == 0 && forSale) {
			return nil, badField("price", "Enter a price above 0")
		}
		field("price", int(n))
	}
	rentFields := []struct {
		key, col, msg string
		lo, def       int
	}{
		{"rentPrice", "rent_price", "Enter the rent price", 0, 0},
		{"rentDays", "rent_days", "Enter how many days the rent covers (1 or more)", 1, 3},
		{"rentExtraDay", "rent_extra_day", "Enter the price per extra day (0 or more)", 0, 0},
		{"rentDeposit", "rent_deposit", "Enter the deposit (0 or more)", 0, 0},
		{"rentUnits", "rent_units", "Enter how many of this set you can rent out (1 or more)", 1, 1},
	}
	for _, f := range rentFields {
		n, has, err := wholeNumber(f.key, f.msg, f.lo)
		if err != nil {
			return nil, err
		}
		if !has && partial {
			continue
		}
		if !has {
			n = f.def
		}
		if f.key == "rentPrice" && forRent && n <= 0 {
			return nil, badField("rentPrice", "Enter the rent price")
		}
		field(f.col, n)
	}
	if v, has := get("stock"); has {
		n, err := strconv.ParseFloat(orZero(v), 64)
		if err != nil || !isInt(n) || n < 0 {
			return nil, badField("stock", "Enter a stock count of 0 or more")
		}
		field("stock", int(n))
	} else if !partial {
		field("stock", 0)
	}
	if v, has, err := need("categoryId"); err != nil {
		return nil, err
	} else if has {
		if v == "" {
			return nil, badField("categoryId", "Choose a category")
		}
		field("category_id", v)
	}
	if v, has, err := need("jewelleryType"); err != nil {
		return nil, err
	} else if has {
		if !oneOf(v, jewelleryTypes...) {
			return nil, badField("jewelleryType", "")
		}
		field("jewellery_type", v)
	}
	for _, f := range []struct {
		key, col string
		def      bool
	}{{"isNewArrival", "is_new_arrival", false}, {"isActive", "is_active", true}} {
		if v, has := get(f.key); has {
			field(f.col, boolInt(truthy(v)))
		} else if !partial {
			field(f.col, boolInt(f.def))
		}
	}
	for _, k := range []string{"style", "colour"} {
		if v, has := get(k); has {
			v = strings.TrimSpace(v)
			if len([]rune(v)) > 40 {
				return nil, badField(k, "Keep it under 40 characters")
			}
			if v == "" {
				field(k, nil)
			} else {
				field(k, v)
			}
		}
	}
	// Sizes arrive as JSON: [{"size": "2.4", "stock": 3}, ...]. With sizes, the stock is their total.
	if v, has := get("sizes"); has {
		var raw []struct {
			Size  string  `json:"size"`
			Stock float64 `json:"stock"`
		}
		if json.Unmarshal([]byte(v), &raw) != nil || len(raw) > 30 {
			return nil, badField("sizes", "Check the sizes")
		}
		sizes := []Size{}
		seen := map[string]bool{}
		total := 0
		for _, x := range raw {
			x.Size = strings.TrimSpace(x.Size)
			if x.Size == "" || len([]rune(x.Size)) > 12 || seen[x.Size] {
				return nil, badField("sizes", "Each size needs a short, different name, like 2.4")
			}
			if !isInt(x.Stock) || x.Stock < 0 {
				return nil, badField("sizes", "Enter a stock of 0 or more for size "+x.Size)
			}
			seen[x.Size] = true
			total += int(x.Stock)
			sizes = append(sizes, Size{Size: x.Size, Stock: int(x.Stock)})
		}
		in.sizes = &sizes
		if len(sizes) > 0 {
			for i, c := range in.set {
				if c == "stock" {
					in.args[i] = total
				}
			}
			if !slices.Contains(in.set, "stock") {
				field("stock", total)
			}
		}
	}
	return in, nil
}

// saveSizes replaces a product's sizes.
func saveSizes(ctx context.Context, tx *sql.Tx, productID string, sizes []Size) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM product_sizes WHERE product_id = ?`, productID); err != nil {
		return err
	}
	for i, sz := range sizes {
		if _, err := tx.ExecContext(ctx, `INSERT INTO product_sizes (id, product_id, size, stock, sort) VALUES (?, ?, ?, ?, ?)`, newID(), productID, sz.Size, sz.Stock, i); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) assertCodeFree(r *http.Request, code, exceptID string) error {
	var name string
	err := a.db.QueryRowContext(r.Context(), `SELECT name FROM products WHERE code = ? AND id <> ?`, code, exceptID).Scan(&name)
	if err == nil {
		return httpErr(http.StatusConflict, "Product code %s is already used by \"%s\".", code, name)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	return err
}

func (a *App) productWithImages(r *http.Request, id string) (Product, error) {
	list, err := queryProducts(r.Context(), a.db, `SELECT `+productCols+` FROM products p WHERE p.id = ?`, id)
	if err != nil {
		return Product{}, err
	}
	if len(list) == 0 {
		return Product{}, errNotFound
	}
	if err := attachImages(r.Context(), a.db, list, false); err != nil {
		return Product{}, err
	}
	return list[0], nil
}

func (a *App) createProduct(w http.ResponseWriter, r *http.Request) error {
	if err := parseMultipart(w, r); err != nil {
		return err
	}
	in, err := readProductForm(r, false)
	if err != nil {
		return err
	}
	if err := a.assertCodeFree(r, in.code, ""); err != nil {
		return err
	}
	images, err := formImages(r, "images", 10)
	if err != nil {
		return err
	}
	id := newID()
	cols := append([]string{"id", "slug", "created_at"}, in.set...)
	args := append([]any{id, slugify(in.name) + "-" + slugify(in.code), nowTS()}, in.args...)
	var urls []string
	for _, fh := range images {
		url, err := a.saveUpload(fh)
		if err != nil {
			return err
		}
		urls = append(urls, url)
	}
	err = withTx(r.Context(), a.db, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO products (`+strings.Join(cols, ", ")+`) VALUES (`+placeholders(len(cols))+`)`, args...); err != nil {
			return err
		}
		if in.sizes != nil {
			if err := saveSizes(r.Context(), tx, id, *in.sizes); err != nil {
				return err
			}
		}
		for i, url := range urls {
			if _, err := tx.ExecContext(r.Context(), `INSERT INTO product_images (id, url, sort, product_id) VALUES (?, ?, ?, ?)`, newID(), url, i, id); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	p, err := a.productWithImages(r, id)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusCreated, p)
}

func (a *App) updateProduct(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("id")
	if err := parseMultipart(w, r); err != nil {
		return err
	}
	in, err := readProductForm(r, true)
	if err != nil {
		return err
	}
	if n, err := countRows(r.Context(), a.db, `SELECT COUNT(*) FROM products WHERE id = ?`, id); err != nil {
		return err
	} else if n == 0 {
		return errNotFound
	}
	if in.code != "" {
		if err := a.assertCodeFree(r, in.code, id); err != nil {
			return err
		}
	}
	images, err := formImages(r, "images", 10)
	if err != nil {
		return err
	}
	var urls []string
	for _, fh := range images {
		url, err := a.saveUpload(fh)
		if err != nil {
			return err
		}
		urls = append(urls, url)
	}
	err = withTx(r.Context(), a.db, func(tx *sql.Tx) error {
		if len(in.set) > 0 {
			sets := make([]string, len(in.set))
			for i, c := range in.set {
				sets[i] = c + " = ?"
			}
			if _, err := tx.ExecContext(r.Context(), `UPDATE products SET `+strings.Join(sets, ", ")+` WHERE id = ?`, append(in.args, id)...); err != nil {
				return err
			}
		}
		if in.sizes != nil {
			if err := saveSizes(r.Context(), tx, id, *in.sizes); err != nil {
				return err
			}
		}
		var start int
		if err := tx.QueryRowContext(r.Context(), `SELECT COALESCE(MAX(sort), -1) + 1 FROM product_images WHERE product_id = ?`, id).Scan(&start); err != nil {
			return err
		}
		for i, url := range urls {
			if _, err := tx.ExecContext(r.Context(), `INSERT INTO product_images (id, url, sort, product_id) VALUES (?, ?, ?, ?)`, newID(), url, start+i, id); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	p, err := a.productWithImages(r, id)
	if err != nil {
		return err
	}
	return ok(w, p)
}

// Body: { order: [imageId, imageId, ...] }; the first becomes the main image.
func (a *App) orderImages(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r)
	if err != nil {
		return err
	}
	var order []string
	if err := jsonField(b, "order", &order); err != nil {
		return err
	}
	err = withTx(r.Context(), a.db, func(tx *sql.Tx) error {
		for i, imgID := range order {
			if _, err := tx.ExecContext(r.Context(), `UPDATE product_images SET sort = ? WHERE id = ? AND product_id = ?`, i, imgID, r.PathValue("id")); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return noContent(w)
}

func (a *App) deleteImage(w http.ResponseWriter, r *http.Request) error {
	if _, err := a.db.ExecContext(r.Context(), `DELETE FROM product_images WHERE id = ? AND product_id = ?`, r.PathValue("imageId"), r.PathValue("id")); err != nil {
		return err
	}
	return noContent(w)
}

// Hiding keeps order history intact; the product can be shown again from the edit form.
func (a *App) hideProduct(w http.ResponseWriter, r *http.Request) error {
	return a.execOne(w, r, `UPDATE products SET is_active = 0 WHERE id = ?`, r.PathValue("id"))
}

// execOne runs a statement that must change exactly one row and answers 204, or 404 when nothing matched.
func (a *App) execOne(w http.ResponseWriter, r *http.Request, query string, args ...any) error {
	res, err := a.db.ExecContext(r.Context(), query, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errNotFound
	}
	return noContent(w)
}
