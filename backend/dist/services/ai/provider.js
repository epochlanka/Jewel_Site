"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiProvider = exports.buildPrompt = exports.placement = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const env_1 = require("../../config/env");
// Where each jewellery type is placed. Sent to the AI as guidance.
exports.placement = {
    EARRINGS: "on both earlobes", NECKLACE: "around the neck, resting on the collarbone",
    CHAIN: "around the neck", LONG_CHAIN: "around the neck, hanging to mid-chest",
    BANGLE: "on the wrist", BRACELET: "on the wrist", RING: "on the ring finger",
    ANKLET: "on the ankle", HAIR: "in the hair", OTHER: "where it is naturally worn",
};
const buildPrompt = (r) => "Photorealistic jewellery virtual try-on. Image 1 is the person. " +
    r.items.map((i, n) => `Image ${n + 2} is a jewellery piece: place it ${exports.placement[i.type]}.`).join(" ") +
    " Keep the person's face, skin tone, hair, clothes, pose and background exactly the same. " +
    "Copy each jewellery design exactly as in its reference image (shape, colour, stones, metal). " +
    "Match the lighting, perspective and realistic scale. Return only the edited photo of the person.";
exports.buildPrompt = buildPrompt;
const mimeFor = (file) => {
    const ext = path_1.default.extname(file).toLowerCase();
    return ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
};
// Images on this server are not reachable from the AI service when running locally,
// so every image is sent as a base64 data URI.
async function toDataUri(url) {
    const local = `${env_1.env.publicUrl}/uploads/`;
    if (url.startsWith(local)) {
        const file = path_1.default.join(env_1.env.uploadDir, decodeURIComponent(url.slice(local.length)));
        const buf = await promises_1.default.readFile(file);
        return `data:${mimeFor(file)};base64,${buf.toString("base64")}`;
    }
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`Couldn't load image ${url} (${res.status})`);
    const type = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}
// Keeps the result on this server so it doesn't depend on the AI service's temporary links.
async function saveResult(url) {
    let buf;
    let ext = ".png";
    if (url.startsWith("data:")) {
        const [meta, data] = url.split(",");
        buf = Buffer.from(data, "base64");
        if (meta.includes("jpeg"))
            ext = ".jpg";
        else if (meta.includes("webp"))
            ext = ".webp";
    }
    else {
        const res = await fetch(url);
        if (!res.ok)
            throw new Error(`Couldn't download the result (${res.status})`);
        buf = Buffer.from(await res.arrayBuffer());
        const type = res.headers.get("content-type") ?? "";
        if (type.includes("jpeg"))
            ext = ".jpg";
        else if (type.includes("webp"))
            ext = ".webp";
    }
    await promises_1.default.mkdir(env_1.env.uploadDir, { recursive: true });
    const name = `tryon-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    await promises_1.default.writeFile(path_1.default.join(env_1.env.uploadDir, name), buf);
    return `${env_1.env.publicUrl}/uploads/${name}`;
}
class MockProvider {
    async generate(_r) {
        throw new Error("AI try-on isn't configured. Add FAL_KEY to backend/.env to generate previews.");
    }
}
// fal.ai image editing (default model: Gemini 2.5 Flash Image edit).
// Docs: https://fal.ai/models/fal-ai/gemini-25-flash-image/edit/api
class FalProvider {
    async generate(r) {
        const falKey = env_1.env.aiApiKey;
        if (!falKey)
            throw new Error("FAL_KEY is missing in .env");
        const image_urls = await Promise.all([r.personImageUrl, ...r.items.map((i) => i.imageUrl)].map(toDataUri));
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 120_000);
        try {
            const model = process.env.FAL_MODEL || "fal-ai/gemini-25-flash-image/edit";
            const res = await fetch(`https://fal.run/${model}`, {
                method: "POST",
                signal: ctrl.signal,
                headers: { "Content-Type": "application/json", Authorization: `Key ${falKey}` },
                body: JSON.stringify({ prompt: (0, exports.buildPrompt)(r), image_urls, num_images: 1, output_format: "jpeg" }),
            });
            if (!res.ok)
                throw new Error(`fal.ai ${res.status}: ${(await res.text()).slice(0, 300)}`);
            const data = (await res.json());
            const out = data.images?.[0]?.url;
            if (!out)
                throw new Error("fal.ai returned no image");
            return saveResult(out);
        }
        finally {
            clearTimeout(timer);
        }
    }
}
// Generic HTTP provider. Adapt the body and response to another image-editing API.
class HttpProvider {
    async generate(r) {
        const res = await fetch(env_1.env.aiEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${env_1.env.aiApiKey}` },
            body: JSON.stringify({ person_image: r.personImageUrl, reference_images: r.items.map((i) => i.imageUrl), prompt: (0, exports.buildPrompt)(r) }),
        });
        if (!res.ok)
            throw new Error(`AI provider ${res.status}: ${await res.text()}`);
        const data = (await res.json());
        return data.output_url;
    }
}
exports.aiProvider = env_1.env.aiProvider === "fal" ? new FalProvider() : env_1.env.aiProvider === "http" ? new HttpProvider() : new MockProvider();
