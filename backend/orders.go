package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var orderStatuses = []string{"PENDING", "CONFIRMED", "PROCESSING", "READY", "DISPATCHED", "DELIVERED", "CANCELLED"}

// PENDING → CONFIRMED → PROCESSING → READY → DISPATCHED → DELIVERED; CANCELLED before dispatch.
var nextStatuses = map[string][]string{
	"PENDING":    {"CONFIRMED", "CANCELLED"},
	"CONFIRMED":  {"PROCESSING", "CANCELLED"},
	"PROCESSING": {"READY", "CANCELLED"},
	"READY":      {"DISPATCHED", "DELIVERED", "CANCELLED"}, // DELIVERED straight from READY for store pickup
	"DISPATCHED": {"DELIVERED"},
	"DELIVERED":  {},
	"CANCELLED":  {},
}

type OrderItemProduct struct {
	Slug   string  `json:"slug"`
	Code   string  `json:"code,omitempty"`
	Images []Image `json:"images"`
}

type OrderItem struct {
	ID        string            `json:"id"`
	OrderID   string            `json:"orderId"`
	ProductID string            `json:"productId"`
	Name      string            `json:"name"`
	Price     int               `json:"price"`
	Qty       int               `json:"qty"`
	Colour    string            `json:"colour"`
	Size      string            `json:"size"`
	Kind      string            `json:"kind"` // BUY or RENT
	RentFrom  *string           `json:"rentFrom"`
	RentTo    *string           `json:"rentTo"`
	Deposit   int               `json:"deposit"`
	Product   *OrderItemProduct `json:"product,omitempty"`
}

// label describes a line for messages, emails and reports, for example
// "Gold bangles (Rose gold, size 2.4)" or "Bridal set (rent 12 Nov to 14 Nov)".
func (it OrderItem) label() string {
	out := it.Name
	var choice []string
	if it.Colour != "" {
		choice = append(choice, it.Colour)
	}
	if it.Size != "" {
		choice = append(choice, "size "+it.Size)
	}
	if len(choice) > 0 {
		out += " (" + strings.Join(choice, ", ") + ")"
	}
	if it.Kind == "RENT" && it.RentFrom != nil && it.RentTo != nil {
		out += " (rent " + shortDay(*it.RentFrom) + " to " + shortDay(*it.RentTo) + ")"
	}
	return out
}

// Label is label() for templates.
func (it OrderItem) Label() string { return it.label() }

func shortDay(d string) string {
	t, err := time.ParseInLocation(dayLayout, d, time.Local)
	if err != nil {
		return d
	}
	return t.Format("2 Jan 2006")
}

type StatusLog struct {
	ID        string `json:"id"`
	OrderID   string `json:"orderId"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
}

type OrderUser struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

type Order struct {
	ID                string      `json:"id"`
	OrderNo           string      `json:"orderNo"`
	UserID            *string     `json:"userId"`
	FullName          string      `json:"fullName"`
	Mobile            string      `json:"mobile"`
	Whatsapp          *string     `json:"whatsapp"`
	Email             *string     `json:"email"`
	Address           *string     `json:"address"`
	City              *string     `json:"city"`
	PostalCode        *string     `json:"postalCode"`
	Note              *string     `json:"note"`
	DeliveryMethod    string      `json:"deliveryMethod"`
	PaymentMethod     string      `json:"paymentMethod"`
	PaymentStatus     string      `json:"paymentStatus"`
	Subtotal          int         `json:"subtotal"`
	DeliveryFee       int         `json:"deliveryFee"`
	Total             int         `json:"total"`
	Status            string      `json:"status"`
	PaymentSlipURL    *string     `json:"paymentSlipUrl"`
	PaymentRef        *string     `json:"paymentRef"`
	PaymentSlipAt     *string     `json:"paymentSlipAt"`
	Deposit           int         `json:"deposit"` // refundable rental deposits, included in Total
	DepositRefundedAt *string     `json:"depositRefundedAt"`
	CreatedAt         string      `json:"createdAt"`
	Items             []OrderItem `json:"items,omitempty"`
	History           []StatusLog `json:"history,omitempty"`
	Count             *struct {
		Items int `json:"items"`
	} `json:"_count,omitempty"`
	User         *OrderUser `json:"user,omitempty"`
	NextStatuses []string   `json:"nextStatuses,omitempty"`
	Confirmed    *bool      `json:"confirmed,omitempty"`
}

const orderCols = `o.id, o.order_no, o.user_id, o.full_name, o.mobile, o.whatsapp, o.email, o.address, o.city, o.postal_code, o.note,
  o.delivery_method, o.payment_method, o.payment_status, o.subtotal, o.delivery_fee, o.total, o.status,
  o.payment_slip_url, o.payment_ref, o.payment_slip_at, o.deposit, o.deposit_refunded_at, o.created_at`

func scanOrder(sc interface{ Scan(...any) error }) (Order, error) {
	var o Order
	var uid, wa, email, addr, city, postal, note, slip, ref, slipAt, refunded sql.NullString
	err := sc.Scan(&o.ID, &o.OrderNo, &uid, &o.FullName, &o.Mobile, &wa, &email, &addr, &city, &postal, &note,
		&o.DeliveryMethod, &o.PaymentMethod, &o.PaymentStatus, &o.Subtotal, &o.DeliveryFee, &o.Total, &o.Status,
		&slip, &ref, &slipAt, &o.Deposit, &refunded, &o.CreatedAt)
	o.PaymentSlipURL, o.PaymentRef, o.PaymentSlipAt, o.DepositRefundedAt = strPtr(slip), strPtr(ref), strPtr(slipAt), strPtr(refunded)
	o.UserID, o.Whatsapp, o.Email, o.Address, o.City, o.PostalCode, o.Note = strPtr(uid), strPtr(wa), strPtr(email), strPtr(addr), strPtr(city), strPtr(postal), strPtr(note)
	return o, err
}

func queryOrders(ctx context.Context, q querier, query string, args ...any) ([]Order, error) {
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Order{}
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// attachOrderDetail adds the items (with each product's slug, code and main photo) and the status history.
func attachOrderDetail(ctx context.Context, q querier, orders []Order) error {
	if len(orders) == 0 {
		return nil
	}
	ids := make([]string, len(orders))
	index := map[string]*Order{}
	for i := range orders {
		ids[i] = orders[i].ID
		orders[i].Items, orders[i].History = []OrderItem{}, []StatusLog{}
		index[orders[i].ID] = &orders[i]
	}
	rows, err := q.QueryContext(ctx, `SELECT oi.id, oi.order_id, oi.product_id, oi.name, oi.price, oi.qty, oi.colour, oi.size, oi.kind, oi.rent_from, oi.rent_to, oi.deposit, p.slug, p.code,
	  (SELECT pi.id FROM product_images pi WHERE pi.product_id = oi.product_id ORDER BY pi.sort, pi.id LIMIT 1),
	  (SELECT pi.url FROM product_images pi WHERE pi.product_id = oi.product_id ORDER BY pi.sort, pi.id LIMIT 1)
	  FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
	  WHERE oi.order_id IN (`+placeholders(len(ids))+`) ORDER BY oi.id`, toAny(ids)...)
	if err != nil {
		return err
	}
	for rows.Next() {
		var it OrderItem
		var slug, code, imgID, imgURL, from, to sql.NullString
		if err := rows.Scan(&it.ID, &it.OrderID, &it.ProductID, &it.Name, &it.Price, &it.Qty, &it.Colour, &it.Size, &it.Kind, &from, &to, &it.Deposit, &slug, &code, &imgID, &imgURL); err != nil {
			rows.Close()
			return err
		}
		it.RentFrom, it.RentTo = strPtr(from), strPtr(to)
		if slug.Valid {
			it.Product = &OrderItemProduct{Slug: slug.String, Code: code.String, Images: []Image{}}
			if imgURL.Valid {
				it.Product.Images = []Image{{ID: imgID.String, URL: imgURL.String}}
			}
		}
		o := index[it.OrderID]
		o.Items = append(o.Items, it)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	rows, err = q.QueryContext(ctx, `SELECT id, order_id, status, created_at FROM order_status_logs WHERE order_id IN (`+placeholders(len(ids))+`) ORDER BY created_at, id`, toAny(ids)...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var h StatusLog
		if err := rows.Scan(&h.ID, &h.OrderID, &h.Status, &h.CreatedAt); err != nil {
			return err
		}
		o := index[h.OrderID]
		o.History = append(o.History, h)
	}
	return rows.Err()
}

func (a *App) orderDetail(ctx context.Context, where string, args ...any) (*Order, error) {
	list, err := queryOrders(ctx, a.db, `SELECT `+orderCols+` FROM orders o WHERE `+where+` LIMIT 1`, args...)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	if err := attachOrderDetail(ctx, a.db, list); err != nil {
		return nil, err
	}
	return &list[0], nil
}

// Orders are confirmed once the payment is received. (Cash on delivery orders from
// before bank transfer became the only method are confirmed by the shop.)
func needsPaymentFirst(o *Order) bool { return o.PaymentMethod != "COD" && o.PaymentStatus != "PAID" }

func allowedNext(o *Order) []string {
	out := []string{}
	for _, s := range nextStatuses[o.Status] {
		if !(s == "CONFIRMED" && needsPaymentFirst(o)) {
			out = append(out, s)
		}
	}
	return out
}

// ---------- Checkout ----------

type checkoutInput struct {
	FullName, Mobile                                 string
	Whatsapp, Email, Address, City, PostalCode, Note *string
	DeliveryMethod, PaymentMethod                    string
}

func readCheckout(b body) (*checkoutInput, error) {
	in := &checkoutInput{}
	text := func(k string) (string, error) {
		s, _, err := b.str(k)
		return strings.TrimSpace(s), err
	}
	var err error
	if in.FullName, err = text("fullName"); err != nil {
		return nil, err
	}
	if len([]rune(in.FullName)) < 2 {
		return nil, badField("fullName", "Enter your full name")
	}
	if in.Mobile, err = text("mobile"); err != nil {
		return nil, err
	}
	if !mobileRe.MatchString(in.Mobile) {
		return nil, badField("mobile", "Enter a mobile number like 07XXXXXXXX")
	}
	optional := func(k string) (*string, error) {
		s, err := text(k)
		if err != nil || s == "" {
			return nil, err
		}
		if len([]rune(s)) > 300 {
			return nil, badField(k, "Keep this under 300 characters")
		}
		return &s, nil
	}
	for k, dst := range map[string]**string{"whatsapp": &in.Whatsapp, "address": &in.Address, "city": &in.City, "postalCode": &in.PostalCode, "note": &in.Note} {
		if *dst, err = optional(k); err != nil {
			return nil, err
		}
	}
	email, err := text("email")
	if err != nil {
		return nil, err
	}
	// Email is required: the order confirmation and tracking details are sent there.
	if email == "" {
		return nil, badField("email", "Enter your email so we can send your order confirmation")
	}
	if !validEmail(email) {
		return nil, badField("email", "Enter a valid email")
	}
	in.Email = &email
	if in.DeliveryMethod, err = text("deliveryMethod"); err != nil || !oneOf(in.DeliveryMethod, "DELIVERY", "PICKUP") {
		return nil, badField("deliveryMethod", "")
	}
	// Bank transfer is the only payment method.
	if in.PaymentMethod, err = text("paymentMethod"); err != nil || !oneOf(in.PaymentMethod, "", "BANK_TRANSFER") {
		return nil, badField("paymentMethod", "")
	}
	in.PaymentMethod = "BANK_TRANSFER"
	return in, nil
}

var digitsRe = regexp.MustCompile(`\D`)

func nextOrderNo(ctx context.Context, tx *sql.Tx) (string, error) {
	var last string
	err := tx.QueryRowContext(ctx, `SELECT order_no FROM orders ORDER BY created_at DESC, order_no DESC LIMIT 1`).Scan(&last)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	n, _ := strconv.Atoi(digitsRe.ReplaceAllString(last, ""))
	return fmt.Sprintf("ORD-%06d", n+1), nil
}

func (a *App) placeOrder(ctx context.Context, cartID string, userID *string, in *checkoutInput) (string, error) {
	s, err := getSettings(ctx, a.db)
	if err != nil {
		return "", err
	}
	if in.DeliveryMethod == "DELIVERY" && (in.Address == nil || in.City == nil) {
		return "", httpErr(http.StatusBadRequest, "Enter your address and city for delivery.")
	}
	if in.DeliveryMethod == "PICKUP" && !s.PickupEnabled {
		return "", httpErr(http.StatusBadRequest, "Store pickup isn't available right now.")
	}
	// The write lock is taken when the transaction starts, so stock checks, rental
	// bookings and the order number can't race with another checkout.
	orderID := newID()
	err = withTx(ctx, a.db, func(tx *sql.Tx) error {
		lines, err := loadCartLines(ctx, tx, cartID)
		if err != nil {
			return err
		}
		items, err := priceLines(ctx, tx, lines)
		if err != nil {
			return err
		}
		if len(items) == 0 {
			return httpErr(http.StatusBadRequest, "Your cart is empty.")
		}
		subtotal, deposit := 0, 0
		for _, it := range items {
			if !it.InStock {
				return httpErr(http.StatusConflict, "%s: %s", it.Product.Name, it.Problem)
			}
			if it.Kind == "BUY" {
				enough, err := takeStock(ctx, tx, it.Product, it.Colour, it.Size, -it.Qty)
				if err != nil {
					return err
				}
				if !enough {
					return httpErr(http.StatusConflict, "%s doesn't have enough stock. Update your cart and try again.", it.Product.Name)
				}
			}
			subtotal += it.LineTotal
			deposit += it.Deposit
		}
		fee := 0
		if in.DeliveryMethod == "DELIVERY" {
			fee = deliveryFeeFor(s, subtotal)
		}
		orderNo, err := nextOrderNo(ctx, tx)
		if err != nil {
			return err
		}
		now := nowTS()
		if _, err := tx.ExecContext(ctx, `INSERT INTO orders (id, order_no, user_id, full_name, mobile, whatsapp, email, address, city, postal_code, note,
		  delivery_method, payment_method, payment_status, subtotal, delivery_fee, deposit, total, status, created_at)
		  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNPAID', ?, ?, ?, ?, 'PENDING', ?)`,
			orderID, orderNo, nullStr(userID), in.FullName, in.Mobile, nullStr(in.Whatsapp), nullStr(in.Email), nullStr(in.Address), nullStr(in.City),
			nullStr(in.PostalCode), nullStr(in.Note), in.DeliveryMethod, in.PaymentMethod, subtotal, fee, deposit, subtotal+fee+deposit, now); err != nil {
			return err
		}
		for _, it := range items {
			var from, to any
			if it.Kind == "RENT" {
				from, to = it.RentFrom, it.RentTo
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO order_items (id, order_id, product_id, name, price, qty, colour, size, kind, rent_from, rent_to, deposit)
			  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				newID(), orderID, it.ProductID, it.Product.Name, it.UnitPrice, it.Qty, it.Colour, it.Size, it.Kind, from, to, it.Deposit); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO order_status_logs (id, order_id, status, created_at) VALUES (?, ?, 'PENDING', ?)`, newID(), orderID, now); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM cart_items WHERE cart_id = ?`, cartID)
		return err
	})
	return orderID, err
}

func (a *App) createOrder(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r)
	if err != nil {
		return err
	}
	in, err := readCheckout(b)
	if err != nil {
		return err
	}
	ctx := r.Context()
	cartID, err := a.resolveCart(ctx, a.db, r)
	if err != nil {
		return err
	}
	var userID *string
	if u := a.currentUser(r); u != nil {
		userID = &u.ID
	}
	id, err := a.placeOrder(ctx, cartID, userID, in)
	if err != nil {
		return err
	}
	o, err := a.orderDetail(ctx, "o.id = ?", id)
	if err != nil {
		return err
	}
	go a.notifyOrderPlaced(*o)
	return writeJSON(w, http.StatusCreated, o)
}

func (a *App) myOrders(w http.ResponseWriter, r *http.Request) error {
	u, err := a.requireUser(r)
	if err != nil {
		return err
	}
	list, err := queryOrders(r.Context(), a.db, `SELECT `+orderCols+` FROM orders o WHERE o.user_id = ? ORDER BY o.created_at DESC`, u.ID)
	if err != nil {
		return err
	}
	if err := attachOrderDetail(r.Context(), a.db, list); err != nil {
		return err
	}
	return ok(w, list)
}

// Public tracking: order number + mobile number
func (a *App) trackOrder(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	if !q.Has("orderNo") {
		return badField("orderNo", "")
	}
	if !q.Has("mobile") {
		return badField("mobile", "")
	}
	orderNo, mobile := strings.ToUpper(strings.TrimSpace(q.Get("orderNo"))), strings.TrimSpace(q.Get("mobile"))
	if !strings.HasPrefix(orderNo, "ORD-") {
		n, _ := strconv.Atoi(digitsRe.ReplaceAllString(orderNo, ""))
		orderNo = fmt.Sprintf("ORD-%06d", n)
	}
	o, err := a.orderDetail(r.Context(), "o.order_no = ? AND o.mobile = ?", orderNo, mobile)
	if err != nil {
		return err
	}
	if o == nil {
		return httpErr(http.StatusNotFound, "No order matches that order number and mobile number.")
	}
	return ok(w, o)
}

// ---------- Status and payment (admin) ----------

func (a *App) changeStatus(ctx context.Context, orderID, to string) (*Order, error) {
	o, err := a.orderDetail(ctx, "o.id = ?", orderID)
	if err != nil {
		return nil, err
	}
	if o == nil {
		return nil, httpErr(http.StatusNotFound, "Order not found")
	}
	if !oneOf(to, nextStatuses[o.Status]...) {
		return nil, httpErr(http.StatusConflict, "An order that is %s can't be moved to %s.", strings.ToLower(o.Status), strings.ToLower(to))
	}
	if to == "CONFIRMED" && needsPaymentFirst(o) {
		return nil, httpErr(http.StatusConflict, "Mark the payment as paid first. The order is confirmed when the payment is received.")
	}
	err = withTx(ctx, a.db, func(tx *sql.Tx) error {
		if to == "CANCELLED" {
			ids := make([]string, 0, len(o.Items))
			for _, it := range o.Items {
				ids = append(ids, it.ProductID)
			}
			products, err := productsByID(ctx, tx, ids)
			if err != nil {
				return err
			}
			for _, it := range o.Items {
				p, found := products[it.ProductID]
				if it.Kind == "RENT" || !found {
					continue // cancelling frees the rental dates; there is no stock to return
				}
				if _, err := takeStock(ctx, tx, p, it.Colour, it.Size, it.Qty); err != nil {
					return err
				}
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO order_status_logs (id, order_id, status, created_at) VALUES (?, ?, ?, ?)`, newID(), orderID, to, nowTS()); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE orders SET status = ? WHERE id = ?`, to, orderID)
		return err
	})
	if err != nil {
		return nil, err
	}
	o.Status = to
	go a.notifyStatusChanged(*o)
	return o, nil
}

// setPayment records the payment; marking a pending order as paid also confirms it and tells the customer.
func (a *App) setPayment(ctx context.Context, orderID, paymentStatus string) (*Order, error) {
	o, err := a.orderDetail(ctx, "o.id = ?", orderID)
	if err != nil {
		return nil, err
	}
	if o == nil {
		return nil, httpErr(http.StatusNotFound, "Order not found")
	}
	confirm := paymentStatus == "PAID" && o.Status == "PENDING"
	err = withTx(ctx, a.db, func(tx *sql.Tx) error {
		if confirm {
			if _, err := tx.ExecContext(ctx, `INSERT INTO order_status_logs (id, order_id, status, created_at) VALUES (?, ?, 'CONFIRMED', ?)`, newID(), orderID, nowTS()); err != nil {
				return err
			}
			o.Status = "CONFIRMED"
		}
		_, err := tx.ExecContext(ctx, `UPDATE orders SET payment_status = ?, status = ? WHERE id = ?`, paymentStatus, o.Status, orderID)
		return err
	})
	if err != nil {
		return nil, err
	}
	o.PaymentStatus = paymentStatus
	o.Confirmed = &confirm
	if confirm {
		go a.notifyPaymentConfirmed(*o)
	}
	return o, nil
}

// ---------- Payment slip ----------

var slipExt = map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf"}

// POST /api/orders/{orderNo}/payment-slip (multipart: mobile, reference?, slip)
// The customer uploads the bank transfer slip. Guests prove the order is theirs
// with the mobile number used at checkout, as on the tracking page.
func (a *App) uploadPaymentSlip(w http.ResponseWriter, r *http.Request) error {
	if err := parseMultipart(w, r); err != nil {
		return err
	}
	ctx := r.Context()
	mobile, _ := formValue(r, "mobile")
	where, args := "o.order_no = ? AND o.mobile = ?", []any{r.PathValue("orderNo"), strings.TrimSpace(mobile)}
	if u := a.currentUser(r); u != nil && strings.TrimSpace(mobile) == "" {
		where, args = "o.order_no = ? AND o.user_id = ?", []any{r.PathValue("orderNo"), u.ID}
	}
	o, err := a.orderDetail(ctx, where, args...)
	if err != nil {
		return err
	}
	if o == nil {
		return httpErr(http.StatusNotFound, "No order matches that order number and mobile number.")
	}
	if o.PaymentMethod != "BANK_TRANSFER" || o.PaymentStatus != "UNPAID" || o.Status != "PENDING" {
		return httpErr(http.StatusConflict, "This order doesn't need a payment slip.")
	}

	ref, _ := formValue(r, "reference")
	ref = strings.TrimSpace(ref)
	if len([]rune(ref)) > 60 {
		return badField("reference", "Keep the reference under 60 characters")
	}
	var slip *multipart.FileHeader
	if files := r.MultipartForm.File["slip"]; len(files) > 0 {
		slip = files[0]
	}
	if slip == nil {
		return badField("slip", "Choose a photo or PDF of your payment slip.")
	}
	if slipExt[slip.Header.Get("Content-Type")] == "" {
		return badField("slip", "Upload the slip as a JPG, PNG, WebP or PDF file.")
	}
	if slip.Size > maxUpload {
		return badField("slip", "That file is over 8 MB. Choose a smaller one.")
	}
	url, err := a.saveUpload(slip)
	if err != nil {
		return err
	}
	var refArg any
	if ref != "" {
		refArg = ref
	}
	if _, err := a.db.ExecContext(ctx, `UPDATE orders SET payment_slip_url = ?, payment_ref = ?, payment_slip_at = ? WHERE id = ?`, url, refArg, nowTS(), o.ID); err != nil {
		return err
	}
	o, err = a.orderDetail(ctx, "o.id = ?", o.ID)
	if err != nil {
		return err
	}
	go a.notifySlipReceived(*o)
	return ok(w, o)
}
