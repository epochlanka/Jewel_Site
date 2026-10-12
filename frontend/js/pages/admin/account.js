import { html, setHtml, on, $ } from "../../html.js";
import { api } from "../../api.js";
import { icon } from "../../icons.js";
import { state, setUser, toast } from "../../store.js";
import { passwordInput } from "../../ui.js";

// The admin's own sign-in details: name, email (used to sign in) and password.
export default function adminAccount(view) {
  const u = state.user;
  setHtml(view, html`<form class="admin-page" data-account>
    <div class="admin-head"><div><h1>My account</h1><p>Change the email and password you use to sign in to the admin.</p></div></div>
    <p class="form-error" role="alert" data-error hidden></p>
    <div class="admin-form">
      <div class="admin-form-main">
        <section class="panel form">
          <h2 style="font-size: 22px">Sign-in details</h2>
          <label class="field"><span class="field-label">Name</span><input name="name" required minlength="2" value="${u?.name ?? ""}" autocomplete="name"></label>
          <label class="field"><span class="field-label">Email (your username)</span><input name="email" type="email" required value="${u?.email ?? ""}" autocomplete="username"><span class="field-hint">You sign in with this email.</span></label>
        </section>
        <section class="panel form">
          <h2 style="font-size: 22px">New password <span class="optional">(optional)</span></h2>
          <p class="field-hint" style="margin-top: -8px">Leave these empty to keep your current password.</p>
          <label class="field"><span class="field-label">New password</span><span class="input-wrap"><input name="newPassword" type="password" minlength="8" autocomplete="new-password"><button type="button" class="input-icon" aria-label="Show password" data-toggle-password>${icon("eye", 18)}</button></span><span class="field-hint">At least 8 characters</span></label>
          <label class="field"><span class="field-label">Confirm new password</span><span class="input-wrap"><input name="confirm" type="password" minlength="8" autocomplete="new-password"><button type="button" class="input-icon" aria-label="Show password" data-toggle-password>${icon("eye", 18)}</button></span></label>
        </section>
      </div>
      <div class="admin-form-side">
        <section class="panel form">
          <h2 style="font-size: 22px">Confirm it's you</h2>
          ${passwordInput({ name: "currentPassword", label: "Current password", autocomplete: "current-password" })}
          <span class="field-hint">Needed to save any change.</span>
        </section>
      </div>
    </div>
    <div class="save-bar"><button class="btn btn-primary" data-save>Save changes</button></div>
  </form>`);

  on(view, "submit", "[data-account]", async (e, form) => {
    e.preventDefault();
    const f = new FormData(form);
    const errBox = $("[data-error]", view), btn = $("[data-save]", view);
    const fail = (msg) => { errBox.textContent = msg; errBox.hidden = false; window.scrollTo({ top: 0, behavior: "smooth" }); };
    errBox.hidden = true;
    if (f.get("newPassword") !== f.get("confirm")) return fail("The new passwords don't match.");
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const user = await api.updateAccount({
        currentPassword: String(f.get("currentPassword")),
        name: String(f.get("name")), email: String(f.get("email")),
        newPassword: String(f.get("newPassword") || ""),
      });
      setUser(user);
      form.querySelectorAll("[type=password]").forEach((i) => { i.value = ""; });
      toast(f.get("newPassword") ? "Saved. Use your new password next time you sign in." : "Account details saved");
    } catch (err) {
      fail(err.message);
      if (err.field) form.querySelector(`[name="${err.field}"]`)?.focus();
    }
    btn.disabled = false; btn.textContent = "Save changes";
  });
}
