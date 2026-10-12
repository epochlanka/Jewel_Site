// Jewellery shop server: the REST API under /api, uploaded images under /uploads,
// and the HTML/CSS/JS storefront and admin from the frontend folder.
//
//	go run .                  start the server
//	go run . seed             add the admin account, categories and shop settings
//	go run . seed-demo        add demo products, model photos and an offer
//	go run . seed-demo --remove   take the demo content out again
package main

import (
	"crypto/rand"
	"database/sql"
	"log"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type App struct {
	cfg  Config
	db   *sql.DB
	wake chan struct{}
}

func randInt(n int64) int64 {
	v, _ := rand.Int(rand.Reader, big.NewInt(n))
	return v.Int64()
}

func main() {
	cfg := loadConfig()
	db, err := openDB(cfg.DBPath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	a := &App{cfg: cfg, db: db}

	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "seed":
			err = a.seed()
		case "seed-demo":
			if len(os.Args) > 2 && os.Args[2] == "--remove" {
				err = a.removeDemo()
			} else {
				err = a.seedDemo()
			}
		default:
			log.Fatalf("unknown command %q (use seed or seed-demo)", os.Args[1])
		}
		if err != nil {
			log.Fatal(err)
		}
		return
	}

	if err := os.MkdirAll(cfg.UploadDir, 0o755); err != nil {
		log.Fatal(err)
	}
	a.startTryOnWorker()
	srv := &http.Server{
		Addr:              "0.0.0.0:" + cfg.Port,
		Handler:           a.routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("Shop on http://localhost:%s (API on /api)", cfg.Port)
	log.Fatal(srv.ListenAndServe())
}

func (a *App) routes() http.Handler {
	mux := http.NewServeMux()
	route := func(pattern string, h handler) { mux.Handle(pattern, h) }
	admin := func(pattern string, h handler) { mux.Handle(pattern, a.adminOnly(h)) }

	route("GET /api/health", func(w http.ResponseWriter, r *http.Request) error { return ok(w, map[string]bool{"ok": true}) })

	route("POST /api/auth/register", a.register)
	route("POST /api/auth/login", a.login)
	route("GET /api/auth/me", a.me)
	route("PATCH /api/auth/me", a.updateMe)
	route("POST /api/auth/password", a.changePassword)

	route("GET /api/categories", a.categories)
	admin("POST /api/categories", a.saveCategory)
	admin("PUT /api/categories/{id}", a.saveCategory)
	admin("DELETE /api/categories/{id}", a.deleteCategory)

	route("GET /api/products", a.listProducts)
	route("GET /api/products/filters", a.productFilters)
	route("GET /api/products/{slug}", a.productBySlug)
	route("GET /api/products/{slug}/related", a.relatedProducts)
	admin("POST /api/products", a.createProduct)
	admin("PUT /api/products/{id}", a.updateProduct)
	admin("PUT /api/products/{id}/images/order", a.orderImages)
	admin("DELETE /api/products/{id}/images/{imageId}", a.deleteImage)
	admin("DELETE /api/products/{id}/try-on-asset", a.removeTryOnAsset)
	admin("DELETE /api/products/{id}", a.hideProduct)

	route("GET /api/cart", a.getCart)
	route("POST /api/cart/items", a.addToCart)
	route("PATCH /api/cart/items/{productId}", a.setCartQty)
	route("DELETE /api/cart/items/{productId}", a.removeCartItem)
	route("POST /api/cart/merge", a.mergeCart)

	route("POST /api/orders", a.createOrder)
	route("GET /api/orders/mine", a.myOrders)
	route("GET /api/orders/track", a.trackOrder)

	route("GET /api/tryon/models", a.tryOnModels)
	route("POST /api/tryon", a.startTryOn)
	route("GET /api/tryon/mine", a.myTryOns)
	route("GET /api/tryon/{id}", a.tryOnStatus)

	route("GET /api/wishlist", a.wishlist)
	route("GET /api/wishlist/ids", a.wishlistIDs)
	route("POST /api/wishlist/{productId}", a.addWish)
	route("DELETE /api/wishlist/{productId}", a.removeWish)

	route("GET /api/settings", a.settings)
	admin("PUT /api/settings", a.saveSettings)

	admin("GET /api/admin/dashboard", a.dashboard)
	admin("GET /api/admin/products", a.adminProducts)
	admin("GET /api/admin/products/{id}", a.adminProduct)
	admin("GET /api/admin/orders", a.adminOrders)
	admin("GET /api/admin/orders/{id}", a.adminOrder)
	admin("PATCH /api/admin/orders/{id}/status", a.adminSetStatus)
	admin("PATCH /api/admin/orders/{id}/payment", a.adminSetPayment)
	admin("GET /api/admin/customers", a.adminCustomers)
	admin("GET /api/admin/customers/{id}", a.adminCustomer)
	admin("GET /api/admin/ai-models", a.adminAiModels)
	admin("POST /api/admin/ai-models", a.addAiModel)
	admin("PATCH /api/admin/ai-models/{id}", a.updateAiModel)
	admin("DELETE /api/admin/ai-models/{id}", a.deleteAiModel)
	admin("GET /api/admin/offers", a.adminOffers)
	admin("POST /api/admin/offers", a.saveOffer)
	admin("PUT /api/admin/offers/{id}", a.saveOffer)
	admin("DELETE /api/admin/offers/{id}", a.deleteOffer)
	admin("GET /api/admin/reports/sales", a.salesReport)
	admin("GET /api/admin/reports/orders", a.ordersReport)
	admin("GET /api/admin/reports/products", a.productsReport)

	route("/api/", func(w http.ResponseWriter, r *http.Request) error { return httpErr(http.StatusNotFound, "Not found") })

	uploads := http.StripPrefix("/uploads/", http.FileServer(noListing{http.Dir(a.cfg.UploadDir)}))
	mux.Handle("GET /uploads/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=604800")
		uploads.ServeHTTP(w, r)
	}))
	mux.Handle("/", a.frontend())
	return cors(mux)
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Cart-Key")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// noListing hides directory listings in the upload folder.
type noListing struct{ fs http.FileSystem }

func (n noListing) Open(name string) (http.File, error) {
	f, err := n.fs.Open(name)
	if err != nil {
		return nil, err
	}
	if st, err := f.Stat(); err == nil && st.IsDir() {
		f.Close()
		return nil, os.ErrNotExist
	}
	return f, nil
}

// frontend serves the storefront files. Any other path without a file extension is a page
// of the single-page app, so it gets index.html and the browser-side router takes over.
func (a *App) frontend() http.Handler {
	root := a.cfg.StaticDir
	files := http.FileServer(noListing{http.Dir(root)})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		clean := filepath.Clean("/" + r.URL.Path)
		if st, err := os.Stat(filepath.Join(root, clean)); err == nil && !st.IsDir() {
			files.ServeHTTP(w, r)
			return
		}
		if filepath.Ext(clean) != "" && !strings.HasSuffix(clean, ".html") {
			http.NotFound(w, r)
			return
		}
		index, err := os.Open(filepath.Join(root, "index.html"))
		if err != nil {
			http.Error(w, "The shop's frontend files are missing.", http.StatusInternalServerError)
			return
		}
		defer index.Close()
		st, _ := index.Stat()
		http.ServeContent(w, r, "index.html", st.ModTime(), index)
	})
}
