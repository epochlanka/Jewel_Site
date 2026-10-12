// The payment step after checkout, laid out like Daraz: payment methods on the left,
// the chosen method's details below them, and the order summary on the right.
import { html, attr, setHtml, on, $ } from "../html.js";
import { icon } from "../icons.js";
import { api, ApiError } from "../api.js";
import { dateTime, lkr } from "../format.js";
import { state, subscribe, rememberedMobile, rememberOrder, toast } from "../store.js";
import { awaitingPayment, lineDetail, pageLoading, productImage, slipSent } from "../ui.js";

const MAX_MB = 8;
const slipTypes = /^(image\/(jpeg|png|webp)|application\/pdf)$/;

export default async function pay(view, ctx) {
  const orderNo = ctx.params.orderNo;
  let order = ctx.state?.order ?? null;
  let mobile = order?.mobile ?? rememberedMobile(orderNo);
  let file = null, preview = null, replacing = false, busy = false, err = "";
  ctx.onCleanup(() => preview && URL.revokeObjectURL(preview));

  const copyRow = (label, value, display = value) => html`<div class="pay-bank-row">
    <dt>${label}</dt>
    <dd><span>${display}</span>${value && html`<button type="button" class="icon-btn icon-btn-sm pay-copy" data-copy="${value}" aria-label="Copy ${label.toLowerCase()}">${icon("copy", 16)}</button>`}</dd>
  </div>`;

  const bankPanel = () => {
    const s = state.settings;
    const hasAccount = s.accountNumber.trim() !== "";
    return html`
      <ol class="pay-steps">
        <li><span class="pay-step-num">1</span><span>Transfer <strong>${lkr(order.total)}</strong> to the account below from any bank, ATM or banking app.</span></li>
        <li><span class="pay-step-num">2</span><span>Use <strong>${order.orderNo}</strong> as the reference or remark so we can match your payment.</span></li>
        <li><span class="pay-step-num">3</span><span>Upload a photo or PDF of the slip below. We confirm your order as soon as the money reaches us.</span></li>
      </ol>
      ${hasAccount ? html`<dl class="pay-bank">
          ${s.bankName && copyRow("Bank", "", s.bankName)}
          ${s.bankBranch && copyRow("Branch", "", s.bankBranch)}
          ${s.accountName && copyRow("Account name", s.accountName)}
          ${copyRow("Account number", s.accountNumber.replace(/\s/g, ""), s.accountNumber)}
          ${copyRow("Amount", String(order.total), lkr(order.total))}
          ${copyRow("Reference", order.orderNo)}
        </dl>`
        : html`<div class="notice notice-info">${icon("chat", 22)}<div><strong>Bank details on WhatsApp</strong><p>We'll send you our bank details on WhatsApp${s.whatsapp ? ` from ${s.whatsapp}` : ""}. You can also contact us any time.</p></div></div>`}
      ${s.bankDetails && html`<p class="pay-extra">${s.bankDetails}</p>`}`;
  };

  const slipForm = () => html`<form class="pay-slip" data-slip>
    <h3>Upload your payment slip</h3>
    ${file ? html`<div class="pay-file">
        ${preview ? html`<img src="${preview}" alt="Your payment slip">` : html`<span class="pay-file-icon">${icon("orders", 28)}</span>`}
        <span class="pay-file-name"><strong>${file.name}</strong><span class="muted">${file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`}</span></span>
        <button type="button" class="btn btn-quiet btn-sm" data-act="clear-file">Change</button>
      </div>`
      : html`<label class="dropzone pay-drop" data-dropzone>
        <span class="dropzone-icon">${icon("upload", 26)}</span>
        <strong>Choose the slip or drop it here</strong>
        <span>A photo or screenshot (JPG, PNG, WebP) or a PDF, up to ${MAX_MB} MB.</span>
        <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" class="sr-only" data-file>
      </label>`}
    <label class="field"><span class="field-label">Transaction or reference number <span class="optional">(optional)</span></span>
      <input name="reference" maxlength="60" placeholder="From your bank's receipt"></label>
    ${err && html`<p class="form-error" role="alert">${err}</p>`}
    <button class="btn btn-primary btn-lg btn-block"${attr("disabled", busy || !file)}>${busy ? "Uploading…" : "Submit payment slip"}</button>
  </form>`;

  const panel = () => {
    if (!awaitingPayment(order)) {
      return html`<div class="pay-done">
        <span class="confirm-icon">${icon("check", 32)}</span>
        <h2>${order.status === "CANCELLED" ? "This order was cancelled" : "This order is paid"}</h2>
        <p class="muted">${order.status === "CANCELLED" ? "Contact us if you have any questions about it." : "We've received your payment. You can follow your order on the tracking page."}</p>
        <a href="/track?orderNo=${encodeURIComponent(order.orderNo)}&mobile=${encodeURIComponent(order.mobile)}" class="btn btn-primary">Track order</a>
      </div>`;
    }
    if (slipSent(order) && !replacing) {
      const isPdf = /\.pdf$/i.test(order.paymentSlipUrl);
      return html`<div class="pay-done">
        <span class="confirm-icon is-waiting">${icon("clock", 32)}</span>
        <h2>We're checking your payment</h2>
        <p class="muted">We received your slip${order.paymentSlipAt ? ` on ${dateTime(order.paymentSlipAt)}` : ""}. Your order is confirmed as soon as the transfer reaches our account, and we'll message you on ${order.mobile}.</p>
        <a href="${order.paymentSlipUrl}" target="_blank" rel="noreferrer" class="pay-slip-thumb">${isPdf ? html`${icon("orders", 22)}View your slip (PDF)` : html`<img src="${order.paymentSlipUrl}" alt="Your payment slip">`}</a>
        <div class="card-actions">
          <a href="/order/${order.orderNo}" class="btn btn-primary">View order</a>
          <button class="btn btn-quiet" data-act="replace">Upload a different slip</button>
        </div>
      </div>`;
    }
    return html`${bankPanel()}${slipForm()}`;
  };

  const draw = () => {
    const count = order.items.reduce((s, i) => s + i.qty, 0);
    setHtml(view, html`<div class="page">
      <div class="page-head"><h1>Select payment method</h1><p>Order ${order.orderNo} · placed ${dateTime(order.createdAt)}</p></div>
      <div class="pay">
        <div class="pay-main">
          <div class="pay-methods" role="radiogroup" aria-label="Payment method">
            <button class="pay-method is-selected" role="radio" aria-checked="true">
              <span class="pay-method-icon">${icon("bank", 26)}</span>
              <span class="pay-method-text"><strong>Bank transfer</strong><span>Pay from any Sri Lankan bank or app</span></span>
              <span class="pay-method-check">${icon("check", 14)}</span>
            </button>
          </div>
          <section class="pay-panel" aria-label="Bank transfer">${panel()}</section>
        </div>

        <aside class="summary" aria-label="Order summary">
          <h2>Order summary</h2>
          <div class="summary-items">${order.items.map((i) => html`<div class="summary-item">
            <span class="summary-item-img">${productImage(i.product?.images[0]?.url, "")}<span class="summary-item-qty" aria-label="Quantity ${i.qty}">${i.qty}</span></span>
            <span>${i.name}${lineDetail(i)}</span>
            <span class="num">${lkr(i.price * i.qty)}</span>
          </div>`)}</div>
          <div class="summary-row"><span>Subtotal (${count} ${count === 1 ? "item" : "items"})</span><span>${lkr(order.subtotal)}</span></div>
          <div class="summary-row"><span>${order.deliveryMethod === "PICKUP" ? "Store pickup" : "Delivery fee"}</span><span>${order.deliveryFee ? lkr(order.deliveryFee) : "Free"}</span></div>
          ${order.deposit > 0 && html`<div class="summary-row"><span>Refundable deposit</span><span>${lkr(order.deposit)}</span></div>`}
          <div class="summary-row summary-total"><span>Total amount</span><span>${lkr(order.total)}</span></div>
          <p class="summary-note">${icon("lock", 14)} Your order is held for you while we wait for the payment.</p>
        </aside>
      </div>
    </div>`);
  };

  const askMobile = (message = "") => setHtml(view, html`<div class="page page-narrow">
    <div class="page-head"><h1>Pay for order ${orderNo}</h1><p>Enter the mobile number you used at checkout to open this order.</p></div>
    <form class="card form" data-find>
      <label class="field"><span class="field-label">Mobile number</span><input name="mobile" type="tel" required placeholder="07XXXXXXXX" inputmode="tel" value="${mobile ?? ""}"></label>
      ${message && html`<p class="form-error" role="alert">${message}</p>`}
      <button class="btn btn-primary btn-block">Continue</button>
    </form>
  </div>`);

  const pickFile = (f) => {
    err = "";
    if (f && !slipTypes.test(f.type)) err = "Upload the slip as a JPG, PNG, WebP or PDF file.";
    else if (f && f.size > MAX_MB * 1024 * 1024) err = `That file is over ${MAX_MB} MB. Choose a smaller one.`;
    else if (f) {
      if (preview) URL.revokeObjectURL(preview);
      file = f;
      preview = f.type.startsWith("image/") ? URL.createObjectURL(f) : null;
    }
    draw();
  };

  const load = async () => {
    try {
      order = mobile ? await api.trackOrder(orderNo, mobile) : (await api.myOrders()).find((o) => o.orderNo === orderNo);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) return askMobile(e.message);
      order = null;
    }
    if (!ctx.alive()) return;
    if (!order) return askMobile();
    mobile = order.mobile;
    rememberOrder(order);
    draw();
  };

  on(view, "submit", "[data-find]", (e, form) => {
    e.preventDefault();
    mobile = String(new FormData(form).get("mobile")).trim();
    setHtml(view, pageLoading());
    load();
  });
  on(view, "change", "[data-file]", (e, el) => pickFile(el.files?.[0]));
  on(view, "dragover", "[data-dropzone]", (e, el) => { e.preventDefault(); el.classList.add("is-over"); });
  on(view, "dragleave", "[data-dropzone]", (e, el) => el.classList.remove("is-over"));
  on(view, "drop", "[data-dropzone]", (e) => { e.preventDefault(); pickFile(e.dataTransfer.files[0]); });
  on(view, "click", "[data-act=clear-file]", () => { if (preview) URL.revokeObjectURL(preview); file = null; preview = null; draw(); });
  on(view, "click", "[data-act=replace]", () => { replacing = true; draw(); });
  on(view, "click", "[data-copy]", async (e, el) => {
    try { await navigator.clipboard.writeText(el.dataset.copy); toast("Copied"); } catch { /* clipboard blocked */ }
  });
  on(view, "submit", "[data-slip]", async (e, form) => {
    e.preventDefault();
    if (!file || busy) return;
    const fd = new FormData();
    fd.append("mobile", order.mobile);
    fd.append("reference", String(new FormData(form).get("reference") || ""));
    fd.append("slip", file);
    busy = true; err = ""; draw();
    try {
      order = await api.uploadSlip(order.orderNo, fd);
      file = null; replacing = false;
      toast("Payment slip received");
    } catch (ex) { err = ex.message; }
    busy = false;
    if (ctx.alive()) draw();
  });
  ctx.onCleanup(subscribe((what) => { if (what === "settings" && order && !file) draw(); }));

  if (order) draw();
  else { setHtml(view, pageLoading()); load(); }
}

