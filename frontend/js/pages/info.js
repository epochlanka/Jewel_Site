// About, contact, delivery, FAQ, privacy and terms. Text marked [LIKE THIS] is a
// placeholder for the shop to replace with its own details.
import { html, setHtml } from "../html.js";
import { icon } from "../icons.js";
import { lkr, phoneLink, whatsappLink } from "../format.js";
import { state, subscribe } from "../store.js";

function about(s) {
  return html`<div class="page page-narrow">
    <div class="page-head"><h1>About ${s.shopName}</h1><p>${s.tagline}</p></div>
    <div class="prose">
      <p>[Tell your story here: when the shop started, who runs it and what kind of jewellery you love to sell.]</p>
      <h2>See it on before you buy</h2>
      <p>Choosing jewellery online is hard when you can't hold it up to yourself. Every piece that supports it can be tried on with AI, on one of our models or on your own photo, before you order.</p>
      <h2>Order your way</h2>
      <p>Pay by cash on delivery or bank transfer, have it delivered anywhere in Sri Lanka, or collect it from our shop. If you have a question about a piece, message us on WhatsApp.</p>
      <p><a href="/shop" class="btn btn-primary">Shop now</a></p>
    </div>
  </div>`;
}

function contact(s) {
  const cards = [
    s.whatsapp && { href: whatsappLink(s.whatsapp, "Hi, I have a question."), icon: "chat", title: "WhatsApp", text: s.whatsapp, external: true },
    s.phone && { href: phoneLink(s.phone), icon: "phone", title: "Call us", text: s.phone },
    s.email && { href: `mailto:${s.email}`, icon: "mail", title: "Email", text: s.email },
  ].filter(Boolean);
  return html`<div class="page page-narrow">
    <div class="page-head"><h1>Contact us</h1><p>Questions about a piece, an order or a custom request? We're happy to help.</p></div>
    <div class="contact-grid">
      ${cards.map((c) => html`<a href="${c.href}" class="contact-card"${c.external ? html` target="_blank" rel="noreferrer"` : ""}>
        <span class="contact-card-icon">${icon(c.icon, 24)}</span><strong>${c.title}</strong><span>${c.text}</span>
      </a>`)}
      <div class="contact-card"><span class="contact-card-icon">${icon("pin", 24)}</span><strong>Visit the shop</strong><span>${s.address || "[Shop address]"}</span></div>
      <div class="contact-card"><span class="contact-card-icon">${icon("clock", 24)}</span><strong>Opening hours</strong><span>[Days and hours]</span></div>
    </div>
    ${!cards.length && html`<p class="muted" style="margin-top: 20px">Contact details appear here once they're added in the admin settings.</p>`}
  </div>`;
}

function delivery(s) {
  const methods = [s.codEnabled && "cash on delivery", s.bankEnabled && "bank transfer", s.onlineEnabled && "online card payment"].filter(Boolean).join(", ");
  return html`<div class="page page-narrow">
    <div class="page-head"><h1>Delivery and returns</h1></div>
    <div class="prose">
      <h2>Delivery</h2>
      <p>We deliver anywhere in Sri Lanka for ${lkr(s.deliveryFee)}${s.freeDeliveryOver ? `, and free on orders over ${lkr(s.freeDeliveryOver)}` : ""}. Most orders arrive within [number of] working days after we confirm them.</p>
      ${s.pickupEnabled && html`<p>Prefer to collect? Choose store pickup at checkout. It's free, and we'll message you when your order is ready${s.address ? ` at ${s.address}` : ""}.</p>`}
      <h2>Payment</h2>
      <p>You can pay by ${methods || "the methods shown at checkout"}. For bank transfers, use your order number as the reference and send us the slip on WhatsApp.</p>
      <h2>Returns and exchanges</h2>
      <p>[Your return policy: how many days customers have, what condition items must be in, and which items can't be returned, for example earrings for hygiene reasons.]</p>
      <p>To start a return, <a href="/contact">contact us</a> with your order number.</p>
    </div>
  </div>`;
}

const faqs = [
  { id: "order", q: "How do I place an order?", a: html`Add pieces to your cart and go to checkout. You can order as a guest or sign in. We contact you to confirm the order before it's sent.` },
  { id: "try-on", q: "How does AI try-on work?", a: html`On any piece you can try on, choose one of our models or upload a clear, front-facing photo of yourself. The AI places the piece where it's worn, for example earrings on the earlobes and necklaces around the neck, and shows a preview in a few seconds. Size and colour can vary slightly in real life.` },
  { id: "photo", q: "What happens to my photo?", a: html`Your photo is only used to create your preview. If you're signed in, the preview is saved to your account so you can see it again.` },
  { id: "look", q: "Can I try on a full set?", a: html`Yes. Use <a href="/build-look">Create your look</a> to pick earrings, a necklace and bangles, then preview them together.` },
  { id: "track", q: "How do I track my order?", a: html`Go to <a href="/track">Track your order</a> and enter your order number and mobile number.` },
  { id: "pay", q: "How can I pay?", a: html`Cash on delivery or bank transfer. See <a href="/delivery">Delivery and returns</a> for details.` },
];

const faq = () => html`<div class="page page-narrow">
  <div class="page-head"><h1>Questions and answers</h1></div>
  <dl class="faq-list">${faqs.map((f) => html`<div id="${f.id}" class="faq-item"><dt>${f.q}</dt><dd>${f.a}</dd></div>`)}</dl>
</div>`;

const privacy = (s) => html`<div class="page page-narrow">
  <div class="page-head"><h1>Privacy</h1></div>
  <div class="prose">
    <p>This page explains what ${s.shopName} collects when you use this website and why.</p>
    <h2>What we collect</h2>
    <p>Your name, mobile number, address and email when you place an order or create an account. Photos you upload for AI try-on. Pieces you save to your wishlist.</p>
    <h2>How we use it</h2>
    <p>To deliver your order, contact you about it, create try-on previews and keep your account working. We don't sell your details.</p>
    <p>[Add how long you keep data, who you share it with (for example your delivery company) and how customers can ask for their data to be deleted.]</p>
    <p>Questions? <a href="/contact">Contact us</a>.</p>
  </div>
</div>`;

const terms = (s) => html`<div class="page page-narrow">
  <div class="page-head"><h1>Terms</h1></div>
  <div class="prose">
    <p>These terms apply when you order from ${s.shopName}.</p>
    <h2>Orders and prices</h2>
    <p>Prices are in Sri Lankan rupees. An order is accepted when we confirm it by phone or WhatsApp.</p>
    <h2>AI previews</h2>
    <p>Try-on previews show how a piece may look. Size and colour can vary slightly from the real piece.</p>
    <p>[Add your returns, warranty and any other conditions here. See <a href="/delivery">Delivery and returns</a>.]</p>
  </div>
</div>`;

const pages = { "/about": about, "/contact": contact, "/delivery": delivery, "/faq": faq, "/privacy": privacy, "/terms": terms };

export default function info(view, ctx) {
  const page = pages[location.pathname.replace(/\/$/, "")];
  const draw = () => setHtml(view, page(state.settings));
  draw();
  ctx.onCleanup(subscribe((what) => { if (what === "settings") draw(); }));
}
