import { on } from "./html.js";
import { initStore, authReady, state, subscribe, displayName, addToCart, toggleWish } from "./store.js";
import { startRouter } from "./router.js";
import { siteLayout, bareLayout, adminLayout } from "./layouts.js";
import { togglePassword, watchBrokenImages } from "./ui.js";

// Controls that appear on many pages are handled once, here.
on(document, "click", "[data-add-to-cart]", async (e, btn) => {
  btn.disabled = true;
  await addToCart([{ productId: btn.dataset.addToCart, qty: 1 }], `${btn.dataset.name} added to cart`);
  btn.disabled = false;
});
on(document, "click", "[data-wish]", (e, btn) => toggleWish(btn.dataset.wish, btn.dataset.name));
on(document, "click", "[data-toggle-password]", (e, btn) => togglePassword(btn));
watchBrokenImages();

// On phones, tables are shown as cards; each cell gets its column name as a label.
let labelling = false;
new MutationObserver(() => {
  if (labelling) return;
  labelling = true;
  requestAnimationFrame(() => {
    for (const t of document.querySelectorAll("table.table")) {
      const heads = [...t.querySelectorAll("thead th")].map((th) => th.textContent.trim());
      for (const tr of t.querySelectorAll("tbody tr")) [...tr.children].forEach((td, i) => { if (heads[i] && !td.dataset.label) td.dataset.label = heads[i]; });
    }
    labelling = false;
  });
}).observe(document.body, { childList: true, subtree: true });

subscribe((what) => { if (what === "settings") document.title = displayName(); });

initStore();
startRouter({
  layouts: { site: siteLayout, bare: bareLayout, admin: adminLayout },
  authReady,
  getUser: () => state.user,
});
