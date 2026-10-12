package main

import (
	"context"
	"database/sql"
	"math"
)

var jewelleryTypes = []string{"EARRINGS", "NECKLACE", "CHAIN", "LONG_CHAIN", "BANGLE", "BRACELET", "RING", "ANKLET", "HAIR", "OTHER"}

type Image struct {
	ID   string `json:"id"`
	URL  string `json:"url"`
	Sort int    `json:"sort"`
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
	p.Images, p.Sizes = []Image{}, []Size{}
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
	return out, attachSizes(ctx, q, out)
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
	rows, err := q.QueryContext(ctx, `SELECT id, url, sort, product_id FROM product_images WHERE product_id IN (`+placeholders(len(ids))+`) ORDER BY sort, id`, toAny(ids)...)
	if err != nil {
		return err
	}
	defer rows.Close()
	byProduct := map[string][]Image{}
	for rows.Next() {
		var im Image
		var pid string
		if err := rows.Scan(&im.ID, &im.URL, &im.Sort, &pid); err != nil {
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
