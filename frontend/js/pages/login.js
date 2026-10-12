import { html, setHtml, on, $ } from "../html.js";
import { api } from "../api.js";
import { state, login } from "../store.js";
import { passwordInput } from "../ui.js";
import { navigate } from "../router.js";

// Two-column frame for the sign-in pages: a model photo with a short pitch, and the form.
export function authShell(view, { title, subtitle, aside, body }) {
  setHtml(view, html`<div class="auth">
    <aside class="auth-aside">
      <a href="/" class="auth-logo">${state.settings.shopName}</a>
      <div class="auth-aside-body">${aside}</div>
    </aside>
    <main class="auth-main"><div class="auth-card"><h1>${title}</h1><p class="auth-sub">${subtitle}</p>${body}</div></main>
  </div>`);
  api.aiModels().then((m) => {
    const photo = m[1]?.imageUrl ?? m[0]?.imageUrl;
    const side = $(".auth-aside", view);
    if (!photo || !side) return;
    side.classList.add("has-photo");
    side.insertAdjacentHTML("afterbegin", html`<img class="auth-photo" src="${photo}" alt="">`.s);
  }).catch(() => undefined);
}

// Runs a sign-in form: shows "busy" on the button and the server's message on failure.
export function handleAuthForm(view, busyLabel, submit) {
  on(view, "submit", "form[data-auth]", async (e, form) => {
    e.preventDefault();
    const btn = form.querySelector("button.btn-primary");
    const errBox = form.querySelector("[data-error]");
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = busyLabel; errBox.hidden = true;
    try {
      await submit(new FormData(form));
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  });
}

export const formError = () => html`<p class="form-error" role="alert" data-error hidden></p>`;

export default function loginPage(view, ctx) {
  const from = ctx.state?.from ?? "/";
  authShell(view, {
    title: "Sign in",
    subtitle: "Welcome back. Sign in to see your orders and saved try-ons.",
    aside: html`<h2>See it on before you buy</h2><p>Try any piece on a model or your own photo, then order in a few taps.</p>`,
    body: html`
      <form class="form" data-auth>
        <label class="field"><span class="field-label">Email</span><input name="email" type="email" required autocomplete="email"></label>
        ${passwordInput({ name: "password", label: "Password", autocomplete: "current-password" })}
        ${formError()}
        <button class="btn btn-primary btn-block">Sign in</button>
      </form>
      <p class="auth-switch">New here? <a href="/register" data-from="${from}">Create an account</a></p>
      <p class="auth-switch"><a href="/">Continue as guest</a></p>`,
  });
  handleAuthForm(view, "Signing in…", async (f) => {
    const u = await login(String(f.get("email")), String(f.get("password")));
    navigate(u.role === "ADMIN" ? "/admin" : from, { replace: true });
  });
}
