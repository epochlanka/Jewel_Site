import { html, attr, setHtml, on, $ } from "../html.js";
import { icon } from "../icons.js";
import { api } from "../api.js";
import { lkr } from "../format.js";
import { addToCart, toast } from "../store.js";
import { emptyState, pageLoading, price, productImage } from "../ui.js";

const MAX_MB = 8;
const neckTypes = ["NECKLACE", "CHAIN", "LONG_CHAIN"], wristTypes = ["BANGLE", "BRACELET"];

export default async function tryOn(view, ctx) {
  const ids = (ctx.query.get("products") ?? "").split(",").filter(Boolean);
  const s = {
    items: null, mode: null, models: null, modelId: null, photo: null, preview: null, over: false,
    cameraOn: false, overlayScale: 100, overlayOffset: 0, job: null, err: "",
  };
  let timer = null, stream = null;

  const stopCamera = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; s.cameraOn = false; };
  const setPhoto = (file) => {
    if (s.preview) URL.revokeObjectURL(s.preview);
    s.photo = file;
    s.preview = file ? URL.createObjectURL(file) : null;
  };
  ctx.onCleanup(() => { clearInterval(timer); stopCamera(); setPhoto(null); });

  const total = () => s.items.reduce((sum, p) => sum + (p.salePrice ?? p.price), 0);
  const names = () => s.items.map((p) => p.name).join(", ");

  const overlayStyle = (type, side) => {
    const top = type === "EARRINGS" ? 39 : neckTypes.includes(type) ? 69 : wristTypes.includes(type) ? 80 : 60;
    const sc = s.overlayScale / 100;
    const [left, width, flip] = type === "EARRINGS" ? [side === "left" ? 24 : 76, 18, " scaleX(-1)"]
      : neckTypes.includes(type) ? [50, 54, ""] : wristTypes.includes(type) ? [72, 30, ""] : [65, 22, ""];
    return `top: ${top + s.overlayOffset}%; left: ${left}%; width: ${width * sc}%; transform: translate(-50%, -50%)${flip}`;
  };

  const stage = () => {
    const { job, mode, items } = s;
    if (job) {
      if (job.status === "DONE" && job.resultUrl) {
        return html`<div class="result">
          <div class="result-img"><img src="${job.resultUrl}" alt="Preview wearing ${names()}"></div>
          <div class="result-info">
            <h2>Here's how it looks</h2>
            <p class="muted">Wearing ${names()}.</p>
            <button class="btn btn-primary btn-lg" data-act="add">Add ${items.length > 1 ? `all ${items.length} to cart` : "to cart"} · ${lkr(total())}</button>
            <div class="tryon-actions" style="margin-top: 0">
              <button class="btn btn-quiet" data-act="save">${icon("download", 18)}Save</button>
              <button class="btn btn-quiet" data-act="share">${icon("share", 18)}Share</button>
              <button class="btn btn-quiet" data-act="reset">${icon("refresh", 18)}Try again</button>
            </div>
            <p class="result-note">AI previews show how a piece may look. Size and colour can vary slightly in real life.</p>
          </div>
        </div>`;
      }
      if (job.status === "FAILED") {
        return html`<div class="empty-state">
          <span class="empty-icon empty-icon-error">${icon("alert", 28)}</span>
          <h2>We couldn't make the preview</h2>
          <p>${job.error ?? "Try a different photo or model."}</p>
          <button class="btn btn-primary" data-act="reset">Try again</button>
        </div>`;
      }
      return html`<div class="generating" role="status">
        <span class="generating-art">${icon("sparkle", 44)}</span>
        <h2>Creating your preview</h2>
        <p>This usually takes a few seconds. Keep this page open.</p>
      </div>`;
    }
    if (!mode) {
      return html`<h2 class="sr-only">How would you like to try it on?</h2>
        <div class="method-grid">
          <button class="method" data-mode="AI_MODEL"><span class="method-icon">${icon("model", 28)}</span><strong>Use an AI model</strong><span>Pick a model and see the piece on them. Quick, and no photo needed.</span></button>
          <button class="method" data-mode="UPLOAD"><span class="method-icon">${icon("camera", 28)}</span><strong>Upload your photo</strong><span>See it on yourself. Your photo is only used to make this preview.</span></button>
          <button class="method" data-mode="LIVE"><span class="method-icon">${icon("camera", 28)}</span><strong>Live camera overlay</strong><span>See the product photos over your camera feed. No AI service needed; placement is approximate.</span></button>
        </div>`;
    }
    if (mode === "AI_MODEL") {
      return html`<h2 class="sr-only">Pick a model</h2>${!s.models ? pageLoading("Loading models…")
        : !s.models.length ? emptyState({ icon: "model", title: "No models yet", text: "The shop hasn't added AI models yet.", action: html`<button class="btn btn-primary" data-mode="UPLOAD">Upload your photo instead</button>` })
        : html`<div class="model-grid">${s.models.map((m) => html`
            <button class="model-card" aria-pressed="${String(s.modelId === m.id)}" data-model="${m.id}" aria-label="Model ${m.name}">
              <img src="${m.imageUrl}" alt=""><span class="model-card-check">${icon("check", 16)}</span><span class="model-card-name">${m.name}</span>
            </button>`)}</div>`}`;
    }
    if (mode === "LIVE") {
      return html`<div class="live-tryon">
        <div class="live-stage">
          <video autoplay playsinline muted aria-label="Live camera preview"></video>
          ${items.flatMap((p) => (p.jewelleryType === "EARRINGS" ? ["left", "right"] : [null]).map((side) =>
            html`<img class="live-jewel" src="${p.images[0]?.url ?? ""}" alt="" aria-hidden="true" style="${overlayStyle(p.jewelleryType, side)}">`))}
        </div>
        <p class="live-disclaimer">Approximate preview. Product photos may include a background, and placement or scale may not match real fit. Your live camera feed stays on this device.</p>
        <div class="live-controls">
          <label>Jewellery size <input type="range" min="65" max="145" value="${s.overlayScale}" data-range="overlayScale"></label>
          <label>Vertical position <input type="range" min="-12" max="12" value="${s.overlayOffset}" data-range="overlayOffset"></label>
        </div>
        <div class="tryon-actions" style="margin-top: 8px"><button class="btn btn-quiet" data-act="stop-live">${icon("close", 18)}Stop camera</button></div>
      </div>`;
    }
    // UPLOAD
    const picker = html`<input type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" data-file>`;
    return html`<h2 class="sr-only">Add your photo</h2>${s.cameraOn
      ? html`<div class="camera-capture">
          <video autoplay playsinline muted aria-label="Live camera preview"></video>
          <p class="muted">Face the camera in good, even lighting.</p>
          <div class="tryon-actions" style="margin-top: 4px">
            <button class="btn btn-quiet" data-act="cancel-camera">Cancel</button>
            <button class="btn btn-primary" data-act="capture">${icon("camera", 18)}Capture photo</button>
          </div>
        </div>`
      : s.preview
        ? html`<div class="photo-preview">
            <img src="${s.preview}" alt="Your photo">
            <div class="stack">
              <ul class="tips"><li>${icon("checkCircle")}Face clearly visible</li><li>${icon("checkCircle")}Good, even lighting</li><li>${icon("checkCircle")}Facing the camera</li></ul>
              <label class="btn btn-quiet" style="align-self: flex-start">${icon("refresh", 18)}Choose another photo${picker}</label>
            </div>
          </div>`
        : html`<div class="photo-options">
            <button class="btn btn-secondary" data-act="open-camera">${icon("camera", 18)}Open camera</button>
            <label class="dropzone ${s.over ? "is-over" : ""}" data-dropzone>
              <span class="dropzone-icon">${icon("upload", 26)}</span>
              <strong>Choose a photo or drop it here</strong>
              <span>JPG, PNG or WebP, up to ${MAX_MB} MB. A clear, front-facing photo works best.</span>
              ${picker}
            </label>
          </div>`}`;
  };

  const draw = () => {
    const { items, job, mode } = s;
    const step = job ? 3 : mode ? 2 : 1;
    const ready = (mode === "AI_MODEL" && !!s.modelId) || (mode === "UPLOAD" && !!s.photo);
    const labels = ["Choose how", mode === "UPLOAD" ? "Add your photo" : mode === "LIVE" ? "Live camera" : "Pick a model", "Your preview"];
    setHtml(view, html`<div class="page">
      <div class="page-head"><h1>Virtual try-on</h1></div>
      <ol class="stepper" aria-label="Steps">${labels.map((label, i) => html`
        <li class="${step === i + 1 ? "is-current" : step > i + 1 ? "is-done" : ""}"${attr("aria-current", step === i + 1 && "step")}><span class="step-dot">${step > i + 1 ? icon("check", 14) : i + 1}</span>${label}</li>`)}
      </ol>
      <div class="tryon">
        <div>
          ${stage()}
          ${s.err && html`<p class="form-error" role="alert" style="margin-top: 16px">${s.err}</p>`}
          ${!job && mode && mode !== "LIVE" && html`<div class="tryon-actions">
            <button class="btn btn-quiet" data-act="back">${icon("arrowLeft", 18)}Back</button>
            <button class="btn btn-primary" data-act="generate"${attr("disabled", !ready)}>${icon("sparkle", 18)}Create preview</button>
          </div>`}
        </div>
        <aside class="tryon-side" aria-label="Pieces you're trying on">
          <h2>Trying on</h2>
          ${items.map((p) => html`<div class="mini-item">
            <span class="mini-item-img">${productImage(p.images[0]?.url, "", { type: p.jewelleryType, iconSize: 30 })}</span>
            <span><a href="/product/${p.slug}" class="mini-item-name">${p.name}</a><br>${price(p.price, p)}</span>
          </div>`)}
          ${items.length > 1 && html`<div class="tray-total"><span>Total</span><span>${lkr(total())}</span></div>`}
        </aside>
      </div>
    </div>`);
    const video = $("video", view);
    if (video && stream) video.srcObject = stream;
  };

  const pickFile = (f) => {
    s.err = "";
    if (f) {
      if (!/image\/(jpeg|png|webp)/.test(f.type)) s.err = "Choose a JPG, PNG or WebP photo.";
      else if (f.size > MAX_MB * 1024 * 1024) s.err = `That photo is over ${MAX_MB} MB. Choose a smaller one.`;
      else setPhoto(f);
    }
    draw();
  };

  const startCamera = async () => {
    s.err = "";
    try {
      const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      stopCamera();
      stream = next;
      s.cameraOn = true;
      return true;
    } catch {
      s.err = "We couldn't access your camera. Allow camera access or choose a photo instead.";
      return false;
    }
  };

  const capture = () => {
    const el = $("video", view);
    if (!el?.videoWidth || !el.videoHeight) { s.err = "The camera is still starting. Try again in a moment."; return draw(); }
    const canvas = document.createElement("canvas");
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    const g = canvas.getContext("2d");
    if (!g) { s.err = "We couldn't capture the photo. Choose an image from your device instead."; return draw(); }
    g.translate(canvas.width, 0);
    g.scale(-1, 1);
    g.drawImage(el, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      stopCamera();
      if (blob) pickFile(new File([blob], "camera-photo.jpg", { type: "image/jpeg" }));
      else { s.err = "We couldn't capture the photo. Please try again."; draw(); }
    }, "image/jpeg", 0.9);
  };

  const poll = (id) => {
    const started = Date.now();
    timer = setInterval(async () => {
      try {
        s.job = await api.tryOnStatus(id);
        if (s.job.status === "DONE" || s.job.status === "FAILED") clearInterval(timer);
      } catch { /* keep polling */ }
      if (Date.now() - started > 120_000 && s.job?.status !== "DONE" && s.job?.status !== "FAILED") {
        clearInterval(timer);
        s.job = { id, status: "FAILED", error: "This is taking longer than expected. Try again in a moment." };
      }
      if (ctx.alive()) draw();
    }, 2000);
  };

  const generate = async () => {
    s.err = "";
    const fd = new FormData();
    fd.append("productIds", JSON.stringify(s.items.map((p) => p.id)));
    fd.append("source", s.mode);
    if (s.mode === "AI_MODEL" && s.modelId) fd.append("aiModelId", s.modelId);
    if (s.mode === "UPLOAD" && s.photo) fd.append("photo", s.photo);
    try {
      s.job = await api.startTryOn(fd);
      poll(s.job.id);
    } catch (e) { s.err = e.message; }
    draw();
  };

  on(view, "click", "[data-mode]", async (e, el) => {
    const mode = el.dataset.mode;
    if (mode === "LIVE") { if (await startCamera()) s.mode = "LIVE"; return draw(); }
    s.mode = mode;
    draw();
    if (mode === "AI_MODEL" && !s.models) {
      s.models = await api.aiModels().catch(() => []);
      draw();
    }
  });
  on(view, "click", "[data-model]", (e, el) => { s.modelId = el.dataset.model; draw(); });
  on(view, "change", "[data-file]", (e, el) => pickFile(el.files?.[0]));
  on(view, "input", "[data-range]", (e, el) => {
    s[el.dataset.range] = Number(el.value);
    const imgs = view.querySelectorAll(".live-jewel");
    let i = 0;
    for (const p of s.items) for (const side of p.jewelleryType === "EARRINGS" ? ["left", "right"] : [null]) imgs[i++]?.setAttribute("style", overlayStyle(p.jewelleryType, side));
  });
  on(view, "dragover", "[data-dropzone]", (e) => { e.preventDefault(); if (!s.over) { s.over = true; e.target.closest("[data-dropzone]").classList.add("is-over"); } });
  on(view, "dragleave", "[data-dropzone]", (e, el) => { s.over = false; el.classList.remove("is-over"); });
  on(view, "drop", "[data-dropzone]", (e) => { e.preventDefault(); s.over = false; pickFile(e.dataTransfer.files[0]); });
  on(view, "click", "[data-act]", async (e, el) => {
    switch (el.dataset.act) {
      case "back": s.mode = null; s.err = ""; return draw();
      case "generate": return generate();
      case "open-camera": await startCamera(); return draw();
      case "cancel-camera": stopCamera(); return draw();
      case "capture": return capture();
      case "stop-live": stopCamera(); s.mode = null; return draw();
      case "reset": clearInterval(timer); s.job = null; return draw();
      case "add": return addToCart(s.items.map((p) => ({ productId: p.id, qty: 1 })), s.items.length > 1 ? "Your look was added to the cart" : `${s.items[0].name} added to cart`);
      case "save":
        try {
          const blob = await (await fetch(s.job.resultUrl)).blob();
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "my-try-on.jpg";
          a.click();
          URL.revokeObjectURL(a.href);
        } catch { window.open(s.job.resultUrl, "_blank"); }
        return;
      case "share":
        try {
          const url = new URL(s.job.resultUrl, location.href).href;
          if (navigator.share) await navigator.share({ title: "My try-on", url });
          else { await navigator.clipboard.writeText(url); toast("Link copied"); }
        } catch { /* closed */ }
    }
  });

  setHtml(view, pageLoading());
  if (ids.length) {
    s.items = await api.products({ ids: ids.join(","), limit: 20 }).then((r) => r.items.filter((p) => p.tryOnEnabled)).catch(() => []);
  } else s.items = [];
  if (!ctx.alive()) return;
  if (!s.items.length) {
    return setHtml(view, html`<div class="page">${emptyState({
      icon: "sparkle", title: "Choose a piece to try on",
      text: "Open any product and select “Try it on with AI”, or build a full set in Create your look.",
      action: html`<a href="/shop?tryOn=1" class="btn btn-primary">Browse pieces you can try on</a>`,
    })}</div>`);
  }
  draw();
}
