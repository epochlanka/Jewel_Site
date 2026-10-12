import { html, attr, setHtml, on, $ } from "../html.js";
import { icon } from "../icons.js";
import { api } from "../api.js";
import { typeLabel } from "../format.js";
import { state, subscribe, addToCart, toggleWish, toast } from "../store.js";
import { breadcrumb, emptyState, pageLoading, price, productImage, productGrid, qtyStepper } from "../ui.js";

export default async function product(view, ctx) {
  const slug = ctx.params.slug;
  let p = null, related = [], img = 0, qty = 1, busy = false;

  setHtml(view, pageLoading());
  try {
    [p, related] = await Promise.all([api.product(slug), api.related(slug).catch(() => [])]);
  } catch {
    setHtml(view, html`<div class="page">${emptyState({
      icon: "search", title: "This piece isn't available", text: "It may have sold out or been removed.",
      action: html`<a href="/shop" class="btn btn-primary">Browse jewellery</a>`,
    })}</div>`);
    return;
  }

  const images = p.images;
  const soldOut = p.stock <= 0;
  const low = !soldOut && p.stock <= 3;

  const wishButton = () => {
    const saved = state.wishIds.has(p.id);
    return html`<button class="btn btn-quiet btn-sm" aria-pressed="${String(saved)}" data-act="wish">${icon("heart", 18, saved)}${saved ? "Saved" : "Save to wishlist"}</button>`;
  };
  const gallery = () => html`
    <div class="gallery-main">
      ${productImage(images[img]?.url, `${p.name}${images.length > 1 ? `, photo ${img + 1} of ${images.length}` : ""}`, { type: p.jewelleryType, iconSize: 160 })}
      ${images.length > 1 && html`
        <button class="icon-btn gallery-nav gallery-prev" aria-label="Previous photo" data-photo="${(img - 1 + images.length) % images.length}">${icon("chevronLeft")}</button>
        <button class="icon-btn gallery-nav gallery-next" aria-label="Next photo" data-photo="${(img + 1) % images.length}">${icon("chevronRight")}</button>`}
    </div>
    ${images.length > 1 && html`<div class="thumbs">${images.map((im, i) => html`
      <button class="thumb" aria-current="${String(i === img)}" aria-label="Show photo ${i + 1}" data-photo="${i}">${productImage(im.url, "", { type: p.jewelleryType, iconSize: 32 })}</button>`)}</div>`}`;
  const buyRow = () => html`
    ${!soldOut && qtyStepper(qty, Math.min(p.stock, 20))}
    <button class="btn btn-primary btn-lg" data-act="add"${attr("disabled", soldOut || busy)}>${soldOut ? "Sold out" : busy ? "Adding…" : "Add to cart"}</button>`;

  setHtml(view, html`<div class="page">
    ${breadcrumb([{ to: "/", label: "Home" }, { to: "/shop", label: "Shop" }, ...(p.category ? [{ to: `/shop/${p.category.slug}`, label: p.category.name }] : []), { label: p.name }])}
    <div class="pdp">
      <div class="gallery" data-gallery>${gallery()}</div>
      <div class="pdp-info">
        <div class="pdp-meta">
          <span>Code ${p.code}</span>
          ${soldOut ? html`<span class="stock stock-out">${icon("close", 16)}Sold out</span>`
            : low ? html`<span class="stock stock-low">${icon("alert", 16)}Only ${p.stock} left</span>`
            : html`<span class="stock stock-in">${icon("check", 16)}In stock</span>`}
        </div>
        <h1>${p.name}</h1>
        ${price(p.price, p, "lg")}
        ${p.offerTitle && html`<p class="pdp-offer">${p.offerTitle}: ${p.offerPercent}% off</p>`}
        ${p.description && html`<p class="pdp-desc">${p.description}</p>`}

        <div class="pdp-buy">
          <div class="pdp-buy-row" data-buy>${buyRow()}</div>
          ${p.tryOnEnabled && html`<a href="/try-on?products=${p.id}" class="try-cta">
            <span class="try-cta-icon">${icon("sparkle", 22)}</span>
            <span><strong>Try it on with AI</strong><span>See it on a model or on your own photo</span></span>
            ${icon("chevronRight")}
          </a>`}
        </div>

        <div class="pdp-actions"><span data-wish-slot>${wishButton()}</span><button class="btn btn-quiet btn-sm" data-act="share">${icon("share", 18)}Share</button></div>

        <dl class="pdp-details">
          <dt>Type</dt><dd>${typeLabel[p.jewelleryType]}</dd>
          ${p.category && html`<dt>Category</dt><dd><a href="/shop/${p.category.slug}">${p.category.name}</a></dd>`}
          ${p.style && html`<dt>Style</dt><dd>${p.style}</dd>`}
          ${p.colour && html`<dt>Colour</dt><dd>${p.colour}</dd>`}
        </dl>
      </div>
    </div>

    ${related.length > 0 && html`<section class="related" aria-labelledby="related-title">
      <div class="section-head"><h2 id="related-title">You may also like</h2>${p.category && html`<a href="/shop/${p.category.slug}">More ${p.category.name.toLowerCase()}</a>`}</div>
      ${productGrid(related)}
    </section>`}
  </div>`);

  const wishSlot = $("[data-wish-slot]", view);
  wishSlot.style.display = "contents";
  ctx.onCleanup(subscribe((what) => { if (what === "wishlist") setHtml(wishSlot, wishButton()); }));

  on(view, "click", "[data-photo]", (e, el) => { img = Number(el.dataset.photo); setHtml($("[data-gallery]", view), gallery()); });
  on(view, "click", "[data-step]", (e, el) => { qty += Number(el.dataset.step); setHtml($("[data-buy]", view), buyRow()); });
  on(view, "click", "[data-act=add]", async () => {
    busy = true; setHtml($("[data-buy]", view), buyRow());
    await addToCart([{ productId: p.id, qty }], `${p.name} added to cart`);
    busy = false; setHtml($("[data-buy]", view), buyRow());
  });
  on(view, "click", "[data-act=wish]", () => toggleWish(p.id, p.name));
  on(view, "click", "[data-act=share]", async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: p.name, url });
      else { await navigator.clipboard.writeText(url); toast("Link copied"); }
    } catch { /* closed the share sheet */ }
  });
}
