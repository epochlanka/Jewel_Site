import "dotenv/config";
export const env = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "dev",
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  publicUrl: process.env.PUBLIC_URL ?? "http://localhost:4000",
  aiProvider: process.env.AI_PROVIDER ?? (process.env.FAL_KEY ? "fal" : "mock"),
  aiApiKey: process.env.AI_API_KEY ?? "",
  aiEndpoint: process.env.AI_ENDPOINT ?? "",
  falKey: process.env.FAL_KEY ?? "",
  falModel: process.env.FAL_MODEL ?? "fal-ai/gemini-25-flash-image/edit",
  deliveryFee: Number(process.env.DELIVERY_FEE ?? 450),
};
