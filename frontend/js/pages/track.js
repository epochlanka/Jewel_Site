import { html, setHtml, on, $ } from "../html.js";
import { icon } from "../icons.js";
import { api } from "../api.js";
import { customerStatus, shortDate, whatsappLink } from "../format.js";
import { state } from "../store.js";
import { orderLines, orderNotice, orderTimeline } from "../ui.js";

export default function track(view, ctx) {
  let order = null, err = "", busy = false;

  setHtml(view, html`<div class="page">
    <div class="page-head"><h1>Track your order</h1><p>Enter your order number and the mobile number you used at checkout.</p></div>
    <div class="track-grid">
      <form class="card form" data-track>
        <label class="field"><span class="field-label">Order number</span><input name="orderNo" required placeholder="ORD-000125" value="${ctx.query.get("orderNo") ?? ""}" autocapitalize="characters"></label>
        <label class="field"><span class="field-label">Mobile number</span><input name="mobile" type="tel" required placeholder="07XXXXXXXX" inputmode="tel" value="${ctx.query.get("mobile") ?? ""}"></label>
        <p class="form-error" role="alert" data-error hidden></p>
        <button class="btn btn-primary btn-block" data-submit>Track order</button>
      </form>
      <div data-result></div>
    </div>
  </div>`);

  const drawResult = () => {
    const errBox = $("[data-error]", view);
    errBox.textContent = err;
    errBox.hidden = !err;
    const btn = $("[data-submit]", view);
    btn.disabled = busy;
    btn.textContent = busy ? "Checking…" : "Track order";
    const contact = state.settings.whatsapp || state.settings.phone;
    setHtml($("[data-result]", view), order ? html`<div class="stack">
        <section class="card" aria-labelledby="status-title">
          <div class="order-card-head" style="margin-bottom: 20px">
            <div><h2 id="status-title" style="margin-bottom: 4px">${customerStatus[order.status]}</h2><span class="muted">${order.orderNo} · placed ${shortDate(order.createdAt)}</span></div>
            ${contact && html`<a href="${whatsappLink(contact, `Hi, about my order ${order.orderNo}.`)}" target="_blank" rel="noreferrer" class="btn btn-quiet btn-sm">${icon("chat", 16)}Ask on WhatsApp</a>`}
          </div>
          ${orderNotice(order)}
          ${orderTimeline(order)}
        </section>
        <section class="card" aria-labelledby="items-title"><h2 id="items-title">Items</h2>${orderLines(order)}</section>
      </div>`
      : html`<div class="card" style="display: flex; gap: 16px; align-items: center">
        <span class="empty-icon" style="flex-shrink: 0">${icon("truck", 26)}</span>
        <p class="muted">Your order number is on the confirmation page and in the message we sent you. It looks like ORD-000125.</p>
      </div>`);
  };

  const lookup = async (orderNo, mobile) => {
    busy = true; err = ""; drawResult();
    try { order = await api.trackOrder(orderNo, mobile); }
    catch (e) { err = e.message; order = null; }
    busy = false;
    if (ctx.alive()) drawResult();
  };

  on(view, "submit", "[data-track]", (e, form) => {
    e.preventDefault();
    const f = new FormData(form);
    const orderNo = String(f.get("orderNo")).trim(), mobile = String(f.get("mobile")).trim();
    history.replaceState(history.state, "", `/track?${new URLSearchParams({ orderNo, mobile })}`);
    lookup(orderNo, mobile);
  });

  drawResult();
  const o = ctx.query.get("orderNo"), m = ctx.query.get("mobile");
  if (o && m) lookup(o, m);
}

