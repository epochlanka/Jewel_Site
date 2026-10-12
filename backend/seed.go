package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"
)

// seed adds the admin account, the standard categories and the settings row. It is safe to run again.
func (a *App) seed() error {
	ctx := context.Background()
	if n, err := countRows(ctx, a.db, `SELECT COUNT(*) FROM users WHERE email = 'admin@shop.lk'`); err != nil {
		return err
	} else if n == 0 {
		hash, err := hashPassword("admin123")
		if err != nil {
			return err
		}
		if _, err := a.db.ExecContext(ctx, `INSERT INTO users (id, name, email, password, role, created_at) VALUES (?, 'Admin', 'admin@shop.lk', ?, 'ADMIN', ?)`, newID(), hash, nowTS()); err != nil {
			return err
		}
	}
	cats := []string{"Earrings", "Bangles", "Chains", "Long Chains", "Necklaces", "Rings", "Bracelets", "Anklets", "Bridal Jewellery", "Hair Accessories", "Fancy Jewellery"}
	for i, name := range cats {
		slug := strings.ReplaceAll(strings.ToLower(name), " ", "-")
		if _, err := a.db.ExecContext(ctx, `INSERT OR IGNORE INTO categories (id, name, slug, sort) VALUES (?, ?, ?, ?)`, newID(), name, slug, i); err != nil {
			return err
		}
	}
	if _, err := getSettings(ctx, a.db); err != nil {
		return err
	}
	log.Printf("Seeded: admin@shop.lk / admin123, %d categories, shop settings", len(cats))
	return nil
}

// ---------- Demo content ----------
// Photos are free Unsplash photos (https://unsplash.com/license), loaded straight from Unsplash.
// They show jewellery you may not stock, so replace them with your own pieces before you open the shop.

func unsplash(id string, w int) string {
	return fmt.Sprintf("https://images.unsplash.com/photo-%s?w=%d&q=80&auto=format&fit=crop", id, w)
}

const demoPrefix = "DEMO-"

type demoProduct struct {
	code, name, cat, typ string
	price, stock         int
	style, colour, photo string
	isNew                bool
	description          string
}

var demoProducts = []demoProduct{
	{"ER01", "Temple jhumka earrings", "earrings", "EARRINGS", 2800, 8, "Traditional", "Gold", "1762686130435-897de4b26aac", true, "Bell-shaped jhumkas with fine filigree and tiny hanging beads. Lightweight for all-day wear."},
	{"ER02", "Classic gold drop earrings", "earrings", "EARRINGS", 3200, 6, "Modern", "Gold", "1727990865600-91f8cb8b0168", true, "Simple gold-finish drops that work with office wear and sarees alike."},
	{"ER03", "Ruby kundan earrings", "earrings", "EARRINGS", 3900, 4, "Traditional", "Red", "1653227907864-560dce4c252d", true, "Kundan-style studs with deep red stones and a gold frame."},
	{"ER04", "Two-tone statement earrings", "earrings", "EARRINGS", 2400, 10, "Modern", "Silver", "1714733831162-0a6e849141be", false, "Silver and gold tones together for an easy everyday sparkle."},
	{"ER05", "Pearl drop earrings", "earrings", "EARRINGS", 2100, 12, "Modern", "Gold", "1701777892740-88419a701472", false, "Soft pearl drops on a slim gold hook."},
	{"BG01", "Antique bangle stack", "bangles", "BANGLE", 4500, 5, "Traditional", "Gold", "1758995116383-f51775896add", true, "A set of ornate gold-finish bangles to wear together or split."},
	{"BG02", "Polished gold bangle pair", "bangles", "BANGLE", 3500, 7, "Modern", "Gold", "1690175867343-2af70ea57537", false, "A smooth, high-shine pair for everyday wear."},
	{"BG03", "Textured inlay bangles", "bangles", "BANGLE", 3800, 3, "Modern", "Gold", "1787769499046-8a94b2de1f62", false, "Hammered gold bangles with dark oval inlays."},
	{"BR01", "Stone-set tennis bracelet", "bracelets", "BRACELET", 5200, 4, "Modern", "Gold", "1611598935678-c88dca238fce", true, "A line of sparkling stones set in gold for special occasions."},
	{"BR02", "Beaded charm bracelets", "bracelets", "BRACELET", 1900, 15, "Modern", "Gold", "1626784215013-13322cb0e471", false, "Mix-and-match beaded bracelets in gold and silver tones."},
	{"CH01", "Everyday gold chain", "chains", "CHAIN", 4200, 9, "Modern", "Gold", "1611107683227-e9060eccd846", true, "A fine gold-finish chain to wear alone or with a pendant."},
	{"CH02", "Heart pendant chain", "chains", "CHAIN", 3600, 6, "Modern", "Gold", "1623321673989-830eff0fd59f", false, "A delicate chain with a small gold heart charm."},
	{"NK01", "Amethyst bead necklace", "necklaces", "NECKLACE", 6800, 3, "Traditional", "Purple", "1601121141461-9d6647bca1ed", true, "Gold beads with purple stones in a classic collar shape."},
	{"NK02", "Ruby bead necklace", "necklaces", "NECKLACE", 7200, 4, "Traditional", "Red", "1600862754152-80a263dd564f", false, "Rich red beads strung with gold spacers."},
	{"NK03", "Pearl and gold necklace", "necklaces", "NECKLACE", 8500, 2, "Traditional", "Gold", "1721103418312-b0057a8c31c2", false, "Layers of pearls framed in gold for weddings and festivals."},
	{"NK04", "Gold bead collar necklace", "necklaces", "NECKLACE", 5900, 5, "Modern", "Gold", "1599475211349-f4c81b3216bc", false, "Rounded gold and white beads in a short collar length."},
	{"LC01", "Long layered chain", "long-chains", "LONG_CHAIN", 7500, 4, "Traditional", "Gold", "1705326454924-f6777522b030", false, "A long statement chain that falls to mid-chest."},
	{"RG01", "Diamond-cut cocktail ring", "rings", "RING", 2600, 8, "Modern", "Gold", "1611955167811-4711904bb9f8", false, "A bright cluster of stones on a slim gold band."},
	{"RG02", "Amethyst solitaire ring", "rings", "RING", 2900, 5, "Traditional", "Purple", "1603561596973-8166e9e089d1", false, "A single purple stone in a raised gold setting."},
	{"RG03", "Stone-studded band", "rings", "RING", 2300, 9, "Modern", "Gold", "1626784213922-d9f1e050cf8f", false, "A comfortable band set with small sparkling stones."},
	{"AN01", "Gold chain anklet", "anklets", "ANKLET", 1500, 12, "Modern", "Gold", "1744722091259-ed1cf11ac97f", false, "A fine chain anklet for everyday wear."},
	{"BJ01", "Bridal necklace and earring set", "bridal-jewellery", "NECKLACE", 18500, 2, "Traditional", "Gold", "1722410180687-b05b50922362", true, "A matching bridal necklace and earrings for the big day."},
	{"HA01", "Jewelled tiara", "hair-accessories", "HAIR", 6500, 3, "Traditional", "Purple", "1603974372039-adc49044b6bd", false, "A gold tiara set with purple stones for brides and special events."},
	{"FJ01", "Party jewellery trio", "fancy-jewellery", "OTHER", 2200, 7, "Modern", "Gold", "1641290748359-1d944fc8359a", false, "Three easy pieces to dress up any outfit."},
}

var demoCategoryPhotos = map[string]string{
	"earrings": "1762686130435-897de4b26aac", "bangles": "1758995116383-f51775896add", "chains": "1611107683227-e9060eccd846",
	"long-chains": "1705326454924-f6777522b030", "necklaces": "1601121141461-9d6647bca1ed", "rings": "1611955167811-4711904bb9f8",
	"bracelets": "1611598935678-c88dca238fce", "anklets": "1744722091259-ed1cf11ac97f", "bridal-jewellery": "1722410180687-b05b50922362",
	"hair-accessories": "1603974372039-adc49044b6bd", "fancy-jewellery": "1641290748359-1d944fc8359a",
}

const demoOfferTitle = "Demo offer: bangles week"

func (a *App) seedDemo() error {
	ctx := context.Background()
	added, skipped := 0, 0
	err := withTx(ctx, a.db, func(tx *sql.Tx) error {
		for i, p := range demoProducts {
			var catID string
			err := tx.QueryRowContext(ctx, `SELECT id FROM categories WHERE slug = ?`, p.cat).Scan(&catID)
			if errors.Is(err, sql.ErrNoRows) {
				log.Printf("Skipped %s: category %q not found. Run `go run . seed` first.", p.name, p.cat)
				skipped++
				continue
			}
			if err != nil {
				return err
			}
			code := demoPrefix + p.code
			// Space out creation times so "Newest" keeps the list order.
			created := ts(time.Now().Add(-time.Duration(len(demoProducts)-i) * time.Minute))
			var id string
			err = tx.QueryRowContext(ctx, `INSERT INTO products (id, code, name, slug, description, price, stock, is_active, is_new_arrival, style, colour,
			  jewellery_type, category_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
			  ON CONFLICT (code) DO UPDATE SET name = excluded.name, description = excluded.description, price = excluded.price, stock = excluded.stock,
			  is_active = 1, is_new_arrival = excluded.is_new_arrival, style = excluded.style, colour = excluded.colour,
			  jewellery_type = excluded.jewellery_type, category_id = excluded.category_id
			  RETURNING id`,
				newID(), code, p.name, slugify(p.name)+"-"+slugify(code), p.description, p.price, p.stock, boolInt(p.isNew), p.style, p.colour, p.typ, catID, created).Scan(&id)
			if err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `DELETE FROM product_images WHERE product_id = ?`, id); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO product_images (id, url, sort, product_id) VALUES (?, ?, 0, ?)`, newID(), unsplash(p.photo, 900), id); err != nil {
				return err
			}
			added++
		}
		for slug, photo := range demoCategoryPhotos {
			if _, err := tx.ExecContext(ctx, `UPDATE categories SET image_url = ? WHERE slug = ? AND image_url IS NULL`, unsplash(photo, 300), slug); err != nil {
				return err
			}
		}
		var bangles string
		if err := tx.QueryRowContext(ctx, `SELECT id FROM categories WHERE slug = 'bangles'`).Scan(&bangles); err == nil {
			if n, err := countRows(ctx, tx, `SELECT COUNT(*) FROM offers WHERE title = ?`, demoOfferTitle); err != nil {
				return err
			} else if n == 0 {
				now := time.Now()
				if _, err := tx.ExecContext(ctx, `INSERT INTO offers (id, title, percent_off, starts_at, ends_at, is_active, category_id, created_at) VALUES (?, ?, 15, ?, ?, 1, ?, ?)`,
					newID(), demoOfferTitle, ts(now), ts(now.AddDate(0, 0, 14)), bangles, ts(now)); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	note := ""
	if skipped > 0 {
		note = fmt.Sprintf(" (%d skipped)", skipped)
	}
	log.Printf("Demo content ready: %d products%s, category photos and one offer.", added, note)
	log.Println("Remove it later with: go run . seed-demo --remove")
	return nil
}

func (a *App) removeDemo() error {
	ctx := context.Background()
	deleted, hidden := 0, 0
	err := withTx(ctx, a.db, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT id,
		  (SELECT COUNT(*) FROM order_items oi WHERE oi.product_id = p.id)
		  FROM products p WHERE code LIKE ?`, demoPrefix+"%")
		if err != nil {
			return err
		}
		type demo struct {
			id   string
			used int
		}
		var list []demo
		for rows.Next() {
			var d demo
			if err := rows.Scan(&d.id, &d.used); err != nil {
				rows.Close()
				return err
			}
			list = append(list, d)
		}
		rows.Close()
		for _, d := range list {
			for _, q := range []string{`DELETE FROM cart_items WHERE product_id = ?`, `DELETE FROM wishlist_items WHERE product_id = ?`} {
				if _, err := tx.ExecContext(ctx, q, d.id); err != nil {
					return err
				}
			}
			if d.used > 0 {
				// Keep products that appear in orders so history stays intact; just hide them.
				if _, err := tx.ExecContext(ctx, `UPDATE products SET is_active = 0 WHERE id = ?`, d.id); err != nil {
					return err
				}
				hidden++
				continue
			}
			if _, err := tx.ExecContext(ctx, `DELETE FROM products WHERE id = ?`, d.id); err != nil {
				return err
			}
			deleted++
		}
		for _, photo := range demoCategoryPhotos {
			if _, err := tx.ExecContext(ctx, `UPDATE categories SET image_url = NULL WHERE image_url = ?`, unsplash(photo, 300)); err != nil {
				return err
			}
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM offers WHERE title = ?`, demoOfferTitle)
		return err
	})
	if err != nil {
		return err
	}
	log.Printf("Demo content removed: %d products deleted, %d hidden because they appear in orders.", deleted, hidden)
	return nil
}
