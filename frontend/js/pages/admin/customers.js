import { html, setHtml, on, $ } from "../../html.js";
import { icon } from "../../icons.js";
import { api } from "../../api.js";
import { lkr, phoneLink, shortDate, whatsappLink } from "../../format.js";
import { emptyState, errorState, openModal, pageLoading, pagination, statusPill } from "../../ui.js";
import { setQuery } from "../../router.js";

export default function customers(view, ctx) {
  const sp = ctx.query;
  const q = sp.get("q");

  setHtml(view, html`<div class="admin-page">
    <div class="admin-head"><div><h1>Customers</h1><p>People who created an account. Guest orders appear under Orders.</p></div></div>
    <div class="toolbar">
      <form class="search" role="search" data-search>
        ${icon("search", 18)}
        <label for="c-search" class="sr-only">Search customers</label>
        <input id="c-search" name="q" type="search" placeholder="Name, email or mobile" value="${q ?? ""}">
      </form>
    </div>
    <div data-list>${pageLoading()}</div>
  </div>`);

  const draw = (data) => setHtml($("[data-list]", view), !data.items.length
    ? html`<div class="panel">${emptyState({ icon: "customers", title: q ? "No customers match" : "No customers yet", text: q ? "Try another name, email or number." : "Customers appear here when they create an account." })}</div>`
    : html`<div class="panel panel-flush"><div class="table-scroll"><table class="table">
        <thead><tr><th>Customer</th><th>Mobile</th><th class="num">Orders</th><th class="num">Spent</th><th>Joined</th></tr></thead>
        <tbody>${data.items.map((c) => html`<tr>
          <td><button class="btn-link" style="min-height: 0; text-align: left" data-customer="${c.id}">${c.name}</button><span class="muted" style="display: block; font-size: 13px">${c.email}</span></td>
          <td>${c.phone || html`<span class="muted">Not given</span>`}</td>
          <td class="num">${c._count.orders}</td>
          <td class="num">${lkr(c.totalSpent)}</td>
          <td class="muted">${shortDate(c.createdAt)}</td>
        </tr>`)}</tbody>
      </table></div></div>
      ${pagination(data.page, data.pages)}`);

  const load = () => api.admin.customers({ q, page: sp.get("page") ?? 1 }).then(draw).catch((e) => setHtml($("[data-list]", view), errorState(e.message)));

  on(view, "submit", "[data-search]", (e, form) => { e.preventDefault(); setQuery({ q: String(new FormData(form).get("q") || "") || null }); });
  on(view, "click", "[data-page]", (e, el) => setQuery({ page: el.dataset.page }, { resetPage: false }));
  on(view, "click", "[data-act=retry]", load);
  on(view, "click", "[data-customer]", async (e, el) => {
    const c = await api.admin.customer(el.dataset.customer).catch(() => null);
    if (!c) return;
    const d = openModal({
      title: c.name, wide: true,
      body: html`<div class="stack">
        <dl class="kv">
          <dt>Email</dt><dd><a href="mailto:${c.email}">${c.email}</a></dd>
          <dt>Mobile</dt><dd>${c.phone || "Not given"}</dd>
          <dt>Joined</dt><dd>${shortDate(c.createdAt)}</dd>
        </dl>
        ${c.phone && html`<div class="contact-actions" style="margin-top: 0">
          <a href="${phoneLink(c.phone)}" class="btn btn-quiet btn-sm">${icon("phone", 16)}Call</a>
          <a href="${whatsappLink(c.phone)}" target="_blank" rel="noreferrer" class="btn btn-quiet btn-sm">${icon("chat", 16)}WhatsApp</a>
        </div>`}
        <h3 style="font-size: 16px">Orders (${c.orders.length})</h3>
        ${c.orders.length ? html`<div class="table-scroll"><table class="table">
          <thead><tr><th>Order</th><th class="num">Total</th><th>Status</th><th>Placed</th></tr></thead>
          <tbody>${c.orders.map((o) => html`<tr><td><a href="/admin/orders/${o.id}">${o.orderNo}</a></td><td class="num">${lkr(o.total)}</td><td>${statusPill(o.status)}</td><td class="muted">${shortDate(o.createdAt)}</td></tr>`)}</tbody>
        </table></div>` : html`<p class="muted">No orders yet.</p>`}
      </div>`,
    });
    // Following a link to an order closes the dialog.
    d.addEventListener("click", (ev) => { if (ev.target.closest("a[href^='/admin']")) d.closeModal(); });
  });
  load();
}
