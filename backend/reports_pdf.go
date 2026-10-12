package main

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/go-pdf/fpdf"
)

// GET /api/admin/reports/pdf?type=sales|orders|stock&from=YYYY-MM-DD&to=YYYY-MM-DD
// Builds a printable A4 report. The date range is inclusive and defaults to this month.
func (a *App) reportPDF(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	kind := q.Get("type")
	if !oneOf(kind, "sales", "orders", "stock") {
		return badField("type", "Choose a sales, orders or stock report")
	}
	now := time.Now()
	from, to := startOfDay(time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local)), startOfDay(now)
	for key, dst := range map[string]*time.Time{"from": &from, "to": &to} {
		if v := q.Get(key); v != "" {
			t, err := time.ParseInLocation("2006-01-02", v, time.Local)
			if err != nil {
				return badField(key, "Choose a valid date")
			}
			*dst = t
		}
	}
	if to.Before(from) {
		return badField("to", "The end date must be on or after the start date")
	}
	if to.Sub(from) > 366*24*time.Hour {
		return badField("to", "Choose a range of one year or less")
	}

	s, err := getSettings(r.Context(), a.db)
	if err != nil {
		return err
	}
	rep := newReport(s, now)
	switch kind {
	case "sales":
		err = a.salesPDF(r.Context(), rep, from, to)
	case "orders":
		err = a.ordersPDF(r.Context(), rep, from, to)
	case "stock":
		err = a.stockPDF(r.Context(), rep)
	}
	if err != nil {
		return err
	}
	name := fmt.Sprintf("%s-report-%s.pdf", kind, now.Format("2006-01-02"))
	if kind != "stock" {
		name = fmt.Sprintf("%s-report-%s-to-%s.pdf", kind, from.Format("2006-01-02"), to.Format("2006-01-02"))
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	return rep.pdf.Output(w)
}

// ---------- Layout helpers ----------

var accentRGB = map[string][3]int{"emerald": {14, 90, 69}, "gold": {138, 92, 18}, "rose": {163, 63, 88}, "blue": {49, 95, 156}}

type report struct {
	pdf    *fpdf.Fpdf
	tr     func(string) string
	accent [3]int
	shop   Settings
}

const pageW = 180.0 // A4 width minus 15 mm margins

func newReport(s Settings, generated time.Time) *report {
	p := fpdf.New("P", "mm", "A4", "")
	p.SetMargins(15, 15, 15)
	p.SetAutoPageBreak(true, 18)
	rep := &report{pdf: p, tr: p.UnicodeTranslatorFromDescriptor(""), shop: s, accent: accentRGB["emerald"]}
	if c, ok := accentRGB[s.ThemeAccent]; ok {
		rep.accent = c
	}
	p.SetTitle(s.ShopName+" report", true)
	p.SetCreator(s.ShopName, true)
	p.SetFooterFunc(func() {
		p.SetY(-12)
		p.SetFont("Helvetica", "", 8)
		p.SetTextColor(120, 128, 125)
		p.CellFormat(pageW/2, 5, rep.tr(fmt.Sprintf("%s · generated %s", s.ShopName, generated.Format("2 Jan 2006, 15:04"))), "", 0, "L", false, 0, "")
		p.CellFormat(pageW/2, 5, fmt.Sprintf("Page %d of {nb}", p.PageNo()), "", 0, "R", false, 0, "")
	})
	p.AliasNbPages("")
	return rep
}

// title starts the first page: a coloured band with the shop name, report name and period.
func (rep *report) title(name, period string) {
	p := rep.pdf
	p.AddPage()
	p.SetFillColor(rep.accent[0], rep.accent[1], rep.accent[2])
	p.Rect(0, 0, 210, 38, "F")
	p.SetTextColor(255, 255, 255)
	p.SetXY(15, 10)
	p.SetFont("Helvetica", "", 10)
	p.CellFormat(pageW, 5, rep.tr(rep.shop.ShopName), "", 1, "L", false, 0, "")
	p.SetX(15)
	p.SetFont("Helvetica", "B", 20)
	p.CellFormat(pageW, 10, rep.tr(name), "", 1, "L", false, 0, "")
	p.SetX(15)
	p.SetFont("Helvetica", "", 10)
	p.CellFormat(pageW, 6, rep.tr(period), "", 1, "L", false, 0, "")
	p.SetY(46)
}

func (rep *report) heading(text string) {
	p := rep.pdf
	if p.GetY() > 250 {
		p.AddPage()
	}
	p.Ln(4)
	p.SetFont("Helvetica", "B", 13)
	p.SetTextColor(29, 35, 33)
	p.CellFormat(pageW, 8, rep.tr(text), "", 1, "L", false, 0, "")
	p.Ln(1)
}

func (rep *report) note(text string) {
	p := rep.pdf
	p.SetFont("Helvetica", "", 9)
	p.SetTextColor(107, 115, 112)
	p.MultiCell(pageW, 5, rep.tr(text), "", "L", false)
	p.Ln(2)
}

// stats draws a row of summary boxes: label above a large value.
func (rep *report) stats(items [][2]string) {
	p := rep.pdf
	gap := 4.0
	w := (pageW - gap*float64(len(items)-1)) / float64(len(items))
	y := p.GetY()
	for i, it := range items {
		x := 15 + float64(i)*(w+gap)
		if i == 0 {
			p.SetFillColor(rep.accent[0], rep.accent[1], rep.accent[2])
			p.SetTextColor(255, 255, 255)
		} else {
			p.SetFillColor(243, 245, 244)
			p.SetTextColor(29, 35, 33)
		}
		p.RoundedRect(x, y, w, 22, 2.5, "1234", "F")
		p.SetXY(x+4, y+4)
		p.SetFont("Helvetica", "", 8.5)
		p.CellFormat(w-8, 4, rep.tr(it[0]), "", 2, "L", false, 0, "")
		p.SetX(x + 4)
		p.SetFont("Helvetica", "B", 13)
		p.CellFormat(w-8, 9, rep.tr(it[1]), "", 0, "L", false, 0, "")
	}
	p.SetY(y + 26)
}

type column struct {
	title string
	width float64
	align string // L, C or R
}

// table draws rows with a coloured header that repeats on each new page.
// A row whose first cell starts with "!" is drawn in bold (used for totals).
func (rep *report) table(cols []column, rows [][]string, highlight func(row []string) bool) {
	p := rep.pdf
	header := func() {
		p.SetFont("Helvetica", "B", 8.5)
		p.SetFillColor(rep.accent[0], rep.accent[1], rep.accent[2])
		p.SetTextColor(255, 255, 255)
		for _, c := range cols {
			p.CellFormat(c.width, 8, rep.tr(c.title), "", 0, c.align, true, 0, "")
		}
		p.Ln(-1)
	}
	header()
	if len(rows) == 0 {
		p.SetFont("Helvetica", "I", 9)
		p.SetTextColor(107, 115, 112)
		p.CellFormat(pageW, 9, "Nothing to show for this period.", "B", 1, "C", false, 0, "")
		return
	}
	for i, row := range rows {
		if p.GetY() > 270 {
			p.AddPage()
			header()
		}
		bold := strings.HasPrefix(row[0], "!")
		switch {
		case bold:
			p.SetFillColor(220, 235, 228)
		case highlight != nil && highlight(row):
			p.SetFillColor(253, 236, 236)
		case i%2 == 1:
			p.SetFillColor(247, 248, 247)
		default:
			p.SetFillColor(255, 255, 255)
		}
		if bold {
			p.SetFont("Helvetica", "B", 9)
		} else {
			p.SetFont("Helvetica", "", 8.5)
		}
		p.SetTextColor(29, 35, 33)
		for j, c := range cols {
			text := strings.TrimPrefix(row[j], "!")
			// Keep long text on one line by trimming it to the column width.
			for p.GetStringWidth(rep.tr(text)) > c.width-3 && len([]rune(text)) > 4 {
				r := []rune(text)
				text = strings.TrimSpace(string(r[:len(r)-4])) + "..."
			}
			p.CellFormat(c.width, 7, rep.tr(text), "", 0, c.align, true, 0, "")
		}
		p.Ln(-1)
	}
	p.SetDrawColor(220, 224, 222)
	p.Line(15, p.GetY(), 15+pageW, p.GetY())
}

func period(from, to time.Time) string {
	if from.Equal(to) {
		return from.Format("Monday 2 January 2006")
	}
	return from.Format("2 Jan 2006") + " to " + to.Format("2 Jan 2006")
}

var statusName = map[string]string{"PENDING": "Pending", "CONFIRMED": "Confirmed", "PROCESSING": "Processing", "READY": "Ready", "DISPATCHED": "Dispatched", "DELIVERED": "Delivered", "CANCELLED": "Cancelled"}

func (a *App) ordersBetween(ctx context.Context, from, to time.Time) ([]Order, error) {
	list, err := queryOrders(ctx, a.db, `SELECT `+orderCols+` FROM orders o WHERE o.created_at >= ? AND o.created_at < ? ORDER BY o.created_at`, ts(from), ts(to.AddDate(0, 0, 1)))
	if err != nil {
		return nil, err
	}
	return list, attachOrderDetail(ctx, a.db, list)
}

// ---------- Sales ----------

func (a *App) salesPDF(ctx context.Context, rep *report, from, to time.Time) error {
	orders, err := a.ordersBetween(ctx, from, to)
	if err != nil {
		return err
	}
	type day struct{ orders, sales int }
	days := map[string]*day{}
	type seller struct {
		name       string
		qty, sales int
	}
	sellers := map[string]*seller{}
	byStatus := map[string]int{}
	var count, revenue, delivery, paid, unpaid, cancelled int
	for _, o := range orders {
		byStatus[o.Status]++
		if o.Status == "CANCELLED" {
			cancelled++
			continue
		}
		count++
		revenue += o.Total
		delivery += o.DeliveryFee
		if o.PaymentStatus == "PAID" {
			paid += o.Total
		} else {
			unpaid += o.Total
		}
		key := parseTS(o.CreatedAt).Local().Format("2006-01-02")
		if days[key] == nil {
			days[key] = &day{}
		}
		days[key].orders++
		days[key].sales += o.Total
		for _, it := range o.Items {
			if sellers[it.ProductID] == nil {
				sellers[it.ProductID] = &seller{name: it.Name}
			}
			sellers[it.ProductID].qty += it.Qty
			sellers[it.ProductID].sales += it.Price * it.Qty
		}
	}
	avg := 0
	if count > 0 {
		avg = revenue / count
	}

	rep.title("Sales report", period(from, to))
	rep.stats([][2]string{{"Total sales", lkr(revenue)}, {"Orders", fmt.Sprint(count)}, {"Average order", lkr(avg)}, {"Cancelled", fmt.Sprint(cancelled)}})
	rep.stats([][2]string{{"Paid", lkr(paid)}, {"Waiting for payment", lkr(unpaid)}, {"Delivery fees", lkr(delivery)}})
	rep.note("Cancelled orders are left out of the sales figures. \"Waiting for payment\" is the value of orders that are not marked as paid yet.")

	rep.heading("Sales by day")
	var rows [][]string
	for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
		x := days[d.Format("2006-01-02")]
		if x == nil {
			x = &day{}
		}
		if x.orders == 0 && to.Sub(from) > 62*24*time.Hour {
			continue // long ranges: only days with sales
		}
		rows = append(rows, []string{d.Format("Mon 2 Jan 2006"), fmt.Sprint(x.orders), lkr(x.sales)})
	}
	rows = append(rows, []string{"!Total", fmt.Sprint(count), lkr(revenue)})
	rep.table([]column{{"Date", 90, "L"}, {"Orders", 40, "R"}, {"Sales", 50, "R"}}, rows, nil)

	rep.heading("Best sellers")
	list := make([]*seller, 0, len(sellers))
	for _, s := range sellers {
		list = append(list, s)
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].qty > list[j].qty || (list[i].qty == list[j].qty && list[i].sales > list[j].sales)
	})
	rows = nil
	for i, s := range list {
		if i == 15 {
			break
		}
		rows = append(rows, []string{fmt.Sprint(i + 1), s.name, fmt.Sprint(s.qty), lkr(s.sales)})
	}
	rep.table([]column{{"#", 12, "L"}, {"Product", 108, "L"}, {"Pieces sold", 28, "R"}, {"Sales", 32, "R"}}, rows, nil)

	rep.heading("Orders by status")
	rows = nil
	for _, st := range orderStatuses {
		rows = append(rows, []string{statusName[st], fmt.Sprint(byStatus[st])})
	}
	rep.table([]column{{"Status", 130, "L"}, {"Orders", 50, "R"}}, rows, nil)
	return nil
}

// ---------- Orders ----------

func (a *App) ordersPDF(ctx context.Context, rep *report, from, to time.Time) error {
	orders, err := a.ordersBetween(ctx, from, to)
	if err != nil {
		return err
	}
	var total, count int
	var rows [][]string
	for _, o := range orders {
		pay := "Not paid"
		if o.PaymentStatus == "PAID" {
			pay = "Paid"
		} else if o.PaymentStatus == "REFUNDED" {
			pay = "Refunded"
		}
		deliv := "Delivery"
		if o.DeliveryMethod == "PICKUP" {
			deliv = "Pickup"
		}
		pieces := 0
		for _, it := range o.Items {
			pieces += it.Qty
		}
		rows = append(rows, []string{o.OrderNo, parseTS(o.CreatedAt).Local().Format("2 Jan 15:04"), o.FullName, o.Mobile, fmt.Sprint(pieces), deliv, pay, statusName[o.Status], lkr(o.Total)})
		if o.Status != "CANCELLED" {
			total += o.Total
			count++
		}
	}
	rep.title("Orders report", period(from, to))
	rep.stats([][2]string{{"Orders", fmt.Sprint(len(orders))}, {"Value (not cancelled)", lkr(total)}, {"Cancelled", fmt.Sprint(len(orders) - count)}})
	rep.heading("All orders")
	rows = append(rows, []string{"!Total", "", "", "", "", "", "", "", lkr(total)})
	rep.table([]column{
		{"Order", 21, "L"}, {"Placed", 21, "L"}, {"Customer", 34, "L"}, {"Mobile", 21, "L"}, {"Pcs", 9, "R"},
		{"Delivery", 16, "L"}, {"Payment", 16, "L"}, {"Status", 19, "L"}, {"Total", 23, "R"},
	}, rows, func(row []string) bool { return row[7] == "Cancelled" })
	rep.note("Cancelled orders are shaded and left out of the total.")
	return nil
}

// ---------- Stock ----------

func (a *App) stockPDF(ctx context.Context, rep *report) error {
	products, err := queryProducts(ctx, a.db, `SELECT `+productCols+` FROM products p ORDER BY p.is_active DESC, p.stock, p.name`)
	if err != nil {
		return err
	}
	if err := attachCategories(ctx, a.db, products); err != nil {
		return err
	}
	var active, soldOut, low, pieces, value int
	var rows [][]string
	for _, p := range products {
		state := "Hidden"
		if p.IsActive {
			active++
			pieces += p.Stock
			value += p.Stock * p.Price
			switch {
			case p.Stock == 0:
				soldOut++
				state = "Sold out"
			case p.Stock <= 3:
				low++
				state = "Low stock"
			default:
				state = "In stock"
			}
		}
		cat := ""
		if p.Category != nil {
			cat = p.Category.Name
		}
		rows = append(rows, []string{p.Code, p.Name, cat, lkr(p.Price), fmt.Sprint(p.Stock), state})
	}
	rep.title("Stock report", "Stock on "+time.Now().Format("Monday 2 January 2006"))
	rep.stats([][2]string{{"Stock value", lkr(value)}, {"Products in the shop", fmt.Sprint(active)}, {"Pieces in stock", fmt.Sprint(pieces)}})
	rep.stats([][2]string{{"Sold out", fmt.Sprint(soldOut)}, {"Low stock (3 or fewer)", fmt.Sprint(low)}, {"Hidden products", fmt.Sprint(len(products) - active)}})
	rep.note("Stock value is price × pieces in stock for products shown in the shop. Sold out and low stock rows are shaded.")
	rep.heading("All products")
	rep.table([]column{{"Code", 26, "L"}, {"Product", 64, "L"}, {"Category", 32, "L"}, {"Price", 22, "R"}, {"Stock", 14, "R"}, {"Status", 22, "L"}}, rows,
		func(row []string) bool { return row[5] == "Sold out" || row[5] == "Low stock" })
	return nil
}
