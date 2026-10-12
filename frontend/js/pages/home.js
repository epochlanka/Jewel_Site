import { html, setHtml } from "../html.js";
import { icon } from "../icons.js";
import { api } from "../api.js";
import { lkr, whatsappLink } from "../format.js";
import { state, subscribe } from "../store.js";
import { productCard, reveal, observeReveals, skeletonGrid } from "../ui.js";

function services(s) {
  const chat = s.whatsapp || s.phone;
  return [
    { icon: "truck", title: "Islandwide delivery", href: "/delivery", more: "Delivery details",
      text: s.freeDeliveryOver ? `Free over ${lkr(s.freeDeliveryOver)}, otherwise ${lkr(s.deliveryFee)}` : `Delivered to your door for ${lkr(s.deliveryFee)}` },
    { icon: "bank", title: "Pay by bank transfer", href: "/faq#pay", more: "How to pay", text: "From any bank or banking app. Your order is confirmed once we receive it." },
    { icon: "chat", title: "Help on WhatsApp", href: chat ? whatsappLink(chat, "Hi, I have a question.") : "/contact", external: !!chat, more: "Chat with us", text: "Ask about any piece or order and get a quick reply." },
    s.pickupEnabled && { icon: "store", title: "Store pickup", href: "/contact", more: "Find the shop", text: s.address ? `Collect for free from ${s.address}` : "Collect your order for free from our shop" },
  ].filter(Boolean);
}

export default async function home(view, ctx) {
  const d = { cats: [], fresh: [], sale: [], rent: [], loading: true };

  const draw = () => {
    const s = state.settings;
    const heroImg = d.fresh.find((p) => p.images[0])?.images[0]?.url;
    const withItems = d.cats.filter((c) => (c._count?.products ?? 0) > 0);
    const cats = withItems.length ? withItems : d.cats;

    setHtml(view, html`
      <section class="hero" aria-labelledby="hero-title">
        <div class="hero-copy">
          <h1 id="hero-title">Discover your perfect jewellery</h1>
          <p>Earrings, bangles, chains and necklaces for every day and every occasion, delivered islandwide.</p>
          <div class="hero-actions">
            <a href="/shop" class="btn btn-primary btn-lg">Shop now</a>
            <a href="/shop?newArrivals=1" class="btn btn-secondary btn-lg">New arrivals</a>
          </div>
        </div>
        <div class="hero-media ${heroImg ? "" : "hero-media-empty"}">
          ${heroImg ? html`<img src="${heroImg}" alt="" fetchpriority="high">` : icon("diamond", 96)}
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

      ${d.rent.length > 0 && html`<section class="home-section" aria-labelledby="rent-title">
        <div class="rent-band">
          <div class="rent-band-copy">
            <span class="rent-band-kicker">${icon("clock", 16)}Bridal rentals</span>
            <h2 id="rent-title">Rent your bridal jewellery</h2>
            <p>Wear a complete bridal set for your big day without buying it. Pick your dates, pay the rent and a refundable deposit, and return it after the wedding.</p>
            <a href="/shop?rent=1" class="btn btn-primary">See rental pieces</a>
          </div>
          <div class="rail rail-products">${d.rent.map(productCard)}</div>
        </div>
      </section>`}

      ${d.sale.length > 0 && html`<section class="home-section" aria-labelledby="sale-title">
        <div class="section-head"><h2 id="sale-title">On offer now</h2><a href="/shop?onSale=1">See all offers</a></div>
        <div class="rail rail-products">${d.sale.map(productCard)}</div>
      </section>`}

      <section class="services" aria-labelledby="services-title">
        <div class="services-head"><h2 id="services-title">Shop with confidence</h2><p>Simple ordering, safe payment and help whenever you need it.</p></div>
        <div class="services-grid">${services(s).map((x, i) => reveal(html`
          <a href="${x.href}" class="service"${x.external ? html` target="_blank" rel="noreferrer"` : ""}>
            <span class="service-icon">${icon(x.icon, 24)}</span>
            <span><strong>${x.title}</strong><span class="service-text">${x.text}</span></span>
            <span class="service-more">${x.more}${icon("chevronRight", 14)}</span>
          </a>`, i))}</div>
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
    api.products({ rent: 1, limit: 8 }).then((r) => { d.rent = r.items; }),
  ]).catch(() => undefined);
  d.loading = false;
  draw();
}
