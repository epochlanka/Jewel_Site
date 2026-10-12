import { html, attr, setHtml, on, $ } from "../../html.js";
import { icon } from "../../icons.js";
import { api } from "../../api.js";
import { shortDate } from "../../format.js";
import { toast, toastError } from "../../store.js";
import { confirmDialog, emptyState, errorState, openModal, pageLoading, switchField } from "../../ui.js";

const toInput = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
const today = () => new Date().toISOString().slice(0, 10);
const plus = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };

function offerState(o) {
  const now = Date.now();
  if (!o.isActive) return { label: "Off", cls: "pill-off" };
  if (new Date(o.startsAt).getTime() > now) return { label: "Scheduled", cls: "pill-confirmed" };
  if (new Date(o.endsAt).getTime() < now) return { label: "Ended", cls: "pill-off" };
  return { label: "Live", cls: "pill-on" };
}

export default function offers(view) {
  let list = null, cats = [], products = [];

  setHtml(view, html`<div class="admin-page">
    <div class="admin-head">
      <div><h1>Offers</h1><p>Discounts show on product cards and are applied in the cart. If two offers cover a piece, the bigger one wins.</p></div>
      <button class="btn btn-primary" data-edit="new">${icon("plus", 18)}Create offer</button>
    </div>
    <div data-list>${pageLoading()}</div>
  </div>`);

  const draw = () => setHtml($("[data-list]", view), !list.length
    ? html`<div class="panel">${emptyState({ icon: "offers", title: "No offers yet", text: "Run a sale on one piece, a whole category or the entire shop.", action: html`<button class="btn btn-primary" data-edit="new">Create an offer</button>` })}</div>`
    : html`<div class="panel panel-flush"><div class="table-scroll"><table class="table">
        <thead><tr><th>Offer</th><th class="num">Discount</th><th>Applies to</th><th>Dates</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${list.map((o) => {
          const st = offerState(o);
          return html`<tr>
            <td><strong>${o.title}</strong></td>
            <td class="num">${o.percentOff}%</td>
            <td>${o.product ? `${o.product.name} (${o.product.code})` : o.category ? `All ${o.category.name.toLowerCase()}` : "Whole shop"}</td>
            <td class="muted">${shortDate(o.startsAt)} to ${shortDate(o.endsAt)}</td>
            <td><span class="pill ${st.cls}">${st.label}</span></td>
            <td><div class="row-actions">
              <button class="icon-btn" aria-label="Edit ${o.title}" data-edit="${o.id}">${icon("edit", 18)}</button>
              <button class="icon-btn" aria-label="Delete ${o.title}" data-delete="${o.id}">${icon("trash", 18)}</button>
            </div></td>
          </tr>`;
        })}</tbody>
      </table></div></div>`);

  const load = () => api.admin.offers().then((r) => { list = r; draw(); }).catch((e) => setHtml($("[data-list]", view), errorState(e.message)));

  const edit = (cur) => {
    let scope = cur?.productId ? "product" : cur?.categoryId ? "category" : "shop";
    const d = openModal({
      title: cur ? "Edit offer" : "Create offer",
      body: html`<form class="form" data-offer-form>
        <label class="field"><span class="field-label">Title</span><input name="title" required maxlength="80" value="${cur?.title ?? ""}" placeholder="Avurudu sale" autofocus><span class="field-hint">Shown on the product page</span></label>
        <label class="field"><span class="field-label">Discount (%)</span><input name="percentOff" type="number" required min="1" max="90" value="${cur?.percentOff ?? 10}"></label>
        <fieldset class="fieldset"><legend>Applies to</legend><div data-scope></div></fieldset>
        <div class="form-grid">
          <label class="field"><span class="field-label">Starts</span><input name="startsAt" type="date" required value="${toInput(cur?.startsAt) || today()}"></label>
          <label class="field"><span class="field-label">Ends</span><input name="endsAt" type="date" required value="${toInput(cur?.endsAt) || plus(14)}"></label>
        </div>
        ${switchField({ name: "isActive", label: "Offer is on", hint: "Turn off to pause it without deleting", checked: cur?.isActive ?? true })}
        <p class="form-error" role="alert" data-error hidden></p>
        <div class="modal-foot" style="margin: 4px -24px -24px">
          <button type="button" class="btn btn-secondary" data-close>Cancel</button>
          <button class="btn btn-primary" data-save>Save offer</button>
        </div>
      </form>`,
    });
    const drawScope = () => setHtml($("[data-scope]", d), html`
      <div class="chips">${[["shop", "Whole shop"], ["category", "A category"], ["product", "One product"]].map(([v, label]) =>
        html`<button type="button" class="chip" aria-pressed="${String(scope === v)}" data-scope-pick="${v}">${label}</button>`)}</div>
      ${scope === "category" && html`<label class="field"><span class="sr-only">Category</span>
        <select name="categoryId" required><option value="" disabled${attr("selected", !cur?.categoryId)}>Choose a category</option>
          ${cats.map((c) => html`<option value="${c.id}"${attr("selected", cur?.categoryId === c.id)}>${c.name}</option>`)}</select></label>`}
      ${scope === "product" && html`<label class="field"><span class="sr-only">Product</span>
        <select name="productId" required><option value="" disabled${attr("selected", !cur?.productId)}>Choose a product</option>
          ${products.map((p) => html`<option value="${p.id}"${attr("selected", cur?.productId === p.id)}>${p.name} (${p.code})</option>`)}</select></label>`}`);
    drawScope();
    d.addEventListener("click", (e) => { const b = e.target.closest("[data-scope-pick]"); if (b) { scope = b.dataset.scopePick; drawScope(); } });
    $("[data-offer-form]", d).addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const body = {
        title: f.get("title"), percentOff: Number(f.get("percentOff")),
        startsAt: new Date(`${f.get("startsAt")}T00:00:00`).toISOString(),
        endsAt: new Date(`${f.get("endsAt")}T23:59:59`).toISOString(),
        isActive: !!f.get("isActive"),
        productId: scope === "product" ? f.get("productId") : null,
        categoryId: scope === "category" ? f.get("categoryId") : null,
      };
      const btn = $("[data-save]", d), errBox = $("[data-error]", d);
      btn.disabled = true; btn.textContent = "Saving…"; errBox.hidden = true;
      try {
        await api.admin.saveOffer(body, cur?.id);
        toast("Offer saved");
        d.closeModal();
        load();
      } catch (err) {
        errBox.textContent = err.message; errBox.hidden = false;
        btn.disabled = false; btn.textContent = "Save offer";
      }
    });
  };

  on(view, "click", "[data-edit]", (e, el) => edit(list?.find((o) => o.id === el.dataset.edit)));
  on(view, "click", "[data-delete]", (e, el) => {
    const o = list.find((x) => x.id === el.dataset.delete);
    confirmDialog({
      title: "Delete this offer?", danger: true, confirmLabel: "Delete offer",
      body: `${o.title} will stop applying straight away. Past orders keep the price they were charged.`,
      onConfirm: async () => {
        try { await api.admin.deleteOffer(o.id); toast("Offer deleted"); load(); }
        catch (err) { toastError(err); throw err; }
      },
    });
  });
  on(view, "click", "[data-act=retry]", load);

  load();
  api.categories().then((r) => { cats = r; }).catch(() => undefined);
  api.admin.products({ show: "active" }).then(async (first) => {
    const rest = await Promise.all(Array.from({ length: Math.min(first.pages, 10) - 1 }, (_, i) => api.admin.products({ show: "active", page: i + 2 })));
    products = [...first.items, ...rest.flatMap((r) => r.items)];
  }).catch(() => undefined);
}
