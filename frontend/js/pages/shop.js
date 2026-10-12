import { html, attr, setHtml, on } from "../html.js";
import { icon } from "../icons.js";
import { api } from "../api.js";
import { breadcrumb, emptyState, errorState, pagination, productGrid, skeletonGrid } from "../ui.js";
import { setQuery } from "../router.js";

const sorts = [
  { v: "new", label: "Newest" },
  { v: "price_asc", label: "Price: low to high" },
  { v: "price_desc", label: "Price: high to low" },
  { v: "name", label: "Name A to Z" },
];

export default async function shop(view, ctx) {
  const category = ctx.params.category;
  const sp = ctx.query;
  const d = { data: null, cats: [], facets: null, err: "", open: false };

  const q = sp.get("q");
  // Keep the filters (but not the page) when switching category.
  const keep = (() => { const k = new URLSearchParams(sp); k.delete("page"); const s = k.toString(); return s ? `?${s}` : ""; })();

  const chips = [];
  if (q) chips.push({ label: `“${q}”`, clear: { q: null } });
  if (sp.get("minPrice") || sp.get("maxPrice")) chips.push({ label: `LKR ${sp.get("minPrice") || "0"} to ${sp.get("maxPrice") || "any"}`, clear: { minPrice: null, maxPrice: null } });
  if (sp.get("style")) chips.push({ label: sp.get("style"), clear: { style: null } });
  if (sp.get("colour")) chips.push({ label: sp.get("colour"), clear: { colour: null } });
  if (sp.get("inStock")) chips.push({ label: "In stock", clear: { inStock: null } });
  if (sp.get("onSale")) chips.push({ label: "On offer", clear: { onSale: null } });
  if (sp.get("newArrivals")) chips.push({ label: "New arrivals", clear: { newArrivals: null } });
  if (sp.get("tryOn")) chips.push({ label: "AI try-on", clear: { tryOn: null } });

  const draw = () => {
    const { data, cats, facets, err, open } = d;
    const current = cats.find((c) => c.slug === category);
    const title = q ? `Results for “${q}”` : current?.name ?? (sp.get("newArrivals") ? "New arrivals" : sp.get("onSale") ? "Offers" : sp.get("tryOn") ? "Try on with AI" : "All jewellery");
    const check = (key, label) => html`<label class="check"><input type="checkbox" data-toggle="${key}"${attr("checked", !!sp.get(key))}>${label}</label>`;

    setHtml(view, html`<div class="page">
      ${breadcrumb([{ to: "/", label: "Home" }, { to: "/shop", label: "Shop" }, ...(current ? [{ label: current.name }] : [])])}
      <div class="shop-head"><h1>${title}</h1></div>

      <div class="shop">
        ${open && html`<button class="drawer-scrim" aria-label="Close filters" data-filters="close"></button>`}
        <aside class="filters ${open ? "is-open" : ""}" aria-label="Filters">
          <div class="filters-head"><h2>Filters</h2><button class="icon-btn" aria-label="Close filters" data-filters="close">${icon("close")}</button></div>

          <div class="filter-group">
            <h2>Category</h2>
            <div class="filter-list">
              <a href="/shop${keep}" class="filter-link ${!category ? "is-on" : ""}">All jewellery</a>
              ${cats.map((c) => html`<a href="/shop/${c.slug}${keep}" class="filter-link ${category === c.slug ? "is-on" : ""}"${attr("aria-current", category === c.slug && "page")}>
                ${c.name}<span class="muted">${c._count?.products ?? ""}</span></a>`)}
            </div>
          </div>

          <form class="filter-group" data-price>
            <h2>Price (LKR)</h2>
            <div class="price-inputs">
              <label class="sr-only" for="minPrice">Minimum price</label>
              <input id="minPrice" name="minPrice" type="number" min="0" inputmode="numeric" placeholder="${facets ? String(facets.minPrice) : "Min"}" value="${sp.get("minPrice") ?? ""}">
              <span aria-hidden="true">to</span>
              <label class="sr-only" for="maxPrice">Maximum price</label>
              <input id="maxPrice" name="maxPrice" type="number" min="0" inputmode="numeric" placeholder="${facets ? String(facets.maxPrice) : "Max"}" value="${sp.get("maxPrice") ?? ""}">
            </div>
            <button class="btn btn-quiet btn-sm">Apply price</button>
          </form>

          ${facets?.styles.length > 0 && html`<div class="filter-group"><h2>Style</h2><div class="chips">
            ${facets.styles.map((st) => html`<button type="button" class="chip" aria-pressed="${String(sp.get("style") === st)}" data-facet="style" data-value="${st}">${st}</button>`)}
          </div></div>`}
          ${facets?.colours.length > 0 && html`<div class="filter-group"><h2>Colour</h2><div class="chips">
            ${facets.colours.map((c) => html`<button type="button" class="chip" aria-pressed="${String(sp.get("colour") === c)}" data-facet="colour" data-value="${c}">${c}</button>`)}
          </div></div>`}

          <div class="filter-group">
            <h2>Show</h2>
            ${check("inStock", "In stock only")}
            ${check("onSale", "On offer")}
            ${check("newArrivals", "New arrivals")}
            ${check("tryOn", "Can try on with AI")}
          </div>
        </aside>

        <div>
          <div class="shop-toolbar">
            <span class="shop-count" aria-live="polite">${data ? `${data.total} ${data.total === 1 ? "piece" : "pieces"}` : "Loading…"}</span>
            <div class="shop-toolbar-right">
              <button class="btn btn-quiet btn-sm filters-toggle" data-filters="open" aria-expanded="${String(open)}">${icon("filter", 18)}Filters${chips.length ? ` (${chips.length})` : ""}</button>
              <label class="sort"><span class="sr-only">Sort by</span>
                <select data-sort>${sorts.map((s) => html`<option value="${s.v}"${attr("selected", (sp.get("sort") ?? "new") === s.v)}>${s.label}</option>`)}</select>
              </label>
            </div>
          </div>

          ${chips.length > 0 && html`<div class="active-filters">
            ${chips.map((c, i) => html`<button class="chip" data-clear="${i}" aria-label="Remove filter ${c.label}">${c.label}${icon("close", 14)}</button>`)}
            <a href="${category ? `/shop/${category}` : "/shop"}" class="btn-link" style="min-height: 36px; font-size: 14px">Clear all</a>
          </div>`}

          ${err ? errorState(err)
            : !data ? skeletonGrid(8)
            : !data.items.length ? emptyState({
                title: "No pieces match",
                text: chips.length ? "Remove a filter or search for something else." : "There's nothing in this category yet.",
                action: html`<a href="/shop" class="btn btn-primary">See all jewellery</a>`,
              })
            : html`${productGrid(data.items)}${pagination(data.page, data.pages)}`}
        </div>
      </div>
    </div>`);
  };

  const setOpen = (v) => { d.open = v; document.body.style.overflow = v ? "hidden" : ""; draw(); };
  ctx.onCleanup(() => { document.body.style.overflow = ""; });

  on(view, "click", "[data-filters]", (e, el) => setOpen(el.dataset.filters === "open"));
  on(view, "click", "[data-facet]", (e, el) => setQuery({ [el.dataset.facet]: sp.get(el.dataset.facet) === el.dataset.value ? null : el.dataset.value }));
  on(view, "change", "[data-toggle]", (e, el) => setQuery({ [el.dataset.toggle]: sp.get(el.dataset.toggle) ? null : "1" }));
  on(view, "change", "[data-sort]", (e, el) => setQuery({ sort: el.value === "new" ? null : el.value }));
  on(view, "click", "[data-clear]", (e, el) => setQuery(chips[Number(el.dataset.clear)].clear));
  on(view, "click", "[data-page]", (e, el) => { const p = Number(el.dataset.page); setQuery({ page: p === 1 ? null : p }, { resetPage: false }); });
  on(view, "click", "[data-act=retry]", () => load());
  on(view, "submit", "[data-price]", (e, form) => {
    e.preventDefault();
    const f = new FormData(form);
    setQuery({ minPrice: String(f.get("minPrice") || ""), maxPrice: String(f.get("maxPrice") || "") });
  });

  const load = () => {
    d.err = ""; d.data = null; draw();
    api.products({ category, ...Object.fromEntries(sp), limit: 24 })
      .then((r) => { d.data = r; draw(); })
      .catch((e) => { d.err = e.message; draw(); });
  };

  draw();
  api.categories().then((c) => { d.cats = c; draw(); }).catch(() => undefined);
  api.productFilters().then((f) => { d.facets = f; draw(); }).catch(() => undefined);
  load();
}

