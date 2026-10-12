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
		lines = append(lines, fmt.Sprintf("%s × %d", it.label(), it.Qty))
	}
	list := strings.Join(lines, "\n")
	send(o.Mobile, fmt.Sprintf("%s: order %s received.\n%s\nTotal %s.\nPlease transfer %s with %s as the reference and upload the slip. Your order is confirmed once we receive your payment.",
		s.ShopName, o.OrderNo, list, lkr(o.Total), lkr(o.Total), o.OrderNo))
	shop := s.Whatsapp
	if shop == "" {
		shop = s.Phone
	}
	send(shop, fmt.Sprintf("New order %s from %s (%s).\n%s\nTotal %s", o.OrderNo, o.FullName, o.Mobile, list, lkr(o.Total)))
	a.orderEmail(o, fmt.Sprintf("Order %s received", o.OrderNo), "Thank you for your order!",
		"we've received your order. Keep your order number to track it, and complete the bank transfer below to confirm it.")
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
		a.orderEmail(o, fmt.Sprintf("Your order %s %s", o.OrderNo, text), fmt.Sprintf("Your order %s", text), fmt.Sprintf("your order %s %s.", o.OrderNo, text))
	}
}

func (a *App) notifyPaymentConfirmed(o Order) {
	send(o.Mobile, fmt.Sprintf("%s: we received your payment of %s. Your order %s is confirmed.", a.shopName(), lkr(o.Total), o.OrderNo))
	a.orderEmail(o, fmt.Sprintf("Payment received: order %s is confirmed", o.OrderNo), "Your order is confirmed",
		fmt.Sprintf("we received your payment of %s. We're getting your pieces ready and will let you know when they're on the way.", lkr(o.Total)))
}

func (a *App) notifySlipReceived(o Order) {
	s, err := getSettings(context.Background(), a.db)
	if err != nil {
		log.Println("notify:", err)
		return
	}
	shop := s.Whatsapp
	if shop == "" {
		shop = s.Phone
	}
	send(shop, fmt.Sprintf("Payment slip uploaded for %s (%s, %s). Check the payment and confirm the order.", o.OrderNo, o.FullName, lkr(o.Total)))
}

func (a *App) notifyRentalReturned(o Order) {
	send(o.Mobile, fmt.Sprintf("%s: thank you for returning your rental from order %s. Your deposit of %s has been refunded.", a.shopName(), o.OrderNo, lkr(o.Deposit)))
	a.orderEmail(o, fmt.Sprintf("Rental returned: deposit refunded for %s", o.OrderNo), "Your deposit has been refunded",
		fmt.Sprintf("thank you for returning your rental. We've refunded your deposit of %s.", lkr(o.Deposit)))
}
