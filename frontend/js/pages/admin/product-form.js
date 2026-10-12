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
          <h2 style="font-size: 22px">Selling</h2>
          ${switchField({ name: "forSale", label: "Customers can buy this piece", checked: p?.forSale ?? true })}
          <div class="form-grid" data-sale-fields>
            <label class="field"><span class="field-label">Price (LKR)</span><input name="price" type="number" min="1" step="1" inputmode="numeric" value="${p?.price || ""}"></label>
            <label class="field"><span class="field-label">Stock</span><input name="stock" type="number" min="0" step="1" inputmode="numeric" value="${p?.stock ?? 1}" data-stock><span class="field-hint" data-stock-hint>Shows as sold out at 0</span></label>
          </div>
          <div class="field" data-sale-fields>
            <span class="field-label">Sizes <span class="optional">(optional)</span></span>
            <span class="field-hint">For bangles or rings. Each size has its own stock, and customers must choose one.</span>
            <div class="size-editor" data-sizes></div>
            <div class="size-editor-actions">
              <button type="button" class="btn btn-quiet btn-sm" data-add-size>${icon("plus", 16)}Add a size</button>
              <button type="button" class="btn btn-quiet btn-sm" data-bangle-sizes>Add bangle sizes 2.2 to 2.8</button>
            </div>
          </div>
        </section>

        <section class="panel form">
          <h2 style="font-size: 22px">Renting</h2>
          ${switchField({ name: "forRent", label: "Customers can rent this piece", hint: "For example a bridal set. Customers pick their dates and the same set can't be booked twice for the same day.", checked: p?.forRent ?? false })}
          <div class="form-grid" data-rent-fields>
            <label class="field"><span class="field-label">Rent price (LKR)</span><input name="rentPrice" type="number" min="1" step="1" inputmode="numeric" value="${p?.rentPrice || ""}"></label>
            <label class="field"><span class="field-label">Days included</span><input name="rentDays" type="number" min="1" max="30" step="1" inputmode="numeric" value="${p?.rentDays ?? 3}"><span class="field-hint">The rent price covers this many days</span></label>
            <label class="field"><span class="field-label">Each extra day (LKR)</span><input name="rentExtraDay" type="number" min="0" step="1" inputmode="numeric" value="${p?.rentExtraDay ?? 0}"></label>
            <label class="field"><span class="field-label">Refundable deposit (LKR)</span><input name="rentDeposit" type="number" min="0" step="1" inputmode="numeric" value="${p?.rentDeposit ?? 0}"></label>
            <label class="field"><span class="field-label">Sets available</span><input name="rentUnits" type="number" min="1" step="1" inputmode="numeric" value="${p?.rentUnits ?? 1}"><span class="field-hint">How many identical sets you can rent out on the same day</span></label>
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

  // Sizes are edited in memory and sent as JSON when the form is saved.
  let sizes = (p?.sizes ?? []).map((x) => ({ size: x.size, stock: x.stock }));
  const syncStock = () => {
    const stock = $("[data-stock]", view), hint = $("[data-stock-hint]", view);
    const valid = sizes.filter((x) => x.size.trim());
    stock.readOnly = valid.length > 0;
    if (valid.length) stock.value = valid.reduce((n, x) => n + (Number(x.stock) || 0), 0);
    hint.textContent = valid.length ? "Total of all sizes" : "Shows as sold out at 0";
  };
  const drawSizes = () => {
    setHtml($("[data-sizes]", view), sizes.map((x, i) => html`<div class="size-row">
      <input aria-label="Size" placeholder="2.4" maxlength="12" value="${x.size}" data-size-field="size" data-i="${i}">
      <input aria-label="Stock for this size" type="number" min="0" step="1" inputmode="numeric" value="${x.stock}" data-size-field="stock" data-i="${i}">
      <button type="button" class="icon-btn" aria-label="Remove size ${x.size}" data-remove-size="${i}">${icon("trash", 16)}</button>
    </div>`));
    syncStock();
  };
  const syncModes = () => {
    const sale = $("[name=forSale]", view).checked, rent = $("[name=forRent]", view).checked;
    for (const el of view.querySelectorAll("[data-sale-fields]")) {
      el.hidden = !sale;
      el.querySelectorAll("input").forEach((i) => { i.disabled = !sale; });
    }
    $("[name=price]", view).required = sale;
    for (const el of view.querySelectorAll("[data-rent-fields]")) {
      el.hidden = !rent;
      el.querySelectorAll("input").forEach((i) => { i.disabled = !rent; });
    }
    $("[name=rentPrice]", view).required = rent;
  };
  drawSizes();
  syncModes();
  on(view, "change", "[name=forSale], [name=forRent]", syncModes);
  on(view, "input", "[data-size-field]", (e, el) => { sizes[Number(el.dataset.i)][el.dataset.sizeField] = el.value; syncStock(); });
  on(view, "click", "[data-add-size]", () => { sizes.push({ size: "", stock: 0 }); drawSizes(); view.querySelector(`[data-i="${sizes.length - 1}"]`)?.focus(); });
  on(view, "click", "[data-bangle-sizes]", () => {
    for (const label of ["2.2", "2.4", "2.6", "2.8"]) if (!sizes.some((x) => x.size === label)) sizes.push({ size: label, stock: 0 });
    drawSizes();
  });
  on(view, "click", "[data-remove-size]", (e, el) => { sizes.splice(Number(el.dataset.removeSize), 1); drawSizes(); });

  on(view, "change", "[data-add-images]", (e, el) => {
    const list = [...el.files];
    const good = list.filter(okType);
    if (good.length < list.length) toast("Some files were skipped. Use JPG, PNG or WebP up to 8 MB.", { kind: "error" });
    files = [...files, ...good.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 10);
    drawImages();

  // Sizes are edited in memory and sent as JSON when the form is saved.
  let sizes = (p?.sizes ?? []).map((x) => ({ size: x.size, stock: x.stock }));
  const syncStock = () => {
    const stock = $("[data-stock]", view), hint = $("[data-stock-hint]", view);
    const valid = sizes.filter((x) => x.size.trim());
    stock.readOnly = valid.length > 0;
    if (valid.length) stock.value = valid.reduce((n, x) => n + (Number(x.stock) || 0), 0);
    hint.textContent = valid.length ? "Total of all sizes" : "Shows as sold out at 0";
  };
  const drawSizes = () => {
    setHtml($("[data-sizes]", view), sizes.map((x, i) => html`<div class="size-row">
      <input aria-label="Size" placeholder="2.4" maxlength="12" value="${x.size}" data-size-field="size" data-i="${i}">
      <input aria-label="Stock for this size" type="number" min="0" step="1" inputmode="numeric" value="${x.stock}" data-size-field="stock" data-i="${i}">
      <button type="button" class="icon-btn" aria-label="Remove size ${x.size}" data-remove-size="${i}">${icon("trash", 16)}</button>
    </div>`));
    syncStock();
  };
  const syncModes = () => {
    const sale = $("[name=forSale]", view).checked, rent = $("[name=forRent]", view).checked;
    for (const el of view.querySelectorAll("[data-sale-fields]")) {
      el.hidden = !sale;
      el.querySelectorAll("input").forEach((i) => { i.disabled = !sale; });
    }
    $("[name=price]", view).required = sale;
    for (const el of view.querySelectorAll("[data-rent-fields]")) {
      el.hidden = !rent;
      el.querySelectorAll("input").forEach((i) => { i.disabled = !rent; });
    }
    $("[name=rentPrice]", view).required = rent;
  };
  drawSizes();
  syncModes();
  on(view, "change", "[name=forSale], [name=forRent]", syncModes);
  on(view, "input", "[data-size-field]", (e, el) => { sizes[Number(el.dataset.i)][el.dataset.sizeField] = el.value; syncStock(); });
  on(view, "click", "[data-add-size]", () => { sizes.push({ size: "", stock: 0 }); drawSizes(); view.querySelector(`[data-i="${sizes.length - 1}"]`)?.focus(); });
  on(view, "click", "[data-bangle-sizes]", () => {
    for (const label of ["2.2", "2.4", "2.6", "2.8"]) if (!sizes.some((x) => x.size === label)) sizes.push({ size: label, stock: 0 });
    drawSizes();
  });
  on(view, "click", "[data-remove-size]", (e, el) => { sizes.splice(Number(el.dataset.removeSize), 1); drawSizes(); });
  });
  on(view, "click", "[data-remove-new]", (e, el) => {
    const i = Number(el.dataset.removeNew);
    URL.revokeObjectURL(files[i].url);
    files = files.filter((_, j) => j !== i);
    drawImages();

  // Sizes are edited in memory and sent as JSON when the form is saved.
  let sizes = (p?.sizes ?? []).map((x) => ({ size: x.size, stock: x.stock }));
  const syncStock = () => {
    const stock = $("[data-stock]", view), hint = $("[data-stock-hint]", view);
    const valid = sizes.filter((x) => x.size.trim());
    stock.readOnly = valid.length > 0;
    if (valid.length) stock.value = valid.reduce((n, x) => n + (Number(x.stock) || 0), 0);
    hint.textContent = valid.length ? "Total of all sizes" : "Shows as sold out at 0";
  };
  const drawSizes = () => {
    setHtml($("[data-sizes]", view), sizes.map((x, i) => html`<div class="size-row">
      <input aria-label="Size" placeholder="2.4" maxlength="12" value="${x.size}" data-size-field="size" data-i="${i}">
      <input aria-label="Stock for this size" type="number" min="0" step="1" inputmode="numeric" value="${x.stock}" data-size-field="stock" data-i="${i}">
      <button type="button" class="icon-btn" aria-label="Remove size ${x.size}" data-remove-size="${i}">${icon("trash", 16)}</button>
    </div>`));
    syncStock();
  };
  const syncModes = () => {
    const sale = $("[name=forSale]", view).checked, rent = $("[name=forRent]", view).checked;
    for (const el of view.querySelectorAll("[data-sale-fields]")) {
      el.hidden = !sale;
      el.querySelectorAll("input").forEach((i) => { i.disabled = !sale; });
    }
    $("[name=price]", view).required = sale;
    for (const el of view.querySelectorAll("[data-rent-fields]")) {
      el.hidden = !rent;
      el.querySelectorAll("input").forEach((i) => { i.disabled = !rent; });
    }
    $("[name=rentPrice]", view).required = rent;
  };
  drawSizes();
  syncModes();
  on(view, "change", "[name=forSale], [name=forRent]", syncModes);
  on(view, "input", "[data-size-field]", (e, el) => { sizes[Number(el.dataset.i)][el.dataset.sizeField] = el.value; syncStock(); });
  on(view, "click", "[data-add-size]", () => { sizes.push({ size: "", stock: 0 }); drawSizes(); view.querySelector(`[data-i="${sizes.length - 1}"]`)?.focus(); });
  on(view, "click", "[data-bangle-sizes]", () => {
    for (const label of ["2.2", "2.4", "2.6", "2.8"]) if (!sizes.some((x) => x.size === label)) sizes.push({ size: label, stock: 0 });
    drawSizes();
  });
  on(view, "click", "[data-remove-size]", (e, el) => { sizes.splice(Number(el.dataset.removeSize), 1); drawSizes(); });
  });
  on(view, "click", "[data-delete-image]", async (e, el) => {
    try {
      await api.admin.deleteImage(p.id, el.dataset.deleteImage);
      images = images.filter((x) => x.id !== el.dataset.deleteImage);
      drawImages();

  // Sizes are edited in memory and sent as JSON when the form is saved.
  let sizes = (p?.sizes ?? []).map((x) => ({ size: x.size, stock: x.stock }));
  const syncStock = () => {
    const stock = $("[data-stock]", view), hint = $("[data-stock-hint]", view);
    const valid = sizes.filter((x) => x.size.trim());
    stock.readOnly = valid.length > 0;
    if (valid.length) stock.value = valid.reduce((n, x) => n + (Number(x.stock) || 0), 0);
    hint.textContent = valid.length ? "Total of all sizes" : "Shows as sold out at 0";
  };
  const drawSizes = () => {
    setHtml($("[data-sizes]", view), sizes.map((x, i) => html`<div class="size-row">
      <input aria-label="Size" placeholder="2.4" maxlength="12" value="${x.size}" data-size-field="size" data-i="${i}">
      <input aria-label="Stock for this size" type="number" min="0" step="1" inputmode="numeric" value="${x.stock}" data-size-field="stock" data-i="${i}">
      <button type="button" class="icon-btn" aria-label="Remove size ${x.size}" data-remove-size="${i}">${icon("trash", 16)}</button>
    </div>`));
    syncStock();
  };
  const syncModes = () => {
    const sale = $("[name=forSale]", view).checked, rent = $("[name=forRent]", view).checked;
    for (const el of view.querySelectorAll("[data-sale-fields]")) {
      el.hidden = !sale;
      el.querySelectorAll("input").forEach((i) => { i.disabled = !sale; });
    }
    $("[name=price]", view).required = sale;
    for (const el of view.querySelectorAll("[data-rent-fields]")) {
      el.hidden = !rent;
      el.querySelectorAll("input").forEach((i) => { i.disabled = !rent; });
    }
    $("[name=rentPrice]", view).required = rent;
  };
  drawSizes();
  syncModes();
  on(view, "change", "[name=forSale], [name=forRent]", syncModes);
  on(view, "input", "[data-size-field]", (e, el) => { sizes[Number(el.dataset.i)][el.dataset.sizeField] = el.value; syncStock(); });
  on(view, "click", "[data-add-size]", () => { sizes.push({ size: "", stock: 0 }); drawSizes(); view.querySelector(`[data-i="${sizes.length - 1}"]`)?.focus(); });
  on(view, "click", "[data-bangle-sizes]", () => {
    for (const label of ["2.2", "2.4", "2.6", "2.8"]) if (!sizes.some((x) => x.size === label)) sizes.push({ size: label, stock: 0 });
    drawSizes();
  });
  on(view, "click", "[data-remove-size]", (e, el) => { sizes.splice(Number(el.dataset.removeSize), 1); drawSizes(); });
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

  // Sizes are edited in memory and sent as JSON when the form is saved.
  let sizes = (p?.sizes ?? []).map((x) => ({ size: x.size, stock: x.stock }));
  const syncStock = () => {
    const stock = $("[data-stock]", view), hint = $("[data-stock-hint]", view);
    const valid = sizes.filter((x) => x.size.trim());
    stock.readOnly = valid.length > 0;
    if (valid.length) stock.value = valid.reduce((n, x) => n + (Number(x.stock) || 0), 0);
    hint.textContent = valid.length ? "Total of all sizes" : "Shows as sold out at 0";
  };
  const drawSizes = () => {
    setHtml($("[data-sizes]", view), sizes.map((x, i) => html`<div class="size-row">
      <input aria-label="Size" placeholder="2.4" maxlength="12" value="${x.size}" data-size-field="size" data-i="${i}">
      <input aria-label="Stock for this size" type="number" min="0" step="1" inputmode="numeric" value="${x.stock}" data-size-field="stock" data-i="${i}">
      <button type="button" class="icon-btn" aria-label="Remove size ${x.size}" data-remove-size="${i}">${icon("trash", 16)}</button>
    </div>`));
    syncStock();
  };
  const syncModes = () => {
    const sale = $("[name=forSale]", view).checked, rent = $("[name=forRent]", view).checked;
    for (const el of view.querySelectorAll("[data-sale-fields]")) {
      el.hidden = !sale;
      el.querySelectorAll("input").forEach((i) => { i.disabled = !sale; });
    }
    $("[name=price]", view).required = sale;
    for (const el of view.querySelectorAll("[data-rent-fields]")) {
      el.hidden = !rent;
      el.querySelectorAll("input").forEach((i) => { i.disabled = !rent; });
    }
    $("[name=rentPrice]", view).required = rent;
  };
  drawSizes();
  syncModes();
  on(view, "change", "[name=forSale], [name=forRent]", syncModes);
  on(view, "input", "[data-size-field]", (e, el) => { sizes[Number(el.dataset.i)][el.dataset.sizeField] = el.value; syncStock(); });
  on(view, "click", "[data-add-size]", () => { sizes.push({ size: "", stock: 0 }); drawSizes(); view.querySelector(`[data-i="${sizes.length - 1}"]`)?.focus(); });
  on(view, "click", "[data-bangle-sizes]", () => {
    for (const label of ["2.2", "2.4", "2.6", "2.8"]) if (!sizes.some((x) => x.size === label)) sizes.push({ size: label, stock: 0 });
    drawSizes();
  });
  on(view, "click", "[data-remove-size]", (e, el) => { sizes.splice(Number(el.dataset.removeSize), 1); drawSizes(); });
      toast("Main photo updated");
    } catch (err) { toastError(err); }
  });
  on(view, "submit", "[data-product-form]", async (e, form) => {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(form);
    for (const k of ["isActive", "isNewArrival", "forSale", "forRent"]) fd.set(k, fd.get(k) ? "true" : "false");
    if (fd.get("forSale") === "true") fd.set("sizes", JSON.stringify(sizes.filter((x) => x.size.trim()).map((x) => ({ size: x.size.trim(), stock: Number(x.stock) || 0 }))));
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
