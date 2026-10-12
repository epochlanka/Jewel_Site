import { html, setHtml, on, $ } from "../../html.js";
import { icon } from "../../icons.js";
import { api } from "../../api.js";
import { dateTime, deliveryLabel, lkr, paymentLabel, statusLabel } from "../../format.js";
import { emptyState, errorState, pageLoading, pagination, statusPill } from "../../ui.js";
import { setQuery } from "../../router.js";

const tabs = ["", "PENDING", "CONFIRMED", "PROCESSING", "READY", "DISPATCHED", "DELIVERED", "CANCELLED"];

export default function adminOrders(view, ctx) {
  const sp = ctx.query;
  const status = sp.get("status") ?? "";
  const q = sp.get("q");

  setHtml(view, html`<div class="admin-page">
    <div class="admin-head"><div><h1>Orders</h1><p data-count>&nbsp;</p></div></div>
    <div class="tabs" role="group" aria-label="Filter by status" data-tabs></div>
    <div class="toolbar">
      <form class="search" role="search" data-search>
        ${icon("search", 18)}
        <label for="o-search" class="sr-only">Search orders</label>
        <input id="o-search" name="q" type="search" placeholder="Order number, name or mobile" value="${q ?? ""}">
      </form>
      ${q && html`<button class="btn-link" data-clear-search style="font-size: 14px">Clear search</button>`}
    </div>
    <div data-list>${pageLoading()}</div>
  </div>`);

  const drawTabs = (data) => {
    const all = data ? Object.values(data.byStatus).reduce((s, n) => s + (n ?? 0), 0) : 0;
    setHtml($("[data-tabs]", view), tabs.map((t) => html`<button class="tab" aria-pressed="${String(status === t)}" data-status="${t}">
      ${t ? statusLabel[t] : "All"}${data && html`<span class="tab-count">${t ? data.byStatus[t] ?? 0 : all}</span>`}</button>`));
  };

  const draw = (data) => {
    $("[data-count]", view).textContent = `${data.total} ${status ? statusLabel[status].toLowerCase() : ""} ${data.total === 1 ? "order" : "orders"}`;
    drawTabs(data);
    setHtml($("[data-list]", view), !data.items.length
      ? html`<div class="panel">${emptyState({ icon: "orders", title: q ? "No orders match" : status ? `No ${statusLabel[status].toLowerCase()} orders` : "No orders yet", text: q ? "Check the order number or mobile number." : "Orders from the shop appear here." })}</div>`
      : html`<div class="panel panel-flush"><div class="table-scroll"><table class="table">
          <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th class="num">Total</th><th>Payment</th><th>Delivery</th><th>Status</th><th>Placed</th></tr></thead>
          <tbody>${data.items.map((o) => html`<tr>
            <td><a href="/admin/orders/${o.id}">${o.orderNo}</a></td>
            <td>${o.fullName}<span class="muted" style="display: block; font-size: 13px">${o.mobile}</span></td>
            <td>${o._count?.items ?? o.items?.length}</td>
            <td class="num">${lkr(o.total)}</td>
            <td>${paymentLabel[o.paymentMethod]}<span style="display: block; margin-top: 4px"><span class="pill pill-${o.paymentStatus.toLowerCase()}">${o.paymentStatus === "PAID" ? "Paid" : o.paymentStatus === "REFUNDED" ? "Refunded" : "Not paid"}</span></span></td>
            <td>${deliveryLabel[o.deliveryMethod]}${o.city && html`<span class="muted" style="display: block; font-size: 13px">${o.city}</span>`}</td>
            <td>${statusPill(o.status)}</td>
            <td class="muted">${dateTime(o.createdAt)}</td>
          </tr>`)}</tbody>
        </table></div></div>
        ${pagination(data.page, data.pages)}`);
  };

  const load = () => {
    setHtml($("[data-list]", view), pageLoading());
    api.admin.orders({ status: status || undefined, q, page: sp.get("page") ?? 1 })
      .then(draw).catch((e) => setHtml($("[data-list]", view), errorState(e.message)));
  };

  on(view, "click", "[data-status]", (e, el) => setQuery({ status: el.dataset.status || null }));
  on(view, "submit", "[data-search]", (e, form) => { e.preventDefault(); setQuery({ q: String(new FormData(form).get("q") || "") || null }); });
  on(view, "click", "[data-clear-search]", () => setQuery({ q: null }));
  on(view, "click", "[data-page]", (e, el) => setQuery({ page: el.dataset.page }, { resetPage: false }));
  on(view, "click", "[data-act=retry]", load);
  drawTabs(null);
  load();
}
