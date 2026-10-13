package main

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
)

// A cart line is either a purchase (BUY, optionally in a colour and size) or a rental (RENT) for a
// pickup and return date. Rentals are always one piece per line.
type CartItem struct {
	ID        string  `json:"id"`
	CartID    string  `json:"cartId"`
	ProductID string  `json:"productId"`
	Qty       int     `json:"qty"`
	Colour    string  `json:"colour"`
	Size      string  `json:"size"`
	Kind      string  `json:"kind"`
	RentFrom  string  `json:"rentFrom"`
	RentTo    string  `json:"rentTo"`
	RentDays  int     `json:"rentDays"`
	Deposit   int     `json:"deposit"`
	Product   Product `json:"product"`
	UnitPrice int     `json:"unitPrice"`
	LineTotal int     `json:"lineTotal"`
	InStock   bool    `json:"inStock"` // false when the size is sold out or the rental dates are taken
	Problem   string  `json:"problem,omitempty"`
	MaxQty    int     `json:"maxQty"`
}

type CartView struct {
	ID               string     `json:"id"`
	Items            []CartItem `json:"items"`
	Subtotal         int        `json:"subtotal"`
	Deposit          int        `json:"deposit"`
	DeliveryFee      int        `json:"deliveryFee"`
	Total            int        `json:"total"` // subtotal + delivery + refundable deposits
	FreeDeliveryOver *int       `json:"freeDeliveryOver"`
}

// resolveCart finds or creates the cart for this request: by user when signed in,
// otherwise by the X-Cart-Key header (a random id the browser keeps).
func (a *App) resolveCart(ctx context.Context, q querier, r *http.Request) (string, error) {
	var id string
	if u := a.currentUser(r); u != nil {
		err := q.QueryRowContext(ctx, `INSERT INTO carts (id, user_id, updated_at) VALUES (?, ?, ?)
		  ON CONFLICT (user_id) DO UPDATE SET updated_at = excluded.updated_at RETURNING id`, newID(), u.ID, nowTS()).Scan(&id)
		return id, err
	}
	key := r.Header.Get("X-Cart-Key")
	if key == "" {
		return "", httpErr(http.StatusBadRequest, "Missing cart key")
	}
	err := q.QueryRowContext(ctx, `INSERT INTO carts (id, guest_key, updated_at) VALUES (?, ?, ?)
	  ON CONFLICT (guest_key) DO UPDATE SET updated_at = excluded.updated_at RETURNING id`, newID(), key, nowTS()).Scan(&id)
	return id, err
}

func loadCartLines(ctx context.Context, q querier, cartID string) ([]CartItem, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, product_id, qty, colour, size, kind, rent_from, rent_to FROM cart_items WHERE cart_id = ? ORDER BY id`, cartID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CartItem
	for rows.Next() {
		it := CartItem{CartID: cartID}
		if err := rows.Scan(&it.ID, &it.ProductID, &it.Qty, &it.Colour, &it.Size, &it.Kind, &it.RentFrom, &it.RentTo); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

func productsByID(ctx context.Context, q querier, ids []string) (map[string]Product, error) {
	out := map[string]Product{}
	if len(ids) == 0 {
		return out, nil
	}
	list, err := queryProducts(ctx, q, `SELECT `+productCols+` FROM products p WHERE p.id IN (`+placeholders(len(ids))+`)`, toAny(ids)...)
	if err != nil {
		return nil, err
	}
	for _, p := range list {
		out[p.ID] = p
	}
	return out, nil
}

// priceLines fills in prices and checks every line. It is shared by the cart and checkout.
func priceLines(ctx context.Context, q querier, lines []CartItem) ([]CartItem, error) {
	ids := make([]string, 0, len(lines))
	for _, l := range lines {
		ids = append(ids, l.ProductID)
	}
	products, err := productsByID(ctx, q, ids)
	if err != nil {
		return nil, err
	}
	list := make([]Product, 0, len(products))
	for _, p := range products {
		list = append(list, p)
	}
	if err := attachImages(ctx, q, list, true); err != nil {
		return nil, err
	}
	if err := withPricing(ctx, q, list); err != nil {
		return nil, err
	}
	for _, p := range list {
		products[p.ID] = p
	}

	out := []CartItem{}
	for _, it := range lines {
		p, found := products[it.ProductID]
		if !found || !p.IsActive {
			continue
		}
		it.Product, it.InStock = p, true
		if it.Kind == "RENT" {
			d, err := parseRentalDates(it.RentFrom, it.RentTo)
			if err != nil {
				it.InStock, it.Problem = false, err.Error()
			} else if err := checkRentable(ctx, q, p, d); err != nil {
				var he *HTTPError
				if !errors.As(err, &he) {
					return nil, err
				}
				it.InStock, it.Problem = false, "These dates are no longer free. Remove it and book other dates."
			}
			it.RentDays, it.Qty, it.MaxQty = d.Days, 1, 1
			it.UnitPrice, it.Deposit = rentFor(p, d.Days), p.RentDeposit
		} else {
			it.UnitPrice = p.Price
			if p.SalePrice != nil {
				it.UnitPrice = *p.SalePrice
			}
			stock, sizeOK := stockOf(p, it.Colour, it.Size)
			it.MaxQty = max(1, min(stock, 20))
			switch {
			case !p.ForSale:
				it.InStock, it.Problem = false, "No longer for sale. Remove it to continue."
			case !sizeOK:
				it.InStock, it.Problem = false, "This colour or size is no longer available. Remove it to continue."
			case stock < it.Qty && stock > 0:
				it.InStock, it.Problem = false, "Only "+strconv.Itoa(stock)+" left. Lower the quantity to continue."
			case stock < it.Qty:
				it.InStock, it.Problem = false, "Sold out. Remove it to continue."
			}
		}
		it.LineTotal = it.UnitPrice * it.Qty
		out = append(out, it)
	}
	return out, nil
}

func cartView(ctx context.Context, q querier, cartID string) (CartView, error) {
	lines, err := loadCartLines(ctx, q, cartID)
	if err != nil {
		return CartView{}, err
	}
	items, err := priceLines(ctx, q, lines)
	if err != nil {
		return CartView{}, err
	}
	s, err := getSettings(ctx, q)
	if err != nil {
		return CartView{}, err
	}
	v := CartView{ID: cartID, Items: items, FreeDeliveryOver: s.FreeDeliveryOver}
	for _, it := range items {
		v.Subtotal += it.LineTotal
		v.Deposit += it.Deposit
	}
	if len(items) > 0 {
		v.DeliveryFee = deliveryFeeFor(s, v.Subtotal)
	}
	v.Total = v.Subtotal + v.DeliveryFee + v.Deposit
	return v, nil
}

func (a *App) getCart(w http.ResponseWriter, r *http.Request) error {
	id, err := a.resolveCart(r.Context(), a.db, r)
	if err != nil {
		return err
	}
	v, err := cartView(r.Context(), a.db, id)
	if err != nil {
		return err
	}
	return ok(w, v)
}

func stockError(name string, stock int) error {
	if stock > 0 {
		return httpErr(http.StatusConflict, "Only %d of %s left.", stock, name)
	}
	return httpErr(http.StatusConflict, "%s is sold out.", name)
}

func readQty(raw map[string]any, def int) (int, bool) {
	v, has := raw["qty"]
	if !has || v == nil {
		return def, def > 0
	}
	f, isNum := v.(float64)
	if !isNum || !isInt(f) || f < 1 || f > 20 {
		return 0, false
	}
	return int(f), true
}

// Body: { items: [{ productId, qty, colour?, size?, rentFrom?, rentTo? }] }. Lines with rental
// dates are bookings; the others are purchases.
func (a *App) addToCart(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r)
	if err != nil {
		return err
	}
	var raw []map[string]any
	if err := jsonField(b, "items", &raw); err != nil || len(raw) < 1 || len(raw) > 10 {
		return badField("items", "")
	}
	ctx := r.Context()
	var view CartView
	err = withTx(ctx, a.db, func(tx *sql.Tx) error {
		cartID, err := a.resolveCart(ctx, tx, r)
		if err != nil {
			return err
		}
		for _, it := range raw {
			pid, _ := it["productId"].(string)
			size, _ := it["size"].(string)
			colour, _ := it["colour"].(string)
			colour = strings.TrimSpace(colour)
			from, _ := it["rentFrom"].(string)
			to, _ := it["rentTo"].(string)
			size = strings.TrimSpace(size)
			qty, valid := readQty(it, 1)
			if pid == "" || !valid {
				return badField("items", "")
			}
			products, err := productsByID(ctx, tx, []string{pid})
			if err != nil {
				return err
			}
			p, found := products[pid]
			if !found || !p.IsActive {
				return httpErr(http.StatusNotFound, "This product isn't available.")
			}

			if from != "" || to != "" {
				d, err := parseRentalDates(from, to)
				if err != nil {
					return err
				}
				if err := checkRentable(ctx, tx, p, d); err != nil {
					return err
				}
				res, err := tx.ExecContext(ctx, `INSERT INTO cart_items (id, cart_id, product_id, qty, kind, rent_from, rent_to) VALUES (?, ?, ?, 1, 'RENT', ?, ?)
				  ON CONFLICT (cart_id, product_id, colour, size, kind, rent_from) DO NOTHING`, newID(), cartID, pid, d.From, d.To)
				if err != nil {
					return err
				}
				if n, _ := res.RowsAffected(); n == 0 {
					return httpErr(http.StatusConflict, "%s is already in your cart for that pickup date.", p.Name)
				}
				continue
			}

			if !p.ForSale {
				return httpErr(http.StatusBadRequest, "%s is for rent only. Choose your dates to book it.", p.Name)
			}
			if len(p.Colours) > 0 && colour == "" {
				return badField("colour", "Choose a colour")
			}
			if len(p.Sizes) > 0 && size == "" {
				return badField("size", "Choose a size")
			}
			stock, choiceOK := stockOf(p, colour, size)
			if !choiceOK {
				return badField("size", "That colour or size isn't available")
			}
			var existing int
			if err := tx.QueryRowContext(ctx, `SELECT COALESCE(SUM(qty), 0) FROM cart_items WHERE cart_id = ? AND product_id = ? AND colour = ? AND size = ? AND kind = 'BUY'`,
				cartID, pid, colour, size).Scan(&existing); err != nil {
				return err
			}
			want := existing + qty
			if stock < want {
				name := p.Name
				if choice := strings.TrimSpace(strings.Join(nonEmpty(colour, size), " ")); choice != "" {
					name += " in " + choice
				}
				return stockError(name, stock)
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO cart_items (id, cart_id, product_id, qty, colour, size, kind) VALUES (?, ?, ?, ?, ?, ?, 'BUY')
			  ON CONFLICT (cart_id, product_id, colour, size, kind, rent_from) DO UPDATE SET qty = ?`, newID(), cartID, pid, qty, colour, size, want); err != nil {
				return err
			}
		}
		view, err = cartView(ctx, tx, cartID)
		return err
	})
	if err != nil {
		return err
	}
	return ok(w, view)
}

// PATCH /api/cart/items/{itemId}: change the quantity of a purchase line.
func (a *App) setCartQty(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r)
	if err != nil {
		return err
	}
	n, has, err := b.num("qty")
	if err != nil || !has || !isInt(n) || n < 1 || n > 20 {
		return badField("qty", "")
	}
	qty := int(n)
	ctx := r.Context()
	cartID, err := a.resolveCart(ctx, a.db, r)
	if err != nil {
		return err
	}
	var pid, colour, size, kind string
	err = a.db.QueryRowContext(ctx, `SELECT product_id, colour, size, kind FROM cart_items WHERE id = ? AND cart_id = ?`, r.PathValue("itemId"), cartID).Scan(&pid, &colour, &size, &kind)
	if errors.Is(err, sql.ErrNoRows) {
		return errNotFound
	}
	if err != nil {
		return err
	}
	if kind != "BUY" {
		return httpErr(http.StatusBadRequest, "A rental is always one piece.")
	}
	products, err := productsByID(ctx, a.db, []string{pid})
	if err != nil {
		return err
	}
	p, found := products[pid]
	if !found {
		return httpErr(http.StatusNotFound, "This product isn't available.")
	}
	if stock, _ := stockOf(p, colour, size); stock < qty {
		return stockError(p.Name, stock)
	}
	if _, err := a.db.ExecContext(ctx, `UPDATE cart_items SET qty = ? WHERE id = ? AND cart_id = ?`, qty, r.PathValue("itemId"), cartID); err != nil {
		return err
	}
	v, err := cartView(ctx, a.db, cartID)
	if err != nil {
		return err
	}
	return ok(w, v)
}

func (a *App) removeCartItem(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	cartID, err := a.resolveCart(ctx, a.db, r)
	if err != nil {
		return err
	}
	if _, err := a.db.ExecContext(ctx, `DELETE FROM cart_items WHERE id = ? AND cart_id = ?`, r.PathValue("itemId"), cartID); err != nil {
		return err
	}
	v, err := cartView(ctx, a.db, cartID)
	if err != nil {
		return err
	}
	return ok(w, v)
}

// Called after sign-in: moves the guest cart's items into the user's cart.
func (a *App) mergeCart(w http.ResponseWriter, r *http.Request) error {
	if _, err := a.requireUser(r); err != nil {
		return err
	}
	b, err := readBody(r)
	if err != nil {
		return err
	}
	guestKey, has, err := b.str("guestKey")
	if err != nil || !has {
		return badField("guestKey", "")
	}
	ctx := r.Context()
	var view CartView
	err = withTx(ctx, a.db, func(tx *sql.Tx) error {
		userCart, err := a.resolveCart(ctx, tx, r)
		if err != nil {
			return err
		}
		var guestCart string
		err = tx.QueryRowContext(ctx, `SELECT id FROM carts WHERE guest_key = ?`, guestKey).Scan(&guestCart)
		if err == nil && guestCart != userCart {
			if _, err := tx.ExecContext(ctx, `INSERT INTO cart_items (id, cart_id, product_id, qty, colour, size, kind, rent_from, rent_to)
			  SELECT id || 'm', ?, product_id, qty, colour, size, kind, rent_from, rent_to FROM cart_items WHERE cart_id = ? AND true
			  ON CONFLICT (cart_id, product_id, colour, size, kind, rent_from)
			  DO UPDATE SET qty = CASE WHEN cart_items.kind = 'BUY' THEN cart_items.qty + excluded.qty ELSE cart_items.qty END`, userCart, guestCart); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `DELETE FROM carts WHERE id = ?`, guestCart); err != nil {
				return err
			}
		} else if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		view, err = cartView(ctx, tx, userCart)
		return err
	})
	if err != nil {
		return err
	}
	return ok(w, view)
}
