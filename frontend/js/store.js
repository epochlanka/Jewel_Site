// Shared state for every page: shop settings (and the theme they set), the signed-in
// user, the cart and the wishlist. Pages and layouts subscribe() to hear about changes.
import { api, auth } from "./api.js";
import { html, setHtml, $$ } from "./html.js";
import { icon } from "./icons.js";
import { navigate, currentPath } from "./router.js";

const defaults = {
  shopName: "[Shop name]", tagline: "Jewellery for every day and every occasion.",
  phone: "", whatsapp: "", email: "", address: "",
  deliveryFee: 450, freeDeliveryOver: null, bankDetails: "",
  codEnabled: true, bankEnabled: true, onlineEnabled: false, pickupEnabled: true,
  themeMode: "system", themeAccent: "emerald",
};

export const state = {
  settings: { ...defaults },
  user: null,
  authLoading: !!auth.token,
  cart: null,
  wishIds: new Set(),
};

const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (what) => listeners.forEach((fn) => fn(what));

export const cartCount = () => state.cart?.items.reduce((s, i) => s + i.qty, 0) ?? 0;
export const displayName = () => state.settings.shopName.replace(/^\[|\]$/g, "") || "Jewellery";

// ---------- Toasts ----------

let toastId = 1;
const toasts = [];

function drawToasts() {
  let box = document.querySelector(".toasts");
  if (!box) {
    box = document.createElement("div");
    box.className = "toasts";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    document.body.append(box);
    box.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-dismiss], .toast-link");
      if (btn) dismiss(Number(btn.closest(".toast").dataset.id));
    });
  }
  setHtml(box, toasts.map((t) => html`
    <div class="toast toast-${t.kind}" data-id="${t.id}">
      ${icon(t.kind === "ok" ? "check" : "alert", 18)}
      <span class="toast-text">${t.text}</span>
      ${t.link && html`<a href="${t.link.to}" class="toast-link">${t.link.label}</a>`}
      <button class="icon-btn icon-btn-sm" aria-label="Dismiss" data-dismiss>${icon("close", 16)}</button>
    </div>`));
}

function dismiss(id) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) { toasts.splice(i, 1); drawToasts(); }
}

export function toast(text, opts = {}) {
  const t = { id: toastId++, text, kind: opts.kind ?? "ok", link: opts.link };
  toasts.push(t);
  while (toasts.length > 3) toasts.shift();
  drawToasts();
  setTimeout(() => dismiss(t.id), t.kind === "error" ? 6000 : 3500);
}

export const toastError = (e) => toast(e.message, { kind: "error" });

// ---------- Settings and theme ----------

const accents = {
  emerald: { light: ["#0e5a45", "#0a4636", "#dcebe4", "#5e8f7f", "#ffffff"], dark: ["#4fbf97", "#6fd0ad", "#173a2f", "#3e7f6a", "#06130e"] },
  gold: { light: ["#8a5c12", "#68430b", "#f3e8cf", "#a8874a", "#ffffff"], dark: ["#e5b85c", "#f1cc7e", "#3b2e17", "#a8874a", "#211707"] },
  rose: { light: ["#a33f58", "#812b42", "#f5e0e6", "#b56f82", "#ffffff"], dark: ["#f07e97", "#ff9aae", "#3e2029", "#b56f82", "#260b12"] },
  blue: { light: ["#315f9c", "#244775", "#e0e9f5", "#6f8eb8", "#ffffff"], dark: ["#82aef0", "#a4c4f6", "#1d2e47", "#6f8eb8", "#09162a"] },
};

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function applyTheme() {
  const s = state.settings;
  const root = document.documentElement;
  if (s.themeMode === "system") delete root.dataset.theme;
  else root.dataset.theme = s.themeMode;
  const palette = accents[s.themeAccent] ?? accents.emerald;
  for (const mode of ["light", "dark"]) {
    const [accent, accent2, soft, muted, onAccent] = palette[mode];
    root.style.setProperty(`--accent-${mode}`, accent);
    root.style.setProperty(`--accent-2-${mode}`, accent2);
    root.style.setProperty(`--accent-soft-${mode}`, soft);
    root.style.setProperty(`--accent-muted-${mode}`, muted);
    root.style.setProperty(`--on-accent-${mode}`, onAccent);
  }
  const mode = s.themeMode === "system" ? (darkQuery.matches ? "dark" : "light") : s.themeMode;
  root.style.colorScheme = mode;
  for (const v of ["accent", "accent-2", "accent-soft", "accent-muted", "on-accent"]) root.style.setProperty(`--${v}`, `var(--${v}-${mode})`);
}
darkQuery.addEventListener("change", applyTheme);

export async function reloadSettings() {
  const data = await api.settings();
  // Keep defaults for anything the server doesn't send.
  if (data && typeof data === "object" && !Array.isArray(data)) state.settings = { ...defaults, ...data };
  applyTheme();
  emit("settings");
}

// ---------- Cart ----------

export async function refreshCart() {
  state.cart = await api.cart();
  emit("cart");
}

export async function addToCart(items, message) {
  try {
    state.cart = await api.addToCart(items);
    emit("cart");
    toast(message ?? "Added to cart", { link: { to: "/cart", label: "View cart" } });
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

export async function setCartQty(productId, qty) {
  try { state.cart = await api.setQty(productId, qty); emit("cart"); } catch (e) { toastError(e); }
}

export async function removeFromCart(productId) {
  try { state.cart = await api.removeItem(productId); emit("cart"); toast("Removed from cart"); } catch (e) { toastError(e); }
}

// ---------- Account ----------

let resolveAuth;
export const authReady = new Promise((r) => { resolveAuth = r; });

async function loadWishlist() {
  if (state.user?.role !== "CUSTOMER") { state.wishIds = new Set(); syncWishButtons(); emit("wishlist"); return; }
  try { state.wishIds = new Set(await api.wishlistIds()); } catch { /* keep the old list */ }
  syncWishButtons();
  emit("wishlist");
}

async function signIn(token, user) {
  auth.set(token);
  state.user = user;
  if (user.role === "CUSTOMER") await api.mergeCart().catch(() => undefined);
  await refreshCart().catch(() => undefined);
  emit("user");
  loadWishlist();
  return user;
}

export async function login(email, password) {
  const r = await api.login(email, password);
  return signIn(r.token, r.user);
}

export async function register(body) {
  const r = await api.register(body);
  return signIn(r.token, r.user);
}

export function logout() {
  auth.set(null);
  state.user = null;
  emit("user");
  loadWishlist();
  refreshCart().catch(() => undefined);
}

export function setUser(u) {
  state.user = u;
  emit("user");
}

// ---------- Wishlist ----------

export async function toggleWish(id, name) {
  if (!state.user) {
    toast("Sign in to save pieces to your wishlist");
    navigate("/login", { state: { from: currentPath() } });
    return;
  }
  const before = new Set(state.wishIds);
  const had = before.has(id);
  had ? state.wishIds.delete(id) : state.wishIds.add(id);
  syncWishButtons();
  emit("wishlist");
  try {
    had ? await api.removeWish(id) : await api.addWish(id);
    toast(had ? "Removed from wishlist" : `${name ?? "Saved"} added to your wishlist`, had ? {} : { link: { to: "/account/wishlist", label: "View" } });
  } catch (e) {
    state.wishIds = before;
    syncWishButtons();
    emit("wishlist");
    toastError(e);
  }
}

// Heart buttons on product cards follow the wishlist wherever they are on the page.
export function syncWishButtons(root = document) {
  for (const btn of $$("[data-wish]", root)) {
    const saved = state.wishIds.has(btn.dataset.wish);
    btn.classList.toggle("is-on", saved);
    btn.setAttribute("aria-pressed", String(saved));
    btn.setAttribute("aria-label", `${saved ? "Remove" : "Save"} ${btn.dataset.name} ${saved ? "from" : "to"} wishlist`);
    setHtml(btn, icon("heart", 20, saved));
  }
}

// ---------- Start-up ----------

export async function initStore() {
  reloadSettings().catch(() => applyTheme());
  refreshCart().catch(() => undefined);
  if (auth.token) {
    try { state.user = await api.me(); } catch { auth.set(null); }
  }
  state.authLoading = false;
  resolveAuth();
  emit("user");
  loadWishlist();
}
