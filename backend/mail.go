package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"html/template"
	"log"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/smtp"
	"net/url"
	"strings"
	"time"
)

// sendMail sends a plain-text and HTML email. Without SMTP settings in .env the
// email is written to the log instead, so the shop still works while it is set up.
func (a *App) sendMail(to, subject, text, htmlBody string) {
	if to == "" {
		return
	}
	if a.cfg.SMTPHost == "" {
		log.Printf("[email → %s] %s\n%s\n(Add SMTP_HOST, SMTP_USER and SMTP_PASS to backend/.env to send real emails.)\n", to, subject, text)
		return
	}
	if err := a.deliverMail(to, subject, text, htmlBody); err != nil {
		log.Printf("email to %s failed: %v", to, err)
	}
}

func (a *App) deliverMail(to, subject, text, htmlBody string) error {
	from := a.cfg.MailFrom
	shop := a.shopName()
	boundary := randomHex(12)
	var msg bytes.Buffer
	header := func(k, v string) { fmt.Fprintf(&msg, "%s: %s\r\n", k, v) }
	header("From", mime.QEncoding.Encode("utf-8", oneLine(shop))+" <"+from+">")
	header("To", to)
	header("Subject", mime.QEncoding.Encode("utf-8", oneLine(subject)))
	header("Date", time.Now().Format(time.RFC1123Z))
	header("Message-ID", "<"+randomHex(16)+"@"+domainOf(from)+">")
	header("MIME-Version", "1.0")
	header("Content-Type", `multipart/alternative; boundary="`+boundary+`"`)
	msg.WriteString("\r\n")
	for _, part := range []struct{ typ, body string }{{"text/plain", text}, {"text/html", htmlBody}} {
		fmt.Fprintf(&msg, "--%s\r\nContent-Type: %s; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n", boundary, part.typ)
		qp := quotedprintable.NewWriter(&msg)
		qp.Write([]byte(part.body))
		qp.Close()
		msg.WriteString("\r\n")
	}
	fmt.Fprintf(&msg, "--%s--\r\n", boundary)

	addr := net.JoinHostPort(a.cfg.SMTPHost, a.cfg.SMTPPort)
	var auth smtp.Auth
	if a.cfg.SMTPUser != "" {
		auth = smtp.PlainAuth("", a.cfg.SMTPUser, a.cfg.SMTPPass, a.cfg.SMTPHost)
	}
	if a.cfg.SMTPPort != "465" {
		// Port 587 and others: smtp.SendMail upgrades to TLS with STARTTLS when the server offers it.
		return smtp.SendMail(addr, auth, from, []string{to}, msg.Bytes())
	}
	// Port 465 uses TLS from the start.
	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 20 * time.Second}, "tcp", addr, &tls.Config{ServerName: a.cfg.SMTPHost})
	if err != nil {
		return err
	}
	c, err := smtp.NewClient(conn, a.cfg.SMTPHost)
	if err != nil {
		return err
	}
	defer c.Close()
	if auth != nil {
		if err := c.Auth(auth); err != nil {
			return err
		}
	}
	if err := c.Mail(from); err != nil {
		return err
	}
	if err := c.Rcpt(to); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg.Bytes()); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}

func oneLine(s string) string { return strings.NewReplacer("\r", " ", "\n", " ").Replace(s) }

func domainOf(addr string) string {
	if i := strings.LastIndex(addr, "@"); i >= 0 {
		return addr[i+1:]
	}
	return "localhost"
}

func randomHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// ---------- Order emails ----------

type mailData struct {
	Shop     Settings
	Order    Order
	Name     string
	Heading  string
	Intro    string
	TrackURL string
	PayURL   string
	ShowPay  bool
	SiteURL  string
}

func (a *App) mailData(o Order, heading, intro string) (mailData, error) {
	s, err := getSettings(context.Background(), a.db)
	if err != nil {
		return mailData{}, err
	}
	q := url.Values{"orderNo": {o.OrderNo}, "mobile": {o.Mobile}}
	return mailData{
		Shop: s, Order: o, Name: strings.Fields(o.FullName + " ")[0], Heading: heading, Intro: intro,
		TrackURL: a.cfg.SiteURL + "/track?" + q.Encode(),
		PayURL:   a.cfg.SiteURL + "/pay/" + url.PathEscape(o.OrderNo),
		ShowPay:  o.PaymentMethod == "BANK_TRANSFER" && o.PaymentStatus == "UNPAID" && o.Status == "PENDING",
		SiteURL:  a.cfg.SiteURL,
	}, nil
}

var mailFuncs = template.FuncMap{
	"lkr": lkr,
	"mul": func(a, b int) int { return a * b },
	"orderBy": func(o Order) string {
		return strings.Join(nonEmpty(deref(o.Address), deref(o.City), deref(o.PostalCode)), ", ")
	},
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func nonEmpty(parts ...string) []string {
	var out []string
	for _, p := range parts {
		if strings.TrimSpace(p) != "" {
			out = append(out, p)
		}
	}
	return out
}

// Email clients ignore stylesheets, so the styles are written inline.
var orderMail = template.Must(template.New("order").Funcs(mailFuncs).Parse(`<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f5f3;font-family:Arial,Helvetica,sans-serif;color:#1d2321">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f3;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
  <tr><td style="background:#0e5a45;color:#ffffff;padding:20px 28px;font-size:20px;font-weight:bold">{{.Shop.ShopName}}</td></tr>
  <tr><td style="padding:28px">
    <h1 style="margin:0 0 8px;font-size:22px">{{.Heading}}</h1>
    <p style="margin:0 0 20px;line-height:1.5;color:#4a524f">Hi {{.Name}}, {{.Intro}}</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#dcebe4;border-radius:12px;margin-bottom:20px">
      <tr><td style="padding:16px 20px">
        <div style="font-size:13px;color:#4a524f">Your order number</div>
        <div style="font-size:26px;font-weight:bold;letter-spacing:1px;margin:4px 0">{{.Order.OrderNo}}</div>
        <div style="font-size:13px;color:#4a524f">Track your order any time with this number and your mobile number {{.Order.Mobile}}.</div>
      </td></tr>
    </table>
    <p style="margin:0 0 24px"><a href="{{.TrackURL}}" style="display:inline-block;background:#0e5a45;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">Track your order</a></p>

    {{if .ShowPay}}
    <h2 style="font-size:17px;margin:0 0 10px">Complete your payment</h2>
    <p style="margin:0 0 12px;line-height:1.5;color:#4a524f">Transfer <strong>{{lkr .Order.Total}}</strong> with <strong>{{.Order.OrderNo}}</strong> as the reference, then upload the slip. Your order is confirmed as soon as we receive the payment.</p>
    {{if .Shop.AccountNumber}}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e6e4;border-radius:12px;margin-bottom:16px;font-size:14px">
      {{if .Shop.BankName}}<tr><td style="padding:8px 14px;color:#6b7370">Bank</td><td style="padding:8px 14px;font-weight:bold">{{.Shop.BankName}}</td></tr>{{end}}
      {{if .Shop.BankBranch}}<tr><td style="padding:8px 14px;color:#6b7370">Branch</td><td style="padding:8px 14px;font-weight:bold">{{.Shop.BankBranch}}</td></tr>{{end}}
      {{if .Shop.AccountName}}<tr><td style="padding:8px 14px;color:#6b7370">Account name</td><td style="padding:8px 14px;font-weight:bold">{{.Shop.AccountName}}</td></tr>{{end}}
      <tr><td style="padding:8px 14px;color:#6b7370">Account number</td><td style="padding:8px 14px;font-weight:bold">{{.Shop.AccountNumber}}</td></tr>
      <tr><td style="padding:8px 14px;color:#6b7370">Amount</td><td style="padding:8px 14px;font-weight:bold">{{lkr .Order.Total}}</td></tr>
      <tr><td style="padding:8px 14px;color:#6b7370">Reference</td><td style="padding:8px 14px;font-weight:bold">{{.Order.OrderNo}}</td></tr>
    </table>
    {{end}}
    <p style="margin:0 0 24px"><a href="{{.PayURL}}" style="display:inline-block;border:2px solid #0e5a45;color:#0e5a45;text-decoration:none;font-weight:bold;padding:10px 20px;border-radius:999px">Upload payment slip</a></p>
    {{end}}

    <h2 style="font-size:17px;margin:0 0 10px">Order summary</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin-bottom:8px">
      {{range .Order.Items}}<tr><td style="padding:6px 0;border-bottom:1px solid #eef0ef">{{.Name}} × {{.Qty}}</td><td align="right" style="padding:6px 0;border-bottom:1px solid #eef0ef">{{lkr (mul .Price .Qty)}}</td></tr>{{end}}
      <tr><td style="padding:6px 0;color:#6b7370">Subtotal</td><td align="right" style="padding:6px 0">{{lkr .Order.Subtotal}}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7370">{{if eq .Order.DeliveryMethod "PICKUP"}}Store pickup{{else}}Delivery{{end}}</td><td align="right" style="padding:6px 0">{{if .Order.DeliveryFee}}{{lkr .Order.DeliveryFee}}{{else}}Free{{end}}</td></tr>
      <tr><td style="padding:10px 0;font-weight:bold;font-size:16px;border-top:1px solid #e3e6e4">Total</td><td align="right" style="padding:10px 0;font-weight:bold;font-size:16px;border-top:1px solid #e3e6e4">{{lkr .Order.Total}}</td></tr>
    </table>
    <p style="margin:12px 0 0;font-size:14px;line-height:1.5;color:#4a524f">
      {{if eq .Order.DeliveryMethod "PICKUP"}}<strong>Store pickup</strong>{{if .Shop.Address}} from {{.Shop.Address}}{{end}}{{else}}<strong>Delivering to</strong> {{orderBy .Order}}{{end}}
    </p>
  </td></tr>
  <tr><td style="padding:18px 28px;background:#f4f5f3;font-size:12px;color:#6b7370;line-height:1.5">
    Questions about your order? Reply to this email{{if .Shop.Whatsapp}} or message us on WhatsApp {{.Shop.Whatsapp}}{{else if .Shop.Phone}} or call {{.Shop.Phone}}{{end}}.<br>
    <a href="{{.SiteURL}}" style="color:#0e5a45">{{.Shop.ShopName}}</a>
  </td></tr>
</table>
</td></tr></table>
</body></html>`))

func (a *App) orderEmail(o Order, subject, heading, intro string) {
	if o.Email == nil {
		return
	}
	d, err := a.mailData(o, heading, intro)
	if err != nil {
		log.Println("email:", err)
		return
	}
	var body bytes.Buffer
	if err := orderMail.Execute(&body, d); err != nil {
		log.Println("email:", err)
		return
	}
	var text strings.Builder
	fmt.Fprintf(&text, "Hi %s, %s\n\nYour order number: %s\nTrack your order: %s\n", d.Name, intro, o.OrderNo, d.TrackURL)
	if d.ShowPay {
		fmt.Fprintf(&text, "\nComplete your payment: transfer %s with %s as the reference, then upload the slip at %s\n", lkr(o.Total), o.OrderNo, d.PayURL)
		if d.Shop.AccountNumber != "" {
			fmt.Fprintf(&text, "%s\nAccount name: %s\nAccount number: %s\n", strings.Join(nonEmpty(d.Shop.BankName, d.Shop.BankBranch), ", "), d.Shop.AccountName, d.Shop.AccountNumber)
		}
	}
	text.WriteString("\nOrder summary\n")
	for _, it := range o.Items {
		fmt.Fprintf(&text, "%s × %d  %s\n", it.Name, it.Qty, lkr(it.Price*it.Qty))
	}
	fmt.Fprintf(&text, "Total %s\n", lkr(o.Total))
	a.sendMail(*o.Email, subject, text.String(), body.String())
}
