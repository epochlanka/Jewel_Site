import fs from "fs/promises";
import path from "path";
import { JewelleryType } from "@prisma/client";
import { env } from "../../config/env";

export type TryOnRequest = {
  personImageUrl: string;                       // AI model image or customer photo
  items: { imageUrl: string; type: JewelleryType }[];
};
export interface TryOnProvider { generate(req: TryOnRequest): Promise<string /* result image URL */> }

// Where each jewellery type is placed. Sent to the AI as guidance.
export const placement: Record<JewelleryType, string> = {
  EARRINGS: "on both earlobes", NECKLACE: "around the neck, resting on the collarbone",
  CHAIN: "around the neck", LONG_CHAIN: "around the neck, hanging to mid-chest",
  BANGLE: "on the wrist", BRACELET: "on the wrist", RING: "on the ring finger",
  ANKLET: "on the ankle", HAIR: "in the hair", OTHER: "where it is naturally worn",
};

export const buildPrompt = (r: TryOnRequest) =>
  "Photorealistic jewellery virtual try-on. Image 1 is the person. " +
  r.items.map((i, n) => `Image ${n + 2} is a jewellery piece: place it ${placement[i.type]}.`).join(" ") +
  " Keep the person's face, skin tone, hair, clothes, pose and background exactly the same. " +
  "Copy each jewellery design exactly as in its reference image (shape, colour, stones, metal). " +
  "Match the lighting, perspective and realistic scale. Return only the edited photo of the person.";

const mimeFor = (file: string) => {
  const ext = path.extname(file).toLowerCase();
  return ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
};

// Images on this server are not reachable from the AI service when running locally,
// so every image is sent as a base64 data URI.
async function toDataUri(url: string) {
  const local = `${env.publicUrl}/uploads/`;
  if (url.startsWith(local)) {
    const file = path.join(env.uploadDir, decodeURIComponent(url.slice(local.length)));
    const buf = await fs.readFile(file);
    return `data:${mimeFor(file)};base64,${buf.toString("base64")}`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load image ${url} (${res.status})`);
  const type = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

// Keeps the result on this server so it doesn't depend on the AI service's temporary links.
async function saveResult(url: string) {
  let buf: Buffer; let ext = ".png";
  if (url.startsWith("data:")) {
    const [meta, data] = url.split(",");
    buf = Buffer.from(data, "base64");
    if (meta.includes("jpeg")) ext = ".jpg"; else if (meta.includes("webp")) ext = ".webp";
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Couldn't download the result (${res.status})`);
    buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("jpeg")) ext = ".jpg"; else if (type.includes("webp")) ext = ".webp";
  }
  await fs.mkdir(env.uploadDir, { recursive: true });
  const name = `tryon-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
  await fs.writeFile(path.join(env.uploadDir, name), buf);
  return `${env.publicUrl}/uploads/${name}`;
}

class MockProvider implements TryOnProvider {
  async generate(_r: TryOnRequest): Promise<string> {
    throw new Error("AI try-on isn't configured. Add FAL_KEY to backend/.env to generate previews.");
  }
}

// fal.ai image editing (default model: Gemini 2.5 Flash Image edit).
// Docs: https://fal.ai/models/fal-ai/gemini-25-flash-image/edit/api
class FalProvider implements TryOnProvider {
  async generate(r: TryOnRequest) {
    const falKey = env.aiApiKey;
    if (!falKey) throw new Error("FAL_KEY is missing in .env");
    const image_urls = await Promise.all([r.personImageUrl, ...r.items.map((i) => i.imageUrl)].map(toDataUri));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120_000);
    try {
      const model = process.env.FAL_MODEL || "fal-ai/gemini-25-flash-image/edit";
      const res = await fetch(`https://fal.run/${model}`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Key ${falKey}` },
        body: JSON.stringify({ prompt: buildPrompt(r), image_urls, num_images: 1, output_format: "jpeg" }),
      });
      if (!res.ok) throw new Error(`fal.ai ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as { images?: { url: string }[] };
      const out = data.images?.[0]?.url;
      if (!out) throw new Error("fal.ai returned no image");
      return saveResult(out);
    } finally {
      clearTimeout(timer);
    }
  }
}

// Generic HTTP provider. Adapt the body and response to another image-editing API.
class HttpProvider implements TryOnProvider {
  async generate(r: TryOnRequest) {
    const res = await fetch(env.aiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.aiApiKey}` },
      body: JSON.stringify({ person_image: r.personImageUrl, reference_images: r.items.map((i) => i.imageUrl), prompt: buildPrompt(r) }),
    });
    if (!res.ok) throw new Error(`AI provider ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { output_url: string };
    return data.output_url;
  }
}

export const aiProvider: TryOnProvider =
  env.aiProvider === "fal" ? new FalProvider() : env.aiProvider === "http" ? new HttpProvider() : new MockProvider();
