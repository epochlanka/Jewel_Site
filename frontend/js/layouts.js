// The three page frames: the storefront (header, menu drawer, footer), a bare frame for
// sign-in pages, and the admin shell. Each returns { outlet, onRoute, destroy }.
import { html, attr, setHtml, on, $ } from "./html.js";
import { icon } from "./icons.js";
import { api } from "./api.js";
import { phoneLink, whatsappLink } from "./format.js";
import { state, subscribe, cartCount, logout } from "./store.js";
import { navigate } from "./router.js";

const links = [
  { to: "/", label: "Home" },
  { to: "/shop", label: "Shop" },
  { to: "/shop?newArrivals=1", label: "New arrivals" },
  { to: "/shop?onSale=1", label: "Offers" },
  { to: "/about", label: "About" },
  { to: "/contact", label: "Contact" },
];

function isActive(to) {
  const { pathname, search } = location;
  const [path, query] = to.split("?");
  if (query) return pathname === path && search.includes(query);
  if (path === "/shop") return pathname.startsWith("/shop") && !/newArrivals|onSale/.test(search);
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(path + "/");
}

const searchForm = (id) => html`<form class="search" role="search" data-search>
  <label for="${id}" class="sr-only">Search jewellery</label>
  ${icon("search", 18)}
  <input id="${id}" name="q" type="search" placeholder="Search jewellery or code">
</form>`;

export function siteLayout(root) {
  setHtml(root, html`<div class="site">
    <a href="#main" class="skip-link">Skip to content</a>
    <header class="site-header"></header>
    <div data-drawer-slot></div>
    <main id="main" class="site-main"></main>
    <footer class="site-footer"></footer>
  </div>`);
  const header = $(".site-header", root), footer = $(".site-footer", root), drawerSlot = $("[data-drawer-slot]", root);
  let menuOpen = false;

  const drawHeader = () => {
    const u = state.user, count = cartCount(), wishes = state.wishIds.size, s = state.settings;
    setHtml(header, html`<div class="header-row">
      <button class="icon-btn header-menu" aria-label="Open menu" aria-expanded="${String(menuOpen)}" aria-controls="mobile-menu" data-menu-open>${icon("menu")}</button>
      <a href="/" class="brand">${s.shopName}</a>
      <nav class="main-nav" aria-label="Main">${links.map((l) => html`<a href="${l.to}" class="${isActive(l.to) ? "active" : ""}"${attr("aria-current", isActive(l.to) && "page")}>${l.label}</a>`)}</nav>
      <div class="header-search">${searchForm("search-desktop")}</div>
      <div class="header-icons">
        <a href="${u ? "/account/wishlist" : "/login"}" class="icon-btn header-icon" aria-label="Wishlist${wishes ? `, ${wishes} items` : ""}">
          ${icon("heart")}${wishes > 0 && html`<span class="count-badge">${wishes}</span>`}
        </a>
        <a href="/cart" class="icon-btn header-icon" aria-label="Cart, ${count} ${count === 1 ? "item" : "items"}">
          ${icon("bag")}${count > 0 && html`<span class="count-badge">${count}</span>`}
        </a>
        ${u
          ? html`<a href="${u.role === "ADMIN" ? "/admin" : "/account"}" class="icon-btn header-icon" aria-label="${u.role === "ADMIN" ? "Admin" : "My account"}">${icon("user")}</a>`
          : html`<a href="/login" data-from class="icon-btn header-signin" aria-label="Sign in">${icon("user")}<span class="header-signin-label" aria-hidden="true">Sign in</span></a>`}
      </div>
    </div>`);
  };

  const drawDrawer = () => {
    const u = state.user;
    setHtml(drawerSlot, html`
      ${menuOpen && html`<button class="drawer-scrim" aria-label="Close menu" data-menu-close></button>`}
      <aside id="mobile-menu" class="drawer ${menuOpen ? "is-open" : ""}" aria-label="Menu"${attr("inert", !menuOpen)}>
        <div class="drawer-head">
          <span class="brand">${state.settings.shopName}</span>
          <button class="icon-btn" aria-label="Close menu" data-menu-close>${icon("close")}</button>
        </div>
        ${searchForm("search-mobile")}
        <nav class="drawer-nav" aria-label="Mobile">
          ${links.map((l) => html`<a href="${l.to}" class="${isActive(l.to) ? "active" : ""}">${l.label}</a>`)}
          <a href="/track" class="${isActive("/track") ? "active" : ""}">Track your order</a>
        </nav>
        <div class="drawer-foot">${u
          ? html`<a href="${u.role === "ADMIN" ? "/admin" : "/account"}">${u.role === "ADMIN" ? "Admin" : "My account"}</a><button class="btn-link" data-sign-out>Sign out</button>`
          : html`<a href="/login" class="btn btn-primary btn-block">Sign in</a>`}</div>
      </aside>`);
  };

  const drawFooter = () => {
    const s = state.settings;
    const chat = s.whatsapp || s.phone;
    const year = new Date().getFullYear();
    setHtml(footer, html`<div class="footer-wrap">
      <div class="footer-cta">
        <div>
          <h2>Need help choosing the perfect piece?</h2>
          <p>Send us a message and we'll help you find the right jewellery for any occasion.</p>
        </div>
        ${chat
          ? html`<a href="${whatsappLink(chat, "Hi, I'd like some help choosing a piece.")}" target="_blank" rel="noreferrer" class="footer-cta-btn">${icon("chat", 20)}Chat on WhatsApp</a>`
          : html`<a href="/contact" class="footer-cta-btn">${icon("chat", 20)}Contact us</a>`}
      </div>

      <div class="footer-inner">
        <div class="footer-brand">
          <a href="/" class="footer-logo">${icon("diamond", 26)}<span>${s.shopName}</span></a>
          <p>${s.tagline}</p>
          <div class="footer-social">
            ${s.whatsapp && html`<a href="${whatsappLink(s.whatsapp)}" target="_blank" rel="noreferrer" aria-label="WhatsApp">${icon("chat", 20)}</a>`}
            ${s.phone && html`<a href="${phoneLink(s.phone)}" aria-label="Call us">${icon("phone", 20)}</a>`}
            ${s.email && html`<a href="mailto:${s.email}" aria-label="Email us">${icon("mail", 20)}</a>`}
            <a href="/contact" aria-label="Visit the shop">${icon("pin", 20)}</a>
          </div>
        </div>
        <div class="footer-col">
          <h2>Shop</h2>
          <a href="/shop">All jewellery</a>
          <a href="/shop?newArrivals=1">New arrivals</a>
          <a href="/shop?onSale=1">Offers</a>
          <a href="/account/wishlist">Wishlist</a>
        </div>
        <div class="footer-col">
          <h2>Help</h2>
          <a href="/track">Track your order</a>
          <a href="/delivery">Delivery and returns</a>
          <a href="/faq#pay">How to pay</a>
          <a href="/faq">FAQ</a>
        </div>
        <div class="footer-col footer-contact">
          <h2>Contact</h2>
          ${s.phone && html`<a href="${phoneLink(s.phone)}">${icon("phone", 18)}<span>${s.phone}</span></a>`}
          ${s.whatsapp && html`<a href="${whatsappLink(s.whatsapp)}" target="_blank" rel="noreferrer">${icon("chat", 18)}<span>WhatsApp ${s.whatsapp}</span></a>`}
          ${s.email && html`<a href="mailto:${s.email}">${icon("mail", 18)}<span>${s.email}</span></a>`}
          ${s.address && html`<span class="footer-address">${icon("pin", 18)}<span>${s.address}</span></span>`}
          ${!s.phone && !s.whatsapp && !s.email && !s.address && html`<a href="/contact">${icon("mail", 18)}<span>Contact us</span></a>`}
        </div>
      </div>

      <div class="footer-trust">
        <span>${icon("truck", 18)}Islandwide delivery</span>
        <span>${icon("bank", 18)}Secure bank transfer</span>
        <span>${icon("lock", 18)}Safe checkout</span>
        ${s.pickupEnabled && html`<span>${icon("store", 18)}Free store pickup</span>`}
      </div>

      <div class="footer-base">
        <span>© ${year} ${s.shopName}. All rights reserved.</span>
        <nav class="footer-legal" aria-label="Legal"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/contact">Contact</a></nav>
        <button class="footer-top" data-back-to-top aria-label="Back to top">${icon("chevronDown", 18)}</button>
      </div>
    </div>`);
  };

  const setMenu = (open) => {
    menuOpen = open;
    document.body.style.overflow = open ? "hidden" : "";
    drawHeader();
    drawDrawer();
    if (open) $(".drawer [data-menu-close]", root)?.focus();
  };

  const offs = [
    on(root, "click", "[data-menu-open]", () => setMenu(true)),
    on(root, "click", "[data-menu-close]", () => setMenu(false)),
    on(root, "click", ".drawer a", () => setMenu(false)),
    on(root, "click", "[data-sign-out]", () => { setMenu(false); logout(); }),
    on(root, "click", "[data-back-to-top]", () => window.scrollTo({ top: 0, behavior: "smooth" })),
    on(root, "submit", "[data-search]", (e, form) => {
      e.preventDefault();
      const q = String(new FormData(form).get("q") || "").trim();
      setMenu(false);
      navigate(q ? `/shop?q=${encodeURIComponent(q)}` : "/shop");
    }),
    subscribe((what) => {
      if (what === "settings") { drawHeader(); drawDrawer(); drawFooter(); }
      if (what === "user") { drawHeader(); drawDrawer(); }
      if (what === "cart" || what === "wishlist") drawHeader();
    }),
  ];
  const onKey = (e) => { if (e.key === "Escape" && menuOpen) setMenu(false); };
  document.addEventListener("keydown", onKey);

  drawHeader(); drawDrawer(); drawFooter();
  return {
    outlet: $("main", root),
    onRoute: () => { if (menuOpen) setMenu(false); else { drawHeader(); drawDrawer(); } },
    destroy: () => { offs.forEach((off) => off()); document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; },
  };
}

// Sign-in pages draw their own two-column frame (see authShell in pages/login.js).
export function bareLayout(root) {
  return { outlet: root };
}

const adminLinks = [
  { to: "/admin", label: "Dashboard", icon: "dashboard", end: true },
  { to: "/admin/orders", label: "Orders", icon: "orders" },
  { to: "/admin/products", label: "Products", icon: "products" },
  { to: "/admin/categories", label: "Categories", icon: "categories" },
  { to: "/admin/customers", label: "Customers", icon: "customers" },
  { to: "/admin/offers", label: "Offers", icon: "offers" },
  { to: "/admin/reports", label: "Reports", icon: "reports" },
  { to: "/admin/settings", label: "Settings", icon: "settings" },
];

export function adminLayout(root) {
  setHtml(root, html`<div class="admin-shell">
    <aside class="admin-side" aria-label="Admin menu"></aside>
    <div class="admin-main">
      <header class="admin-top">
        <button class="icon-btn admin-menu" aria-label="Open menu" aria-expanded="false" data-admin-menu>${icon("menu")}</button>
        <a href="/admin" class="admin-top-brand" data-admin-brand></a>
        <span class="admin-user"></span>
      </header>
      <div class="admin-content"></div>
    </div>
    <div data-scrim-slot></div>
  </div>`);
  const side = $(".admin-side", root), user = $(".admin-user", root), scrim = $("[data-scrim-slot]", root), menuBtn = $("[data-admin-menu]", root);
  let open = false, pending = 0;

  const drawSide = () => {
    const path = location.pathname;
    $("[data-admin-brand]", root).textContent = state.settings.shopName;
    setHtml(side, html`
      <a href="/admin" class="admin-logo">${state.settings.shopName}</a>
      <nav class="admin-nav" aria-label="Admin">${adminLinks.map((l) => {
        const active = l.end ? path === l.to : path === l.to || path.startsWith(l.to + "/");
        return html`<a href="${l.to}" class="${active ? "active" : ""}"${attr("aria-current", active && "page")}>${icon(l.icon)}${l.label}
          ${l.to === "/admin/orders" && pending > 0 && html`<span class="admin-nav-count" aria-label="${pending} pending">${pending}</span>`}</a>`;
      })}</nav>
      <div class="admin-side-foot">
        <a href="/" class="admin-side-link" target="_blank">${icon("store")}View shop</a>
        <button class="admin-side-link" data-admin-sign-out>${icon("logout")}Sign out</button>
      </div>`);
  };
  const setOpen = (v) => {
    open = v;
    side.classList.toggle("is-open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
    setHtml(scrim, open ? html`<button class="admin-scrim" aria-label="Close menu" data-admin-close></button>` : "");
  };
  const drawUser = () => setHtml(user, html`${icon("user", 18)}${state.user?.name}`);

  const offs = [
    on(root, "click", "[data-admin-menu]", () => setOpen(!open)),
    on(root, "click", "[data-admin-close]", () => setOpen(false)),
    on(root, "click", "[data-admin-sign-out]", () => { logout(); navigate("/admin/login", { replace: true }); }),
    subscribe((what) => { if (what === "settings") drawSide(); if (what === "user") drawUser(); }),
  ];
  drawSide(); drawUser();

  return {
    outlet: $(".admin-content", root),
    onRoute: () => {
      setOpen(false);
      drawSide();
      api.admin.orders({ status: "PENDING" }).then((r) => { pending = r.total; drawSide(); }).catch(() => undefined);
    },
    destroy: () => offs.forEach((off) => off()),
  };
}
