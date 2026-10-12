import { html } from "../../html.js";
import { authReady, state, login, logout } from "../../store.js";
import { passwordInput } from "../../ui.js";
import { navigate } from "../../router.js";
import { authShell, formError, handleAuthForm } from "../login.js";

export default async function adminLogin(view) {
  await authReady;
  if (state.user?.role === "ADMIN") return navigate("/admin", { replace: true });

  authShell(view, {
    title: "Admin sign in",
    subtitle: "Manage products, orders and reports.",
    aside: html`<h2>Shop admin</h2><p>Confirm orders, update stock and see today's sales in one place.</p>`,
    body: html`<form class="form" data-auth>
      <label class="field"><span class="field-label">Email</span><input name="email" type="email" required autocomplete="username"></label>
      ${passwordInput({ name: "password", label: "Password", autocomplete: "current-password" })}
      ${formError()}
      <button class="btn btn-primary btn-block">Sign in</button>
    </form>`,
  });
  handleAuthForm(view, "Signing in…", async (f) => {
    const u = await login(String(f.get("email")), String(f.get("password")));
    if (u.role !== "ADMIN") {
      logout();
      throw new Error("This account doesn't have admin access.");
    }
    navigate("/admin", { replace: true });
  });
}
