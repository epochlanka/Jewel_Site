# Jewellery shop

- `backend/`: Go server with the REST API (`/api`), uploaded images (`/uploads`) and a SQLite database.
- `frontend/`: the storefront and admin in plain HTML, CSS and JavaScript (ES modules, no build step). The Go server serves it on the same port.

## Run it

Needs Go 1.22 or newer.

```bash
cd backend
cp .env.example .env     # first time only; then set JWT_SECRET
go run . seed            # admin@shop.lk / admin123, categories, shop settings
go run . seed-demo       # optional demo products, category photos and an offer
go run .                 # http://localhost:4000
```

Remove demo content with `go run . seed-demo --remove`. Build a single binary with `go build -o jewellery .`.
