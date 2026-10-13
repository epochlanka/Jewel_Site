// Building blocks shared by the pages. Each returns HTML; buttons carry data-* attributes
// that the page (or app.js, for product cards) listens for.
import { html, raw, attr, setHtml, $$ } from "./html.js";
import { icon } from "./icons.js";
import { lkr, statusLabel, customerStatus, dateTime, deliveryLabel, paymentLabel, paymentStatusLabel } from "./format.js";
import { state } from "./store.js";

/* ---------- Product image with a drawn placeholder ---------- */
export function productImage(url, alt, { type, cls = "", iconSize = 72 } = {}) {
  if (url) return html`<img src="${url}" alt="${alt}" class="pimg ${cls}" loading="lazy" data-icon-size="${iconSize}"${attr("data-type", type)}>`;
  return imagePlaceholder(alt, { type, cls, iconSize });
}

export const imagePlaceholder = (alt, { type, cls = "", iconSize = 72 } = {}) =>
  html`<span class="pimg pimg-empty ${cls}" role="img" aria-label="${alt}"${attr("data-type", type)}>${icon("diamond", Math.round(iconSize * 0.6))}</span>`;

// Photos that fail to load are swapped for the placeholder (called once from app.js).
export function watchBrokenImages() {
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains("pimg")) return;
    const cls = [...img.classList].filter((c) => c !== "pimg").join(" ");
    img.outerHTML = imagePlaceholder(img.alt, { type: img.dataset.type, cls, iconSize: Number(img.dataset.iconSize) || 72 }).s;
  }, true);
}

/* ---------- Price with offer ---------- */
export function price(amount, pricing, size = "md") {
  const sale = pricing?.salePrice;
  return html`<span class="price price-${size}">${sale != null
    ? html`<span class="price-now">${lkr(sale)}</span><s class="price-was"><span class="sr-only">Was </span>${lkr(amount)}</s><span class="price-off">${pricing.offerPercent}% off</span>`
    : html`<span class="price-now">${lkr(amount)}</span>`}</span>`;
}

/* ---------- Quantity stepper ---------- */
// Buttons have data-step="-1|1" and data-key so the page knows which stepper was used.
export function qtyStepper(value, max, { label = "Quantity", key = "", disabled = false } = {}) {
  return html`<div class="qty" role="group" aria-label="${label}">
    <button type="button" class="qty-btn" aria-label="Decrease quantity" data-step="-1" data-key="${key}"${attr("disabled", disabled || value <= 1)}>${icon("minus", 16)}</button>
    <output class="qty-value" aria-live="polite">${value}</output>
    <button type="button" class="qty-btn" aria-label="Increase quantity" data-step="1" data-key="${key}"${attr("disabled", disabled || value >= max)}>${icon("plus", 16)}</button>
  </div>`;
}

/* ---------- Order status pill ---------- */
export const statusPill = (status, label) => html`<span class="pill pill-${status.toLowerCase()}">${label ?? statusLabel[status]}</span>`;

/* ---------- Loading / empty / error ---------- */
export const pageLoading = (label = "Loading…") => html`<div class="page-loading" role="status"><span class="spinner" aria-hidden="true"></span>${label}</div>`;

export const skeletonGrid = (n) => html`<div class="pgrid">${Array.from({ length: n }, () => html`<div class="skeleton skeleton-card"></div>`)}</div>`;

export function emptyState({ icon: name = "search", title, text, action }) {
  return html`<div class="empty-state">
    <span class="empty-icon">${icon(name, 28)}</span>
    <h2>${title}</h2>
    ${text && html`<p>${text}</p>`}
    ${action}
  </div>`;
}

// The retry button has data-act="retry".
export function errorState(message, retry = true) {
  return html`<div class="empty-state">
    <span class="empty-icon empty-icon-error">${icon("alert", 28)}</span>
    <h2>That didn't load</h2>
    <p>${message}</p>
    ${retry && html`<button class="btn btn-secondary" data-act="retry">${icon("refresh", 18)}Try again</button>`}
  </div>`;
}

/* ---------- Pagination ---------- */
// Buttons carry data-page with the page to go to.
export function pagination(page, pages) {
  if (pages <= 1) return "";
  const nums = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1);
  return html`<nav class="pager" aria-label="Pages">
    <button class="pager-btn" data-page="${page - 1}"${attr("disabled", page <= 1)} aria-label="Previous page">${icon("chevronLeft", 18)}</button>
    ${nums.map((n, i) => html`<span class="pager-group">
      ${i > 0 && n - nums[i - 1] > 1 && html`<span class="pager-gap" aria-hidden="true">…</span>`}
      <button class="pager-btn ${n === page ? "is-current" : ""}" data-page="${n}"${attr("aria-current", n === page && "page")}>${n}</button>
    </span>`)}
    <button class="pager-btn" data-page="${page + 1}"${attr("disabled", page >= pages)} aria-label="Next page">${icon("chevronRight", 18)}</button>
  </nav>`;
}

/* ---------- Breadcrumb ---------- */
export function breadcrumb(items) {
  return html`<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.map((it, i) => html`<li>${it.to && i < items.length - 1
    ? html`<a href="${it.to}">${it.label}</a>`
    : html`<span${attr("aria-current", i === items.length - 1 && "page")}>${it.label}</span>`}</li>`)}</ol></nav>`;
}

/* ---------- Form controls ---------- */
export function switchField({ name, label, hint, checked }) {
  return html`<label class="switch">
    <input type="checkbox" role="switch"${attr("name", name)}${attr("checked", !!checked)}>
    <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
    <span class="switch-text"><span class="switch-label">${label}</span>${hint && html`<span class="field-hint">${hint}</span>`}</span>
  </label>`;
}

// The eye button is handled once in app.js for every password field.
export function passwordInput({ name, label, autocomplete, minLength, hint }) {
  return html`<label class="field">
    <span class="field-label">${label}</span>
    <span class="input-wrap">
      <input name="${name}" type="password" required${attr("minlength", minLength)} autocomplete="${autocomplete}">
      <button type="button" class="input-icon" aria-label="Show password" data-toggle-password>${icon("eye", 18)}</button>
    </span>
    ${hint && html`<span class="field-hint">${hint}</span>`}
  </label>`;
}

export function togglePassword(btn) {
  const input = btn.parentElement.querySelector("input");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
  setHtml(btn, icon(show ? "eyeOff" : "eye", 18));
}

/* ---------- Product card ---------- */
// Add-to-cart and heart buttons are handled once in app.js.
// "12 Nov 2026" from "2026-11-12".
export const dayLabel = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// What an order or cart line is: the size, or the rental dates.
export function lineDetail(l) {
  if (l.kind === "RENT" && l.rentFrom) return html`<span class="line-tag line-tag-rent">${icon("clock", 13)}Rent ${dayLabel(l.rentFrom)} to ${dayLabel(l.rentTo)}</span>`;
  const parts = [l.colour, l.size && `Size ${l.size}`].filter(Boolean);
  if (parts.length) return html`<span class="line-tag">${parts.join(" · ")}</span>`;
  return "";
}

export function rentPrice(p) {
  return html`<span class="price price-md"><span class="price-now">${lkr(p.rentPrice)}</span><span class="price-unit">rent · up to ${p.rentDays} ${p.rentDays === 1 ? "day" : "days"}</span></span>`;
}

export function productCard(p) {
  const saved = state.wishIds.has(p.id);
  const rentOnly = p.forRent && !p.forSale;
  const soldOut = !rentOnly && p.stock <= 0;
  const sized = p.sizes?.length > 0 || p.colours?.length > 0;
  const colours = p.colours ?? [];
  return html`<article class="pcard ${soldOut ? "is-soldout" : ""}">
    <div class="pcard-media">
      <a href="/product/${p.slug}" class="pcard-link" tabindex="-1" aria-hidden="true">${productImage(p.images[0]?.url, p.name, { type: p.jewelleryType })}</a>
      <button class="pcard-wish ${saved ? "is-on" : ""}" aria-pressed="${String(saved)}" data-wish="${p.id}" data-name="${p.name}"
        aria-label="${saved ? `Remove ${p.name} from wishlist` : `Save ${p.name} to wishlist`}">${icon("heart", 20, saved)}</button>
    </div>
    <div class="pcard-body">
      <div class="pcard-meta"><span>${p.code}</span>${p.forRent && html`<span class="pcard-rent">${rentOnly ? "For rent" : "Also for rent"}</span>`}${p.isNewArrival && !soldOut && !p.forRent && html`<span class="pcard-new">New</span>`}</div>
      <h3 class="pcard-name"><a href="/product/${p.slug}">${p.name}</a></h3>
      ${rentOnly ? rentPrice(p) : price(p.price, p)}
      ${colours.length > 0 && html`<div class="pcard-swatches" role="group" aria-label="Colours">${colours.slice(0, 6).map((c) => html`
        <button type="button" class="swatch swatch-sm" style="--swatch: ${c.hex}" title="${c.name}" aria-label="Show ${c.name}" data-card-colour="${c.image}"></button>`)}
        ${colours.length > 6 && html`<span class="muted" style="font-size: 12px">+${colours.length - 6}</span>`}</div>`}
      ${p.sizes?.length > 0 && !rentOnly && html`<span class="pcard-sizes">Sizes ${p.sizes.map((s) => s.size).join(", ")}</span>`}
    </div>
    <div class="pcard-actions">
      ${rentOnly ? html`<a href="/product/${p.slug}" class="btn btn-primary btn-sm pcard-add">${icon("clock", 16)}Book rental</a>`
        : sized && !soldOut ? html`<a href="/product/${p.slug}" class="btn btn-primary btn-sm pcard-add">${p.colours?.length ? "Choose options" : "Choose size"}</a>`
        : html`<button class="btn btn-primary btn-sm pcard-add" data-add-to-cart="${p.id}" data-name="${p.name}"${attr("disabled", soldOut)}>${soldOut ? "Sold out" : "Add to cart"}</button>`}
    </div>
  </article>`;
}

export const productGrid = (items, style = "") => html`<div class="pgrid"${attr("style", style)}>${items.map(productCard)}</div>`;

/* ---------- Reveal on scroll ---------- */
export const reveal = (content, index = 0, cls = "") => html`<div class="reveal ${cls}" style="--i: ${index}">${content}</div>`;

// Fades blocks in once as they scroll into view. CSS skips the effect for visitors who prefer reduced motion.
export function observeReveals(root) {
  const els = $$(".reveal:not(.is-in)", root);
  if (typeof IntersectionObserver === "undefined") { els.forEach((el) => el.classList.add("is-in")); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
  }, { rootMargin: "0px 0px -10% 0px" });
  els.forEach((el) => io.observe(el));
}

/* ---------- Modal (native dialog) ---------- */
// openModal returns the dialog element; its body and footer are live DOM the caller wires up.
export function openModal({ title, body, footer, wide = false, onClose }) {
  const d = document.createElement("dialog");
  d.className = `modal ${wide ? "modal-wide" : ""}`;
  setHtml(d, html`<div class="modal-inner">
    <header class="modal-head"><h2>${title}</h2><button class="icon-btn" aria-label="Close" data-close>${icon("close")}</button></header>
    <div class="modal-body">${body}</div>
    ${footer && html`<footer class="modal-foot">${footer}</footer>`}
  </div>`);
  document.body.append(d);
  const close = () => { if (d.open) d.close(); };
  d.addEventListener("close", () => { d.remove(); onClose?.(); });
  d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-close]")) close(); });
  d.showModal();
  d.querySelector("[autofocus]")?.focus();
  d.closeModal = close;
  return d;
}

// Asks for confirmation; onConfirm runs while the button shows "Working…". The dialog closes
// when it succeeds and stays open (with the error shown as a toast by the caller) when it throws.
export function confirmDialog({ title, body, confirmLabel, danger = false, onConfirm }) {
  const d = openModal({
    title,
    body: html`<p class="modal-text">${body}</p>`,
    footer: html`<button class="btn btn-secondary" data-close>Keep it</button><button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-confirm>${confirmLabel}</button>`,
  });
  const btn = d.querySelector("[data-confirm]");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Working…";
    try {
      await onConfirm();
      d.closeModal();
    } catch {
      btn.disabled = false;
      btn.textContent = confirmLabel;
    }
  });
  return d;
}

/* ---------- Bar chart ---------- */
// One series of bars (sales per period). Hover or focus a bar to see its value; a hidden
// table gives screen readers the same numbers.
const short = (n) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));

export function barChart(bars, caption, height = 240) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  const dense = bars.length > 14;
  return html`<div class="bars ${dense ? "bars-dense" : ""}" style="height: ${height}px; grid-template-columns: repeat(${bars.length}, minmax(0, 1fr))"
      role="img" aria-label="${caption}. Values are in the table that follows.">
      <div class="bars-grid" aria-hidden="true"><span>${short(max)}</span><span>${short(Math.round(max / 2))}</span><span>0</span></div>
      ${bars.map((b, i) => html`<div class="bar-col" tabindex="0" aria-label="${b.fullLabel}: ${lkr(b.value)}, ${b.orders} orders">
        <div class="bar-track">
          <div class="bar ${b.highlight ? "is-highlight" : ""}" style="height: ${(b.value / max) * 100}%"></div>
          <div class="bar-tip ${i > bars.length * 0.7 ? "tip-left" : i < bars.length * 0.3 ? "tip-right" : ""}" role="tooltip">
            <strong>${lkr(b.value)}</strong>
            <span>${b.orders} ${b.orders === 1 ? "order" : "orders"} · ${b.fullLabel}</span>
          </div>
        </div>
        <span class="bar-label">${dense && i % 5 !== 0 && i !== bars.length - 1 ? "" : b.label}</span>
      </div>`)}
    </div>
    <div class="sr-only"><table><caption>${caption}</caption>
      <thead><tr><th>Period</th><th>Sales</th><th>Orders</th></tr></thead>
      <tbody>${bars.map((b) => html`<tr><td>${b.fullLabel}</td><td>${lkr(b.value)}</td><td>${b.orders}</td></tr>`)}</tbody>
    </table></div>`;
}

/* ---------- Orders (customer view) ---------- */
// Orders are confirmed once the bank transfer is received. (Older cash on delivery
// orders were confirmed by the shop instead.)
export const awaitingPayment = (o) => o.status === "PENDING" && o.paymentMethod !== "COD" && o.paymentStatus !== "PAID";
export const slipSent = (o) => awaitingPayment(o) && !!o.paymentSlipUrl;
export const isConfirmed = (o) => o.status !== "PENDING" && o.status !== "CANCELLED";

export function orderNotice(order) {
  if (order.status === "CANCELLED") return "";
  if (isConfirmed(order)) {
    return html`<div class="notice notice-ok" role="status">${icon("check", 22)}
      <div><strong>Your order is confirmed</strong><p>${order.paymentStatus === "PAID" ? `Payment of ${lkr(order.total)} received. ` : ""}We're getting your pieces ready.</p></div>
    </div>`;
  }
  if (slipSent(order)) {
    return html`<div class="notice notice-info" role="status">${icon("clock", 22)}
      <div>
        <strong>We're checking your payment</strong>
        <p>We received your payment slip${order.paymentSlipAt ? ` on ${dateTime(order.paymentSlipAt)}` : ""}. Your order is confirmed as soon as the transfer reaches our account.</p>
      </div>
    </div>`;
  }
  if (awaitingPayment(order)) {
    return html`<div class="notice notice-warn" role="status">${icon("clock", 22)}
      <div>
        <strong>Waiting for your payment</strong>
        <p>Transfer <strong>${lkr(order.total)}</strong> with <strong>${order.orderNo}</strong> as the reference, then upload the slip. Your order is confirmed as soon as we receive it.</p>
        <a href="/pay/${order.orderNo}" class="btn btn-primary btn-sm" style="margin-top: 10px">${icon("bank", 16)}Pay now</a>
      </div>
    </div>`;
  }
  return html`<div class="notice notice-info" role="status">${icon("phone", 22)}
    <div><strong>We'll call you to confirm</strong><p>We'll contact you on ${order.mobile} to confirm your order. You pay when it arrives.</p></div>
  </div>`;
}

const flowDelivery = ["PENDING", "CONFIRMED", "PROCESSING", "DISPATCHED", "DELIVERED"];
const flowPickup = ["PENDING", "CONFIRMED", "PROCESSING", "READY", "DELIVERED"];

export function orderTimeline(order) {
  const history = order.history ?? [];
  const when = (s) => history.find((h) => h.status === s)?.createdAt;
  const step = (cls, label, at, done) => html`<li class="tl-step ${cls}"${attr("aria-current", cls === "is-current" && "step")}>
    <span class="tl-dot">${done && icon("check", 16)}</span>
    <span class="tl-text"><strong>${label}</strong>${at && html`<span>${dateTime(at)}</span>`}</span>
  </li>`;

  if (order.status === "CANCELLED") {
    return html`<ol class="timeline">${step("is-done", "Order received", when("PENDING"), true)}${step("is-current", "Cancelled", when("CANCELLED"), false)}</ol>`;
  }
  const flow = order.deliveryMethod === "PICKUP" ? flowPickup : flowDelivery;
  // READY can happen on delivery orders too; place the current step at the furthest reached point.
  const currentIndex = Math.max(flow.indexOf(order.status), ...history.map((h) => flow.indexOf(h.status)));
  const labels = order.deliveryMethod === "PICKUP" ? { READY: "Ready to collect", DELIVERED: "Collected" } : {};
  return html`<ol class="timeline">${flow.map((s, i) => {
    const cls = i < currentIndex || (i === currentIndex && s === "DELIVERED") ? "is-done" : i === currentIndex ? "is-current" : "";
    return step(cls, labels[s] ?? customerStatus[s], when(s), cls === "is-done");
  })}</ol>`;
}

export function orderLines(order) {
  return html`<div class="order-lines">${order.items.map((i) => html`<div class="order-line">
      <span class="order-line-img">${productImage(i.product?.images[0]?.url, "")}</span>
      <span>${i.product?.slug ? html`<a href="/product/${i.product.slug}">${i.name}</a>` : i.name} <span class="muted">× ${i.qty}</span>${lineDetail(i)}</span>
      <span class="num">${lkr(i.price * i.qty)}</span>
    </div>`)}</div>
    <div class="order-totals">
      <div class="summary-row"><span>Subtotal</span><span>${lkr(order.subtotal)}</span></div>
      <div class="summary-row"><span>${deliveryLabel[order.deliveryMethod]}</span><span>${order.deliveryFee ? lkr(order.deliveryFee) : "Free"}</span></div>
      ${order.deposit > 0 && html`<div class="summary-row"><span>Refundable deposit${order.depositRefundedAt ? " (refunded)" : ""}</span><span>${lkr(order.deposit)}</span></div>`}
      <div class="summary-row summary-total"><span>Total</span><span>${lkr(order.total)}</span></div>
      <div class="summary-row muted"><span>Payment</span><span>${paymentLabel[order.paymentMethod]}, ${paymentStatusLabel[order.paymentStatus].toLowerCase()}</span></div>
    </div>`;
}

/* ---------- Free delivery progress ---------- */
export function freeDeliveryBar(subtotal, over) {
  if (!over) return "";
  const left = over - subtotal;
  return html`<div class="free-bar">
    <span>${left > 0 ? html`Add <strong>${lkr(left)}</strong> more for free delivery` : html`<strong>You get free delivery</strong>`}</span>
    <span class="free-bar-track"><span class="free-bar-fill" style="width: ${Math.min(100, (subtotal / over) * 100)}%"></span></span>
  </div>`;
}

export { raw };
