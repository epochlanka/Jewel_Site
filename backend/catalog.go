package main

import (
	"context"
	"database/sql"
	"math"
)

var jewelleryTypes = []string{"EARRINGS", "NECKLACE", "CHAIN", "LONG_CHAIN", "BANGLE", "BRACELET", "RING", "ANKLET", "HAIR", "OTHER"}

type Image struct {
	ID     string `json:"id"`
	URL    string `json:"url"`
	Sort   int    `json:"sort"`
	Colour string `json:"colour"` // the colour this photo shows, or "" for any
}

type Colour struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Hex   string `json:"hex"`
	Stock int    `json:"stock"` // when the piece has sizes, the total of this colour's sizes
	Image string `json:"image"` // first photo of this colour, for swatches on product cards
}

// Variant is the stock of one colour in one size.
type Variant struct {
	Colour string `json:"colour"`
	Size   string `json:"size"`
	Stock  int    `json:"stock"`
}

type CategoryCount struct {
	Products int `json:"products"`
}

type Category struct {
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	Slug     string         `json:"slug"`
	ImageURL *string        `json:"imageUrl"`
	Sort     int            `json:"sort"`
	Count    *CategoryCount `json:"_count,omitempty"`
}

type Pricing struct {
	SalePrice    *int    `json:"salePrice"`
	OfferPercent *int    `json:"offerPercent"`
	OfferTitle   *string `json:"offerTitle"`
}

type Product struct {
	ID            string    `json:"id"`
	Code          string    `json:"code"`
	Name          string    `json:"name"`
	Slug          string    `json:"slug"`
	Description   *string   `json:"description"`
	Price         int       `json:"price"`
	Stock         int       `json:"stock"`
	IsActive      bool      `json:"isActive"`
	IsNewArrival  bool      `json:"isNewArrival"`
	Style         *string   `json:"style"`
	Colour        *string   `json:"colour"`
	JewelleryType string    `json:"jewelleryType"`
	CategoryID    string    `json:"categoryId"`
	CreatedAt     string    `json:"createdAt"`
	ForSale       bool      `json:"forSale"`
	ForRent       bool      `json:"forRent"`
	RentPrice     int       `json:"rentPrice"`    // for up to RentDays days
	RentDays      int       `json:"rentDays"`     // days included in RentPrice
	RentExtraDay  int       `json:"rentExtraDay"` // per day after that
	RentDeposit   int       `json:"rentDeposit"`  // refundable
	RentUnits     int       `json:"rentUnits"`    // identical sets that can be out at once
	Sizes         []Size    `json:"sizes"`
	Colours       []Colour  `json:"colours"`
	Variants      []Variant `json:"variants"`
	Images        []Image   `json:"images"`
	Category      *Category `json:"category,omitempty"`
	Pricing
}

const productCols = `p.id, p.code, p.name, p.slug, p.description, p.price, p.stock, p.is_active, p.is_new_arrival,
  p.style, p.colour, p.jewellery_type, p.category_id, p.created_at,
  p.for_sale, p.for_rent, p.rent_price, p.rent_days, p.rent_extra_day, p.rent_deposit, p.rent_units`

// effPrice is what a piece costs to get: its sale price, or the rent for rent-only pieces.
const effPrice = `(CASE WHEN p.for_sale = 1 THEN p.price ELSE p.rent_price END)`

type Size struct {
	ID    string `json:"id"`
	Size  string `json:"size"`
	Stock int    `json:"stock"`
}

func scanProduct(sc interface{ Scan(...any) error }) (Product, error) {
	var p Product
	var desc, style, colour sql.NullString
	err := sc.Scan(&p.ID, &p.Code, &p.Name, &p.Slug, &desc, &p.Price, &p.Stock, &p.IsActive, &p.IsNewArrival,
		&style, &colour, &p.JewelleryType, &p.CategoryID, &p.CreatedAt,
		&p.ForSale, &p.ForRent, &p.RentPrice, &p.RentDays, &p.RentExtraDay, &p.RentDeposit, &p.RentUnits)
	p.Description, p.Style, p.Colour = strPtr(desc), strPtr(style), strPtr(colour)
	p.Images, p.Sizes, p.Colours, p.Variants = []Image{}, []Size{}, []Colour{}, []Variant{}
	return p, err
}

func queryProducts(ctx context.Context, q querier, query string, args ...any) ([]Product, error) {
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Product{}
	for rows.Next() {
		p, err := scanProduct(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := attachSizes(ctx, q, out); err != nil {
		return nil, err
	}
	return out, attachColours(ctx, q, out)
}

func attachSizes(ctx context.Context, q querier, list []Product) error {
	if len(list) == 0 {
		return nil
	}
	ids := make([]string, len(list))
	for i, p := range list {
		ids[i] = p.ID
	}
	rows, err := q.QueryContext(ctx, `SELECT id, size, stock, product_id FROM product_sizes WHERE product_id IN (`+placeholders(len(ids))+`) ORDER BY sort, id`, toAny(ids)...)
	if err != nil {
		return err
	}
	defer rows.Close()
	byProduct := map[string][]Size{}
	for rows.Next() {
		var sz Size
		var pid string
		if err := rows.Scan(&sz.ID, &sz.Size, &sz.Stock, &pid); err != nil {
			return err
		}
		byProduct[pid] = append(byProduct[pid], sz)
	}
	for i := range list {
		if sz := byProduct[list[i].ID]; sz != nil {
			list[i].Sizes = sz
		}
	}
	return rows.Err()
}

// attachImages fills in each product's photos, main photo first. firstOnly keeps just the main one.
func attachImages(ctx context.Context, q querier, list []Product, firstOnly bool) error {
	if len(list) == 0 {
		return nil
	}
	ids := make([]string, len(list))
	for i, p := range list {
		ids[i] = p.ID
	}
	rows, err := q.QueryContext(ctx, `SELECT id, url, sort, colour, product_id FROM product_images WHERE product_id IN (`+placeholders(len(ids))+`) ORDER BY sort, id`, toAny(ids)...)
	if err != nil {
		return err
	}
	defer rows.Close()
	byProduct := map[string][]Image{}
	for rows.Next() {
		var im Image
		var pid string
		if err := rows.Scan(&im.ID, &im.URL, &im.Sort, &im.Colour, &pid); err != nil {
			return err
		}
		if firstOnly && len(byProduct[pid]) > 0 {
			continue
		}
		byProduct[pid] = append(byProduct[pid], im)
	}
	for i := range list {
		if imgs := byProduct[list[i].ID]; imgs != nil {
			list[i].Images = imgs
		}
	}
	return rows.Err()
}

func attachCategories(ctx context.Context, q querier, list []Product) error {
	cats, err := listCategories(ctx, q, false)
	if err != nil {
		return err
	}
	byID := map[string]*Category{}
	for i := range cats {
		byID[cats[i].ID] = &cats[i]
	}
	for i := range list {
		list[i].Category = byID[list[i].CategoryID]
	}
	return nil
}

func listCategories(ctx context.Context, q querier, withCounts bool) ([]Category, error) {
	rows, err := q.QueryContext(ctx, `SELECT c.id, c.name, c.slug, c.image_url, c.sort,
	  (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_active = 1)
	  FROM categories c ORDER BY c.sort, c.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Category{}
	for rows.Next() {
		var c Category
		var img sql.NullString
		var n int
		if err := rows.Scan(&c.ID, &c.Name, &c.Slug, &img, &c.Sort, &n); err != nil {
			return nil, err
		}
		c.ImageURL = strPtr(img)
		if withCounts {
			c.Count = &CategoryCount{Products: n}
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ---------- Pricing ----------

type Offer struct {
	ID         string
	Title      string
	PercentOff int
	ProductID  *string
	CategoryID *string
}

func activeOffers(ctx context.Context, q querier) ([]Offer, error) {
	now := nowTS()
	rows, err := q.QueryContext(ctx, `SELECT id, title, percent_off, product_id, category_id FROM offers
	  WHERE is_active = 1 AND starts_at <= ? AND ends_at >= ?`, now, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Offer
	for rows.Next() {
		var o Offer
		var pid, cid sql.NullString
		if err := rows.Scan(&o.ID, &o.Title, &o.PercentOff, &pid, &cid); err != nil {
			return nil, err
		}
		o.ProductID, o.CategoryID = strPtr(pid), strPtr(cid)
		out = append(out, o)
	}
	return out, rows.Err()
}

// priceFor picks the best offer for a product: product-specific, category-wide or shop-wide.
func priceFor(id, categoryID string, price int, offers []Offer) Pricing {
	var best *Offer
	for i := range offers {
		o := &offers[i]
		applies := true
		if o.ProductID != nil {
			applies = *o.ProductID == id
		} else if o.CategoryID != nil {
			applies = *o.CategoryID == categoryID
		}
		if applies && (best == nil || o.PercentOff > best.PercentOff) {
			best = o
		}
	}
	if best == nil {
		return Pricing{}
	}
	sale := int(math.Floor(float64(price*(100-best.PercentOff))/100 + 0.5))
	pct, title := best.PercentOff, best.Title
	return Pricing{SalePrice: &sale, OfferPercent: &pct, OfferTitle: &title}
}

func unitPrice(p Product, offers []Offer) int {
	if pr := priceFor(p.ID, p.CategoryID, p.Price, offers); pr.SalePrice != nil {
		return *pr.SalePrice
	}
	return p.Price
}

func withPricing(ctx context.Context, q querier, list []Product) error {
	offers, err := activeOffers(ctx, q)
	if err != nil {
		return err
	}
	for i := range list {
		if list[i].ForSale { // offers only discount pieces that are sold, not rentals
			list[i].Pricing = priceFor(list[i].ID, list[i].CategoryID, list[i].Price, offers)
		}
	}
	return nil
}

// ---------- Settings ----------

type Settings struct {
	ID               int    `json:"id"`
	ShopName         string `json:"shopName"`
	Tagline          string `json:"tagline"`
	Phone            string `json:"phone"`
	Whatsapp         string `json:"whatsapp"`
	Email            string `json:"email"`
	Address          string `json:"address"`
	DeliveryFee      int    `json:"deliveryFee"`
	FreeDeliveryOver *int   `json:"freeDeliveryOver"`
	BankName         string `json:"bankName"`
	BankBranch       string `json:"bankBranch"`
	AccountName      string `json:"accountName"`
	AccountNumber    string `json:"accountNumber"`
	BankDetails      string `json:"bankDetails"` // extra payment instructions
	PickupEnabled    bool   `json:"pickupEnabled"`
	ThemeMode        string `json:"themeMode"`
	ThemeAccent      string `json:"themeAccent"`
}

// getSettings returns the shop's single settings row, creating it with defaults the first time.
func getSettings(ctx context.Context, q querier) (Settings, error) {
	if _, err := q.ExecContext(ctx, `INSERT OR IGNORE INTO shop_settings (id) VALUES (1)`); err != nil {
		return Settings{}, err
	}
	var s Settings
	var free sql.NullInt64
	err := q.QueryRowContext(ctx, `SELECT id, shop_name, tagline, phone, whatsapp, email, address, delivery_fee, free_delivery_over,
	  bank_name, bank_branch, account_name, account_number, bank_details, pickup_enabled, theme_mode, theme_accent FROM shop_settings WHERE id = 1`).
		Scan(&s.ID, &s.ShopName, &s.Tagline, &s.Phone, &s.Whatsapp, &s.Email, &s.Address, &s.DeliveryFee, &free,
			&s.BankName, &s.BankBranch, &s.AccountName, &s.AccountNumber, &s.BankDetails, &s.PickupEnabled, &s.ThemeMode, &s.ThemeAccent)
	s.FreeDeliveryOver = intPtr(free)
	return s, err
}

func deliveryFeeFor(s Settings, subtotal int) int {
	if s.FreeDeliveryOver != nil && *s.FreeDeliveryOver > 0 && subtotal >= *s.FreeDeliveryOver {
		return 0
	}
	return s.DeliveryFee
}

// attachColours adds each product's colours (with the first photo of each) and,
// for pieces with colours and sizes, the stock of every colour and size pair.
func attachColours(ctx context.Context, q querier, list []Product) error {
	if len(list) == 0 {
		return nil
	}
	ids := make([]string, len(list))
	index := map[string]*Product{}
	for i := range list {
		ids[i] = list[i].ID
		index[list[i].ID] = &list[i]
	}
	rows, err := q.QueryContext(ctx, `SELECT c.id, c.name, c.hex, c.stock, c.product_id,
	  COALESCE((SELECT pi.url FROM product_images pi WHERE pi.product_id = c.product_id AND pi.colour = c.name ORDER BY pi.sort, pi.id LIMIT 1), '')
	  FROM product_colours c WHERE c.product_id IN (`+placeholders(len(ids))+`) ORDER BY c.sort, c.id`, toAny(ids)...)
	if err != nil {
		return err
	}
	for rows.Next() {
		var c Colour
		var pid string
		if err := rows.Scan(&c.ID, &c.Name, &c.Hex, &c.Stock, &pid, &c.Image); err != nil {
			rows.Close()
			return err
		}
		index[pid].Colours = append(index[pid].Colours, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	rows, err = q.QueryContext(ctx, `SELECT product_id, colour, size, stock FROM product_variants WHERE product_id IN (`+placeholders(len(ids))+`)`, toAny(ids)...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var v Variant
		var pid string
		if err := rows.Scan(&pid, &v.Colour, &v.Size, &v.Stock); err != nil {
			return err
		}
		index[pid].Variants = append(index[pid].Variants, v)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	// With sizes too, a colour's stock is the total over its sizes.
	for i := range list {
		p := &list[i]
		if len(p.Colours) == 0 || len(p.Sizes) == 0 {
			continue
		}
		for j := range p.Colours {
			p.Colours[j].Stock = 0
			for _, v := range p.Variants {
				if v.Colour == p.Colours[j].Name {
					p.Colours[j].Stock += v.Stock
				}
			}
		}
	}
	return nil
}

// stockOf is how many of a piece can be bought in a colour and size. ok is false when
// the choice doesn't exist (a colour or size it doesn't come in, or a missing choice).
func stockOf(p Product, colour, size string) (n int, ok bool) {
	hasC, hasS := len(p.Colours) > 0, len(p.Sizes) > 0
	if hasC != (colour != "") || hasS != (size != "") {
		return 0, false
	}
	switch {
	case hasC && hasS:
		for _, v := range p.Variants {
			if v.Colour == colour && v.Size == size {
				return v.Stock, true
			}
		}
		for _, c := range p.Colours { // a pair with no stock row yet has 0
			if c.Name == colour {
				for _, sz := range p.Sizes {
					if sz.Size == size {
						return 0, true
					}
				}
			}
		}
		return 0, false
	case hasC:
		for _, c := range p.Colours {
			if c.Name == colour {
				return c.Stock, true
			}
		}
		return 0, false
	case hasS:
		for _, sz := range p.Sizes {
			if sz.Size == size {
				return sz.Stock, true
			}
		}
		return 0, false
	}
	return p.Stock, true
}

// takeStock moves stock for a purchase: n < 0 takes it (checking there is enough), n > 0 returns it.
// It returns false when there wasn't enough.
func takeStock(ctx context.Context, tx *sql.Tx, p Product, colour, size string, n int) (bool, error) {
	run := func(query string, args ...any) (bool, error) {
		res, err := tx.ExecContext(ctx, query, args...)
		if err != nil {
			return false, err
		}
		rows, _ := res.RowsAffected()
		return rows > 0, nil
	}
	if ok, err := run(`UPDATE products SET stock = stock + ? WHERE id = ? AND stock + ? >= 0`, n, p.ID, n); !ok || err != nil {
		return false, err
	}
	hasC, hasS := len(p.Colours) > 0, len(p.Sizes) > 0
	switch {
	case hasC && hasS:
		if n > 0 { // returning stock to a pair that may have no row
			_, err := tx.ExecContext(ctx, `INSERT INTO product_variants (product_id, colour, size, stock) VALUES (?, ?, ?, ?)
			  ON CONFLICT (product_id, colour, size) DO UPDATE SET stock = stock + excluded.stock`, p.ID, colour, size, n)
			return err == nil, err
		}
		return run(`UPDATE product_variants SET stock = stock + ? WHERE product_id = ? AND colour = ? AND size = ? AND stock + ? >= 0`, n, p.ID, colour, size, n)
	case hasC:
		return run(`UPDATE product_colours SET stock = stock + ? WHERE product_id = ? AND name = ? AND stock + ? >= 0`, n, p.ID, colour, n)
	case hasS:
		return run(`UPDATE product_sizes SET stock = stock + ? WHERE product_id = ? AND size = ? AND stock + ? >= 0`, n, p.ID, size, n)
	}
	return true, nil
}
