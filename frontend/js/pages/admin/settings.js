import { html, attr, setHtml, on, $ } from "../../html.js";
import { api } from "../../api.js";
import { state, subscribe, reloadSettings, toast } from "../../store.js";
import { switchField } from "../../ui.js";

export default function settingsPage(view, ctx) {
  let edited = false;
  const draw = () => {
    const s = state.settings;
    const option = (value, label, current) => html`<option value="${value}"${attr("selected", current === value)}>${label}</option>`;
    setHtml(view, html`<form class="admin-page" data-settings>
      <div class="admin-head"><div><h1>Settings</h1><p>These details appear across the shop, at checkout and in messages to customers.</p></div></div>
      <p class="form-error" role="alert" data-error hidden></p>

      <div class="admin-form">
        <div class="admin-form-main">
          <section class="panel form">
            <h2 style="font-size: 22px">Shop</h2>
            <div class="form-grid">
              <label class="field"><span class="field-label">Shop name</span><input name="shopName" required maxlength="80" value="${s.shopName}"></label>
              <label class="field"><span class="field-label">Tagline</span><input name="tagline" maxlength="200" value="${s.tagline}"></label>
              <label class="field span-2"><span class="field-label">Address</span><textarea name="address" rows="2" maxlength="300">${s.address}</textarea><span class="field-hint">Shown for store pickup and on the contact page</span></label>
            </div>
          </section>
          <section class="panel form">
            <h2 style="font-size: 22px">Contact</h2>
            <div class="form-grid">
              <label class="field"><span class="field-label">Phone</span><input name="phone" type="tel" maxlength="30" value="${s.phone}" placeholder="0XX XXX XXXX"></label>
              <label class="field"><span class="field-label">WhatsApp</span><input name="whatsapp" type="tel" maxlength="30" value="${s.whatsapp}" placeholder="07XXXXXXXX"><span class="field-hint">Used for WhatsApp buttons and new-order alerts</span></label>
              <label class="field span-2"><span class="field-label">Email</span><input name="email" type="email" maxlength="120" value="${s.email}"></label>
            </div>
          </section>
          <section class="panel form">
            <h2 style="font-size: 22px">Payment</h2>
            <p class="field-hint" style="margin-top: -8px">Customers pay by bank transfer. These details are shown on the payment page after they place an order.</p>
            <div class="form-grid">
              <label class="field"><span class="field-label">Bank</span><input name="bankName" maxlength="80" value="${s.bankName}" placeholder="Commercial Bank"></label>
              <label class="field"><span class="field-label">Branch</span><input name="bankBranch" maxlength="80" value="${s.bankBranch}" placeholder="Colombo 07"></label>
              <label class="field"><span class="field-label">Account name</span><input name="accountName" maxlength="120" value="${s.accountName}"></label>
              <label class="field"><span class="field-label">Account number</span><input name="accountNumber" maxlength="40" value="${s.accountNumber}" inputmode="numeric"></label>
              <label class="field span-2"><span class="field-label">Extra payment note <span class="optional">(optional)</span></span><textarea name="bankDetails" rows="2" maxlength="1000" placeholder="For example: we also accept transfers to our BOC account 1234567">${s.bankDetails}</textarea></label>
            </div>
          </section>
        </div>
        <div class="admin-form-side">
          <section class="panel form">
            <h2 style="font-size: 22px">Appearance</h2>
            <label class="field"><span class="field-label">Colour mode</span><select name="themeMode">
              ${option("system", "Use visitor’s device setting", s.themeMode)}${option("light", "Light", s.themeMode)}${option("dark", "Dark", s.themeMode)}
            </select></label>
            <label class="field"><span class="field-label">Accent colour</span><select name="themeAccent">
              ${option("emerald", "Emerald", s.themeAccent)}${option("gold", "Gold", s.themeAccent)}${option("rose", "Rose", s.themeAccent)}${option("blue", "Blue", s.themeAccent)}
            </select><span class="field-hint">Changes buttons, links and highlights across the shop.</span></label>
          </section>
          <section class="panel form">
            <h2 style="font-size: 22px">Delivery</h2>
            <label class="field"><span class="field-label">Delivery fee (LKR)</span><input name="deliveryFee" type="number" min="0" step="1" required value="${s.deliveryFee}"></label>
            <label class="field"><span class="field-label">Free delivery over (LKR) <span class="optional">(optional)</span></span><input name="freeDeliveryOver" type="number" min="0" step="1" value="${s.freeDeliveryOver ?? ""}"><span class="field-hint">Leave empty to always charge</span></label>
            ${switchField({ name: "pickupEnabled", label: "Store pickup", hint: "Free for the customer", checked: s.pickupEnabled })}
          </section>
        </div>
      </div>

      <div class="save-bar"><button class="btn btn-primary" data-save>Save settings</button></div>
    </form>`);
  };

  on(view, "submit", "[data-settings]", async (e, form) => {
    e.preventDefault();
    const f = new FormData(form);
    const text = (k) => String(f.get(k) ?? "").trim();
    const body = {
      shopName: text("shopName"), tagline: text("tagline"), phone: text("phone"), whatsapp: text("whatsapp"),
      email: text("email"), address: text("address"), bankDetails: text("bankDetails"),
      deliveryFee: Number(f.get("deliveryFee") || 0),
      freeDeliveryOver: f.get("freeDeliveryOver") ? Number(f.get("freeDeliveryOver")) : null,
      bankName: text("bankName"), bankBranch: text("bankBranch"), accountName: text("accountName"), accountNumber: text("accountNumber"),
      pickupEnabled: !!f.get("pickupEnabled"),
      themeMode: text("themeMode"), themeAccent: text("themeAccent"),
    };
    const errBox = $("[data-error]", view), btn = $("[data-save]", view);
    const fail = (msg) => { errBox.textContent = msg; errBox.hidden = false; window.scrollTo({ top: 0, behavior: "smooth" }); };
    btn.disabled = true; btn.textContent = "Saving…"; errBox.hidden = true;
    try {
      await api.admin.saveSettings(body);
      edited = false;
      await reloadSettings();
      toast("Settings saved");
    } catch (err) {
      fail(err.message);
      btn.disabled = false; btn.textContent = "Save settings";
    }
  });
  // Settings may still be loading when the page opens; show them once they arrive.
  on(view, "input", "[data-settings]", () => { edited = true; });
  ctx.onCleanup(subscribe((what) => { if (what === "settings" && !edited) draw(); }));
  draw();
}
