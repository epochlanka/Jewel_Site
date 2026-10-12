import { html, attr, setHtml, on, $ } from "../html.js";
import { icon } from "../icons.js";
import { api, ApiError } from "../api.js";
import { lkr, paymentLabel } from "../format.js";
import { state, subscribe, refreshCart } from "../store.js";
import { freeDeliveryBar, pageLoading, productImage } from "../ui.js";
import { navigate } from "../router.js";

const paymentInfo = {
  COD: { icon: "cash", note: "Pay in cash when your order arrives." },
  BANK_TRANSFER: { icon: "bank", note: "Transfer the total and send us the slip on WhatsApp." },
  ONLINE: { icon: "card", note: "Pay securely by card." },
};

export default function checkout(view, ctx) {
  let delivery = "DELIVERY", payment = "", busy = false, drawn = false;

  const methods = () => ["COD", "BANK_TRANSFER", "ONLINE"].filter((m) => ({ COD: state.settings.codEnabled, BANK_TRANSFER: state.settings.bankEnabled, ONLINE: state.settings.onlineEnabled })[m]);

  // The form is drawn once so typed details are kept; the summary and the
  // method-dependent parts are redrawn in place.
  const draw = () => {
    const cart = state.cart;
    if (!cart) return setHtml(view, pageLoading());
    if (!cart.items.length && !busy) return navigate("/cart", { replace: true });
    if (!payment || !methods().includes(payment)) payment = methods()[0] ?? "";
    if (drawn) return drawParts();
    drawn = true;
    const u = state.user;

    setHtml(view, html`<div class="page">
      <div class="page-head"><h1>Checkout</h1><p>${u ? `Signed in as ${u.email}` : html`Checking out as a guest. <a href="/login" data-from="/checkout">Sign in</a> to track orders in your account.`}</p></div>
      <form class="cart" data-checkout>
        <div class="checkout-sections">
          <p class="form-error" role="alert" data-error hidden></p>

          <section class="checkout-section" aria-labelledby="co-details">
            <h2 id="co-details"><span class="checkout-num">1</span>Your details</h2>
            <div class="form-grid">
              <label class="field span-2"><span class="field-label">Full name</span><input name="fullName" required minlength="2" autocomplete="name" value="${u?.name ?? ""}"></label>
              <label class="field"><span class="field-label">Mobile number</span><input name="mobile" type="tel" required pattern="0\\d{9}" placeholder="07XXXXXXXX" autocomplete="tel" inputmode="tel" value="${u?.phone ?? ""}"><span class="field-hint">We'll call or message about your order</span></label>
              <label class="field"><span class="field-label">WhatsApp number <span class="optional">(optional)</span></span><input name="whatsapp" type="tel" placeholder="If different from mobile" inputmode="tel"></label>
              <label class="field span-2"><span class="field-label">Email <span class="optional">(optional)</span></span><input name="email" type="email" autocomplete="email" value="${u?.email ?? ""}"></label>
            </div>
          </section>

          <section class="checkout-section" aria-labelledby="co-delivery">
            <h2 id="co-delivery"><span class="checkout-num">2</span>Delivery</h2>
            <fieldset class="fieldset"><legend class="sr-only">Delivery method</legend><div class="choices choices-2" data-delivery-choices></div></fieldset>
            <div class="form-grid" data-address>
              <label class="field span-2"><span class="field-label">Address</span><textarea name="address" required rows="2" autocomplete="street-address"></textarea></label>
              <label class="field"><span class="field-label">City</span><input name="city" required autocomplete="address-level2"></label>
              <label class="field"><span class="field-label">Postal code <span class="optional">(optional)</span></span><input name="postalCode" autocomplete="postal-code" inputmode="numeric"></label>
            </div>
            <label class="field"><span class="field-label">Order note <span class="optional">(optional)</span></span><textarea name="note" rows="2" placeholder="Gift wrapping, a delivery time, anything we should know"></textarea></label>
          </section>

          <section class="checkout-section" aria-labelledby="co-payment">
            <h2 id="co-payment"><span class="checkout-num">3</span>Payment</h2>
            <div data-payment></div>
          </section>
        </div>

        <aside class="summary" aria-label="Order summary" data-summary></aside>
      </form>
    </div>`);
    drawParts();
  };

  const drawParts = () => {
    const cart = state.cart, s = state.settings, list = methods();
    const fee = delivery === "DELIVERY" ? cart.deliveryFee : 0;
    const total = cart.subtotal + fee;

    setHtml($("[data-delivery-choices]", view), html`
      <label class="choice">
        <input type="radio" name="deliveryMethod" value="DELIVERY"${attr("checked", delivery === "DELIVERY")}>
        <span class="choice-dot" aria-hidden="true"></span>
        <span class="choice-body"><span class="choice-title">${icon("truck", 18)}Deliver to me</span><span class="choice-note">${cart.deliveryFee ? lkr(cart.deliveryFee) : "Free"} · islandwide</span></span>
      </label>
      ${s.pickupEnabled && html`<label class="choice">
        <input type="radio" name="deliveryMethod" value="PICKUP"${attr("checked", delivery === "PICKUP")}>
        <span class="choice-dot" aria-hidden="true"></span>
        <span class="choice-body"><span class="choice-title">${icon("store", 18)}Store pickup</span><span class="choice-note">Free${s.address ? ` · ${s.address}` : ""}</span></span>
      </label>`}`);

    // Address fields only count when the order is delivered.
    const address = $("[data-address]", view);
    address.hidden = delivery !== "DELIVERY";
    address.querySelectorAll("input, textarea").forEach((el) => { el.disabled = delivery !== "DELIVERY"; });

    setHtml($("[data-payment]", view), list.length ? html`
      <fieldset class="fieldset"><legend class="sr-only">Payment method</legend><div class="choices">
        ${list.map((m) => html`<label class="choice">
          <input type="radio" name="paymentMethod" value="${m}" required${attr("checked", payment === m)}>
          <span class="choice-dot" aria-hidden="true"></span>
          <span class="choice-body"><span class="choice-title">${icon(paymentInfo[m].icon, 18)}${paymentLabel[m]}</span><span class="choice-note">${paymentInfo[m].note}</span></span>
        </label>`)}
      </div></fieldset>
      ${payment === "BANK_TRANSFER" && s.bankDetails && html`<div class="bank-box"><strong>Bank details</strong>\n${s.bankDetails}</div>`}`
      : html`<p class="form-error">No payment methods are available right now. Contact the shop to order.</p>`);

    setHtml($("[data-summary]", view), html`
      <h2>Your order</h2>
      <div class="summary-items">${cart.items.map((i) => html`<div class="summary-item">
        <span class="summary-item-img">${productImage(i.product.images[0]?.url, "", { type: i.product.jewelleryType })}<span class="summary-item-qty" aria-label="Quantity ${i.qty}">${i.qty}</span></span>
        <span>${i.product.name}</span>
        <span class="num">${lkr(i.lineTotal)}</span>
      </div>`)}</div>
      <div class="summary-row"><span>Subtotal</span><span>${lkr(cart.subtotal)}</span></div>
      <div class="summary-row"><span>Delivery</span><span>${fee ? lkr(fee) : "Free"}</span></div>
      ${delivery === "DELIVERY" && freeDeliveryBar(cart.subtotal, cart.freeDeliveryOver)}
      <div class="summary-row summary-total"><span>Total</span><span>${lkr(total)}</span></div>
      <button class="btn btn-primary btn-lg btn-block"${attr("disabled", busy || !list.length)}>${busy ? "Placing order…" : `Place order · ${lkr(total)}`}</button>
      <p class="summary-note">We'll confirm your order by phone or WhatsApp before it's sent.</p>`);
  };

  on(view, "change", "[name=deliveryMethod]", (e, el) => { delivery = el.value; drawParts(); });
  on(view, "change", "[name=paymentMethod]", (e, el) => { payment = el.value; drawParts(); });
  on(view, "submit", "[data-checkout]", async (e, form) => {
    e.preventDefault();
    const errBox = $("[data-error]", view);
    errBox.hidden = true;
    form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
    const body = Object.fromEntries(new FormData(form));
    busy = true; drawParts();
    try {
      const order = await api.placeOrder(body);
      await refreshCart();
      navigate(`/order/${order.orderNo}`, { state: { order }, replace: true });
    } catch (err) {
      busy = false; drawParts();
      errBox.textContent = err.message;
      errBox.hidden = false;
      const field = err instanceof ApiError && err.field && form.querySelector(`[name="${err.field}"]`);
      if (field) { field.setAttribute("aria-invalid", "true"); field.focus(); }
      else window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });

  ctx.onCleanup(subscribe((what) => { if ((what === "cart" || what === "settings") && !busy) draw(); }));
  draw();
}
