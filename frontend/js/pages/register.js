import { html } from "../html.js";
import { register } from "../store.js";
import { passwordInput } from "../ui.js";
import { navigate } from "../router.js";
import { authShell, formError, handleAuthForm } from "./login.js";

export default function registerPage(view, ctx) {
  const from = ctx.state?.from ?? "/";
  authShell(view, {
    title: "Create your account",
    subtitle: "Track orders and keep a wishlist of your favourites.",
    aside: html`<h2>Your jewellery, your way</h2><p>Save pieces you love and order them whenever you are ready.</p>`,
    body: html`
      <form class="form" data-auth>
        <label class="field"><span class="field-label">Full name</span><input name="name" required minlength="2" autocomplete="name"></label>
        <label class="field"><span class="field-label">Email</span><input name="email" type="email" required autocomplete="email"></label>
        <label class="field"><span class="field-label">Mobile number <span class="optional">(optional)</span></span><input name="phone" type="tel" placeholder="07XXXXXXXX" pattern="0\\d{9}" autocomplete="tel"></label>
        ${passwordInput({ name: "password", label: "Password", autocomplete: "new-password", minLength: 6, hint: "At least 6 characters" })}
        ${formError()}
        <button class="btn btn-primary btn-block">Create account</button>
      </form>
      <p class="auth-switch">Already have an account? <a href="/login" data-from="${from}">Sign in</a></p>`,
  });
  handleAuthForm(view, "Creating account…", async (f) => {
    await register({
      name: String(f.get("name")),
      email: String(f.get("email")),
      phone: String(f.get("phone") || "") || undefined,
      password: String(f.get("password")),
    });
    navigate(from, { replace: true });
  });
}
