package main

import (
	"database/sql"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"
)

func startOfDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.Local)
}

// ---------- Dashboard ----------

func (a *App) dashboard(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	today := startOfDay(time.Now())
	weekStart := today.AddDate(0, 0, -6)
	todayTS := ts(today)

	counts := map[string]int{}
	for key, q := range map[string]struct {
		sql  string
		args []any
	}{
		"todayOrders": {`SELECT COUNT(*) FROM orders WHERE created_at >= ?`, []any{todayTS}},
		"pending":     {`SELECT COUNT(*) FROM orders WHERE status = 'PENDING'`, nil},
		"processing":  {`SELECT COUNT(*) FROM orders WHERE status IN ('CONFIRMED', 'PROCESSING', 'READY', 'DISPATCHED')`, nil},
		"completed":   {`SELECT COUNT(*) FROM orders WHERE status = 'DELIVERED' AND created_at >= ?`, []any{todayTS}},
		"todaySales":  {`SELECT COALESCE(SUM(total), 0) FROM orders WHERE created_at >= ? AND status <> 'CANCELLED'`, []any{todayTS}},
	} {
		n, err := countRows(ctx, a.db, q.sql, q.args...)
		if err != nil {
			return err
		}
		counts[key] = n
	}

	type day struct {
		Date   string `json:"date"`
		Sales  int    `json:"sales"`
		Orders int    `json:"orders"`
	}
	last7 := make([]day, 7)
	for i := range last7 {
		last7[i].Date = weekStart.AddDate(0, 0, i).Format("2006-01-02")
	}
	rows, err := a.db.QueryContext(ctx, `SELECT created_at, total FROM orders WHERE created_at >= ? AND status <> 'CANCELLED'`, ts(weekStart))
	if err != nil {
		return err
	}
	for rows.Next() {
		var created string
		var total int
		if err := rows.Scan(&created, &total); err != nil {
			rows.Close()
			return err
		}
		key := parseTS(created).Local().Format("2006-01-02")
		for i := range last7 {
			if last7[i].Date == key {
				last7[i].Sales += total
				last7[i].Orders++
			}
		}
	}
	rows.Close()

	recent, err := queryOrders(ctx, a.db, `SELECT `+orderCols+` FROM orders o ORDER BY o.created_at DESC LIMIT 6`)
	if err != nil {
		return err
	}
	type stockRow struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Code  string `json:"code"`
		Stock int    `json:"stock"`
	}
	low := []stockRow{}
	rows, err = a.db.QueryContext(ctx, `SELECT id, name, code, stock FROM products WHERE is_active = 1 AND stock <= 3 ORDER BY stock, name LIMIT 6`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var s stockRow
		if err := rows.Scan(&s.ID, &s.Name, &s.Code, &s.Stock); err != nil {
			return err
		}
		low = append(low, s)
	}
	return ok(w, map[string]any{
		"todayOrders": counts["todayOrders"], "pending": counts["pending"], "processing": counts["processing"],
		"completed": counts["completed"], "todaySales": counts["todaySales"], "last7Days": last7, "recentOrders": recent, "lowStock": low,
	})
}

// ---------- Products ----------

func (a *App) adminProducts(w http.ResponseWriter, r *http.Request) error {
	ctx, qs := r.Context(), r.URL.Query()
	page, err := queryInt(r, "page", 1, 1, math32)
	if err != nil {
		return err
	}
	where, args := []string{"1 = 1"}, []any{}
	if v := qs.Get("q"); v != "" {
		l := likeArg(v)
		where, args = append(where, `(p.name LIKE ? ESCAPE '\' OR p.code LIKE ? ESCAPE '\')`), append(args, l, l)
	}
	if v := qs.Get("categoryId"); v != "" {
		where, args = append(where, "p.category_id = ?"), append(args, v)
	}
	switch qs.Get("show") {
	case "", "all":
	case "active":
		where = append(where, "p.is_active = 1")
	case "hidden":
		where = append(where, "p.is_active = 0")
	case "low":
		where = append(where, "p.is_active = 1 AND p.stock <= 3")
	default:
		return badField("show", "")
	}
	base := ` FROM products p WHERE ` + strings.Join(where, " AND ")
	total, err := countRows(ctx, a.db, `SELECT COUNT(*)`+base, args...)
	if err != nil {
		return err
	}
	items, err := queryProducts(ctx, a.db, `SELECT `+productCols+base+` ORDER BY p.created_at DESC, p.id LIMIT 20 OFFSET ?`, append(args, (page-1)*20)...)
	if err != nil {
		return err
	}
	if err := attachImages(ctx, a.db, items, true); err != nil {
		return err
	}
	if err := attachCategories(ctx, a.db, items); err != nil {
		return err
	}
	return ok(w, paged[Product]{Items: items, Total: total, Page: page, Pages: pageCount(total, 20)})
}

func (a *App) adminProduct(w http.ResponseWriter, r *http.Request) error {
	p, err := a.productWithImages(r, r.PathValue("id"))
	if errors.Is(err, errNotFound) {
		return httpErr(http.StatusNotFound, "Product not found")
	}
	if err != nil {
		return err
	}
	list := []Product{p}
	if err := attachCategories(r.Context(), a.db, list); err != nil {
		return err
	}
	return ok(w, list[0])
}

// ---------- Orders ----------

func (a *App) adminOrders(w http.ResponseWriter, r *http.Request) error {
	ctx, qs := r.Context(), r.URL.Query()
	page, err := queryInt(r, "page", 1, 1, math32)
	if err != nil {
		return err
	}
	where, args := []string{"1 = 1"}, []any{}
	if v := qs.Get("status"); v != "" {
		if !oneOf(v, orderStatuses...) {
			return badField("status", "")
		}
		where, args = append(where, "o.status = ?"), append(args, v)
	}
	if v := qs.Get("q"); v != "" {
		l := likeArg(v)
		where, args = append(where, `(o.order_no LIKE ? ESCAPE '\' OR o.full_name LIKE ? ESCAPE '\' OR o.mobile LIKE ? ESCAPE '\')`), append(args, l, l, l)
	}
	base := ` FROM orders o WHERE ` + strings.Join(where, " AND ")
	total, err := countRows(ctx, a.db, `SELECT COUNT(*)`+base, args...)
	if err != nil {
		return err
	}
	items, err := queryOrders(ctx, a.db, `SELECT `+orderCols+base+` ORDER BY o.created_at DESC LIMIT 20 OFFSET ?`, append(args, (page-1)*20)...)
	if err != nil {
		return err
	}
	for i := range items {
		n, err := countRows(ctx, a.db, `SELECT COUNT(*) FROM order_items WHERE order_id = ?`, items[i].ID)
		if err != nil {
			return err
		}
		items[i].Count = &struct {
			Items int `json:"items"`
		}{n}
	}
	byStatus, err := a.ordersByStatus(r)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"items": items, "total": total, "page": page, "pages": pageCount(total, 20), "byStatus": byStatus})
}

func (a *App) ordersByStatus(r *http.Request) (map[string]int, error) {
	rows, err := a.db.QueryContext(r.Context(), `SELECT status, COUNT(*) FROM orders GROUP BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var s string
		var n int
		if err := rows.Scan(&s, &n); err != nil {
			return nil, err
		}
		out[s] = n
	}
	return out, rows.Err()
}

func (a *App) adminOrder(w http.ResponseWriter, r *http.Request) error {
	o, err := a.orderDetail(r.Context(), "o.id = ?", r.PathValue("id"))
	if err != nil {
		return err
	}
	if o == nil {
		return httpErr(http.StatusNotFound, "Order not found")
	}
	if o.UserID != nil {
		u := &OrderUser{}
		if err := a.db.QueryRowContext(r.Context(), `SELECT id, email FROM users WHERE id = ?`, *o.UserID).Scan(&u.ID, &u.Email); err == nil {
			o.User = u
		}
	}
	o.NextStatuses = allowedNext(o)
	return ok(w, o)
}

func (a *App) adminSetStatus(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r)
	if err != nil {
		return err
	}
	status, _, err := b.str("status")
	if err != nil || !oneOf(status, orderStatuses...) {
		return badField("status", "")
	}
	o, err := a.changeStatus(r.Context(), r.PathValue("id"), status)
	if err != nil {
		return err
	}
	return ok(w, o)
}

func (a *App) adminSetPayment(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r)
	if err != nil {
		return err
	}
	ps, _, err := b.str("paymentStatus")
	if err != nil || !oneOf(ps, "UNPAID", "PAID", "REFUNDED") {
		return badField("paymentStatus", "")
	}
	o, err := a.setPayment(r.Context(), r.PathValue("id"), ps)
	if err != nil {
		return err
	}
	return ok(w, o)
}

// ---------- Customers ----------

func (a *App) adminCustomers(w http.ResponseWriter, r *http.Request) error {
	ctx, qs := r.Context(), r.URL.Query()
	page, err := queryInt(r, "page", 1, 1, math32)
	if err != nil {
		return err
	}
	where, args := "u.role = 'CUSTOMER'", []any{}
	if v := qs.Get("q"); v != "" {
		l := likeArg(v)
		where += ` AND (u.name LIKE ? ESCAPE '\' OR u.email LIKE ? ESCAPE '\' OR u.phone LIKE ? ESCAPE '\')`
		args = append(args, l, l, l)
	}
	total, err := countRows(ctx, a.db, `SELECT COUNT(*) FROM users u WHERE `+where, args...)
	if err != nil {
		return err
	}
	rows, err := a.db.QueryContext(ctx, `SELECT u.id, u.name, u.email, u.phone, u.created_at,
	  (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id),
	  (SELECT COALESCE(SUM(total), 0) FROM orders o WHERE o.user_id = u.id AND o.status <> 'CANCELLED')
	  FROM users u WHERE `+where+` ORDER BY u.created_at DESC LIMIT 20 OFFSET ?`, append(args, (page-1)*20)...)
	if err != nil {
		return err
	}
	defer rows.Close()
	type customer struct {
		ID         string         `json:"id"`
		Name       string         `json:"name"`
		Email      string         `json:"email"`
		Phone      *string        `json:"phone"`
		CreatedAt  string         `json:"createdAt"`
		Count      map[string]int `json:"_count"`
		TotalSpent int            `json:"totalSpent"`
	}
	items := []customer{}
	for rows.Next() {
		var c customer
		var phone sql.NullString
		var orders int
		if err := rows.Scan(&c.ID, &c.Name, &c.Email, &phone, &c.CreatedAt, &orders, &c.TotalSpent); err != nil {
			return err
		}
		c.Phone, c.Count = strPtr(phone), map[string]int{"orders": orders}
		items = append(items, c)
	}
	return ok(w, paged[customer]{Items: items, Total: total, Page: page, Pages: pageCount(total, 20)})
}

func (a *App) adminCustomer(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	var c struct {
		ID        string  `json:"id"`
		Name      string  `json:"name"`
		Email     string  `json:"email"`
		Phone     *string `json:"phone"`
		CreatedAt string  `json:"createdAt"`
		Orders    []Order `json:"orders"`
	}
	var phone sql.NullString
	err := a.db.QueryRowContext(ctx, `SELECT id, name, email, phone, created_at FROM users WHERE id = ? AND role = 'CUSTOMER'`, r.PathValue("id")).
		Scan(&c.ID, &c.Name, &c.Email, &phone, &c.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return httpErr(http.StatusNotFound, "Customer not found")
	}
	if err != nil {
		return err
	}
	c.Phone = strPtr(phone)
	if c.Orders, err = queryOrders(ctx, a.db, `SELECT `+orderCols+` FROM orders o WHERE o.user_id = ? ORDER BY o.created_at DESC`, c.ID); err != nil {
		return err
	}
	return ok(w, c)
}

// ---------- AI models ----------

func (a *App) adminAiModels(w http.ResponseWriter, r *http.Request) error {
	list, err := a.listAiModels(r.Context(), false, true)
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (a *App) addAiModel(w http.ResponseWriter, r *http.Request) error {
	if err := parseMultipart(w, r); err != nil {
		return err
	}
	img, err := formImage(r, "image")
	if err != nil {
		return err
	}
	if img == nil {
		return httpErr(http.StatusBadRequest, "Choose a JPG, PNG or WebP photo.")
	}
	name, _ := formValue(r, "name")
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 40 {
		return badField("name", "Enter a name (up to 40 characters)")
	}
	url, err := a.saveUpload(img)
	if err != nil {
		return err
	}
	m := AiModel{ID: newID(), Name: name, ImageURL: url, IsActive: true, CreatedAt: nowTS()}
	if _, err := a.db.ExecContext(r.Context(), `INSERT INTO ai_models (id, name, image_url, is_active, created_at) VALUES (?, ?, ?, 1, ?)`, m.ID, m.Name, m.ImageURL, m.CreatedAt); err != nil {
		return err
	}
	return writeJSON(w, http.StatusCreated, m)
}

func (a *App) updateAiModel(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	var set []string
	var args []any
	if name, has, err := b.str("name"); err != nil {
		return err
	} else if has {
		name = strings.TrimSpace(name)
		if name == "" || len([]rune(name)) > 40 {
			return badField("name", "Enter a name (up to 40 characters)")
		}
		set, args = append(set, "name = ?"), append(args, name)
	}
	if v, has, err := b.boolean("isActive"); err != nil {
		return err
	} else if has {
		set, args = append(set, "is_active = ?"), append(args, boolInt(v))
	}
	if len(set) > 0 {
		if _, err := a.db.ExecContext(r.Context(), `UPDATE ai_models SET `+strings.Join(set, ", ")+` WHERE id = ?`, append(args, id)...); err != nil {
			return err
		}
	}
	var m AiModel
	if err := a.db.QueryRowContext(r.Context(), `SELECT id, name, image_url, is_active, created_at FROM ai_models WHERE id = ?`, id).Scan(&m.ID, &m.Name, &m.ImageURL, &m.IsActive, &m.CreatedAt); err != nil {
		return err
	}
	return ok(w, m)
}

// Models used in past try-ons are hidden instead of deleted, so that history stays intact.
func (a *App) deleteAiModel(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("id")
	used, err := countRows(r.Context(), a.db, `SELECT COUNT(*) FROM try_ons WHERE ai_model_id = ?`, id)
	if err != nil {
		return err
	}
	if used > 0 {
		if _, err := a.db.ExecContext(r.Context(), `UPDATE ai_models SET is_active = 0 WHERE id = ?`, id); err != nil {
			return err
		}
		return ok(w, map[string]bool{"hidden": true})
	}
	return a.execOne(w, r, `DELETE FROM ai_models WHERE id = ?`, id)
}

// ---------- Offers ----------

type OfferRow struct {
	ID         string  `json:"id"`
	Title      string  `json:"title"`
	PercentOff int     `json:"percentOff"`
	StartsAt   string  `json:"startsAt"`
	EndsAt     string  `json:"endsAt"`
	IsActive   bool    `json:"isActive"`
	ProductID  *string `json:"productId"`
	CategoryID *string `json:"categoryId"`
	CreatedAt  string  `json:"createdAt"`
	Product    *struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Code string `json:"code"`
	} `json:"product"`
	Category *struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"category"`
}

func (a *App) adminOffers(w http.ResponseWriter, r *http.Request) error {
	rows, err := a.db.QueryContext(r.Context(), `SELECT o.id, o.title, o.percent_off, o.starts_at, o.ends_at, o.is_active, o.product_id, o.category_id, o.created_at,
	  p.name, p.code, c.name FROM offers o LEFT JOIN products p ON p.id = o.product_id LEFT JOIN categories c ON c.id = o.category_id
	  ORDER BY o.is_active DESC, o.ends_at DESC`)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []OfferRow{}
	for rows.Next() {
		var o OfferRow
		var pid, cid, pname, pcode, cname sql.NullString
		if err := rows.Scan(&o.ID, &o.Title, &o.PercentOff, &o.StartsAt, &o.EndsAt, &o.IsActive, &pid, &cid, &o.CreatedAt, &pname, &pcode, &cname); err != nil {
			return err
		}
		o.ProductID, o.CategoryID = strPtr(pid), strPtr(cid)
		if pname.Valid {
			o.Product = &struct {
				ID   string `json:"id"`
				Name string `json:"name"`
				Code string `json:"code"`
			}{pid.String, pname.String, pcode.String}
		}
		if cname.Valid {
			o.Category = &struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			}{cid.String, cname.String}
		}
		out = append(out, o)
	}
	return ok(w, out)
}

func parseDate(s string) (time.Time, bool) {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04", "2006-01-02"} {
		if t, err := time.ParseInLocation(layout, s, time.Local); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

func (a *App) saveOffer(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r)
	if err != nil {
		return err
	}
	title, _, err := b.str("title")
	if err != nil {
		return err
	}
	title = strings.TrimSpace(title)
	if n := len([]rune(title)); n < 2 || n > 80 {
		return badField("title", "Enter a title (2 to 80 characters)")
	}
	pct, has, err := b.num("percentOff")
	if err != nil || !has || !isInt(pct) || pct < 1 || pct > 90 {
		return badField("percentOff", "Enter a discount from 1 to 90%")
	}
	dates := map[string]time.Time{}
	for _, k := range []string{"startsAt", "endsAt"} {
		s, _, err := b.str(k)
		t, valid := parseDate(s)
		if err != nil || !valid {
			return badField(k, "Choose a date")
		}
		dates[k] = t
	}
	if !dates["endsAt"].After(dates["startsAt"]) {
		return badField("endsAt", "End date must be after the start date")
	}
	active := true
	if v, has, err := b.boolean("isActive"); err != nil {
		return err
	} else if has {
		active = v
	}
	ref := func(k string) (*string, error) {
		s, _, err := b.str(k)
		if err != nil || s == "" {
			return nil, err
		}
		return &s, nil
	}
	productID, err := ref("productId")
	if err != nil {
		return err
	}
	categoryID, err := ref("categoryId")
	if err != nil {
		return err
	}
	if productID != nil && categoryID != nil {
		return badField("productId", "Choose a product or a category, not both")
	}

	id := r.PathValue("id")
	args := []any{title, int(pct), ts(dates["startsAt"]), ts(dates["endsAt"]), boolInt(active), nullStr(productID), nullStr(categoryID)}
	status := http.StatusOK
	if id == "" {
		id, status = newID(), http.StatusCreated
		_, err = a.db.ExecContext(r.Context(), `INSERT INTO offers (title, percent_off, starts_at, ends_at, is_active, product_id, category_id, id, created_at)
		  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, append(args, id, nowTS())...)
	} else {
		var res sql.Result
		res, err = a.db.ExecContext(r.Context(), `UPDATE offers SET title = ?, percent_off = ?, starts_at = ?, ends_at = ?, is_active = ?, product_id = ?, category_id = ? WHERE id = ?`, append(args, id)...)
		if err == nil {
			if n, _ := res.RowsAffected(); n == 0 {
				return errNotFound
			}
		}
	}
	if err != nil {
		return err
	}
	return writeJSON(w, status, map[string]any{"id": id, "title": title, "percentOff": int(pct), "startsAt": ts(dates["startsAt"]), "endsAt": ts(dates["endsAt"]),
		"isActive": active, "productId": productID, "categoryId": categoryID})
}

func (a *App) deleteOffer(w http.ResponseWriter, r *http.Request) error {
	return a.execOne(w, r, `DELETE FROM offers WHERE id = ?`, r.PathValue("id"))
}

// ---------- Reports ----------

func periodStart(t time.Time, unit string) time.Time {
	d := startOfDay(t.Local())
	switch unit {
	case "week": // weeks start on Monday
		return d.AddDate(0, 0, -((int(d.Weekday()) + 6) % 7))
	case "month":
		return time.Date(d.Year(), d.Month(), 1, 0, 0, 0, 0, time.Local)
	}
	return d
}

func (a *App) salesReport(w http.ResponseWriter, r *http.Request) error {
	rangeName := r.URL.Query().Get("range")
	if rangeName == "" {
		rangeName = "daily"
	}
	unit, limit := map[string]string{"daily": "day", "weekly": "week", "monthly": "month"}[rangeName], 12
	if unit == "" {
		return badField("range", "")
	}
	if unit == "day" {
		limit = 30
	}
	rows, err := a.db.QueryContext(r.Context(), `SELECT created_at, total FROM orders WHERE status <> 'CANCELLED'`)
	if err != nil {
		return err
	}
	defer rows.Close()
	type row struct {
		Period string `json:"period"`
		Orders int    `json:"orders"`
		Sales  int    `json:"sales"`
	}
	byPeriod := map[time.Time]*row{}
	for rows.Next() {
		var created string
		var total int
		if err := rows.Scan(&created, &total); err != nil {
			return err
		}
		p := periodStart(parseTS(created), unit)
		if byPeriod[p] == nil {
			byPeriod[p] = &row{Period: ts(p)}
		}
		byPeriod[p].Orders++
		byPeriod[p].Sales += total
	}
	keys := make([]time.Time, 0, len(byPeriod))
	for k := range byPeriod {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i].Before(keys[j]) })
	if len(keys) > limit {
		keys = keys[len(keys)-limit:]
	}
	out := make([]row, len(keys))
	for i, k := range keys {
		out[i] = *byPeriod[k]
	}
	return ok(w, out)
}

func (a *App) ordersReport(w http.ResponseWriter, r *http.Request) error {
	counts, err := a.ordersByStatus(r)
	if err != nil {
		return err
	}
	out := make([]map[string]any, len(orderStatuses))
	for i, s := range orderStatuses {
		out[i] = map[string]any{"status": s, "count": counts[s]}
	}
	return ok(w, out)
}

func (a *App) productsReport(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	type ref struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		Code      string `json:"code"`
		CreatedAt string `json:"createdAt,omitempty"`
	}
	list := func(query string, withDate bool) ([]ref, error) {
		rows, err := a.db.QueryContext(ctx, query)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		out := []ref{}
		for rows.Next() {
			var p ref
			dst := []any{&p.ID, &p.Name, &p.Code}
			if withDate {
				dst = append(dst, &p.CreatedAt)
			}
			if err := rows.Scan(dst...); err != nil {
				return nil, err
			}
			out = append(out, p)
		}
		return out, rows.Err()
	}
	outOfStock, err := list(`SELECT id, name, code FROM products WHERE stock = 0 AND is_active = 1 ORDER BY name`, false)
	if err != nil {
		return err
	}
	newest, err := list(`SELECT id, name, code, created_at FROM products ORDER BY created_at DESC LIMIT 10`, true)
	if err != nil {
		return err
	}

	type top struct {
		ProductID string `json:"productId"`
		Name      string `json:"name"`
		Qty       int    `json:"qty"`
	}
	best := []top{}
	rows, err := a.db.QueryContext(ctx, `SELECT oi.product_id, oi.name, SUM(oi.qty) AS sold FROM order_items oi JOIN orders o ON o.id = oi.order_id
	  WHERE o.status <> 'CANCELLED' GROUP BY oi.product_id, oi.name ORDER BY sold DESC LIMIT 10`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var t top
		if err := rows.Scan(&t.ProductID, &t.Name, &t.Qty); err != nil {
			rows.Close()
			return err
		}
		best = append(best, t)
	}
	rows.Close()

	type tried struct {
		ID    *string `json:"id,omitempty"`
		Name  *string `json:"name,omitempty"`
		Code  *string `json:"code,omitempty"`
		Tries int     `json:"tries"`
	}
	mostTried := []tried{}
	rows, err = a.db.QueryContext(ctx, `SELECT p.id, p.name, p.code, COUNT(*) AS n FROM try_on_items ti LEFT JOIN products p ON p.id = ti.product_id
	  GROUP BY ti.product_id ORDER BY n DESC LIMIT 10`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var t tried
		var id, name, code sql.NullString
		if err := rows.Scan(&id, &name, &code, &t.Tries); err != nil {
			return err
		}
		t.ID, t.Name, t.Code = strPtr(id), strPtr(name), strPtr(code)
		mostTried = append(mostTried, t)
	}
	return ok(w, map[string]any{"top": best, "outOfStock": outOfStock, "newest": newest, "mostTried": mostTried})
}
