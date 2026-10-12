import { html, setHtml } from "../html.js";
import { icon } from "../icons.js";
import { api } from "../api.js";
import { lkr, whatsappLink } from "../format.js";
import { state, toast } from "../store.js";
import { awaitingPayment, isConfirmed, orderLines, orderNotice } from "../ui.js";

const POLL_MS = 15000;

export default function orderConfirmation(view, ctx) {
  const orderNo = ctx.params.orderNo;
  const placed = ctx.state?.order;
  let order = placed;
  let wasConfirmed = placed ? isConfirmed(placed) : false;

  const draw = () => {
    const s = state.settings;
    const contact = s.whatsapp || s.phone;
    const msg = `Hi, about my order ${orderNo}${order ? ` (${lkr(order.total)})` : ""}.`;
    const confirmed = order ? isConfirmed(order) : false;
    const cancelled = order?.status === "CANCELLED";
    const waiting = order ? awaitingPayment(order) : false;

    const title = cancelled ? "Your order was cancelled" : confirmed ? "Your order is confirmed" : waiting ? "Order received, waiting for payment" : "Thank you for your order";
    const sub = cancelled
      ? "Contact us if you have any questions about this order."
      : confirmed
        ? `${order?.paymentStatus === "PAID" ? "We received your payment. " : ""}We're getting your pieces ready.`
        : waiting
          ? "Your order is confirmed as soon as we receive your payment."
          : `We'll contact you${order ? ` on ${order.mobile}` : ""} to confirm it. Keep your order number to track it.`;

    setHtml(view, html`<div class="page"><div class="confirm">
      <section class="confirm-hero" aria-live="polite">
        <span class="confirm-icon ${confirmed ? "" : cancelled ? "is-cancelled" : "is-waiting"}">${icon(confirmed ? "check" : cancelled ? "close" : "clock", 36)}</span>
        <h1>${title}</h1>
        <p class="order-no">Your order number<strong>${orderNo}</strong></p>
        <p class="muted">${sub}</p>
        <div class="card-actions" style="margin-top: 8px">
          <a href="/track?orderNo=${encodeURIComponent(orderNo)}${order ? `&mobile=${encodeURIComponent(order.mobile)}` : ""}" class="btn btn-primary">Track order</a>
          ${contact && html`<a href="${whatsappLink(contact, msg)}" target="_blank" rel="noreferrer" class="btn btn-secondary">${icon("chat", 18)}${waiting ? "Send payment slip" : "WhatsApp us"}</a>`}
        </div>
      </section>

      ${order && !cancelled && !confirmed && orderNotice(order)}
      ${order && html`<section class="card" aria-labelledby="sum-title"><h2 id="sum-title">Order summary</h2>${orderLines(order)}</section>`}

      <div class="card-actions">
        ${state.user?.role === "CUSTOMER" && html`<a href="/account" class="btn btn-quiet">View my orders</a>`}
        <a href="/shop" class="btn btn-quiet">Continue shopping</a>
      </div>
    </div></div>`);
  };

  draw();

  // Keep checking while the order waits for payment or a call, so the page updates once it is confirmed.
  if (!placed?.mobile) return;
  const check = async () => {
    if (document.hidden) return;
    try {
      const fresh = await api.trackOrder(orderNo, placed.mobile);
      if (!ctx.alive()) return;
      order = fresh;
      draw();
      if (!wasConfirmed && isConfirmed(fresh)) {
        wasConfirmed = true;
        toast("Your order is confirmed");
      }
    } catch { /* try again on the next tick */ }
  };
  check();
  const timer = setInterval(check, POLL_MS);
  ctx.onCleanup(() => clearInterval(timer));
}
