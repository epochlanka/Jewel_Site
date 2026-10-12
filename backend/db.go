package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

// querier is satisfied by both *sql.DB and *sql.Tx, so helpers work inside and outside transactions.
type querier interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'CUSTOMER',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  image_url TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  price INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_new_arrival INTEGER NOT NULL DEFAULT 0,
  style TEXT,
  colour TEXT,
  jewellery_type TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS products_category ON products(category_id);

-- Sizes (for example bangle sizes 2.2, 2.4, 2.6) with their own stock.
-- When a product has sizes, products.stock is the total of its sizes.
CREATE TABLE IF NOT EXISTS product_sizes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, size)
);

CREATE TABLE IF NOT EXISTS product_images (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS product_images_product ON product_images(product_id);

CREATE TABLE IF NOT EXISTS carts (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE REFERENCES users(id),
  guest_key TEXT UNIQUE,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cart_items (
  id TEXT PRIMARY KEY,
  cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL DEFAULT 1,
  size TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'BUY', -- BUY or RENT
  rent_from TEXT NOT NULL DEFAULT '',
  rent_to TEXT NOT NULL DEFAULT '',
  UNIQUE (cart_id, product_id, size, kind, rent_from)
);

CREATE TABLE IF NOT EXISTS wishlist_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  UNIQUE (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id),
  full_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  whatsapp TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  postal_code TEXT,
  note TEXT,
  delivery_method TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'UNPAID',
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  payment_slip_url TEXT,
  payment_ref TEXT,
  payment_slip_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS orders_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  qty INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS order_status_logs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS order_status_logs_order ON order_status_logs(order_id);

-- An offer applies to one product, one category, or (both empty) the whole shop.
CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  percent_off INTEGER NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  product_id TEXT REFERENCES products(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

-- Single row (id = 1) holding the shop's editable details.
CREATE TABLE IF NOT EXISTS shop_settings (
  id INTEGER PRIMARY KEY,
  shop_name TEXT NOT NULL DEFAULT '[Shop name]',
  tagline TEXT NOT NULL DEFAULT 'Jewellery for every day and every occasion.',
  phone TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  delivery_fee INTEGER NOT NULL DEFAULT 450,
  free_delivery_over INTEGER,
  bank_name TEXT NOT NULL DEFAULT '',
  bank_branch TEXT NOT NULL DEFAULT '',
  account_name TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  bank_details TEXT NOT NULL DEFAULT '',
  pickup_enabled INTEGER NOT NULL DEFAULT 1,
  theme_mode TEXT NOT NULL DEFAULT 'system',
  theme_accent TEXT NOT NULL DEFAULT 'emerald'
);
`

func openDB(path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	// WAL lets readers work while an order is being written; _txlock=immediate makes
	// write transactions take the lock up front so they queue instead of failing.
	dsn := "file:" + path + "?_pragma=foreign_keys(1)&_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)&_txlock=immediate"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(8)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("create tables: %w", err)
	}
	if err := migrate(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("update tables: %w", err)
	}
	return db, nil
}

// migrate brings a database made by an older version of the shop up to date.
// Each step does nothing when it has already been applied.
func migrate(db *sql.DB) error {
	// AI try-on was removed.
	for _, t := range []string{"try_on_items", "try_ons", "ai_models"} {
		if _, err := db.Exec(`DROP TABLE IF EXISTS ` + t); err != nil {
			return err
		}
	}
	drop := map[string][]string{
		"products":      {"try_on_enabled", "try_on_asset_url"},
		"shop_settings": {"cod_enabled", "bank_enabled", "online_enabled"}, // bank transfer is the only payment method
	}
	add := map[string][]string{
		"shop_settings": {"bank_name TEXT NOT NULL DEFAULT ''", "bank_branch TEXT NOT NULL DEFAULT ''", "account_name TEXT NOT NULL DEFAULT ''", "account_number TEXT NOT NULL DEFAULT ''"},
		"orders":        {"payment_slip_url TEXT", "payment_ref TEXT", "payment_slip_at TEXT", "deposit INTEGER NOT NULL DEFAULT 0", "deposit_refunded_at TEXT"},
		// Pieces can be sold, rented (a fixed price for up to rent_days, then rent_extra_day per day) or both.
		"products": {"for_sale INTEGER NOT NULL DEFAULT 1", "for_rent INTEGER NOT NULL DEFAULT 0", "rent_price INTEGER NOT NULL DEFAULT 0",
			"rent_days INTEGER NOT NULL DEFAULT 3", "rent_extra_day INTEGER NOT NULL DEFAULT 0", "rent_deposit INTEGER NOT NULL DEFAULT 0", "rent_units INTEGER NOT NULL DEFAULT 1"},
		"order_items": {"size TEXT NOT NULL DEFAULT ''", "kind TEXT NOT NULL DEFAULT 'BUY'", "rent_from TEXT", "rent_to TEXT", "deposit INTEGER NOT NULL DEFAULT 0"},
	}
	hasColumn := func(table, col string) (bool, error) {
		n, err := countRows(context.Background(), db, `SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?`, table, col)
		return n > 0, err
	}
	// Cart lines gained size, rental dates and a wider unique key; SQLite can't change
	// a table's constraints in place, so the table is rebuilt.
	if has, err := hasColumn("cart_items", "kind"); err != nil {
		return err
	} else if !has {
		for _, q := range []string{
			`CREATE TABLE cart_items_new (
			  id TEXT PRIMARY KEY,
			  cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
			  product_id TEXT NOT NULL REFERENCES products(id),
			  qty INTEGER NOT NULL DEFAULT 1,
			  size TEXT NOT NULL DEFAULT '',
			  kind TEXT NOT NULL DEFAULT 'BUY',
			  rent_from TEXT NOT NULL DEFAULT '',
			  rent_to TEXT NOT NULL DEFAULT '',
			  UNIQUE (cart_id, product_id, size, kind, rent_from))`,
			`INSERT INTO cart_items_new (id, cart_id, product_id, qty) SELECT id, cart_id, product_id, qty FROM cart_items`,
			`DROP TABLE cart_items`,
			`ALTER TABLE cart_items_new RENAME TO cart_items`,
		} {
			if _, err := db.Exec(q); err != nil {
				return err
			}
		}
	}
	for table, cols := range drop {
		for _, col := range cols {
			if has, err := hasColumn(table, col); err != nil {
				return err
			} else if has {
				if _, err := db.Exec(`ALTER TABLE ` + table + ` DROP COLUMN ` + col); err != nil {
					return err
				}
			}
		}
	}
	for table, cols := range add {
		for _, def := range cols {
			col, _, _ := strings.Cut(def, " ")
			if has, err := hasColumn(table, col); err != nil {
				return err
			} else if !has {
				if _, err := db.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + def); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func withTx(ctx context.Context, db *sql.DB, fn func(tx *sql.Tx) error) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

func isUniqueViolation(err error) bool {
	var se *sqlite.Error
	return errors.As(err, &se) && (se.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE || se.Code() == sqlite3.SQLITE_CONSTRAINT_PRIMARYKEY)
}

// ---------- IDs and timestamps ----------

const idChars = "0123456789abcdefghijklmnopqrstuvwxyz"

// newID returns a 25-character id that sorts by creation time, like the cuid ids it replaces.
func newID() string {
	ts := strconv.FormatInt(time.Now().UnixMilli(), 36)
	var b strings.Builder
	b.WriteString("c")
	b.WriteString(strings.Repeat("0", 9-len(ts)) + ts)
	for range 15 {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(idChars))))
		b.WriteByte(idChars[n.Int64()])
	}
	return b.String()
}

// Timestamps are stored as fixed-width UTC strings so they compare and sort as text.
const tsLayout = "2006-01-02T15:04:05.000Z"

func ts(t time.Time) string { return t.UTC().Format(tsLayout) }
func nowTS() string         { return ts(time.Now()) }

func parseTS(s string) time.Time {
	t, err := time.Parse(tsLayout, s)
	if err != nil {
		t, _ = time.Parse(time.RFC3339Nano, s)
	}
	return t
}

// ---------- Small query helpers ----------

func placeholders(n int) string {
	if n == 0 {
		return "NULL"
	}
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func toAny[T any](list []T) []any {
	out := make([]any, len(list))
	for i, v := range list {
		out[i] = v
	}
	return out
}

func likeArg(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(s) + "%"
}

func countRows(ctx context.Context, q querier, query string, args ...any) (int, error) {
	var n int
	err := q.QueryRowContext(ctx, query, args...).Scan(&n)
	return n, err
}

func nullStr(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

func strPtr(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	s := ns.String
	return &s
}

func intPtr(ni sql.NullInt64) *int {
	if !ni.Valid {
		return nil
	}
	n := int(ni.Int64)
	return &n
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
