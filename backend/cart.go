package main

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
)

type CartItem struct {
	ID        string  `json:"id"`
	CartID    string  `json:"cartId"`
	ProductID string  `json:"productId"`
	Qty       int     `json:"qty"`
	Product   Product `json:"product"`
	UnitPrice int     `json:"unitPrice"`
	LineTotal int     `json:"lineTotal"`
	InStock   bool    `json:"inStock"`
}

type CartView struct {
	ID               string     `json:"id"`
	Items            []CartItem `json:"items"`
	Subtotal         int        `json:"subtotal"`
	DeliveryFee      int        `json:"deliveryFee"`
	Total            int        `json:"total"`
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

func cartView(ctx context.Context, q querier, cartID string) (CartView, error) {
	rows, err := q.QueryContext(ctx, `SELECT ci.id, ci.qty, `+productCols+` FROM cart_items ci JOIN products p ON p.id = ci.product_id
	  WHERE ci.cart_id = ? AND p.is_active = 1 ORDER BY ci.id`, cartID)
	if err != nil {
		return CartView{}, err
	}
	items := []CartItem{}
	var products []Product
	for rows.Next() {
		var it CartItem
		var p Product
		var desc, style, colour sql.NullString
		if err := rows.Scan(&it.ID, &it.Qty, &p.ID, &p.Code, &p.Name, &p.Slug, &desc, &p.Price, &p.Stock, &p.IsActive, &p.IsNewArrival,
			&style, &colour, &p.JewelleryType, &p.CategoryID, &p.CreatedAt); err != nil {
			rows.Close()
			return CartView{}, err
		}
		p.Description, p.Style, p.Colour = strPtr(desc), strPtr(style), strPtr(colour)
		p.Images = []Image{}
		items = append(items, it)
		products = append(products, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return CartView{}, err
	}
	if err := attachImages(ctx, q, products, true); err != nil {
		return CartView{}, err
	}
	if err := withPricing(ctx, q, products); err != nil {
		return CartView{}, err
	}
	s, err := getSettings(ctx, q)
	if err != nil {
		return CartView{}, err
	}
	v := CartView{ID: cartID, Items: items, FreeDeliveryOver: s.FreeDeliveryOver}
	for i := range items {
		p := products[i]
		it := &items[i]
		it.CartID, it.ProductID, it.Product = cartID, p.ID, p
		it.UnitPrice = p.Price
		if p.SalePrice != nil {
			it.UnitPrice = *p.SalePrice
		}
		it.LineTotal = it.UnitPrice * it.Qty
		it.InStock = p.Stock >= it.Qty
		v.Subtotal += it.LineTotal
	}
	if len(items) > 0 {
		v.DeliveryFee = deliveryFeeFor(s, v.Subtotal)
	}
	v.Total = v.Subtotal + v.DeliveryFee
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

// Single item or a "Create your look" set: { items: [{ productId, qty }] }
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
			qty, valid := readQty(it, 1)
			if pid == "" || !valid {
				return badField("items", "")
			}
			var name string
			var stock int
			var active bool
			err := tx.QueryRowContext(ctx, `SELECT name, stock, is_active FROM products WHERE id = ?`, pid).Scan(&name, &stock, &active)
			if errors.Is(err, sql.ErrNoRows) || (err == nil && !active) {
				return httpErr(http.StatusNotFound, "This product isn't available.")
			}
			if err != nil {
				return err
			}
			var existing int
			if err := tx.QueryRowContext(ctx, `SELECT COALESCE(SUM(qty), 0) FROM cart_items WHERE cart_id = ? AND product_id = ?`, cartID, pid).Scan(&existing); err != nil {
				return err
			}
			want := existing + qty
			if stock < want {
				return stockError(name, stock)
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO cart_items (id, cart_id, product_id, qty) VALUES (?, ?, ?, ?)
			  ON CONFLICT (cart_id, product_id) DO UPDATE SET qty = ?`, newID(), cartID, pid, qty, want); err != nil {
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
	pid := r.PathValue("productId")
	var name string
	var stock int
	err = a.db.QueryRowContext(ctx, `SELECT name, stock FROM products WHERE id = ?`, pid).Scan(&name, &stock)
	if errors.Is(err, sql.ErrNoRows) {
		return httpErr(http.StatusNotFound, "This product isn't available.")
	}
	if err != nil {
		return err
	}
	if stock < qty {
		return stockError(name, stock)
	}
	res, err := a.db.ExecContext(ctx, `UPDATE cart_items SET qty = ? WHERE cart_id = ? AND product_id = ?`, qty, cartID, pid)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errNotFound
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
	if _, err := a.db.ExecContext(ctx, `DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?`, cartID, r.PathValue("productId")); err != nil {
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
			if _, err := tx.ExecContext(ctx, `INSERT INTO cart_items (id, cart_id, product_id, qty)
			  SELECT id || 'm', ?, product_id, qty FROM cart_items WHERE cart_id = ? AND true
			  ON CONFLICT (cart_id, product_id) DO UPDATE SET qty = cart_items.qty + excluded.qty`, userCart, guestCart); err != nil {
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
