// A small client-side router. The server answers every page path with index.html;
// this module picks the page for the address, puts it in the right layout and keeps
// links working without full reloads.
import { setHtml } from "./html.js";

// [path pattern, page module, layout, guard]
const table = [
  ["/", "home", "site"],
  ["/shop", "shop", "site"],
  ["/shop/:category", "shop", "site"],
  ["/product/:slug", "product", "site"],
  ["/cart", "cart", "site"],
  ["/checkout", "checkout", "site"],
  ["/order/:orderNo", "order-confirmation", "site"],
  ["/pay/:orderNo", "pay", "site"],
  ["/track", "track", "site"],
  ["/about", "info", "site"],
  ["/contact", "info", "site"],
  ["/delivery", "info", "site"],
  ["/faq", "info", "site"],
  ["/privacy", "info", "site"],
  ["/terms", "info", "site"],
  ["/account", "account", "site", "user"],
  ["/account/:tab", "account", "site", "user"],
  ["/login", "login", "bare"],
  ["/register", "register", "bare"],
  ["/admin/login", "admin/login", "bare"],
  ["/admin", "admin/dashboard", "admin", "admin"],
  ["/admin/orders", "admin/orders", "admin", "admin"],
  ["/admin/orders/:id", "admin/order-detail", "admin", "admin"],
  ["/admin/products", "admin/products", "admin", "admin"],
  ["/admin/products/new", "admin/product-form", "admin", "admin"],
  ["/admin/products/:id", "admin/product-form", "admin", "admin"],
  ["/admin/categories", "admin/categories", "admin", "admin"],
  ["/admin/customers", "admin/customers", "admin", "admin"],
  ["/admin/rentals", "admin/rentals", "admin", "admin"],
  ["/admin/offers", "admin/offers", "admin", "admin"],
  ["/admin/reports", "admin/reports", "admin", "admin"],
  ["/admin/settings", "admin/settings", "admin", "admin"],
  ["/admin/account", "admin/account", "admin", "admin"],
];

const routes = table.map(([path, page, layout, guard]) => {
  const keys = [];
  const pattern = new RegExp("^" + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  return { pattern, keys, page, layout, guard };
});

function match(pathname) {
  for (const r of routes) {
    const m = pathname.match(r.pattern);
    if (m) return { ...r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return { page: "not-found", layout: "site", params: {} };
}

export const currentPath = () => location.pathname + location.search;
export const routeState = () => history.state?.app ?? null;

let hooks = null; // { layouts, authReady, getUser } supplied by app.js
let active = null; // { layoutName, layout, cleanups }
let renderId = 0;
let lastPath = null;

export function navigate(to, { replace = false, state = null } = {}) {
  const url = new URL(to, location.origin);
  const entry = { app: state };
  if (replace) history.replaceState(entry, "", url.pathname + url.search + url.hash);
  else history.pushState(entry, "", url.pathname + url.search + url.hash);
  render();
}

async function render() {
  const id = ++renderId;
  const route = match(location.pathname);

  if (route.guard) {
    await hooks.authReady;
    if (id !== renderId) return;
    const user = hooks.getUser();
    if (route.guard === "admin" && !user) return navigate("/admin/login", { replace: true });
    if (route.guard === "admin" && user.role !== "ADMIN") return navigate("/", { replace: true });
    if (route.guard === "user" && !user) return navigate("/login", { replace: true, state: { from: location.pathname } });
  }

  let mod;
  try {
    mod = await import(`./pages/${route.page}.js`);
  } catch (e) {
    console.error(e);
    mod = await import("./pages/not-found.js");
  }
  if (id !== renderId) return;

  // Leave the previous page: stop its timers and listeners.
  active?.cleanups.forEach((fn) => fn());
  if (active?.layoutName !== route.layout) {
    active?.layout.destroy?.();
    const root = document.getElementById("app");
    setHtml(root, "");
    active = { layoutName: route.layout, layout: hooks.layouts[route.layout](root), cleanups: [] };
  }
  const cleanups = (active.cleanups = []);

  const view = document.createElement("div");
  view.className = "view";
  active.layout.outlet.replaceChildren(view);
  active.layout.onRoute?.(location.pathname, location.search);

  const path = location.pathname + location.search;
  if (path !== lastPath) {
    if (location.hash) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
    else window.scrollTo(0, 0);
  }
  lastPath = path;

  const ctx = {
    params: route.params,
    query: new URLSearchParams(location.search),
    state: routeState(),
    // A page that finishes loading after the visitor moved on is cleaned up straight away.
    onCleanup: (fn) => (id === renderId ? cleanups.push(fn) : fn()),
    alive: () => id === renderId,
  };
  try {
    await mod.default(view, ctx);
  } catch (e) {
    console.error(e);
  }
}

// Same-site links are handled here instead of reloading the page.
function onLinkClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest?.("a[href]");
  if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/")) return;
  e.preventDefault();
  let state = null;
  if (a.hasAttribute("data-from")) state = { from: a.dataset.from || currentPath() };
  if (url.pathname === location.pathname && url.search === location.search && url.hash) {
    history.pushState(history.state, "", url.hash);
    document.getElementById(url.hash.slice(1))?.scrollIntoView();
    return;
  }
  navigate(url.pathname + url.search + url.hash, { state });
}

export function startRouter(h) {
  hooks = h;
  document.addEventListener("click", onLinkClick);
  window.addEventListener("popstate", render);
  render();
}

// Re-run the current page, for example after the query string changed.
export const refresh = () => render();

// Change the query string of the current page: setQuery({ page: 2, q: null }).
export function setQuery(changes, { resetPage = true } = {}) {
  const sp = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(changes)) {
    v === null || v === undefined || v === "" ? sp.delete(k) : sp.set(k, String(v));
  }
  if (resetPage && !("page" in changes)) sp.delete("page");
  const s = sp.toString();
  navigate(location.pathname + (s ? `?${s}` : ""));
}
