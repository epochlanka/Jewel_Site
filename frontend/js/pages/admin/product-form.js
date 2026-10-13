import { html, attr, setHtml, on, $ } from "../../html.js";
import { icon } from "../../icons.js";
import { api } from "../../api.js";
import { jewelleryTypes, typeLabel } from "../../format.js";
import { toast, toastError } from "../../store.js";
import { errorState, pageLoading, switchField } from "../../ui.js";
import { navigate } from "../../router.js";

const okType = (f) => /image\/(jpeg|png|webp)/.test(f.type) && f.size <= 8 * 1024 * 1024;

// Common jewellery colours for the palette; "Custom colour" adds any other.
const palette = [
  ["Gold", "#d4af37"], ["Rose gold", "#b76e79"], ["Silver", "#c0c0c0"], ["White gold", "#e8e4d6"],
  ["Antique gold", "#a8833a"], ["Black", "#2b2b2b"], ["Ruby red", "#9b1b30"], ["Emerald green", "#1f7a4d"],
  ["Sapphire blue", "#2f4f9e"], ["Pearl white", "#f3eee4"], ["Purple", "#6b3fa0"], ["Pink", "#e48aa6"],
];

export default async function productForm(view, ctx) {
  const id = ctx.params.id;
  const isNew = !id;
  let p = null, busy = false;
  let files = []; // new photos: { file, url, colour }
  ctx.onCleanup(() => files.forEach((f) => URL.revokeObjectURL(f.url)));

  setHtml(view, pageLoading());
  let cats = [];
  try {
    [cats, p] = await Promise.all([api.categories().catch(() => []), isNew ? null : api.admin.product(id)]);
  } catch (e) {
    return setHtml(view, errorState(e.message, false));
  }
  if (!ctx.alive()) return;

  // Options are edited in memory and sent as JSON when the form is saved.
  let images = (p?.images ?? []).map((im) => ({ ...im }));
  let sizes = (p?.sizes ?? []).map((x) => ({ size: x.size, stock: x.stock }));
  let colours = (p?.colours ?? []).map((c) => ({ name: c.name, hex: c.hex, stock: c.stock }));
  const grid = new Map((p?.variants ?? []).map((v) => [`${v.colour}|${v.size}`, v.stock]));
  const named = (list, key) => list.filter((x) => String(x[key]).trim());

  const colourSelect = (value, attrs) => {
    const names = named(colours, "name").map((c) => c.name);
    if (!names.length) return "";
    return html`<select class="im-colour" aria-label="Colour shown in this photo" ${attrs}>
      <option value="">Any colour</option>
      ${names.map((n) => html`<option value="${n}"${attr("selected", value === n)}>${n}</option>`)}
    </select>`;
  };

  const drawImages = () => setHtml($("[data-images]", view), html`
    ${images.map((img, i) => html`<div class="im-tile">
      <img src="${img.url}" alt="Photo ${i + 1}">
      ${i === 0 && html`<span class="im-tile-main">Main</span>`}
      <div class="im-tile-actions">
        ${i > 0 && html`<button type="button" class="icon-btn" aria-label="Make photo ${i + 1} the main photo" title="Make main" data-main="${img.id}">${icon("check", 16)}</button>`}
        <button type="button" class="icon-btn" aria-label="Remove photo ${i + 1}" title="Remove" data-delete-image="${img.id}">${icon("trash", 16)}</button>
      </div>
      ${colourSelect(img.colour, html`data-image-colour="${img.id}"`)}
    </div>`)}
    ${files.map((f, i) => {
      const main = images.length === 0 && i === 0;
      return html`<div class="im-tile">
        <img src="${f.url}" alt="New photo ${i + 1}">
        <span class="${main ? "im-tile-main" : "im-tile-new"}">${main ? "Main" : "New"}</span>
        <div class="im-tile-actions"><button type="button" class="icon-btn" aria-label="Remove new photo ${i + 1}" data-remove-new="${i}">${icon("close", 16)}</button></div>
        ${colourSelect(f.colour, html`data-file-colour="${i}"`)}
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
            <span class="field-label">Colours <span class="optional">(optional)</span></span>
            <span class="field-hint">Pick the colours this piece comes in. Customers choose one, and photos tagged with that colour are shown.</span>
            <div class="palette" role="group" aria-label="Add a colour">
              ${palette.map(([name, hex]) => html`<button type="button" class="palette-chip" data-palette="${name}" data-hex="${hex}"><span class="swatch swatch-sm" style="--swatch: ${hex}"></span>${name}</button>`)}
              <button type="button" class="palette-chip" data-custom-colour>${icon("plus", 14)}Custom colour</button>
            </div>
            <div class="size-editor" data-colours></div>
          </div>

          <div class="field" data-sale-fields>
            <span class="field-label">Sizes <span class="optional">(optional)</span></span>
            <span class="field-hint">For bangles or rings. Customers must choose a size.</span>
            <div class="size-editor" data-sizes></div>
            <div class="size-editor-actions">
              <button type="button" class="btn btn-quiet btn-sm" data-add-size>${icon("plus", 16)}Add a size</button>
              <button type="button" class="btn btn-quiet btn-sm" data-bangle-sizes>Add bangle sizes 2.2 to 2.8</button>
            </div>
          </div>

          <div class="field" data-sale-fields data-grid-wrap>
            <span class="field-label">Stock for each colour and size</span>
            <div class="stock-grid-wrap" data-grid></div>
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
          <p class="field-hint" style="margin-top: -8px">The first photo is the main one in the shop. JPG, PNG or WebP, up to 8 MB each. With colours, choose which colour each photo shows.</p>
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

  // ---------- Stock ----------
  // The stock field is the total when stock is kept per colour and/or size.
  const syncStock = () => {
    const stock = $("[data-stock]", view), hint = $("[data-stock-hint]", view);
    const cs = named(colours, "name"), ss = named(sizes, "size");
    let total = null, label = "Shows as sold out at 0";
    if (cs.length && ss.length) {
      total = 0;
      for (const c of cs) for (const s of ss) total += Number(grid.get(`${c.name}|${s.size}`)) || 0;
      label = "Total of all colours and sizes";
    } else if (cs.length) {
      total = cs.reduce((n, c) => n + (Number(c.stock) || 0), 0);
      label = "Total of all colours";
    } else if (ss.length) {
      total = ss.reduce((n, s) => n + (Number(s.stock) || 0), 0);
      label = "Total of all sizes";
    }
    stock.readOnly = total !== null;
    if (total !== null) stock.value = total;
    hint.textContent = label;
  };

  const drawColours = () => {
    const withSizes = named(sizes, "size").length > 0;
    setHtml($("[data-colours]", view), colours.map((c, i) => html`<div class="size-row colour-row ${withSizes ? "no-stock" : ""}">
      <input type="color" class="colour-input" aria-label="Swatch colour for ${c.name || "this colour"}" value="${c.hex}" data-colour-field="hex" data-i="${i}">
      <input aria-label="Colour name" placeholder="Rose gold" maxlength="30" value="${c.name}" data-colour-field="name" data-i="${i}">
      ${!withSizes && html`<input aria-label="Stock for ${c.name || "this colour"}" type="number" min="0" step="1" inputmode="numeric" value="${c.stock}" data-colour-field="stock" data-i="${i}">`}
      <button type="button" class="icon-btn" aria-label="Remove colour ${c.name}" data-remove-colour="${i}">${icon("trash", 16)}</button>
    </div>`));
  };

  const drawSizes = () => {
    const withColours = named(colours, "name").length > 0;
    setHtml($("[data-sizes]", view), sizes.map((x, i) => html`<div class="size-row ${withColours ? "no-stock" : ""}">
      <input aria-label="Size" placeholder="2.4" maxlength="12" value="${x.size}" data-size-field="size" data-i="${i}">
      ${!withColours && html`<input aria-label="Stock for this size" type="number" min="0" step="1" inputmode="numeric" value="${x.stock}" data-size-field="stock" data-i="${i}">`}
      <button type="button" class="icon-btn" aria-label="Remove size ${x.size}" data-remove-size="${i}">${icon("trash", 16)}</button>
    </div>`));
  };

  const drawGrid = () => {
    const cs = named(colours, "name"), ss = named(sizes, "size");
    const wrap = $("[data-grid-wrap]", view);
    wrap.hidden = !(cs.length && ss.length) || !$("[name=forSale]", view).checked;
    if (wrap.hidden) return setHtml($("[data-grid]", view), "");
    setHtml($("[data-grid]", view), html`<table class="stock-grid">
      <thead><tr><th scope="col">Colour</th>${ss.map((s) => html`<th scope="col">${s.size}</th>`)}</tr></thead>
      <tbody>${cs.map((c) => html`<tr>
        <th scope="row"><span class="swatch swatch-sm" style="--swatch: ${c.hex}"></span>${c.name}</th>
        ${ss.map((s) => html`<td><input type="number" min="0" step="1" inputmode="numeric" aria-label="Stock for ${c.name} size ${s.size}"
          value="${grid.get(`${c.name}|${s.size}`) ?? 0}" data-grid-cell="${c.name}|${s.size}"></td>`)}
      </tr>`)}</tbody>
    </table>`);
  };

  const drawOptions = () => { drawColours(); drawSizes(); drawGrid(); drawImages(); syncStock(); };

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
    drawGrid();
  };

  drawOptions();
  syncModes();

  // ---------- Events ----------
  on(view, "change", "[name=forSale], [name=forRent]", () => { syncModes(); syncStock(); });

  on(view, "click", "[data-palette]", (e, el) => {
    const name = el.dataset.palette;
    if (colours.some((c) => c.name.toLowerCase() === name.toLowerCase())) return toast(`${name} is already added`);
    colours.push({ name, hex: el.dataset.hex, stock: 0 });
    drawOptions();
  });
  on(view, "click", "[data-custom-colour]", () => {
    colours.push({ name: "", hex: "#d4af37", stock: 0 });
    drawOptions();
    view.querySelector(`[data-colour-field="name"][data-i="${colours.length - 1}"]`)?.focus();
  });
  on(view, "input", "[data-colour-field]", (e, el) => {
    const c = colours[Number(el.dataset.i)], field = el.dataset.colourField;
    if (field === "name") {
      // Keep this colour's photo tags and grid stock when it is renamed.
      const old = c.name, next = el.value;
      images.forEach((im) => { if (old && im.colour === old) im.colour = next; });
      files.forEach((f) => { if (old && f.colour === old) f.colour = next; });
      for (const [k, v] of [...grid]) if (old && k.startsWith(`${old}|`)) { grid.delete(k); grid.set(`${next}|${k.slice(old.length + 1)}`, v); }
    }
    c[field] = el.value;
    syncStock();
  });
  // Name and swatch changes show up in the photo dropdowns and grid once the field is left.
  on(view, "change", "[data-colour-field]", () => { drawGrid(); drawImages(); });
  on(view, "click", "[data-remove-colour]", (e, el) => {
    const [gone] = colours.splice(Number(el.dataset.removeColour), 1);
    images.forEach((im) => { if (im.colour === gone.name) im.colour = ""; });
    files.forEach((f) => { if (f.colour === gone.name) f.colour = ""; });
    drawOptions();
  });

  on(view, "input", "[data-size-field]", (e, el) => { sizes[Number(el.dataset.i)][el.dataset.sizeField] = el.value; syncStock(); });
  on(view, "change", "[data-size-field]", () => { drawGrid(); drawColours(); });
  on(view, "click", "[data-add-size]", () => {
    sizes.push({ size: "", stock: 0 });
    drawOptions();
    view.querySelector(`[data-size-field="size"][data-i="${sizes.length - 1}"]`)?.focus();
  });
  on(view, "click", "[data-bangle-sizes]", () => {
    for (const label of ["2.2", "2.4", "2.6", "2.8"]) if (!sizes.some((x) => x.size === label)) sizes.push({ size: label, stock: 0 });
    drawOptions();
  });
  on(view, "click", "[data-remove-size]", (e, el) => { sizes.splice(Number(el.dataset.removeSize), 1); drawOptions(); });
  on(view, "input", "[data-grid-cell]", (e, el) => { grid.set(el.dataset.gridCell, el.value); syncStock(); });

  on(view, "change", "[data-image-colour]", (e, el) => { const im = images.find((x) => x.id === el.dataset.imageColour); if (im) im.colour = el.value; });
  on(view, "change", "[data-file-colour]", (e, el) => { files[Number(el.dataset.fileColour)].colour = el.value; });

  on(view, "change", "[data-add-images]", (e, el) => {
    const list = [...el.files];
    const good = list.filter(okType);
    if (good.length < list.length) toast("Some files were skipped. Use JPG, PNG or WebP up to 8 MB.", { kind: "error" });
    files = [...files, ...good.map((file) => ({ file, url: URL.createObjectURL(file), colour: "" }))].slice(0, 10);
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
    for (const k of ["isActive", "isNewArrival", "forSale", "forRent"]) fd.set(k, fd.get(k) ? "true" : "false");
    // Pickers and option inputs only fill in the state above; the state is sent as JSON.
    for (const k of [...fd.keys()]) if (fd.get(k) instanceof File) fd.delete(k);
    if (fd.get("forSale") === "true") {
      const cs = named(colours, "name"), ss = named(sizes, "size");
      fd.set("sizes", JSON.stringify(ss.map((s) => ({ size: s.size.trim(), stock: Number(s.stock) || 0 }))));
      fd.set("colours", JSON.stringify(cs.map((c) => ({ name: c.name.trim(), hex: c.hex, stock: Number(c.stock) || 0 }))));
      fd.set("variants", JSON.stringify(cs.flatMap((c) => ss.map((s) => ({ colour: c.name.trim(), size: s.size.trim(), stock: Number(grid.get(`${c.name}|${s.size}`)) || 0 })))));
    }
    fd.set("imageColours", JSON.stringify(Object.fromEntries(images.map((im) => [im.id, (im.colour ?? "").trim()]))));
    fd.set("newImageColours", JSON.stringify(files.map((f) => (f.colour ?? "").trim())));
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
