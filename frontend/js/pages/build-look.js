import { html, attr, setHtml, on } from "../html.js";
import { icon } from "../icons.js";
import { api } from "../api.js";
import { lkr } from "../format.js";
import { addToCart } from "../store.js";
import { emptyState, pageLoading, price, productImage } from "../ui.js";
import { navigate } from "../router.js";

const steps = [
  { title: "Choose earrings", short: "Earrings", types: ["EARRINGS"] },
  { title: "Choose a necklace or chain", short: "Necklace", types: ["NECKLACE", "CHAIN", "LONG_CHAIN"] },
  { title: "Choose bangles or a bracelet", short: "Bangles", types: ["BANGLE", "BRACELET"] },
];

export default function buildLook(view, ctx) {
  let step = 0, options = null;
  const picked = [];
  const chosen = () => picked.filter(Boolean);
  const total = () => chosen().reduce((s, p) => s + (p.salePrice ?? p.price), 0);

  const tray = () => html`<aside class="look-tray" aria-label="Your look">
    <h2>Your look</h2>
    ${steps.map((s, i) => {
      const p = picked[i];
      return html`<div class="tray-slot ${p ? "" : "tray-slot-empty"}">
        <span class="tray-slot-img">${p ? productImage(p.images[0]?.url, "", { type: p.jewelleryType, iconSize: 28 }) : icon("plus", 20)}</span>
        <span class="tray-slot-text">${p ? html`<strong>${p.name}</strong><span class="muted">${lkr(p.salePrice ?? p.price)}</span>` : html`<span class="muted">${s.short}: not chosen</span>`}</span>
      </div>`;
    })}
    <div class="tray-total"><span>Total</span><span class="num">${lkr(total())}</span></div>
  </aside>`;

  const draw = () => {
    if (step >= steps.length) {
      const list = chosen();
      return setHtml(view, html`<div class="page">
        <div class="page-head"><h1>Your look</h1><p>Preview the full set with AI, or add it straight to your cart.</p></div>
        <div class="look">
          ${list.length ? html`<div class="stack">
            <div class="look-options">${list.map((p) => html`<div class="look-option" style="cursor: default">
              <span class="look-option-img">${productImage(p.images[0]?.url, "", { type: p.jewelleryType })}</span>
              <a href="/product/${p.slug}" class="look-option-name">${p.name}</a>
              ${price(p.price, p)}
            </div>`)}</div>
            <div class="look-nav">
              <button class="btn btn-quiet" data-goto="0">${icon("edit", 18)}Change pieces</button>
              <div style="display: flex; gap: 12px; flex-wrap: wrap">
                <a href="/try-on?products=${list.map((p) => p.id).join(",")}" class="btn btn-secondary">${icon("sparkle", 18)}Preview with AI</a>
                <button class="btn btn-primary" data-act="add-all">Add all to cart · ${lkr(total())}</button>
              </div>
            </div>
          </div>`
          : emptyState({ icon: "sparkle", title: "You haven't picked anything yet", text: "Go back and choose at least one piece.", action: html`<button class="btn btn-primary" data-goto="0">Start again</button>` })}
          ${tray()}
        </div>
      </div>`);
    }

    setHtml(view, html`<div class="page">
      <div class="page-head"><h1>Create your look</h1><p>Choose a piece at each step, or skip any you don't need.</p></div>
      <ol class="stepper" aria-label="Steps">${[...steps.map((s) => s.short), "Review"].map((label, i) => html`
        <li class="${step === i ? "is-current" : step > i ? "is-done" : ""}"${attr("aria-current", step === i && "step")}><span class="step-dot">${step > i ? icon("check", 14) : i + 1}</span>${label}</li>`)}
      </ol>
      <div class="look">
        <div>
          <h2 style="font-size: 28px; margin-bottom: 20px">${steps[step].title}</h2>
          ${!options ? pageLoading()
            : !options.length ? html`<p class="empty-note" style="text-align: left">No pieces available for this step right now. Skip to the next one.</p>`
            : html`<div class="look-options">${options.map((p) => html`
              <button class="look-option" aria-pressed="${String(picked[step]?.id === p.id)}" data-pick="${p.id}">
                <span class="look-option-img">${productImage(p.images[0]?.url, "", { type: p.jewelleryType })}</span>
                <span class="look-option-name">${p.name}</span>
                ${price(p.price, p)}
                <span class="look-option-check" aria-hidden="true">${icon("check", 16)}</span>
              </button>`)}</div>`}
          <div class="look-nav">
            ${step > 0 ? html`<button class="btn btn-quiet" data-goto="${step - 1}">${icon("arrowLeft", 18)}Back</button>` : html`<span></span>`}
            <button class="btn btn-primary" data-goto="${step + 1}">${picked[step] ? (step === steps.length - 1 ? "Review your look" : "Next") : "Skip this step"}${icon("chevronRight", 18)}</button>
          </div>
        </div>
        ${tray()}
      </div>
    </div>`);
  };

  const goto = (n) => {
    step = n;
    window.scrollTo(0, 0);
    if (step >= steps.length) return draw();
    options = null;
    draw();
    const at = step;
    Promise.all(steps[step].types.map((type) => api.products({ type, inStock: 1, tryOn: 1, limit: 24 })))
      .then((rs) => rs.flatMap((r) => r.items)).catch(() => [])
      .then((list) => { if (at === step && ctx.alive()) { options = list; draw(); } });
  };

  on(view, "click", "[data-goto]", (e, el) => goto(Number(el.dataset.goto)));
  on(view, "click", "[data-pick]", (e, el) => {
    const p = options.find((x) => x.id === el.dataset.pick);
    picked[step] = picked[step]?.id === p.id ? undefined : p;
    draw();
  });
  on(view, "click", "[data-act=add-all]", async () => {
    if (await addToCart(chosen().map((p) => ({ productId: p.id, qty: 1 })), "Your look was added to the cart")) navigate("/cart");
  });
  goto(0);
}
