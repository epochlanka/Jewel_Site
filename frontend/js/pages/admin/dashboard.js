import { html, setHtml, on } from "../../html.js";
import { icon } from "../../icons.js";
import { api } from "../../api.js";
import { dateTime, lkr } from "../../format.js";
import { barChart, errorState, pageLoading, statusPill } from "../../ui.js";

export default function dashboard(view) {
  const draw = (d) => {
    const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    const weekTotal = d.last7Days.reduce((s, x) => s + x.sales, 0);
    const bars = d.last7Days.map((x, i) => {
      const date = new Date(`${x.date}T00:00:00`);
      const last = i === d.last7Days.length - 1;
      return {
        key: x.date,
        label: last ? "Today" : date.toLocaleDateString("en-GB", { weekday: "short" }),
        fullLabel: date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" }),
        value: x.sales, orders: x.orders, highlight: last,
      };
    });

    setHtml(view, html`<div class="admin-page">
      <div class="admin-head">
        <div><h1>Dashboard</h1><p>${today}</p></div>
        <div class="admin-head-actions">
          <a href="/admin/orders" class="btn btn-quiet">View orders</a>
          <a href="/admin/products/new" class="btn btn-primary">${icon("plus", 18)}Add product</a>
        </div>
      </div>

      <section class="stats" aria-label="Today">
        <div class="stat stat-hero">
          <span class="stat-label">Today's sales</span>
          <span class="stat-value">${lkr(d.todaySales)}</span>
          <span class="stat-note">${d.todayOrders} ${d.todayOrders === 1 ? "order" : "orders"} today</span>
        </div>
        <a href="/admin/orders?status=PENDING" class="stat stat-link">
          <span class="stat-label">Waiting to confirm</span>
          <span class="stat-value">${d.pending}</span>
          <span class="stat-note">${d.pending ? "Review pending orders" : "All caught up"}</span>
        </a>
        <a href="/admin/orders?status=PROCESSING" class="stat">
          <span class="stat-label">In progress</span>
          <span class="stat-value">${d.processing}</span>
          <span class="stat-note">Confirmed to dispatched</span>
        </a>
        <div class="stat">
          <span class="stat-label">Delivered today</span>
          <span class="stat-value">${d.completed}</span>
          <span class="stat-note">Completed orders</span>
        </div>
      </section>

      <div class="dash-grid">
        <section class="panel">
          <div class="panel-head"><h2>Sales, last 7 days</h2><span class="panel-meta">${lkr(weekTotal)} total</span></div>
          ${barChart(bars, "Daily sales for the last 7 days")}
        </section>

        <section class="panel">
          <div class="panel-head"><h2>Low stock</h2><a href="/admin/products?show=low" class="panel-link">Manage stock</a></div>
          ${d.lowStock.length ? html`<ul class="stock-list">${d.lowStock.map((p) => html`<li>
            <a href="/admin/products/${p.id}" class="stock-name" style="color: var(--ink); text-decoration: none">${p.name}<span class="muted">${p.code}</span></a>
            <span class="stock-count ${p.stock === 0 ? "is-out" : ""}">${p.stock === 0 ? html`${icon("alert", 14)}Sold out` : `${p.stock} left`}</span>
          </li>`)}</ul>` : html`<p class="empty-note">Every product has more than 3 in stock.</p>`}
        </section>

        <section class="panel panel-wide panel-flush">
          <div class="panel-head" style="padding: 22px 22px 0"><h2>Recent orders</h2><a href="/admin/orders" class="panel-link">All orders</a></div>
          ${d.recentOrders.length ? html`<div class="table-scroll"><table class="table">
            <thead><tr><th>Order</th><th>Customer</th><th class="num">Total</th><th>Status</th><th>Placed</th></tr></thead>
            <tbody>${d.recentOrders.map((o) => html`<tr>
              <td><a href="/admin/orders/${o.id}">${o.orderNo}</a></td>
              <td>${o.fullName}</td>
              <td class="num">${lkr(o.total)}</td>
              <td>${statusPill(o.status)}</td>
              <td class="muted">${dateTime(o.createdAt)}</td>
            </tr>`)}</tbody>
          </table></div>` : html`<p class="empty-note">No orders yet. New orders from the shop appear here.</p>`}
        </section>
      </div>
    </div>`);
  };

  const load = () => {
    setHtml(view, pageLoading("Loading dashboard…"));
    api.admin.dashboard().then(draw).catch((e) => setHtml(view, errorState(e.message)));
  };
  on(view, "click", "[data-act=retry]", load);
  load();
}
