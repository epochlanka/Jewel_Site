"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const error_1 = require("../../middleware/error");
const auth_1 = require("../../middleware/auth");
const upload_1 = require("../../middleware/upload");
const r = (0, express_1.Router)();
r.use(auth_1.optionalAuth);
r.get("/models", (0, error_1.ah)(async (_req, res) => res.json(await db_1.db.aiModel.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } }))));
// multipart: productIds (JSON array string), source=AI_MODEL|UPLOAD, aiModelId?, photo?
r.post("/", upload_1.upload.single("photo"), (0, error_1.ah)(async (req, res) => {
    const b = zod_1.z.object({
        productIds: zod_1.z.string().transform((s, ctx) => {
            try {
                return zod_1.z.array(zod_1.z.string()).min(1).max(5).parse(JSON.parse(s));
            }
            catch {
                ctx.addIssue({ code: "custom", message: "Choose 1 to 5 items" });
                return zod_1.z.NEVER;
            }
        }),
        source: zod_1.z.enum(["AI_MODEL", "UPLOAD"]),
        aiModelId: zod_1.z.string().optional(),
    }).parse(req.body);
    const products = await db_1.db.product.findMany({ where: { id: { in: b.productIds }, tryOnEnabled: true, isActive: true } });
    if (products.length !== b.productIds.length)
        throw new error_1.HttpError(400, "One or more of these items can't be tried on.");
    if (new Set(products.map((p) => p.jewelleryType)).size !== products.length)
        throw new error_1.HttpError(400, "Choose one item of each type, for example one pair of earrings and one necklace.");
    let inputUrl;
    if (b.source === "UPLOAD") {
        if (!req.file)
            throw new error_1.HttpError(400, "Upload a JPG, PNG or WebP photo to continue.");
        inputUrl = (0, upload_1.fileUrl)(req.file.filename);
    }
    else {
        const m = b.aiModelId ? await db_1.db.aiModel.findFirst({ where: { id: b.aiModelId, isActive: true } }) : null;
        if (!m)
            throw new error_1.HttpError(400, "Choose a model to continue.");
        inputUrl = m.imageUrl;
    }
    const job = await db_1.db.tryOn.create({
        data: { userId: req.user?.id, source: b.source, aiModelId: b.source === "AI_MODEL" ? b.aiModelId : undefined, inputUrl, items: { create: b.productIds.map((productId) => ({ productId })) } },
    });
    res.status(202).json({ id: job.id, status: job.status });
}));
r.get("/mine", auth_1.requireAuth, (0, error_1.ah)(async (req, res) => {
    res.json(await db_1.db.tryOn.findMany({
        where: { userId: req.user.id, status: "DONE" },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
            id: true, resultUrl: true, createdAt: true,
            items: { select: { product: { select: { id: true, name: true, slug: true, price: true, isActive: true } } } },
        },
    }));
}));
// The page polls this every 2 seconds
r.get("/:id", (0, error_1.ah)(async (req, res) => {
    const j = await db_1.db.tryOn.findUnique({ where: { id: req.params.id }, select: { id: true, status: true, resultUrl: true, error: true, items: { select: { productId: true } } } });
    if (!j)
        throw new error_1.HttpError(404, "Try-on not found");
    const configError = j.error?.includes("AI try-on isn't configured.") ? j.error : null;
    res.json({ ...j, error: configError ?? (j.error ? "We couldn't create a preview from this photo. Try a clear, front-facing photo with good light." : null) });
}));
exports.default = r;
