import { html, setHtml, on, $ } from "../../html.js";
import { icon } from "../../icons.js";
import { api } from "../../api.js";
import { toast, toastError } from "../../store.js";
import { confirmDialog, emptyState, errorState, openModal, pageLoading } from "../../ui.js";

export default function aiModels(view) {
  let models = null;

  setHtml(view, html`<div class="admin-page">
    <div class="admin-head">
      <div><h1>AI models</h1><p>Customers who don't upload their own photo choose one of these models for their try-on.</p></div>
      <button class="btn btn-primary" data-act="add">${icon("plus", 18)}Add model</button>
    </div>
    <div data-list>${pageLoading()}</div>
  </div>`);

  const draw = () => setHtml($("[data-list]", view), !models.length
    ? html`<div class="panel">${emptyState({
        icon: "model", title: "No models yet",
        text: "Add a few front-facing portrait photos with the ears, neck and wrists visible. Use photos you have the rights to.",
        action: html`<button class="btn btn-primary" data-act="add">Add your first model</button>`,
      })}</div>`
    : html`<div class="gallery-admin">${models.map((m) => html`<article class="model-admin ${m.isActive ? "" : "is-off"}">
        <img src="${m.imageUrl}" alt="Model ${m.name}">
        <div class="model-admin-body">
          <span><strong>${m.name}</strong><span class="muted" style="display: block; font-size: 13px">${m._count?.tryOns ?? 0} try-ons</span></span>
          <span class="pill ${m.isActive ? "pill-on" : "pill-off"}">${m.isActive ? "Shown" : "Hidden"}</span>
        </div>
        <div class="model-admin-actions">
          <button class="btn btn-quiet btn-sm" style="flex: 1" data-toggle="${m.id}">${m.isActive ? "Hide" : "Show"}</button>
          <button class="icon-btn" aria-label="Delete ${m.name}" data-delete="${m.id}">${icon("trash", 18)}</button>
        </div>
      </article>`)}</div>`);

  const load = () => api.admin.aiModels().then((r) => { models = r; draw(); }).catch((e) => setHtml($("[data-list]", view), errorState(e.message)));

  const add = () => {
    const d = openModal({
      title: "Add model",
      body: html`<form class="form" data-model-form>
        <label class="field"><span class="field-label">Name</span><input name="name" required maxlength="40" placeholder="Model 1" autofocus><span class="field-hint">Customers see this name</span></label>
        <div class="field">
          <span class="field-label">Photo</span>
          <img data-preview alt="Preview" hidden style="width: 140px; aspect-ratio: 3 / 4; object-fit: cover; border-radius: 12px">
          <label class="btn btn-quiet btn-sm" style="align-self: flex-start">${icon("upload", 16)}<span data-pick-label>Choose photo</span>
            <input name="image" type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" data-image></label>
          <span class="field-hint">Front-facing, good light, ears, neck and wrists visible.</span>
        </div>
        <p class="form-error" role="alert" data-error hidden></p>
        <div class="modal-foot" style="margin: 4px -24px -24px">
          <button type="button" class="btn btn-secondary" data-close>Cancel</button>
          <button class="btn btn-primary" data-save>Add model</button>
        </div>
      </form>`,
    });
    let previewUrl = null;
    d.addEventListener("close", () => previewUrl && URL.revokeObjectURL(previewUrl));
    $("[data-image]", d).addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = f ? URL.createObjectURL(f) : null;
      const img = $("[data-preview]", d);
      img.hidden = !previewUrl;
      if (previewUrl) img.src = previewUrl;
      $("[data-pick-label]", d).textContent = previewUrl ? "Choose another" : "Choose photo";
    });
    $("[data-model-form]", d).addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = $("[data-save]", d), errBox = $("[data-error]", d);
      const fail = (msg) => { errBox.textContent = msg; errBox.hidden = false; };
      if (!fd.get("image")?.size) return fail("Choose a photo of the model.");
      btn.disabled = true; btn.textContent = "Uploading…"; errBox.hidden = true;
      try {
        await api.admin.addAiModel(fd);
        toast("Model added");
        d.closeModal();
        load();
      } catch (err) {
        fail(err.message);
        btn.disabled = false; btn.textContent = "Add model";
      }
    });
  };

  on(view, "click", "[data-act=add]", add);
  on(view, "click", "[data-act=retry]", load);
  on(view, "click", "[data-toggle]", async (e, el) => {
    const m = models.find((x) => x.id === el.dataset.toggle);
    try {
      await api.admin.updateAiModel(m.id, { isActive: !m.isActive });
      toast(m.isActive ? `${m.name} is hidden from customers` : `${m.name} is available`);
      load();
    } catch (err) { toastError(err); }
  });
  on(view, "click", "[data-delete]", (e, el) => {
    const m = models.find((x) => x.id === el.dataset.delete);
    const used = m._count?.tryOns ?? 0;
    confirmDialog({
      title: "Delete this model?", danger: true, confirmLabel: "Delete model",
      body: used ? `${m.name} was used in ${used} try-ons, so it will be hidden instead of deleted.` : `${m.name} will be removed.`,
      onConfirm: async () => {
        try {
          const r = await api.admin.deleteAiModel(m.id);
          toast(r?.hidden ? `${m.name} has past try-ons, so it was hidden instead of deleted` : "Model deleted");
          load();
        } catch (err) { toastError(err); throw err; }
      },
    });
  });
  load();
}
