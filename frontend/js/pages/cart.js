import { html, attr, setHtml, on } from "../html.js";
import { icon } from "../icons.js";
import { lkr } from "../format.js";
import { state, subscribe, setCartQty, removeFromCart } from "../store.js";
import { emptyState, freeDeliveryBar, pageLoading, price, productImage, qtyStepper } from "../ui.js";

export default function cartPage(view, ctx) {
  const draw = () => {
    const cart = state.cart;
    if (!cart) return setHtml(view, pageLoading());
    if (!cart.items.length) {
      return setHtml(view, html`<div class="page">${emptyState({
        icon: "bag", title: "Your cart is empty", text: "Pieces you add will show here.",
        action: html`<a href="/shop" class="btn btn-primary">Browse jewellery</a>`,
      })}</div>`);
    }
    const blocked = cart.items.some((i) => !i.inStock);
    const count = cart.items.reduce((s, i) => s + i.qty, 0);

    setHtml(view, html`<div class="page">
      <div class="page-head"><h1>Your cart</h1><p>${count} ${count === 1 ? "piece" : "pieces"}</p></div>
      <div class="cart">
        <div class="cart-lines">${cart.items.map((i) => html`
          <div class="cart-line">
            <a href="/product/${i.product.slug}" class="cart-line-img" tabindex="-1" aria-hidden="true">${productImage(i.product.images[0]?.url, "", { type: i.product.jewelleryType })}</a>
            <div class="cart-line-info">
              <a href="/product/${i.product.slug}" class="cart-line-name">${i.product.name}</a>
              ${price(i.product.price, i.product)}
              ${!i.inStock && html`<span class="cart-line-warn">${i.product.stock ? `Only ${i.product.stock} left. Lower the quantity to continue.` : "Sold out. Remove it to continue."}</span>`}
              <div class="cart-line-controls">
                ${qtyStepper(i.qty, Math.max(1, Math.min(i.product.stock, 20)), { label: `Quantity of ${i.product.name}`, key: `${i.productId}:${i.qty}` })}
                <button class="btn-link" data-remove="${i.productId}" style="font-size: 14px">Remove</button>
              </div>
            </div>
            <span class="cart-line-total">${lkr(i.lineTotal)}</span>
          </div>`)}
        </div>

        <aside class="summary" aria-label="Order summary">
          <h2>Summary</h2>
          <div class="summary-row"><span>Subtotal</span><span>${lkr(cart.subtotal)}</span></div>
          <div class="summary-row"><span>Delivery</span><span>${cart.deliveryFee ? lkr(cart.deliveryFee) : "Free"}</span></div>
          ${freeDeliveryBar(cart.subtotal, cart.freeDeliveryOver)}
          <div class="summary-row summary-total"><span>Total</span><span>${lkr(cart.total)}</span></div>
          <p class="summary-note">Store pickup is free. You'll choose at checkout.</p>
          ${blocked
            ? html`<button class="btn btn-primary btn-lg btn-block"${attr("disabled", true)}>Checkout</button>`
            : html`<a href="/checkout" class="btn btn-primary btn-lg btn-block">${icon("lock", 18)}Checkout</a>`}
          <a href="/shop" class="btn btn-quiet btn-block">Continue shopping</a>
        </aside>
      </div>
    </div>`);
  };

  on(view, "click", "[data-step]", (e, el) => {
    const [id, qty] = el.dataset.key.split(":");
    el.disabled = true;
    setCartQty(id, Number(qty) + Number(el.dataset.step));
  });
  on(view, "click", "[data-remove]", (e, el) => removeFromCart(el.dataset.remove));
  ctx.onCleanup(subscribe((what) => { if (what === "cart") draw(); }));
  draw();
}
