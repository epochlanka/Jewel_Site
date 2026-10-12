import { html, setHtml, on, $ } from "../../html.js";
import { api } from "../../api.js";
import { lkr } from "../../format.js";
import { dayLabel, emptyState, errorState, pageLoading, statusPill } from "../../ui.js";
import { setQuery } from "../../router.js";

const tabs = [
  { v: "upcoming", label: "Upcoming", empty: "No upcoming rentals." },
  { v: "out", label: "With customers", empty: "Nothing is out on rent right now." },
  { v: "past", label: "Returned", empty: "No returned rentals yet." },
];

export default function rentals(view, ctx) {
  const when = tabs.some((t) => t.v === ctx.query.get("when")) ? ctx.query.get("when") : "upcoming";
  setHtml(view, html`<div class="admin-page">
    <div class="admin-head"><div><h1>Rentals</h1><p>Bridal and other rental bookings by pickup date. Cancelled orders are left out.</p></div></div>
    <div class="tabs" role="group" aria-label="Show">${tabs.map((t) => html`<button class="tab" aria-pressed="${String(t.v === when)}" data-when="${t.v}">${t.label}</button>`)}</div>
    <div data-list>${pageLoading()}</div>
  </div>`);
  const load = () => api.admin.rentals(when).then((list) => setHtml($("[data-list]", view), !list.length
    ? html`<div class="panel">${emptyState({ icon: "clock", title: tabs.find((t) => t.v === when).empty })}</div>`
    : html`<div class="panel panel-flush"><div class="table-scroll"><table class="table">
        <thead><tr><th>Piece</th><th>Pickup</th><th>Return</th><th>Customer</th><th>Order</th><th class="num">Rent</th><th class="num">Deposit</th><th>Status</th></tr></thead>
        <tbody>${list.map((r) => html`<tr>
          <td><strong>${r.name}</strong></td>
          <td>${dayLabel(r.from)}</td>
          <td>${dayLabel(r.to)}</td>
          <td>${r.fullName}<span class="muted" style="display: block; font-size: 13px">${r.mobile}</span></td>
          <td><a href="/admin/orders/${r.orderId}">${r.orderNo}</a></td>
          <td class="num">${lkr(r.rent)}</td>
          <td class="num">${lkr(r.deposit)}${r.returnedAt ? html`<span class="muted" style="display: block; font-size: 13px">Refunded</span>` : ""}</td>
          <td>${statusPill(r.status)}${r.paymentStatus !== "PAID" ? html`<span class="pill pill-unpaid" style="margin-left: 6px">Not paid</span>` : ""}</td>
        </tr>`)}</tbody>
      </table></div></div>`)).catch((e) => setHtml($("[data-list]", view), errorState(e.message)));
  on(view, "click", "[data-when]", (e, el) => setQuery({ when: el.dataset.when === "upcoming" ? null : el.dataset.when }));
  on(view, "click", "[data-act=retry]", load);
  load();
}
