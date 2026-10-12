import { html, attr, setHtml, on, $ } from "../../html.js";
import { icon } from "../../icons.js";
import { api } from "../../api.js";
import { lkr } from "../../format.js";
import { toast, toastError } from "../../store.js";
import { confirmDialog, emptyState, errorState, pageLoading, pagination, productImage } from "../../ui.js";
import { setQuery } from "../../router.js";

const shows = [
  { v: "all", label: "All" },
  { v: "active", label: "In the shop" },
  { v: "low", label: "Low stock" },
  { v: "hidden", label: "Hidden" },
];

export default function adminProducts(view, ctx) {
  const sp = ctx.query;
  let data = null;

  setHtml(view, html`<div class="admin-page">
    <div class="admin-head">
      <div><h1>Products</h1><p data-count>&nbsp;</p></div>
      <a href="/admin/products/new" class="btn btn-primary">${icon("plus", 18)}Add product</a>
    </div>
    <div class="toolbar">
      <form class="search" role="search" data-search>
        ${icon("search", 18)}
        <label for="p-search" class="sr-only">Search products</label>
        <input id="p-search" name="q" type="search" placeholder="Name or code" value="${sp.get("q") ?? ""}">
      </form>
      <label><span class="sr-only">Category</span><select data-category><option value="">All categories</option></select></label>
      <div class="tabs" role="group" aria-label="Show">
        ${shows.map((s) => html`<button class="tab" aria-pressed="${String((sp.get("show") ?? "all") === s.v)}" data-show="${s.v}">${s.label}</button>`)}
      </div>
    </div>
    <div data-list>${pageLoading()}</div>
  </div>`);

  const draw = () => {
    $("[data-count]", view).textContent = `${data.total} ${data.total === 1 ? "product" : "products"}`;
    setHtml($("[data-list]", view), !data.items.length
      ? html`<div class="panel">${emptyState({
          icon: "products", title: sp.toString() ? "No products match" : "No products yet",
          text: sp.toString() ? "Try another search or filter." : "Products you add appear in the shop straight away.",
          action: html`<a href="/admin/products/new" class="btn btn-primary">Add your first product</a>`,
        })}</div>`
      : html`<div class="panel panel-flush"><div class="table-scroll"><table class="table">
          <thead><tr><th>Product</th><th>Category</th><th class="num">Price</th><th class="num">Stock</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>${data.items.map((p) => html`<tr class="${p.isActive ? "" : "is-hidden-row"}">
            <td><div class="cell-product">
              <span class="table-thumb">${productImage(p.images[0]?.url, "", { type: p.jewelleryType, iconSize: 24 })}</span>
              <span><a href="/admin/products/${p.id}">${p.name}</a><span class="muted" style="display: block">${p.code}</span></span>
            </div></td>
            <td>${p.category?.name}</td>
            <td class="num">${lkr(p.price)}</td>
            <td class="num"><span class="${p.stock === 0 ? "stock-num-out" : p.stock <= 3 ? "stock-num-low" : ""}">${p.stock}</span></td>
            <td>${p.isActive ? html`<span class="pill pill-on">In shop</span>` : html`<span class="pill pill-off">Hidden</span>`}</td>
            <td><div class="row-actions">
              <a href="/admin/products/${p.id}" class="icon-btn" aria-label="Edit ${p.name}">${icon("edit", 18)}</a>
              ${p.isActive && html`<a href="/product/${p.slug}" target="_blank" rel="noreferrer" class="icon-btn" aria-label="View ${p.name} in the shop">${icon("eye", 18)}</a>`}
              ${p.isActive && html`<button class="icon-btn" aria-label="Hide ${p.name}" data-hide="${p.id}">${icon("eyeOff", 18)}</button>`}
            </div></td>
          </tr>`)}</tbody>
        </table></div></div>
        ${pagination(data.page, data.pages)}`);
  };

  const load = () => {
    api.admin.products({ q: sp.get("q"), categoryId: sp.get("category"), show: sp.get("show") ?? "all", page: sp.get("page") ?? 1 })
      .then((r) => { data = r; if (ctx.alive()) draw(); })
      .catch((e) => setHtml($("[data-list]", view), errorState(e.message)));
  };

  on(view, "submit", "[data-search]", (e, form) => { e.preventDefault(); setQuery({ q: String(new FormData(form).get("q") || "") || null }); });
  on(view, "change", "[data-category]", (e, el) => setQuery({ category: el.value || null }));
  on(view, "click", "[data-show]", (e, el) => setQuery({ show: el.dataset.show === "all" ? null : el.dataset.show }));
  on(view, "click", "[data-page]", (e, el) => setQuery({ page: el.dataset.page }, { resetPage: false }));
  on(view, "click", "[data-act=retry]", load);
  on(view, "click", "[data-hide]", (e, el) => {
    const p = data.items.find((x) => x.id === el.dataset.hide);
    confirmDialog({
      title: "Hide this product?", confirmLabel: "Hide product",
      body: `${p.name} will be removed from the shop. Past orders keep it, and you can show it again from its edit page.`,
      onConfirm: async () => {
        try { await api.admin.hideProduct(p.id); toast(`${p.name} is hidden from the shop`); load(); }
        catch (err) { toastError(err); throw err; }
      },
    });
  });

  api.categories().then((cats) => {
    const sel = $("[data-category]", view);
    setHtml(sel, html`<option value="">All categories</option>${cats.map((c) => html`<option value="${c.id}"${attr("selected", sp.get("category") === c.id)}>${c.name}</option>`)}`);
  }).catch(() => undefined);
  load();
}
