import { html, setHtml, on, $ } from "../html.js";
import { icon } from "../icons.js";
import { api } from "../api.js";
import { customerStatus, lkr, shortDate } from "../format.js";
import { state, subscribe, logout, setUser, toast } from "../store.js";
import { emptyState, errorState, orderLines, orderNotice, orderTimeline, pageLoading, passwordInput, productImage, productCard, statusPill } from "../ui.js";
import { navigate } from "../router.js";

function orders(box, ctx) {
  let list = null, err = "", open = null;
  const draw = () => {
    if (err) return setHtml(box, errorState(err));
    if (!list) return setHtml(box, pageLoading());
    if (!list.length) return setHtml(box, emptyState({ icon: "bag", title: "No orders yet", text: "Orders you place while signed in show here.", action: html`<a href="/shop" class="btn btn-primary">Start shopping</a>` }));
    setHtml(box, html`<div class="stack">${list.map((o) => html`<article class="order-card">
      <div class="order-card-head">
        <div><strong>${o.orderNo}</strong><div class="muted" style="font-size: 14px">Placed ${shortDate(o.createdAt)} · ${o.items.reduce((s, i) => s + i.qty, 0)} pieces</div></div>
        ${statusPill(o.status, customerStatus[o.status])}
      </div>
      ${o.status === "PENDING" && orderNotice(o)}
      <div class="order-card-thumbs">${o.items.slice(0, 5).map((i) => html`<span class="order-line-img">${productImage(i.product?.images[0]?.url, i.name)}</span>`)}</div>
      ${open === o.id && html`<div class="track-grid" style="grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)">${orderTimeline(o)}<div>${orderLines(o)}</div></div>`}
      <div class="order-card-foot">
        <strong class="num">${lkr(o.total)}</strong>
        <button class="btn btn-quiet btn-sm" aria-expanded="${String(open === o.id)}" data-open="${o.id}">${open === o.id ? "Hide details" : "View details"}${icon("chevronDown", 16)}</button>
      </div>
    </article>`)}</div>`);
  };
  const load = () => { err = ""; list = null; draw(); api.myOrders().then((r) => { list = r; draw(); }).catch((e) => { err = e.message; draw(); }); };
  on(box, "click", "[data-open]", (e, el) => { open = open === el.dataset.open ? null : el.dataset.open; draw(); });
  on(box, "click", "[data-act=retry]", load);
  load();
}

function wishlist(box, ctx) {
  let items = null;
  const draw = () => {
    if (!items) return setHtml(box, pageLoading());
    const shown = items.filter((p) => state.wishIds.has(p.id));
    if (!shown.length) return setHtml(box, emptyState({ icon: "heart", title: "Your wishlist is empty", text: "Tap the heart on any piece to save it here.", action: html`<a href="/shop" class="btn btn-primary">Browse jewellery</a>` }));
    setHtml(box, html`<div class="pgrid" style="grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))">${shown.map(productCard)}</div>`);
  };
  draw();
  api.wishlist().then((r) => { items = r; draw(); }).catch(() => { items = []; draw(); });
  ctx.onCleanup(subscribe((what) => { if (what === "wishlist") draw(); }));
}

function profile(box) {
  const u = state.user;
  setHtml(box, html`<div class="stack" style="max-width: 560px">
    <form class="card form" data-profile>
      <h2 style="margin-bottom: 0">Your details</h2>
      <label class="field"><span class="field-label">Full name</span><input name="name" required minlength="2" value="${u?.name ?? ""}" autocomplete="name"></label>
      <label class="field"><span class="field-label">Email</span><input value="${u?.email ?? ""}" disabled><span class="field-hint">Contact us to change your email.</span></label>
      <label class="field"><span class="field-label">Mobile number <span class="optional">(optional)</span></span><input name="phone" type="tel" pattern="0\\d{9}" placeholder="07XXXXXXXX" value="${u?.phone ?? ""}" autocomplete="tel"></label>
      <p class="form-error" role="alert" data-error hidden></p>
      <button class="btn btn-primary" style="align-self: flex-start">Save details</button>
    </form>
    <form class="card form" data-password>
      <h2 style="margin-bottom: 0">Change password</h2>
      ${passwordInput({ name: "current", label: "Current password", autocomplete: "current-password" })}
      ${passwordInput({ name: "next", label: "New password", autocomplete: "new-password", minLength: 6, hint: "At least 6 characters" })}
      ${passwordInput({ name: "confirm", label: "Confirm new password", autocomplete: "new-password", minLength: 6 })}
      <p class="form-error" role="alert" data-error hidden></p>
      <button class="btn btn-secondary" style="align-self: flex-start">Change password</button>
    </form>
  </div>`);

  const fail = (form, msg) => { const el = $("[data-error]", form); el.textContent = msg; el.hidden = !msg; };
  on(box, "submit", "[data-profile]", async (e, form) => {
    e.preventDefault();
    const f = new FormData(form), btn = form.querySelector("button");
    fail(form, ""); btn.disabled = true;
    try {
      setUser(await api.updateMe({ name: String(f.get("name")), phone: String(f.get("phone") || "") }));
      toast("Details saved");
    } catch (err) { fail(form, err.message); } finally { btn.disabled = false; }
  });
  on(box, "submit", "[data-password]", async (e, form) => {
    e.preventDefault();
    const f = new FormData(form);
    fail(form, "");
    if (f.get("next") !== f.get("confirm")) return fail(form, "The new passwords don't match.");
    try {
      await api.changePassword(String(f.get("current")), String(f.get("next")));
      form.reset();
      toast("Password changed");
    } catch (err) { fail(form, err.message); }
  });
}

const tabs = [
  { key: "", label: "My orders", icon: "bag", show: orders },
  { key: "wishlist", label: "Wishlist", icon: "heart", show: wishlist },
  { key: "profile", label: "Profile", icon: "user", show: profile },
];

export default function account(view, ctx) {
  const tab = ctx.params.tab ?? "";
  const current = tabs.find((t) => t.key === tab);
  if (!current) return navigate("/account", { replace: true });
  if (state.user?.role === "ADMIN") return navigate("/admin", { replace: true });

  setHtml(view, html`<div class="page">
    <div class="page-head"><h1>${current.label}</h1><p>Hi ${state.user?.name.split(" ")[0]}.</p></div>
    <div class="account">
      <nav class="account-nav" aria-label="Account">
        ${tabs.map((t) => html`<a href="${t.key ? `/account/${t.key}` : "/account"}" class="${t === current ? "active" : ""}"${t === current ? html` aria-current="page"` : ""}>${icon(t.icon, 18)}${t.label}</a>`)}
        <button data-sign-out>${icon("logout", 18)}Sign out</button>
      </nav>
      <div data-tab></div>
    </div>
  </div>`);
  on(view, "click", "[data-sign-out]", () => { logout(); navigate("/"); });
  current.show($("[data-tab]", view), ctx);
}
