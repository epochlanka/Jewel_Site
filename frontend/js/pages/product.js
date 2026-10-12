import { html, attr, setHtml, on, $ } from "../html.js";
import { icon } from "../icons.js";
import { api } from "../api.js";
import { typeLabel } from "../format.js";
import { state, subscribe, addToCart, toggleWish, toast } from "../store.js";
import { breadcrumb, dayLabel, emptyState, pageLoading, price, productImage, productGrid, qtyStepper } from "../ui.js";
import { lkr } from "../format.js";

export default async function product(view, ctx) {
  const slug = ctx.params.slug;
  let p = null, related = [], img = 0, qty = 1, busy = false;
  let mode = "buy", size = null, from = "", to = "", bookings = null;

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
  const sized = p.sizes.length > 0;
  if (!p.forSale) mode = "rent";
  // In stock for the chosen size, or for the piece when it has no sizes.
  const stockNow = () => (sized ? (p.sizes.find((x) => x.size === size)?.stock ?? 0) : p.stock);
  const soldOut = p.forSale && p.stock <= 0;
  const low = !soldOut && !sized && p.stock <= 3;
  if (p.forRent) api.bookings(slug).then((b) => { bookings = b; if (mode === "rent") drawBuy(); }).catch(() => { bookings = { units: p.rentUnits, bookings: [] }; });

  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const rentDays = () => (from && to && to >= from ? Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 864e5) + 1 : 0);
  const rentTotal = (days) => p.rentPrice + Math.max(0, days - p.rentDays) * p.rentExtraDay;
  const clashes = () => (bookings?.bookings ?? []).filter((b) => b.from <= to && b.to >= from).length >= (bookings?.units ?? p.rentUnits);

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
  const buyPanel = () => {
    const stock = stockNow();
    const needSize = sized && !size;
    return html`
      ${sized && html`<div class="size-pick">
        <div class="size-pick-head"><strong>Size</strong>${size ? html`<span class="muted">${stock > 0 && stock <= 3 ? `Only ${stock} left in ${size}` : `Size ${size}`}</span>` : html`<span class="muted">Choose your size</span>`}</div>
        <div class="size-chips" role="radiogroup" aria-label="Size">${p.sizes.map((x) => html`
          <button type="button" class="size-chip" role="radio" aria-checked="${String(size === x.size)}" data-size="${x.size}"${attr("disabled", x.stock <= 0)}>
            ${x.size}${x.stock <= 0 && html`<span class="size-chip-out">Sold out</span>`}</button>`)}</div>
      </div>`}
      <div class="pdp-buy-row">
        ${!soldOut && !needSize && stock > 0 && qtyStepper(qty, Math.min(stock, 20))}
        <button class="btn btn-primary btn-lg" data-act="add"${attr("disabled", soldOut || busy || needSize)}>${soldOut ? "Sold out" : needSize ? "Choose a size" : busy ? "Adding…" : "Add to cart"}</button>
      </div>`;
  };

  const rentPanel = () => {
    const days = rentDays();
    const taken = days > 0 && clashes();
    const tooLong = days > 30;
    const upcoming = (bookings?.bookings ?? []).slice(0, 6);
    const ready = days > 0 && !taken && !tooLong && from >= today();
    return html`
      <dl class="rent-facts">
        <div><dt>Rent</dt><dd>${lkr(p.rentPrice)} <span class="muted">for up to ${p.rentDays} ${p.rentDays === 1 ? "day" : "days"}</span></dd></div>
        ${p.rentExtraDay > 0 && html`<div><dt>Extra day</dt><dd>${lkr(p.rentExtraDay)} <span class="muted">per day</span></dd></div>`}
        ${p.rentDeposit > 0 && html`<div><dt>Deposit</dt><dd>${lkr(p.rentDeposit)} <span class="muted">refunded when returned</span></dd></div>`}
      </dl>
      <div class="rent-dates">
        <label class="field"><span class="field-label">Pickup date</span><input type="date" data-rent="from" min="${today()}" value="${from}"></label>
        <label class="field"><span class="field-label">Return date</span><input type="date" data-rent="to" min="${from || today()}" value="${to}"></label>
      </div>
      ${upcoming.length > 0 && html`<p class="rent-booked">${icon("clock", 15)}<span>Already booked: ${upcoming.map((b) => b.from === b.to ? dayLabel(b.from) : `${dayLabel(b.from)} to ${dayLabel(b.to)}`).join(" · ")}</span></p>`}
      ${taken && html`<p class="form-error" role="alert">This piece is booked for some of those days. Choose other dates.</p>`}
      ${tooLong && html`<p class="form-error" role="alert">A rental can be up to 30 days.</p>`}
      ${ready && html`<div class="rent-sum">
        <div class="summary-row"><span>Rent for ${days} ${days === 1 ? "day" : "days"}</span><span>${lkr(rentTotal(days))}</span></div>
        ${p.rentDeposit > 0 && html`<div class="summary-row"><span>Refundable deposit</span><span>${lkr(p.rentDeposit)}</span></div>`}
        <div class="summary-row summary-total"><span>To pay now</span><span>${lkr(rentTotal(days) + p.rentDeposit)}</span></div>
      </div>`}
      <div class="pdp-buy-row">
        <button class="btn btn-primary btn-lg" data-act="rent"${attr("disabled", !ready || busy)}>${icon("clock", 18)}${busy ? "Adding…" : ready ? `Book rental · ${lkr(rentTotal(days) + p.rentDeposit)}` : "Choose your dates"}</button>
      </div>`;
  };

  const drawBuy = () => setHtml($("[data-buy]", view), html`
    ${p.forSale && p.forRent && html`<div class="tabs mode-tabs" role="tablist" aria-label="Buy or rent">
      <button class="tab" role="tab" aria-selected="${String(mode === "buy")}" aria-pressed="${String(mode === "buy")}" data-mode="buy">Buy</button>
      <button class="tab" role="tab" aria-selected="${String(mode === "rent")}" aria-pressed="${String(mode === "rent")}" data-mode="rent">Rent</button>
    </div>`}
    ${mode === "rent" ? rentPanel() : buyPanel()}`);

  setHtml(view, html`<div class="page">
    ${breadcrumb([{ to: "/", label: "Home" }, { to: "/shop", label: "Shop" }, ...(p.category ? [{ to: `/shop/${p.category.slug}`, label: p.category.name }] : []), { label: p.name }])}
    <div class="pdp">
      <div class="gallery" data-gallery>${gallery()}</div>
      <div class="pdp-info">
        <div class="pdp-meta">
          <span>Code ${p.code}</span>
          ${!p.forSale ? html`<span class="stock stock-in">${icon("clock", 16)}Available to rent</span>`
            : soldOut ? html`<span class="stock stock-out">${icon("close", 16)}Sold out</span>`
            : low ? html`<span class="stock stock-low">${icon("alert", 16)}Only ${p.stock} left</span>`
            : html`<span class="stock stock-in">${icon("check", 16)}In stock</span>`}
        </div>
        <h1>${p.name}</h1>
        ${p.forSale ? price(p.price, p, "lg") : html`<span class="price price-lg"><span class="price-now">${lkr(p.rentPrice)}</span><span class="price-unit">rent for up to ${p.rentDays} days</span></span>`}
        ${p.forSale && p.forRent && html`<p class="pdp-offer">Also available to rent from ${lkr(p.rentPrice)}</p>`}
        ${p.offerTitle && html`<p class="pdp-offer">${p.offerTitle}: ${p.offerPercent}% off</p>`}
        ${p.description && html`<p class="pdp-desc">${p.description}</p>`}

        <div class="pdp-buy">
          <div data-buy></div>
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

  drawBuy();
  const wishSlot = $("[data-wish-slot]", view);
  wishSlot.style.display = "contents";
  ctx.onCleanup(subscribe((what) => { if (what === "wishlist") setHtml(wishSlot, wishButton()); }));

  on(view, "click", "[data-photo]", (e, el) => { img = Number(el.dataset.photo); setHtml($("[data-gallery]", view), gallery()); });
  on(view, "click", "[data-step]", (e, el) => { qty += Number(el.dataset.step); drawBuy(); });
  on(view, "click", "[data-mode]", (e, el) => { mode = el.dataset.mode; drawBuy(); });
  on(view, "click", "[data-size]", (e, el) => { size = el.dataset.size; qty = 1; drawBuy(); });
  on(view, "change", "[data-rent]", (e, el) => {
    if (el.dataset.rent === "from") { from = el.value; if (to && to < from) to = ""; if (!to && from) to = from; }
    else to = el.value;
    drawBuy();
  });
  on(view, "click", "[data-act=add]", async () => {
    busy = true; drawBuy();
    await addToCart([{ productId: p.id, qty, ...(size ? { size } : {}) }], `${p.name}${size ? ` (size ${size})` : ""} added to cart`);
    busy = false; drawBuy();
  });
  on(view, "click", "[data-act=rent]", async () => {
    busy = true; drawBuy();
    const added = await addToCart([{ productId: p.id, qty: 1, rentFrom: from, rentTo: to }], `${p.name} booked for ${dayLabel(from)} to ${dayLabel(to)}. Complete checkout to confirm it.`);
    busy = false;
    if (added) { from = ""; to = ""; bookings = await api.bookings(slug).catch(() => bookings); }
    drawBuy();
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
