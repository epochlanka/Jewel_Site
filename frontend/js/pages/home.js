import { html, setHtml } from "../html.js";
import { icon } from "../icons.js";
import { api } from "../api.js";
import { lkr } from "../format.js";
import { state, subscribe } from "../store.js";
import { productCard, reveal, observeReveals, skeletonGrid } from "../ui.js";

const lookTypes = [
  { label: "Earrings", types: ["EARRINGS"] },
  { label: "Necklace", types: ["NECKLACE", "CHAIN", "LONG_CHAIN"] },
  { label: "Bangles", types: ["BANGLE", "BRACELET"] },
];

export default async function home(view, ctx) {
  const d = { cats: [], fresh: [], sale: [], models: [], lookPieces: [], loading: true };

  const draw = () => {
    const s = state.settings;
    const heroImg = d.models[0] ?? d.fresh.find((p) => p.images[0])?.images[0]?.url;
    const lookImg = d.models[1] ?? d.models[0] ?? heroImg;
    const withItems = d.cats.filter((c) => (c._count?.products ?? 0) > 0);
    const cats = withItems.length ? withItems : d.cats;

    setHtml(view, html`
      <section class="hero" aria-labelledby="hero-title">
        <div class="hero-copy">
          <h1 id="hero-title">Discover your perfect jewellery</h1>
          <p>See any piece on a model or on your own photo before you order.</p>
          <div class="hero-actions">
            <a href="/shop" class="btn btn-primary btn-lg">Shop now</a>
            <a href="/shop?tryOn=1" class="btn btn-secondary btn-lg">${icon("sparkle", 18)}Try on with AI</a>
          </div>
        </div>
        <div class="hero-media ${heroImg ? "" : "hero-media-empty"}">
          ${heroImg ? html`<img src="${heroImg}" alt="A model wearing earrings and bangles from the shop" fetchpriority="high">` : icon("diamond", 96)}
        </div>
      </section>

      ${cats.length > 0 && html`<section class="home-section" aria-labelledby="cat-title">
        <div class="section-head"><h2 id="cat-title">Shop by category</h2><a href="/shop">View all</a></div>
        <div class="rail">${cats.map((c, i) => reveal(html`<a href="/shop/${c.slug}" class="cat-card">
          <span class="cat-card-img">${c.imageUrl ? html`<img src="${c.imageUrl}" alt="" loading="lazy">` : html`<span class="cat-card-letter" aria-hidden="true">${c.name.charAt(0)}</span>`}</span>
          <span class="cat-card-name">${c.name}</span>
        </a>`, i))}</div>
      </section>`}

      <section class="home-section" aria-labelledby="new-title">
        <div class="section-head"><h2 id="new-title">New arrivals</h2><a href="/shop?newArrivals=1">See all</a></div>
        ${d.loading ? skeletonGrid(4)
          : d.fresh.length ? html`<div class="pgrid">${d.fresh.map((p, i) => reveal(productCard(p), i % 4))}</div>`
          : html`<p class="empty-note">New pieces are on their way. Check back soon.</p>`}
      </section>

      <section class="home-section" aria-labelledby="look-title">
        ${reveal(html`
          <div class="look-copy">
            <h2 id="look-title">Create your look</h2>
            <p>Pick earrings, a necklace and bangles, then see the whole set on a model before you order.</p>
            <a href="/build-look" class="btn btn-primary">Start your look</a>
          </div>
          ${lookImg && html`<div class="look-photo"><img src="${lookImg}" alt="A model wearing a full jewellery set" loading="lazy"></div>`}
          ${d.lookPieces.length > 0 && html`<div class="look-pieces">${d.lookPieces.map(({ label, p }) => html`
            <a href="/product/${p.slug}" class="look-piece">
              <span class="look-piece-img"><img src="${p.images[0].url}" alt="" loading="lazy"></span>
              <span>${label}<br><span class="muted">${lkr(p.salePrice ?? p.price)}</span></span>
            </a>`)}</div>`}`, 0, "look-bento")}
      </section>

      ${d.sale.length > 0 && html`<section class="home-section" aria-labelledby="sale-title">
        <div class="section-head"><h2 id="sale-title">On offer now</h2><a href="/shop?onSale=1">See all offers</a></div>
        <div class="rail rail-products">${d.sale.map(productCard)}</div>
      </section>`}

      <section class="services" aria-label="Delivery and payment">
        <div class="service">${icon("truck", 22)}<span><strong>Islandwide delivery</strong><span>${s.freeDeliveryOver ? `Free over ${lkr(s.freeDeliveryOver)}, otherwise ${lkr(s.deliveryFee)}` : `Delivered to your door for ${lkr(s.deliveryFee)}`}</span></span></div>
        ${s.codEnabled && html`<div class="service">${icon("cash", 22)}<span><strong>Cash on delivery</strong><span>${s.bankEnabled ? "Or pay by bank transfer" : "Pay when it arrives"}</span></span></div>`}
        <div class="service">${icon("chat", 22)}<span><strong>Help on WhatsApp</strong><span>Ask about any piece or order</span></span></div>
        ${s.pickupEnabled && html`<div class="service">${icon("store", 22)}<span><strong>Store pickup</strong><span>${s.address ? `Collect from ${s.address}` : "Collect from our shop"}</span></span></div>`}
      </section>`);
    observeReveals(view);
  };

  draw();
  ctx.onCleanup(subscribe((what) => { if (what === "settings") draw(); }));

  await Promise.all([
    api.categories().then((c) => { d.cats = c; }),
    api.products({ newArrivals: 1, limit: 8 }).then(async (r) => {
      // Fall back to the newest pieces when nothing is marked as a new arrival.
      d.fresh = r.items.length ? r.items : (await api.products({ limit: 8 })).items;
    }),
    api.products({ onSale: 1, limit: 12 }).then((r) => { d.sale = r.items; }),
    api.aiModels().then((m) => { d.models = m.map((x) => x.imageUrl); }),
    Promise.all(lookTypes.map(async (t) => {
      const found = (await Promise.all(t.types.map((type) => api.products({ type, tryOn: 1, inStock: 1, limit: 1 })))).flatMap((r) => r.items)[0];
      return found?.images[0] ? { label: t.label, p: found } : null;
    })).then((list) => { d.lookPieces = list.filter(Boolean); }),
  ]).catch(() => undefined);
  d.loading = false;
  draw();
}
