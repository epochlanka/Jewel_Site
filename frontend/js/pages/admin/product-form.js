import { html, attr, setHtml, on, $ } from "../../html.js";
import { icon } from "../../icons.js";
import { api } from "../../api.js";
import { jewelleryTypes, typeLabel } from "../../format.js";
import { toast, toastError } from "../../store.js";
import { errorState, pageLoading, switchField } from "../../ui.js";
import { navigate } from "../../router.js";

const okType = (f) => /image\/(jpeg|png|webp)/.test(f.type) && f.size <= 8 * 1024 * 1024;

export default async function productForm(view, ctx) {
  const id = ctx.params.id;
  const isNew = !id;
  let p = null, images = [], files = [], busy = false;
  ctx.onCleanup(() => files.forEach((f) => URL.revokeObjectURL(f.url)));

  setHtml(view, pageLoading());
  let cats = [];
  try {
    [cats, p] = await Promise.all([api.categories().catch(() => []), isNew ? null : api.admin.product(id)]);
  } catch (e) {
    return setHtml(view, errorState(e.message, false));
  }
  if (!ctx.alive()) return;
  images = p?.images ?? [];

  const drawImages = () => setHtml($("[data-images]", view), html`
    ${images.map((img, i) => html`<div class="im-tile">
      <img src="${img.url}" alt="Photo ${i + 1}">
      ${i === 0 && html`<span class="im-tile-main">Main</span>`}
      <div class="im-tile-actions">
        ${i > 0 && html`<button type="button" class="icon-btn" aria-label="Make photo ${i + 1} the main photo" title="Make main" data-main="${img.id}">${icon("check", 16)}</button>`}
        <button type="button" class="icon-btn" aria-label="Remove photo ${i + 1}" title="Remove" data-delete-image="${img.id}">${icon("trash", 16)}</button>
      </div>
    </div>`)}
    ${files.map((f, i) => {
      const main = images.length === 0 && i === 0;
      return html`<div class="im-tile">
        <img src="${f.url}" alt="New photo ${i + 1}">
        <span class="${main ? "im-tile-main" : "im-tile-new"}">${main ? "Main" : "New"}</span>
        <div class="im-tile-actions"><button type="button" class="icon-btn" aria-label="Remove new photo ${i + 1}" data-remove-new="${i}">${icon("close", 16)}</button></div>
      </div>`;
    })}
    ${images.length + files.length < 10 && html`<label class="im-add">${icon("image", 24)}Add photos
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple data-add-images></label>`}`);

  setHtml(view, html`<form class="admin-page" data-product-form>
    <div class="admin-head">
      <div><a href="/admin/products" class="back-link">${icon("arrowLeft", 16)}Products</a><h1>${isNew ? "Add product" : p.name}</h1></div>
      ${!isNew && p.isActive && html`<a href="/product/${p.slug}" target="_blank" rel="noreferrer" class="btn btn-quiet">${icon("eye", 18)}View in shop</a>`}
    </div>
    <p class="form-error" role="alert" data-error hidden></p>

    <div class="admin-form">
      <div class="admin-form-main">
        <section class="panel form">
          <h2 style="font-size: 22px">Details</h2>
          <div class="form-grid">
            <label class="field span-2"><span class="field-label">Product name</span><input name="name" required minlength="2" maxlength="120" value="${p?.name ?? ""}" placeholder="Gold jhumka earrings"></label>
            <label class="field"><span class="field-label">Product code</span><input name="code" required maxlength="30" value="${p?.code ?? ""}" placeholder="ER025" autocapitalize="characters"></label>
            <label class="field"><span class="field-label">Category</span>
              <select name="categoryId" required>
                <option value="" disabled${attr("selected", !p?.categoryId)}>Choose a category</option>
                ${cats.map((c) => html`<option value="${c.id}"${attr("selected", p?.categoryId === c.id)}>${c.name}</option>`)}
              </select>
            </label>
            <label class="field span-2"><span class="field-label">Description</span><textarea name="description" rows="5" maxlength="4000" placeholder="Materials, size, finish and how to care for it">${p?.description ?? ""}</textarea></label>
            <label class="field"><span class="field-label">Jewellery type</span>
              <select name="jewelleryType">${jewelleryTypes.map((t) => html`<option value="${t}"${attr("selected", (p?.jewelleryType ?? "EARRINGS") === t)}>${typeLabel[t]}</option>`)}</select>
            </label>
            <label class="field"><span class="field-label">Style <span class="optional">(optional)</span></span><input name="style" maxlength="40" value="${p?.style ?? ""}" placeholder="Traditional, Modern…"><span class="field-hint">Shown as a filter in the shop</span></label>
            <label class="field"><span class="field-label">Colour <span class="optional">(optional)</span></span><input name="colour" maxlength="40" value="${p?.colour ?? ""}" placeholder="Gold, Silver, Rose gold…"></label>
          </div>
        </section>

        <section class="panel form">
          <h2 style="font-size: 22px">Photos</h2>
          <p class="field-hint" style="margin-top: -8px">The first photo is the main one in the shop. JPG, PNG or WebP, up to 8 MB each.</p>
          <div class="image-manager" data-images></div>
        </section>

      </div>

      <div class="admin-form-side">
        <section class="panel form">
          <h2 style="font-size: 22px">Price and stock</h2>
          <label class="field"><span class="field-label">Price (LKR)</span><input name="price" type="number" required min="1" step="1" inputmode="numeric" value="${p?.price ?? ""}"></label>
          <label class="field"><span class="field-label">Stock</span><input name="stock" type="number" required min="0" step="1" inputmode="numeric" value="${p?.stock ?? 1}"><span class="field-hint">Shows as sold out at 0</span></label>
        </section>
        <section class="panel form">
          <h2 style="font-size: 22px">Visibility</h2>
          ${switchField({ name: "isActive", label: "Show in the shop", checked: p?.isActive ?? true })}
          ${switchField({ name: "isNewArrival", label: "Show in New arrivals", checked: p?.isNewArrival ?? true })}
        </section>
      </div>
    </div>

    <div class="save-bar">
      <a href="/admin/products" class="btn btn-quiet">Cancel</a>
      <button class="btn btn-primary" data-save>${isNew ? "Add product" : "Save changes"}</button>
    </div>
  </form>`);
  drawImages();

  on(view, "change", "[data-add-images]", (e, el) => {
    const list = [...el.files];
    const good = list.filter(okType);
    if (good.length < list.length) toast("Some files were skipped. Use JPG, PNG or WebP up to 8 MB.", { kind: "error" });
    files = [...files, ...good.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 10);
    drawImages();
  });
  on(view, "click", "[data-remove-new]", (e, el) => {
    const i = Number(el.dataset.removeNew);
    URL.revokeObjectURL(files[i].url);
    files = files.filter((_, j) => j !== i);
    drawImages();
  });
  on(view, "click", "[data-delete-image]", async (e, el) => {
    try {
      await api.admin.deleteImage(p.id, el.dataset.deleteImage);
      images = images.filter((x) => x.id !== el.dataset.deleteImage);
      drawImages();
      toast("Photo removed");
    } catch (err) { toastError(err); }
  });
  on(view, "click", "[data-main]", async (e, el) => {
    const img = images.find((x) => x.id === el.dataset.main);
    const order = [img.id, ...images.filter((x) => x.id !== img.id).map((x) => x.id)];
    try {
      await api.admin.orderImages(p.id, order);
      images = [img, ...images.filter((x) => x.id !== img.id)];
      drawImages();
      toast("Main photo updated");
    } catch (err) { toastError(err); }
  });
  on(view, "submit", "[data-product-form]", async (e, form) => {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(form);
    for (const k of ["isActive", "isNewArrival"]) fd.set(k, fd.get(k) ? "true" : "false");
    // File pickers are only used to collect files; the chosen files are added below.
    for (const k of [...fd.keys()]) if (fd.get(k) instanceof File) fd.delete(k);
    files.forEach((f) => fd.append("images", f.file));

    const btn = $("[data-save]", view), errBox = $("[data-error]", view);
    busy = true; btn.disabled = true; btn.textContent = "Saving…"; errBox.hidden = true;
    try {
      const saved = await api.admin.saveProduct(fd, id);
      toast(isNew ? `${saved.name} added to the shop` : "Changes saved");
      navigate("/admin/products", { replace: isNew });
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
      busy = false; btn.disabled = false; btn.textContent = isNew ? "Add product" : "Save changes";
    }
  });
}
