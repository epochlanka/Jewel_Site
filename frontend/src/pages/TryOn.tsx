import { CSSProperties, DragEvent, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { AiModel, Product, TryOnJob } from "../api/types";
import { lkr } from "../api/format";
import { useCart } from "../context/CartContext";
import { useToast } from "../context/ToastContext";
import Icon from "../components/Icon";
import { EmptyState, PageLoading, Price, ProductImage } from "../components/ui";

type Mode = "AI_MODEL" | "UPLOAD" | "LIVE";
const MAX_MB = 8;

export default function TryOn() {
  const [sp] = useSearchParams();
  const ids = (sp.get("products") ?? "").split(",").filter(Boolean);
  const { add } = useCart();
  const { show } = useToast();

  const [items, setItems] = useState<Product[] | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [models, setModels] = useState<AiModel[] | null>(null);
  const [modelId, setModelId] = useState<string>();
  const [photo, setPhoto] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [over, setOver] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [overlayScale, setOverlayScale] = useState(100);
  const [overlayOffset, setOverlayOffset] = useState(0);
  const [job, setJob] = useState<TryOnJob | null>(null);
  const [err, setErr] = useState("");
  const timer = useRef<number>();
  const started = useRef(0);
  const video = useRef<HTMLVideoElement>(null);
  const camera = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!ids.length) { setItems([]); return; }
    api.products({ ids: ids.join(","), limit: 20 }).then((r) => setItems(r.items.filter((p) => p.tryOnEnabled))).catch(() => setItems([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.get("products")]);

  useEffect(() => { if (mode === "AI_MODEL" && !models) api.aiModels().then(setModels).catch(() => setModels([])); }, [mode, models]);
  useEffect(() => () => { window.clearInterval(timer.current); }, []);
  useEffect(() => () => camera.current?.getTracks().forEach((track) => track.stop()), []);
  useEffect(() => {
    if (cameraOn && video.current && camera.current) video.current.srcObject = camera.current;
  }, [cameraOn]);
  useEffect(() => {
    if (!photo) { setPreview(undefined); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  if (!items) return <PageLoading />;
  if (!items.length) return (
    <div className="page">
      <EmptyState icon="sparkle" title="Choose a piece to try on" action={<Link to="/shop?tryOn=1" className="btn btn-primary">Browse pieces you can try on</Link>}>
        Open any product and select “Try it on with AI”, or build a full set in Create your look.
      </EmptyState>
    </div>
  );

  const pickFile = (f?: File) => {
    setErr("");
    if (!f) return;
    if (!/image\/(jpeg|png|webp)/.test(f.type)) { setErr("Choose a JPG, PNG or WebP photo."); return; }
    if (f.size > MAX_MB * 1024 * 1024) { setErr(`That photo is over ${MAX_MB} MB. Choose a smaller one.`); return; }
    setPhoto(f);
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); pickFile(e.dataTransfer.files[0]); };

  const startCamera = async (): Promise<boolean> => {
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      camera.current?.getTracks().forEach((track) => track.stop());
      camera.current = stream;
      setCameraOn(true);
      return true;
    } catch {
      setErr("We couldn't access your camera. Allow camera access or choose a photo instead.");
      return false;
    }
  };

  const startLivePreview = async () => {
    if (await startCamera()) setMode("LIVE");
  };

  const stopCamera = () => {
    camera.current?.getTracks().forEach((track) => track.stop());
    camera.current = null;
    setCameraOn(false);
  };

  const capturePhoto = () => {
    const el = video.current;
    if (!el?.videoWidth || !el.videoHeight) { setErr("The camera is still starting. Try again in a moment."); return; }
    const canvas = document.createElement("canvas");
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) { setErr("We couldn't capture the photo. Choose an image from your device instead."); return; }
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(el, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) pickFile(new File([blob], "camera-photo.jpg", { type: "image/jpeg" }));
      else setErr("We couldn't capture the photo. Please try again.");
      stopCamera();
    }, "image/jpeg", 0.9);
  };

  const poll = (id: string) => {
    started.current = Date.now();
    timer.current = window.setInterval(async () => {
      try {
        const s = await api.tryOnStatus(id);
        setJob(s);
        if (s.status === "DONE" || s.status === "FAILED") window.clearInterval(timer.current);
      } catch { /* keep polling */ }
      if (Date.now() - started.current > 120_000) {
        window.clearInterval(timer.current);
        setJob({ id, status: "FAILED", error: "This is taking longer than expected. Try again in a moment." });
      }
    }, 2000);
  };

  const generate = async () => {
    setErr("");
    const fd = new FormData();
    fd.append("productIds", JSON.stringify(items.map((p) => p.id)));
    fd.append("source", mode!);
    if (mode === "AI_MODEL" && modelId) fd.append("aiModelId", modelId);
    if (mode === "UPLOAD" && photo) fd.append("photo", photo);
    try {
      const j = await api.startTryOn(fd);
      setJob(j);
      poll(j.id);
    } catch (e) { setErr((e as Error).message); }
  };

  const reset = () => { window.clearInterval(timer.current); setJob(null); };
  const step = job ? 3 : mode ? 2 : 1;
  const total = items.reduce((s, p) => s + (p.salePrice ?? p.price), 0);
  const ready = (mode === "AI_MODEL" && !!modelId) || (mode === "UPLOAD" && !!photo);

  const liveOverlay = (type: Product["jewelleryType"], side?: "left" | "right") => {
    const shared = { top: `calc(var(--top) + ${overlayOffset}%)` } as CSSProperties;
    if (type === "EARRINGS") return {
      ...shared, left: side === "left" ? "24%" : "76%", width: `${18 * overlayScale / 100}%`,
      transform: `translate(-50%, -50%) scaleX(-1)`,
    };
    if (["NECKLACE", "CHAIN", "LONG_CHAIN"].includes(type)) return {
      ...shared, left: "50%", width: `${54 * overlayScale / 100}%`, transform: "translate(-50%, -50%)",
    };
    if (["BANGLE", "BRACELET"].includes(type)) return {
      ...shared, left: "72%", width: `${30 * overlayScale / 100}%`, transform: "translate(-50%, -50%)",
    };
    return { ...shared, left: "65%", width: `${22 * overlayScale / 100}%`, transform: "translate(-50%, -50%)" };
  };

  const save = async () => {
    if (!job?.resultUrl) return;
    try {
      const blob = await (await fetch(job.resultUrl)).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "my-try-on.jpg";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { window.open(job.resultUrl, "_blank"); }
  };
  const share = async () => {
    if (!job?.resultUrl) return;
    try {
      if (navigator.share) await navigator.share({ title: "My try-on", url: job.resultUrl });
      else { await navigator.clipboard.writeText(job.resultUrl); show("Link copied"); }
    } catch { /* closed */ }
  };

  return (
    <div className="page">
      <div className="page-head"><h1>Virtual try-on</h1></div>
      <ol className="stepper" aria-label="Steps">
        {["Choose how", mode === "UPLOAD" ? "Add your photo" : mode === "LIVE" ? "Live camera" : "Pick a model", "Your preview"].map((label, i) => (
          <li key={label} className={step === i + 1 ? "is-current" : step > i + 1 ? "is-done" : ""} aria-current={step === i + 1 ? "step" : undefined}>
            <span className="step-dot">{step > i + 1 ? <Icon name="check" size={14} /> : i + 1}</span>{label}
          </li>
        ))}
      </ol>

      <div className="tryon">
        <div>
          {job ? (
            job.status === "DONE" && job.resultUrl ? (
              <div className="result">
                <div className="result-img"><img src={job.resultUrl} alt={`Preview wearing ${items.map((p) => p.name).join(", ")}`} /></div>
                <div className="result-info">
                  <h2>Here's how it looks</h2>
                  <p className="muted">Wearing {items.map((p) => p.name).join(", ")}.</p>
                  <button className="btn btn-primary btn-lg" onClick={() => add(items.map((p) => ({ productId: p.id, qty: 1 })), items.length > 1 ? "Your look was added to the cart" : `${items[0].name} added to cart`)}>
                    Add {items.length > 1 ? `all ${items.length} to cart` : "to cart"} · {lkr(total)}
                  </button>
                  <div className="tryon-actions" style={{ marginTop: 0 }}>
                    <button className="btn btn-quiet" onClick={save}><Icon name="download" size={18} />Save</button>
                    <button className="btn btn-quiet" onClick={share}><Icon name="share" size={18} />Share</button>
                    <button className="btn btn-quiet" onClick={reset}><Icon name="refresh" size={18} />Try again</button>
                  </div>
                  <p className="result-note">AI previews show how a piece may look. Size and colour can vary slightly in real life.</p>
                </div>
              </div>
            ) : job.status === "FAILED" ? (
              <div className="empty-state">
                <span className="empty-icon empty-icon-error"><Icon name="alert" size={28} /></span>
                <h2>We couldn't make the preview</h2>
                <p>{job.error ?? "Try a different photo or model."}</p>
                <button className="btn btn-primary" onClick={reset}>Try again</button>
              </div>
            ) : (
              <div className="generating" role="status">
                <span className="generating-art"><Icon name="sparkle" size={44} /></span>
                <h2>Creating your preview</h2>
                <p>This usually takes a few seconds. Keep this page open.</p>
              </div>
            )
          ) : !mode ? (
            <>
              <h2 className="sr-only">How would you like to try it on?</h2>
              <div className="method-grid">
                <button className="method" onClick={() => setMode("AI_MODEL")}>
                  <span className="method-icon"><Icon name="model" size={28} /></span>
                  <strong>Use an AI model</strong>
                  <span>Pick a model and see the piece on them. Quick, and no photo needed.</span>
                </button>
                <button className="method" onClick={() => setMode("UPLOAD")}>
                  <span className="method-icon"><Icon name="camera" size={28} /></span>
                  <strong>Upload your photo</strong>
                  <span>See it on yourself. Your photo is only used to make this preview.</span>
                </button>
                <button className="method" onClick={startLivePreview}>
                  <span className="method-icon"><Icon name="camera" size={28} /></span>
                  <strong>Live camera overlay</strong>
                  <span>See the product photos over your camera feed. No AI service needed; placement is approximate.</span>
                </button>
              </div>
            </>
          ) : mode === "AI_MODEL" ? (
            <>
              <h2 className="sr-only">Pick a model</h2>
              {!models ? <PageLoading label="Loading models…" /> : !models.length ? (
                <EmptyState icon="model" title="No models yet" action={<button className="btn btn-primary" onClick={() => setMode("UPLOAD")}>Upload your photo instead</button>}>
                  The shop hasn't added AI models yet.
                </EmptyState>
              ) : (
                <div className="model-grid">
                  {models.map((m) => (
                    <button key={m.id} className="model-card" aria-pressed={modelId === m.id} onClick={() => setModelId(m.id)} aria-label={`Model ${m.name}`}>
                      <img src={m.imageUrl} alt="" />
                      <span className="model-card-check"><Icon name="check" size={16} /></span>
                      <span className="model-card-name">{m.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : mode === "LIVE" ? (
            <div className="live-tryon">
              <div className="live-stage">
                <video ref={video} autoPlay playsInline muted aria-label="Live camera preview" />
                {items.flatMap((p) => p.jewelleryType === "EARRINGS"
                  ? (["left", "right"] as const).map((side) => (
                    <img key={`${p.id}-${side}`} className="live-jewel" src={p.images[0]?.url} alt="" aria-hidden="true" style={{ ...liveOverlay(p.jewelleryType, side), "--top": "39%" } as CSSProperties} />
                  ))
                  : <img key={p.id} className="live-jewel" src={p.images[0]?.url} alt="" aria-hidden="true" style={{ ...liveOverlay(p.jewelleryType), "--top": ["NECKLACE", "CHAIN", "LONG_CHAIN"].includes(p.jewelleryType) ? "69%" : ["BANGLE", "BRACELET"].includes(p.jewelleryType) ? "80%" : "60%" } as CSSProperties} />
                )}
              </div>
              <p className="live-disclaimer">Approximate preview. Product photos may include a background, and placement or scale may not match real fit. Your live camera feed stays on this device.</p>
              <div className="live-controls">
                <label>Jewellery size <input type="range" min="65" max="145" value={overlayScale} onChange={(e) => setOverlayScale(Number(e.target.value))} /></label>
                <label>Vertical position <input type="range" min="-12" max="12" value={overlayOffset} onChange={(e) => setOverlayOffset(Number(e.target.value))} /></label>
              </div>
              <div className="tryon-actions" style={{ marginTop: 8 }}>
                <button className="btn btn-quiet" onClick={() => { stopCamera(); setMode(null); }}><Icon name="close" size={18} />Stop camera</button>
              </div>
            </div>
          ) : (
            <>
              <h2 className="sr-only">Add your photo</h2>
              {cameraOn ? (
                <div className="camera-capture">
                  <video ref={video} autoPlay playsInline muted aria-label="Live camera preview" />
                  <p className="muted">Face the camera in good, even lighting.</p>
                  <div className="tryon-actions" style={{ marginTop: 4 }}>
                    <button className="btn btn-quiet" onClick={stopCamera}>Cancel</button>
                    <button className="btn btn-primary" onClick={capturePhoto}><Icon name="camera" size={18} />Capture photo</button>
                  </div>
                </div>
              ) : preview ? (
                <div className="photo-preview">
                  <img src={preview} alt="Your photo" />
                  <div className="stack">
                    <ul className="tips">
                      <li><Icon name="checkCircle" />Face clearly visible</li>
                      <li><Icon name="checkCircle" />Good, even lighting</li>
                      <li><Icon name="checkCircle" />Facing the camera</li>
                    </ul>
                    <label className="btn btn-quiet" style={{ alignSelf: "flex-start" }}>
                      <Icon name="refresh" size={18} />Choose another photo
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0])} />
                    </label>
                  </div>
                </div>
              ) : (
                <div className="photo-options">
                  <button className="btn btn-secondary" onClick={startCamera}><Icon name="camera" size={18} />Open camera</button>
                  <label className={`dropzone ${over ? "is-over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
                    <span className="dropzone-icon"><Icon name="upload" size={26} /></span>
                    <strong>Choose a photo or drop it here</strong>
                    <span>JPG, PNG or WebP, up to {MAX_MB} MB. A clear, front-facing photo works best.</span>
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0])} />
                  </label>
                </div>
              )}
            </>
          )}

          {err && <p className="form-error" role="alert" style={{ marginTop: 16 }}>{err}</p>}

          {!job && mode && mode !== "LIVE" && (
            <div className="tryon-actions">
              <button className="btn btn-quiet" onClick={() => { setMode(null); setErr(""); }}><Icon name="arrowLeft" size={18} />Back</button>
              <button className="btn btn-primary" disabled={!ready} onClick={generate}><Icon name="sparkle" size={18} />Create preview</button>
            </div>
          )}
        </div>

        <aside className="tryon-side" aria-label="Pieces you're trying on">
          <h2>Trying on</h2>
          {items.map((p) => (
            <div key={p.id} className="mini-item">
              <span className="mini-item-img"><ProductImage url={p.images[0]?.url} alt="" type={p.jewelleryType} iconSize={30} /></span>
              <span>
                <Link to={`/product/${p.slug}`} className="mini-item-name">{p.name}</Link><br />
                <Price price={p.price} pricing={p} />
              </span>
            </div>
          ))}
          {items.length > 1 && <div className="tray-total"><span>Total</span><span>{lkr(total)}</span></div>}
        </aside>
      </div>
    </div>
  );
}
