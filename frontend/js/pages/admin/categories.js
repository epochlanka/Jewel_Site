import { html, setHtml, on, $ } from "../../html.js";
import { icon } from "../../icons.js";
import { api } from "../../api.js";
import { toast, toastError } from "../../store.js";
import { confirmDialog, errorState, openModal, pageLoading } from "../../ui.js";

export default function categories(view) {
  let cats = null;

  setHtml(view, html`<div class="admin-page">
    <div class="admin-head">
      <div><h1>Categories</h1><p>Shown on the home page and as filters in the shop, in this order.</p></div>
      <button class="btn btn-primary" data-edit="new">${icon("plus", 18)}Add category</button>
    </div>
    <div data-list>${pageLoading()}</div>
  </div>`);

  const draw = () => setHtml($("[data-list]", view), html`<div class="panel panel-flush"><div class="table-scroll"><table class="table">
    <thead><tr><th>Category</th><th class="num">Order</th><th class="num">Products</th><th><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${cats.map((c) => html`<tr>
      <td><div class="cell-product"><span class="cat-row-img">${c.imageUrl ? html`<img src="${c.imageUrl}" alt="">` : html`<span aria-hidden="true">${c.name.charAt(0)}</span>`}</span><strong>${c.name}</strong></div></td>
      <td class="num">${c.sort}</td>
      <td class="num"><a href="/admin/products?category=${c.id}">${c._count?.products ?? 0}</a></td>
      <td><div class="row-actions">
        <button class="icon-btn" aria-label="Edit ${c.name}" data-edit="${c.id}">${icon("edit", 18)}</button>
        <button class="icon-btn" aria-label="Delete ${c.name}" data-delete="${c.id}">${icon("trash", 18)}</button>
      </div></td>
    </tr>`)}</tbody>
  </table></div></div>`);

  const load = () => api.categories().then((r) => { cats = r; draw(); }).catch((e) => setHtml($("[data-list]", view), errorState(e.message)));

  const edit = (current) => {
    const d = openModal({
      title: current ? "Edit category" : "Add category",
      body: html`<form class="form" data-cat-form>
        <label class="field"><span class="field-label">Name</span><input name="name" required maxlength="60" value="${current?.name ?? ""}" autofocus></label>
        <label class="field"><span class="field-label">Order</span><input name="sort" type="number" step="1" value="${current?.sort ?? cats?.length ?? 0}"><span class="field-hint">Lower numbers show first</span></label>
        <div class="field">
          <span class="field-label">Image <span class="optional">(optional)</span></span>
          <div class="asset-row">
            <span class="cat-row-img" style="width: 72px; height: 72px" data-preview>${current?.imageUrl ? html`<img src="${current.imageUrl}" alt="">` : icon("image", 28)}</span>
            <label class="btn btn-quiet btn-sm">${icon("upload", 16)}Choose image
              <input name="image" type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" data-image></label>
          </div>
          <span class="field-hint">Without an image, the first letter of the name is shown.</span>
        </div>
        <p class="form-error" role="alert" data-error hidden></p>
        <div class="modal-foot" style="margin: 4px -24px -24px">
          <button type="button" class="btn btn-secondary" data-close>Cancel</button>
          <button class="btn btn-primary" data-save>Save category</button>
        </div>
      </form>`,
    });
    let previewUrl = null;
    d.addEventListener("close", () => previewUrl && URL.revokeObjectURL(previewUrl));
    $("[data-image]", d).addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = f ? URL.createObjectURL(f) : null;
      if (previewUrl) setHtml($("[data-preview]", d), html`<img src="${previewUrl}" alt="">`);
    });
    $("[data-cat-form]", d).addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (!fd.get("image")?.size) fd.delete("image");
      const btn = $("[data-save]", d), errBox = $("[data-error]", d);
      btn.disabled = true; btn.textContent = "Saving…"; errBox.hidden = true;
      try {
        await api.admin.saveCategory(fd, current?.id);
        toast(current ? "Category saved" : "Category added");
        d.closeModal();
        load();
      } catch (err) {
        errBox.textContent = err.message; errBox.hidden = false;
        btn.disabled = false; btn.textContent = "Save category";
      }
    });
  };

  on(view, "click", "[data-edit]", (e, el) => edit(cats?.find((c) => c.id === el.dataset.edit)));
  on(view, "click", "[data-delete]", (e, el) => {
    const c = cats.find((x) => x.id === el.dataset.delete);
    const n = c._count?.products ?? 0;
    confirmDialog({
      title: "Delete this category?", danger: true, confirmLabel: "Delete category",
      body: n ? `${c.name} still has ${n} products. Move them to another category first.` : `${c.name} will be removed from the shop.`,
      onConfirm: async () => {
        try { await api.admin.deleteCategory(c.id); toast("Category deleted"); load(); }
        catch (err) { toastError(err); }
      },
    });
  });
  on(view, "click", "[data-act=retry]", load);
  load();
}
