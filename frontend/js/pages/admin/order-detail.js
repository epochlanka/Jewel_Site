import { html, attr, setHtml, on } from "../../html.js";
import { icon } from "../../icons.js";
import { api } from "../../api.js";
import { dateTime, deliveryLabel, lkr, paymentLabel, paymentStatusLabel, phoneLink, statusLabel, whatsappLink } from "../../format.js";
import { state, toast, toastError } from "../../store.js";
import { confirmDialog, errorState, lineDetail, pageLoading, productImage, statusPill } from "../../ui.js";

const actionLabel = {
  PENDING: "Pending", CONFIRMED: "Confirm order", PROCESSING: "Start processing", READY: "Mark ready",
  DISPATCHED: "Mark dispatched", DELIVERED: "Mark delivered", CANCELLED: "Cancel order",
};

export default function orderDetail(view, ctx) {
  const id = ctx.params.id;
  let o = null, busy = false;

  const draw = () => {
    const s = state.settings;
    const waitingPay = o.status === "PENDING" && o.paymentMethod !== "COD" && o.paymentStatus !== "PAID";
    const actions = (o.nextStatuses ?? []).filter((st) => st !== "CANCELLED");
    const labelFor = (st) => (st === "DELIVERED" && o.deliveryMethod === "PICKUP" ? "Mark collected" : actionLabel[st]);
    const canCancel = o.nextStatuses?.includes("CANCELLED");
    const history = o.history ?? [];
    const shipTo = [o.address, o.city, o.postalCode].filter(Boolean);

    setHtml(view, html`<div class="admin-page">
      <div class="admin-head">
        <div>
          <a href="/admin/orders" class="back-link no-print">${icon("arrowLeft", 16)}Orders</a>
          <h1 style="display: flex; gap: 14px; align-items: center; flex-wrap: wrap">${o.orderNo} ${statusPill(o.status)}</h1>
          <p>Placed ${dateTime(o.createdAt)}</p>
        </div>
        <div class="admin-head-actions no-print"><button class="btn btn-quiet" data-act="print">${icon("print", 18)}Print packing slip</button></div>
      </div>

      <section class="packing-slip print-only">
        <header class="packing-slip-head">
          <div><h1>${s.shopName}</h1>${s.phone && html`<p>${s.phone}</p>`}${s.address && html`<p>${s.address}</p>`}</div>
          <div class="packing-slip-order"><strong>Packing slip</strong><span>${o.orderNo}</span><span>${dateTime(o.createdAt)}</span></div>
        </header>
        <section class="packing-slip-customer">
          <strong>${o.deliveryMethod === "PICKUP" ? "Customer" : "Ship to"}</strong>
          <span>${o.fullName}</span><span>${o.mobile}</span>
          ${o.deliveryMethod === "DELIVERY" && html`<span>${shipTo.join(", ")}</span>`}
        </section>
        <table class="packing-slip-items"><thead><tr><th>Product</th><th>Qty</th></tr></thead>
          <tbody>${o.items.map((i) => html`<tr><td>${i.name}${i.size ? ` (size ${i.size})` : ""}${i.kind === "RENT" ? ` (rent ${i.rentFrom} to ${i.rentTo})` : ""}</td><td>${i.qty}</td></tr>`)}</tbody></table>
        ${o.note && html`<p class="packing-slip-note"><strong>Note:</strong> ${o.note}</p>`}
      </section>

      <div class="detail-grid no-print">
        <div class="stack">
          <section class="panel">
            <div class="panel-head"><h2>Items</h2><span class="panel-meta">${o.items.reduce((n, i) => n + i.qty, 0)} pieces</span></div>
            <div class="order-lines">${o.items.map((i) => html`<div class="order-line">
              <span class="order-line-img">${productImage(i.product?.images[0]?.url, "")}</span>
              <span><strong>${i.name}</strong> <span class="muted">× ${i.qty}</span>${lineDetail(i)}
                <span class="muted" style="display: block; font-size: 13px">${i.product?.code ? `Code ${i.product.code} · ` : ""}${i.kind === "RENT" ? `${lkr(i.price)} rent${i.deposit ? ` + ${lkr(i.deposit)} deposit` : ""}` : `${lkr(i.price)} each`}</span></span>
              <span class="num">${lkr(i.price * i.qty)}</span>
            </div>`)}</div>
            <div class="order-totals">
              <div class="summary-row"><span>Subtotal</span><span>${lkr(o.subtotal)}</span></div>
              <div class="summary-row"><span>${deliveryLabel[o.deliveryMethod]}</span><span>${o.deliveryFee ? lkr(o.deliveryFee) : "Free"}</span></div>
              ${o.deposit > 0 && html`<div class="summary-row"><span>Refundable deposit</span><span>${lkr(o.deposit)}</span></div>`}
              <div class="summary-row summary-total"><span>Total</span><span>${lkr(o.total)}</span></div>
            </div>
          </section>

          ${o.note && html`<section class="panel"><h2 style="font-size: 22px; margin-bottom: 10px">Customer note</h2><p style="white-space: pre-line">${o.note}</p></section>`}

          <section class="panel no-print">
            <h2 style="font-size: 22px; margin-bottom: 16px">History</h2>
            <ol class="timeline">${history.map((h, i) => html`<li class="tl-step ${i === history.length - 1 ? "is-current" : "is-done"}">
              <span class="tl-dot">${i < history.length - 1 && icon("check", 16)}</span>
              <span class="tl-text"><strong>${statusLabel[h.status]}</strong><span>${dateTime(h.createdAt)}</span></span>
            </li>`)}</ol>
          </section>
        </div>

        <div class="detail-side">
          ${(actions.length > 0 || canCancel || waitingPay) && html`<section class="panel no-print">
            <h2 style="font-size: 22px; margin-bottom: 14px">Next step</h2>
            ${waitingPay && html`<p class="muted" style="margin-bottom: 12px">${o.paymentSlipUrl ? "The customer uploaded a payment slip. Check that the money is in your account, then confirm." : "Waiting for the bank transfer. When the money is in your account, confirm the order."} The customer sees the order as confirmed.</p>`}
            <div class="status-actions">
              ${waitingPay && html`<button class="btn btn-primary btn-block" data-pay="PAID"${attr("disabled", busy)}>${icon("check", 18)}Payment received, confirm order</button>`}
              ${actions.map((st, i) => html`<button class="btn ${i === 0 && !waitingPay ? "btn-primary" : "btn-secondary"} btn-block" data-move="${st}"${attr("disabled", busy)}>${labelFor(st)}</button>`)}
              ${canCancel && html`<button class="btn-link" style="color: var(--error)" data-act="cancel">Cancel order</button>`}
            </div>
          </section>`}

          <section class="panel">
            <h2 style="font-size: 22px; margin-bottom: 14px">Customer</h2>
            <dl class="kv">
              <dt>Name</dt><dd>${o.fullName}</dd>
              <dt>Mobile</dt><dd>${o.mobile}</dd>
              ${o.whatsapp && html`<dt>WhatsApp</dt><dd>${o.whatsapp}</dd>`}
              ${o.email && html`<dt>Email</dt><dd>${o.email}</dd>`}
              <dt>Account</dt><dd>${o.user ? html`<a href="/admin/customers?q=${encodeURIComponent(o.user.email)}">${o.user.email}</a>` : "Guest"}</dd>
            </dl>
            <div class="contact-actions no-print">
              <a href="${phoneLink(o.mobile)}" class="btn btn-quiet btn-sm">${icon("phone", 16)}Call</a>
              <a href="${whatsappLink(o.whatsapp || o.mobile, `Hi ${o.fullName.split(" ")[0]}, this is ${s.shopName.replace(/^\[|\]$/g, "")} about your order ${o.orderNo}.`)}" target="_blank" rel="noreferrer" class="btn btn-quiet btn-sm">${icon("chat", 16)}WhatsApp</a>
            </div>
          </section>

          <section class="panel">
            <h2 style="font-size: 22px; margin-bottom: 14px">Delivery</h2>
            <dl class="kv">
              <dt>Method</dt><dd>${deliveryLabel[o.deliveryMethod]}</dd>
              ${o.deliveryMethod === "DELIVERY" && html`<dt>Address</dt><dd style="white-space: pre-line">${shipTo.join("\n")}</dd>`}
            </dl>
          </section>

          ${o.items.some((i) => i.kind === "RENT") && html`<section class="panel no-print">
            <h2 style="font-size: 22px; margin-bottom: 14px">Rental</h2>
            <dl class="kv">${o.items.filter((i) => i.kind === "RENT").map((i) => html`<dt>${i.name}</dt><dd>${i.rentFrom} to ${i.rentTo}</dd>`)}
              <dt>Deposit</dt><dd>${lkr(o.deposit)}${o.depositRefundedAt ? ` · refunded ${dateTime(o.depositRefundedAt)}` : " · held"}</dd></dl>
            ${!o.depositRefundedAt && o.status === "DELIVERED" && html`<div class="contact-actions"><button class="btn btn-primary btn-sm" data-act="returned"${attr("disabled", busy)}>${icon("check", 16)}Returned, deposit refunded</button></div>`}
            ${!o.depositRefundedAt && o.status !== "DELIVERED" && o.status !== "CANCELLED" && html`<p class="muted" style="font-size: 14px; margin-top: 10px">When the customer has the pieces, mark the order delivered (or collected). Then mark it returned when they bring it back.</p>`}
          </section>`}

          <section class="panel">
            <h2 style="font-size: 22px; margin-bottom: 14px">Payment</h2>
            <dl class="kv">
              <dt>Method</dt><dd>${paymentLabel[o.paymentMethod]}</dd>
              <dt>Status</dt><dd><span class="pill pill-${o.paymentStatus.toLowerCase()}">${paymentStatusLabel[o.paymentStatus]}</span></dd>
            </dl>
            ${o.paymentSlipUrl ? html`<div class="slip-box">
              <span class="field-label">Payment slip</span>
              <a href="${o.paymentSlipUrl}" target="_blank" rel="noreferrer" class="pay-slip-thumb">${/\.pdf$/i.test(o.paymentSlipUrl) ? html`${icon("orders", 22)}Open slip (PDF)` : html`<img src="${o.paymentSlipUrl}" alt="Payment slip for ${o.orderNo}">`}</a>
              <span class="muted" style="font-size: 13px">Uploaded ${dateTime(o.paymentSlipAt)}${o.paymentRef ? ` · Ref ${o.paymentRef}` : ""}</span>
            </div>` : o.paymentMethod === "BANK_TRANSFER" && o.paymentStatus !== "PAID" && html`<p class="muted" style="font-size: 14px; margin-top: 12px">No payment slip uploaded yet.</p>`}
            <div class="contact-actions no-print">
              ${o.paymentStatus !== "PAID" && !waitingPay && html`<button class="btn btn-secondary btn-sm" data-pay="PAID"${attr("disabled", busy)}>${icon("check", 16)}Mark as paid</button>`}
              ${o.paymentStatus === "PAID" && html`<button class="btn btn-quiet btn-sm" data-pay="UNPAID">Mark as not paid</button>`}
              ${o.paymentStatus === "PAID" && o.status === "CANCELLED" && html`<button class="btn btn-quiet btn-sm" data-pay="REFUNDED">Mark refunded</button>`}
            </div>
          </section>
        </div>
      </div>
    </div>`);
  };

  const load = async () => {
    try { o = await api.admin.order(id); if (ctx.alive()) draw(); }
    catch (e) { if (!o) setHtml(view, errorState(e.message)); else toastError(e); }
  };

  const move = async (to) => {
    busy = true; draw();
    try { await api.admin.setStatus(o.id, to); toast(`Order ${statusLabel[to].toLowerCase()}`); }
    catch (e) { toastError(e); throw e; }
    finally { busy = false; await load(); }
  };

  on(view, "click", "[data-move]", (e, el) => move(el.dataset.move).catch(() => undefined));
  on(view, "click", "[data-pay]", async (e, el) => {
    const ps = el.dataset.pay;
    busy = true; draw();
    try {
      const r = await api.admin.setPayment(o.id, ps);
      toast(r.confirmed ? "Payment received. Order confirmed and the customer was told." : `Payment marked ${paymentStatusLabel[ps].toLowerCase()}`);
    } catch (err) { toastError(err); }
    busy = false;
    await load();
  });
  on(view, "click", "[data-act=print]", () => window.print());
  on(view, "click", "[data-act=returned]", () => confirmDialog({
    title: "Mark the rental returned?", confirmLabel: "Returned, deposit refunded",
    body: `Confirm the pieces came back in good condition and you refunded the deposit of ${lkr(o.deposit)}. The customer is told.`,
    onConfirm: async () => {
      try { await api.admin.rentalReturned(o.id); toast("Rental marked returned"); await load(); }
      catch (err) { toastError(err); throw err; }
    },
  }));
  on(view, "click", "[data-act=cancel]", () => confirmDialog({
    title: "Cancel this order?", danger: true, confirmLabel: "Cancel order",
    body: `The items go back into stock and the customer is told the order is cancelled.${o.paymentStatus === "PAID" ? " This order is marked as paid, so arrange a refund." : ""}`,
    onConfirm: () => move("CANCELLED"),
  }));
  on(view, "click", "[data-act=retry]", load);

  setHtml(view, pageLoading());
  load();
}
