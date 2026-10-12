package main

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
)

// Messages are logged for now. To send real SMS or WhatsApp messages, call your provider
// (for example Notify.lk, Dialog eSMS or the WhatsApp Cloud API) inside send().
func send(to, text string) {
	if to == "" {
		return
	}
	log.Printf("[notify → %s]\n%s\n", to, text)
}

// lkr formats an amount like "LKR 30,600".
func lkr(n int) string {
	s := strconv.Itoa(n)
	var b strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(c)
	}
	return "LKR " + b.String()
}

func (a *App) shopName() string {
	s, err := getSettings(context.Background(), a.db)
	if err != nil {
		return "[Shop name]"
	}
	return s.ShopName
}

func (a *App) notifyOrderPlaced(o Order) {
	s, err := getSettings(context.Background(), a.db)
	if err != nil {
		log.Println("notify:", err)
		return
	}
	var lines []string
	for _, it := range o.Items {
		lines = append(lines, fmt.Sprintf("%s × %d", it.Name, it.Qty))
	}
	list := strings.Join(lines, "\n")
	payNote := ""
	if o.PaymentMethod != "COD" {
		payNote = "\nYour order is confirmed once we receive your payment."
	}
	send(o.Mobile, fmt.Sprintf("%s: order %s received.\n%s\nTotal %s.%s\nTrack it with your order number and mobile number.", s.ShopName, o.OrderNo, list, lkr(o.Total), payNote))
	shop := s.Whatsapp
	if shop == "" {
		shop = s.Phone
	}
	send(shop, fmt.Sprintf("New order %s from %s (%s).\n%s\nTotal %s", o.OrderNo, o.FullName, o.Mobile, list, lkr(o.Total)))
}

var statusText = map[string]string{
	"CONFIRMED":  "has been confirmed",
	"READY":      "is ready",
	"DISPATCHED": "is on its way",
	"DELIVERED":  "has been delivered",
	"CANCELLED":  "has been cancelled",
}

func (a *App) notifyStatusChanged(o Order) {
	if text, ok := statusText[o.Status]; ok {
		send(o.Mobile, fmt.Sprintf("%s: your order %s %s.", a.shopName(), o.OrderNo, text))
	}
}

func (a *App) notifyPaymentConfirmed(o Order) {
	send(o.Mobile, fmt.Sprintf("%s: we received your payment of %s. Your order %s is confirmed.", a.shopName(), lkr(o.Total), o.OrderNo))
}
