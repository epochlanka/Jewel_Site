package main

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"time"
)

// Rental dates are whole days (YYYY-MM-DD, shop's local time). A booking covers the
// pickup day through the return day, both included.

const dayLayout = "2006-01-02"

const maxRentDays = 30

type rentalDates struct {
	From, To string
	Days     int
}

func parseRentalDates(from, to string) (rentalDates, error) {
	f, err1 := time.ParseInLocation(dayLayout, from, time.Local)
	t, err2 := time.ParseInLocation(dayLayout, to, time.Local)
	if err1 != nil || err2 != nil {
		return rentalDates{}, httpErr(http.StatusBadRequest, "Choose a pickup date and a return date.")
	}
	today := startOfDay(time.Now())
	switch {
	case f.Before(today):
		return rentalDates{}, httpErr(http.StatusBadRequest, "The pickup date can't be in the past.")
	case t.Before(f):
		return rentalDates{}, httpErr(http.StatusBadRequest, "The return date must be on or after the pickup date.")
	case f.After(today.AddDate(1, 0, 0)):
		return rentalDates{}, httpErr(http.StatusBadRequest, "Rentals can be booked up to a year ahead.")
	}
	days := int(t.Sub(f).Hours()/24+0.5) + 1
	if days > maxRentDays {
		return rentalDates{}, httpErr(http.StatusBadRequest, "A rental can be up to 30 days.")
	}
	return rentalDates{From: from, To: to, Days: days}, nil
}

// rentFor is the rent for a booking: the fixed price covers RentDays, then each extra day is charged.
func rentFor(p Product, days int) int {
	return p.RentPrice + max(0, days-p.RentDays)*p.RentExtraDay
}

// bookedUnits counts bookings of a piece that overlap the dates. Cancelled orders don't count.
func bookedUnits(ctx context.Context, q querier, productID string, d rentalDates) (int, error) {
	return countRows(ctx, q, `SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id = oi.order_id
	  WHERE oi.product_id = ? AND oi.kind = 'RENT' AND o.status <> 'CANCELLED' AND oi.rent_from <= ? AND oi.rent_to >= ?`,
		productID, d.To, d.From)
}

func checkRentable(ctx context.Context, q querier, p Product, d rentalDates) error {
	if !p.IsActive || !p.ForRent {
		return httpErr(http.StatusBadRequest, "%s isn't available for rent.", p.Name)
	}
	n, err := bookedUnits(ctx, q, p.ID, d)
	if err != nil {
		return err
	}
	if n >= p.RentUnits {
		return httpErr(http.StatusConflict, "%s is already booked for some of those dates. Choose other dates.", p.Name)
	}
	return nil
}

// GET /api/products/{slug}/bookings: upcoming booked date ranges, so the product page
// can show which days are taken. No customer details are included.
func (a *App) productBookings(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	var id string
	var units int
	err := a.db.QueryRowContext(ctx, `SELECT id, rent_units FROM products WHERE slug = ? AND is_active = 1 AND for_rent = 1`, r.PathValue("slug")).Scan(&id, &units)
	if errors.Is(err, sql.ErrNoRows) {
		return httpErr(http.StatusNotFound, "This piece isn't available for rent.")
	}
	if err != nil {
		return err
	}
	rows, err := a.db.QueryContext(ctx, `SELECT oi.rent_from, oi.rent_to FROM order_items oi JOIN orders o ON o.id = oi.order_id
	  WHERE oi.product_id = ? AND oi.kind = 'RENT' AND o.status <> 'CANCELLED' AND oi.rent_to >= ? ORDER BY oi.rent_from`,
		id, time.Now().Format(dayLayout))
	if err != nil {
		return err
	}
	defer rows.Close()
	type booking struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	list := []booking{}
	for rows.Next() {
		var b booking
		if err := rows.Scan(&b.From, &b.To); err != nil {
			return err
		}
		list = append(list, b)
	}
	return ok(w, map[string]any{"units": units, "bookings": list})
}

// ---------- Admin ----------

// GET /api/admin/rentals?when=upcoming|out|past
func (a *App) adminRentals(w http.ResponseWriter, r *http.Request) error {
	today := time.Now().Format(dayLayout)
	where := map[string]string{
		"upcoming": `oi.rent_from >= ?`,                                      // not picked up yet
		"out":      `oi.rent_from < ? AND o.deposit_refunded_at IS NULL`,     // with the customer
		"past":     `oi.rent_from < ? AND o.deposit_refunded_at IS NOT NULL`, // returned
	}[r.URL.Query().Get("when")]
	if where == "" {
		where = `oi.rent_from >= ?`
	}
	order := "oi.rent_from"
	if r.URL.Query().Get("when") == "past" {
		order = "oi.rent_from DESC"
	}
	rows, err := a.db.QueryContext(r.Context(), `SELECT o.id, o.order_no, o.full_name, o.mobile, o.status, o.payment_status, o.deposit_refunded_at,
	  oi.name, oi.size, oi.rent_from, oi.rent_to, oi.price, oi.deposit
	  FROM order_items oi JOIN orders o ON o.id = oi.order_id
	  WHERE oi.kind = 'RENT' AND o.status <> 'CANCELLED' AND `+where+` ORDER BY `+order+` LIMIT 200`, today)
	if err != nil {
		return err
	}
	defer rows.Close()
	type rental struct {
		OrderID       string  `json:"orderId"`
		OrderNo       string  `json:"orderNo"`
		FullName      string  `json:"fullName"`
		Mobile        string  `json:"mobile"`
		Status        string  `json:"status"`
		PaymentStatus string  `json:"paymentStatus"`
		ReturnedAt    *string `json:"returnedAt"`
		Name          string  `json:"name"`
		Size          string  `json:"size"`
		From          string  `json:"from"`
		To            string  `json:"to"`
		Rent          int     `json:"rent"`
		Deposit       int     `json:"deposit"`
	}
	out := []rental{}
	for rows.Next() {
		var x rental
		var ret sql.NullString
		if err := rows.Scan(&x.OrderID, &x.OrderNo, &x.FullName, &x.Mobile, &x.Status, &x.PaymentStatus, &ret, &x.Name, &x.Size, &x.From, &x.To, &x.Rent, &x.Deposit); err != nil {
			return err
		}
		x.ReturnedAt = strPtr(ret)
		out = append(out, x)
	}
	return ok(w, out)
}

// PATCH /api/admin/orders/{id}/rental-returned: the pieces came back and the deposit was refunded.
func (a *App) markRentalReturned(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	o, err := a.orderDetail(ctx, "o.id = ?", r.PathValue("id"))
	if err != nil {
		return err
	}
	if o == nil {
		return httpErr(http.StatusNotFound, "Order not found")
	}
	rentals := 0
	for _, it := range o.Items {
		if it.Kind == "RENT" {
			rentals++
		}
	}
	if rentals == 0 {
		return httpErr(http.StatusConflict, "This order has no rentals.")
	}
	if o.DepositRefundedAt != nil {
		return httpErr(http.StatusConflict, "This rental is already marked as returned.")
	}
	if o.Status != "DELIVERED" {
		return httpErr(http.StatusConflict, "Mark the order as delivered or collected first.")
	}
	now := nowTS()
	if _, err := a.db.ExecContext(ctx, `UPDATE orders SET deposit_refunded_at = ? WHERE id = ?`, now, o.ID); err != nil {
		return err
	}
	o.DepositRefundedAt = &now
	go a.notifyRentalReturned(*o)
	return ok(w, o)
}
