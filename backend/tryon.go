package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type AiModel struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	ImageURL  string `json:"imageUrl"`
	IsActive  bool   `json:"isActive"`
	CreatedAt string `json:"createdAt"`
	Count     *struct {
		TryOns int `json:"tryOns"`
	} `json:"_count,omitempty"`
}

func (a *App) listAiModels(ctx context.Context, activeOnly, withCounts bool) ([]AiModel, error) {
	where := ""
	if activeOnly {
		where = "WHERE m.is_active = 1"
	}
	rows, err := a.db.QueryContext(ctx, `SELECT m.id, m.name, m.image_url, m.is_active, m.created_at,
	  (SELECT COUNT(*) FROM try_ons t WHERE t.ai_model_id = m.id) FROM ai_models m `+where+` ORDER BY m.created_at, m.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AiModel{}
	for rows.Next() {
		var m AiModel
		var n int
		if err := rows.Scan(&m.ID, &m.Name, &m.ImageURL, &m.IsActive, &m.CreatedAt, &n); err != nil {
			return nil, err
		}
		if withCounts {
			m.Count = &struct {
				TryOns int `json:"tryOns"`
			}{n}
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (a *App) tryOnModels(w http.ResponseWriter, r *http.Request) error {
	list, err := a.listAiModels(r.Context(), true, false)
	if err != nil {
		return err
	}
	return ok(w, list)
}

// multipart: productIds (JSON array string), source=AI_MODEL|UPLOAD, aiModelId?, photo?
func (a *App) startTryOn(w http.ResponseWriter, r *http.Request) error {
	if err := parseMultipart(w, r); err != nil {
		return err
	}
	ctx := r.Context()
	rawIDs, _ := formValue(r, "productIds")
	var ids []string
	if json.Unmarshal([]byte(rawIDs), &ids) != nil || len(ids) < 1 || len(ids) > 5 {
		return badField("productIds", "Choose 1 to 5 items")
	}
	source, _ := formValue(r, "source")
	if !oneOf(source, "AI_MODEL", "UPLOAD") {
		return badField("source", "")
	}
	modelID, _ := formValue(r, "aiModelId")

	rows, err := a.db.QueryContext(ctx, `SELECT jewellery_type FROM products WHERE id IN (`+placeholders(len(ids))+`) AND try_on_enabled = 1 AND is_active = 1`, toAny(ids)...)
	if err != nil {
		return err
	}
	types := map[string]bool{}
	found := 0
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			rows.Close()
			return err
		}
		types[t] = true
		found++
	}
	rows.Close()
	if found != len(ids) {
		return httpErr(http.StatusBadRequest, "One or more of these items can't be tried on.")
	}
	if len(types) != found {
		return httpErr(http.StatusBadRequest, "Choose one item of each type, for example one pair of earrings and one necklace.")
	}

	var inputURL string
	var modelArg any
	if source == "UPLOAD" {
		photo, err := formImage(r, "photo")
		if err != nil {
			return err
		}
		if photo == nil {
			return httpErr(http.StatusBadRequest, "Upload a JPG, PNG or WebP photo to continue.")
		}
		if inputURL, err = a.saveUpload(photo); err != nil {
			return err
		}
	} else {
		err := a.db.QueryRowContext(ctx, `SELECT image_url FROM ai_models WHERE id = ? AND is_active = 1`, modelID).Scan(&inputURL)
		if errors.Is(err, sql.ErrNoRows) || modelID == "" {
			return httpErr(http.StatusBadRequest, "Choose a model to continue.")
		}
		if err != nil {
			return err
		}
		modelArg = modelID
	}

	var userID any
	if u := a.currentUser(r); u != nil {
		userID = u.ID
	}
	id := newID()
	err = withTx(ctx, a.db, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO try_ons (id, user_id, source, ai_model_id, input_url, status, created_at) VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`,
			id, userID, source, modelArg, inputURL, nowTS()); err != nil {
			return err
		}
		for _, pid := range ids {
			if _, err := tx.ExecContext(ctx, `INSERT INTO try_on_items (id, try_on_id, product_id) VALUES (?, ?, ?)`, newID(), id, pid); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	a.wakeWorker()
	return writeJSON(w, http.StatusAccepted, map[string]any{"id": id, "status": "PENDING"})
}

func (a *App) myTryOns(w http.ResponseWriter, r *http.Request) error {
	u, err := a.requireUser(r)
	if err != nil {
		return err
	}
	type itemProduct struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Slug     string `json:"slug"`
		Price    int    `json:"price"`
		IsActive bool   `json:"isActive"`
	}
	type item struct {
		Product itemProduct `json:"product"`
	}
	type saved struct {
		ID        string `json:"id"`
		ResultURL string `json:"resultUrl"`
		CreatedAt string `json:"createdAt"`
		Items     []item `json:"items"`
	}
	ctx := r.Context()
	rows, err := a.db.QueryContext(ctx, `SELECT id, result_url, created_at FROM try_ons WHERE user_id = ? AND status = 'DONE' ORDER BY created_at DESC LIMIT 50`, u.ID)
	if err != nil {
		return err
	}
	out := []saved{}
	index := map[string]int{}
	for rows.Next() {
		var s saved
		var res sql.NullString
		if err := rows.Scan(&s.ID, &res, &s.CreatedAt); err != nil {
			rows.Close()
			return err
		}
		s.ResultURL, s.Items = res.String, []item{}
		index[s.ID] = len(out)
		out = append(out, s)
	}
	rows.Close()
	if len(out) > 0 {
		ids := make([]string, len(out))
		for i, s := range out {
			ids[i] = s.ID
		}
		rows, err := a.db.QueryContext(ctx, `SELECT ti.try_on_id, p.id, p.name, p.slug, p.price, p.is_active FROM try_on_items ti JOIN products p ON p.id = ti.product_id
		  WHERE ti.try_on_id IN (`+placeholders(len(ids))+`) ORDER BY ti.id`, toAny(ids)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var tid string
			var p itemProduct
			if err := rows.Scan(&tid, &p.ID, &p.Name, &p.Slug, &p.Price, &p.IsActive); err != nil {
				return err
			}
			i := index[tid]
			out[i].Items = append(out[i].Items, item{p})
		}
	}
	return ok(w, out)
}

// The try-on page polls this every 2 seconds.
func (a *App) tryOnStatus(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	var id, status string
	var result, jobErr sql.NullString
	err := a.db.QueryRowContext(ctx, `SELECT id, status, result_url, error FROM try_ons WHERE id = ?`, r.PathValue("id")).Scan(&id, &status, &result, &jobErr)
	if errors.Is(err, sql.ErrNoRows) {
		return httpErr(http.StatusNotFound, "Try-on not found")
	}
	if err != nil {
		return err
	}
	items := []map[string]string{}
	rows, err := a.db.QueryContext(ctx, `SELECT product_id FROM try_on_items WHERE try_on_id = ? ORDER BY id`, id)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var pid string
		if err := rows.Scan(&pid); err != nil {
			return err
		}
		items = append(items, map[string]string{"productId": pid})
	}
	// Setup problems are shown as they are; anything else gets a friendly message.
	var msg *string
	if jobErr.Valid {
		m := "We couldn't create a preview from this photo. Try a clear, front-facing photo with good light."
		if strings.Contains(jobErr.String, "AI try-on isn't configured.") {
			m = jobErr.String
		}
		msg = &m
	}
	return ok(w, map[string]any{"id": id, "status": status, "resultUrl": strPtr(result), "error": msg, "items": items})
}

// ---------- AI provider ----------

var placement = map[string]string{
	"EARRINGS": "on both earlobes", "NECKLACE": "around the neck, resting on the collarbone",
	"CHAIN": "around the neck", "LONG_CHAIN": "around the neck, hanging to mid-chest",
	"BANGLE": "on the wrist", "BRACELET": "on the wrist", "RING": "on the ring finger",
	"ANKLET": "on the ankle", "HAIR": "in the hair", "OTHER": "where it is naturally worn",
}

type tryOnItem struct{ ImageURL, Type string }

func buildPrompt(items []tryOnItem) string {
	var b strings.Builder
	b.WriteString("Photorealistic jewellery virtual try-on. Image 1 is the person. ")
	for i, it := range items {
		if i > 0 {
			b.WriteString(" ")
		}
		fmt.Fprintf(&b, "Image %d is a jewellery piece: place it %s.", i+2, placement[it.Type])
	}
	b.WriteString(" Keep the person's face, skin tone, hair, clothes, pose and background exactly the same. " +
		"Copy each jewellery design exactly as in its reference image (shape, colour, stones, metal). " +
		"Match the lighting, perspective and realistic scale. Return only the edited photo of the person.")
	return b.String()
}

var aiClient = &http.Client{Timeout: 120 * time.Second}

// localUpload maps an image URL to its file when the image is stored on this server.
func (a *App) localUpload(url string) (string, bool) {
	for _, prefix := range []string{"/uploads/", a.cfg.PublicURL + "/uploads/"} {
		if strings.HasPrefix(url, prefix) {
			name := filepath.Base(strings.TrimPrefix(url, prefix))
			return filepath.Join(a.cfg.UploadDir, name), true
		}
	}
	return "", false
}

// toDataURI inlines an image, because images on this server aren't reachable from the AI service when running locally.
func (a *App) toDataURI(url string) (string, error) {
	var data []byte
	var typ string
	if file, local := a.localUpload(url); local {
		buf, err := os.ReadFile(file)
		if err != nil {
			return "", err
		}
		data, typ = buf, mime.TypeByExtension(strings.ToLower(filepath.Ext(file)))
	} else {
		res, err := aiClient.Get(url)
		if err != nil {
			return "", err
		}
		defer res.Body.Close()
		if res.StatusCode >= 300 {
			return "", fmt.Errorf("couldn't load image %s (%d)", url, res.StatusCode)
		}
		if data, err = io.ReadAll(io.LimitReader(res.Body, 20<<20)); err != nil {
			return "", err
		}
		typ = strings.Split(res.Header.Get("Content-Type"), ";")[0]
	}
	if typ == "" {
		typ = "image/jpeg"
	}
	return "data:" + typ + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

// saveResult keeps the result on this server so it doesn't depend on the AI service's temporary links.
func (a *App) saveResult(url string) (string, error) {
	var data []byte
	ext := ".png"
	if strings.HasPrefix(url, "data:") {
		meta, payload, _ := strings.Cut(url, ",")
		buf, err := base64.StdEncoding.DecodeString(payload)
		if err != nil {
			return "", err
		}
		data = buf
		if strings.Contains(meta, "jpeg") {
			ext = ".jpg"
		} else if strings.Contains(meta, "webp") {
			ext = ".webp"
		}
	} else {
		res, err := aiClient.Get(url)
		if err != nil {
			return "", err
		}
		defer res.Body.Close()
		if res.StatusCode >= 300 {
			return "", fmt.Errorf("couldn't download the result (%d)", res.StatusCode)
		}
		if data, err = io.ReadAll(io.LimitReader(res.Body, 30<<20)); err != nil {
			return "", err
		}
		typ := res.Header.Get("Content-Type")
		if strings.Contains(typ, "jpeg") {
			ext = ".jpg"
		} else if strings.Contains(typ, "webp") {
			ext = ".webp"
		}
	}
	name := fmt.Sprintf("tryon-%d-%d%s", time.Now().UnixMilli(), randInt(1e6), ext)
	if err := os.WriteFile(filepath.Join(a.cfg.UploadDir, name), data, 0o644); err != nil {
		return "", err
	}
	return "/uploads/" + name, nil
}

func (a *App) absoluteURL(url string) string {
	if strings.HasPrefix(url, "/") {
		return a.cfg.PublicURL + url
	}
	return url
}

func (a *App) generate(person string, items []tryOnItem) (string, error) {
	switch a.cfg.AIProvider {
	case "fal":
		return a.generateFal(person, items)
	case "http":
		return a.generateHTTP(person, items)
	default:
		return "", errors.New("AI try-on isn't configured. Add FAL_KEY to backend/.env to generate previews.")
	}
}

// fal.ai image editing (default model: Gemini 2.5 Flash Image edit).
// Docs: https://fal.ai/models/fal-ai/gemini-25-flash-image/edit/api
func (a *App) generateFal(person string, items []tryOnItem) (string, error) {
	if a.cfg.AIAPIKey == "" {
		return "", errors.New("FAL_KEY is missing in .env")
	}
	urls := []string{person}
	for _, it := range items {
		urls = append(urls, it.ImageURL)
	}
	for i, u := range urls {
		d, err := a.toDataURI(u)
		if err != nil {
			return "", err
		}
		urls[i] = d
	}
	payload, _ := json.Marshal(map[string]any{"prompt": buildPrompt(items), "image_urls": urls, "num_images": 1, "output_format": "jpeg"})
	req, _ := http.NewRequest(http.MethodPost, "https://fal.run/"+a.cfg.FalModel, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Key "+a.cfg.AIAPIKey)
	res, err := aiClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 40<<20))
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("fal.ai %d: %.300s", res.StatusCode, body)
	}
	var out struct {
		Images []struct {
			URL string `json:"url"`
		} `json:"images"`
	}
	if json.Unmarshal(body, &out) != nil || len(out.Images) == 0 || out.Images[0].URL == "" {
		return "", errors.New("fal.ai returned no image")
	}
	return a.saveResult(out.Images[0].URL)
}

// Generic HTTP provider. Adapt the body and response to another image-editing API.
func (a *App) generateHTTP(person string, items []tryOnItem) (string, error) {
	refs := make([]string, len(items))
	for i, it := range items {
		refs[i] = a.absoluteURL(it.ImageURL)
	}
	payload, _ := json.Marshal(map[string]any{"person_image": a.absoluteURL(person), "reference_images": refs, "prompt": buildPrompt(items)})
	req, err := http.NewRequest(http.MethodPost, a.cfg.AIEndpoint, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.cfg.AIAPIKey)
	res, err := aiClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("AI provider %d: %s", res.StatusCode, body)
	}
	var out struct {
		OutputURL string `json:"output_url"`
	}
	if json.Unmarshal(body, &out) != nil || out.OutputURL == "" {
		return "", errors.New("AI provider returned no image")
	}
	return out.OutputURL, nil
}

// ---------- Worker ----------

// The worker is a simple queue over the try_ons table. It checks every 1.5 seconds,
// and straight away when a new try-on is started.
func (a *App) startTryOnWorker() {
	a.wake = make(chan struct{}, 1)
	go func() {
		ticker := time.NewTicker(1500 * time.Millisecond)
		defer ticker.Stop()
		lastErr := ""
		for {
			select {
			case <-ticker.C:
			case <-a.wake:
			}
			for {
				more, err := a.processNextTryOn()
				if err != nil {
					if err.Error() != lastErr {
						log.Println("[tryon worker]", err)
					}
					lastErr = err.Error()
					break
				}
				lastErr = ""
				if !more {
					break
				}
			}
		}
	}()
}

func (a *App) wakeWorker() {
	select {
	case a.wake <- struct{}{}:
	default:
	}
}

func (a *App) processNextTryOn() (bool, error) {
	ctx := context.Background()
	var id, input string
	err := a.db.QueryRowContext(ctx, `SELECT id, input_url FROM try_ons WHERE status = 'PENDING' ORDER BY created_at, id LIMIT 1`).Scan(&id, &input)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	res, err := a.db.ExecContext(ctx, `UPDATE try_ons SET status = 'PROCESSING' WHERE id = ? AND status = 'PENDING'`, id)
	if err != nil {
		return false, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return true, nil
	}

	// Each piece uses its try-on image, or its main photo when there isn't one.
	rows, err := a.db.QueryContext(ctx, `SELECT COALESCE(p.try_on_asset_url,
	  (SELECT pi.url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort, pi.id LIMIT 1), ''), p.jewellery_type
	  FROM try_on_items ti JOIN products p ON p.id = ti.product_id WHERE ti.try_on_id = ? ORDER BY ti.id`, id)
	if err != nil {
		return false, err
	}
	var items []tryOnItem
	for rows.Next() {
		var it tryOnItem
		if err := rows.Scan(&it.ImageURL, &it.Type); err != nil {
			rows.Close()
			return false, err
		}
		items = append(items, it)
	}
	rows.Close()

	result, genErr := a.generate(input, items)
	if genErr != nil {
		msg := genErr.Error()
		if len(msg) > 500 {
			msg = msg[:500]
		}
		_, err = a.db.ExecContext(ctx, `UPDATE try_ons SET status = 'FAILED', error = ? WHERE id = ?`, msg, id)
	} else {
		_, err = a.db.ExecContext(ctx, `UPDATE try_ons SET status = 'DONE', result_url = ? WHERE id = ?`, result, id)
	}
	return true, err
}
