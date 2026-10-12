import { html, setHtml, on, $ } from "../../html.js";
import { api } from "../../api.js";
import { lkr, shortDate, statusLabel } from "../../format.js";
import { barChart, errorState, pageLoading } from "../../ui.js";

const ranges = [{ v: "daily", label: "Daily" }, { v: "weekly", label: "Weekly" }, { v: "monthly", label: "Monthly" }];

function periodLabels(iso, range) {
  const d = new Date(iso);
  if (range === "monthly") return { label: d.toLocaleDateString("en-GB", { month: "short" }), full: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) };
  if (range === "weekly") return { label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), full: `Week of ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}` };
  return { label: d.toLocaleDateString("en-GB", { day: "numeric" }), full: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) };
}

export default function reports(view) {
  let range = "daily";

  setHtml(view, html`<div class="admin-page">
    <div class="admin-head"><div><h1>Reports</h1><p>Cancelled orders are left out of sales.</p></div></div>
    <section class="panel">
      <div class="panel-head"><h2>Sales</h2><div class="tabs" role="group" aria-label="Period" data-ranges></div></div>
      <div data-sales>${pageLoading()}</div>
    </section>
    <div class="report-grid">
      <section class="panel"><div class="panel-head"><h2>Orders by status</h2><a href="/admin/orders" class="panel-link">All orders</a></div><div data-status>${pageLoading()}</div></section>
      <section class="panel"><div class="panel-head"><h2>Best sellers</h2><span class="panel-meta">Pieces sold</span></div><div data-top>${pageLoading()}</div></section>
      <section class="panel"><div class="panel-head"><h2>Sold out</h2><a href="/admin/products?show=low" class="panel-link">Update stock</a></div><div data-out>${pageLoading()}</div></section>
      <section class="panel panel-wide" style="grid-column: 1 / -1"><div class="panel-head"><h2>Newest products</h2><a href="/admin/products" class="panel-link">All products</a></div><div data-newest>${pageLoading()}</div></section>
    </div>
  </div>`);

  const fail = (e) => setHtml(view, errorState(e.message, false));

  const loadSales = () => {
    setHtml($("[data-ranges]", view), ranges.map((r) => html`<button class="tab" aria-pressed="${String(range === r.v)}" data-range="${r.v}">${r.label}</button>`));
    setHtml($("[data-sales]", view), pageLoading());
    const at = range;
    api.admin.salesReport(range).then((sales) => {
      if (at !== range) return;
      if (!sales.length) return setHtml($("[data-sales]", view), html`<p class="empty-note">No sales yet.</p>`);
      const total = sales.reduce((s, r) => s + r.sales, 0), orders = sales.reduce((s, r) => s + r.orders, 0);
      const bars = sales.map((r, i) => { const l = periodLabels(r.period, range); return { key: r.period, label: l.label, fullLabel: l.full, value: r.sales, orders: r.orders, highlight: i === sales.length - 1 }; });
      setHtml($("[data-sales]", view), html`
        <p class="panel-meta" style="margin-bottom: 16px">${lkr(total)} from ${orders} orders · average ${lkr(orders ? total / orders : 0)} per order</p>
        ${barChart(bars, `${ranges.find((r) => r.v === range).label} sales`, 260)}`);
    }).catch(fail);
  };

  on(view, "click", "[data-range]", (e, el) => { range = el.dataset.range; loadSales(); });
  loadSales();

  api.admin.ordersReport().then((byStatus) => {
    const max = Math.max(1, ...byStatus.map((s) => s.count));
    setHtml($("[data-status]", view), html`<div class="hbars">${byStatus.map((s) => html`
      <a href="/admin/orders?status=${s.status}" class="hbar" style="color: var(--ink); text-decoration: none">
        <span>${statusLabel[s.status]}</span>
        <span class="hbar-track" aria-hidden="true"><span class="hbar-fill" style="display: block; width: ${(s.count / max) * 100}%"></span></span>
        <span class="hbar-value">${s.count}</span>
      </a>`)}</div>`);
  }).catch(fail);

  api.admin.productsReport().then((prod) => {
    setHtml($("[data-top]", view), prod.top.length
      ? html`<ol class="rank-list">${prod.top.map((t) => html`<li><a href="/admin/products/${t.productId}">${t.name}</a><strong>${t.qty}</strong></li>`)}</ol>`
      : html`<p class="empty-note">No sales yet.</p>`);
    setHtml($("[data-out]", view), prod.outOfStock.length
      ? html`<ul class="stock-list">${prod.outOfStock.map((p) => html`<li><a href="/admin/products/${p.id}" class="stock-name">${p.name}<span class="muted">${p.code}</span></a><span class="stock-count is-out">Sold out</span></li>`)}</ul>`
      : html`<p class="empty-note">Nothing is sold out.</p>`);
    setHtml($("[data-newest]", view), prod.newest.length
      ? html`<ul class="stock-list">${prod.newest.map((p) => html`<li><a href="/admin/products/${p.id}" class="stock-name">${p.name}<span class="muted">${p.code}</span></a><span class="muted" style="font-size: 14px">Added ${shortDate(p.createdAt)}</span></li>`)}</ul>`
      : html`<p class="empty-note">No products yet.</p>`);
  }).catch(fail);
}
