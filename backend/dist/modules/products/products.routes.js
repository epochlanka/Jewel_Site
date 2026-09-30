"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const db_1 = require("../../config/db");
const error_1 = require("../../middleware/error");
const auth_1 = require("../../middleware/auth");
const upload_1 = require("../../middleware/upload");
const pricing_1 = require("../../services/pricing");
const r = (0, express_1.Router)();
const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const firstImage = { images: { orderBy: { sort: "asc" }, take: 1 } };
// GET /api/products?ids=a,b&category=earrings&q=&minPrice=&maxPrice=&style=&colour=&inStock=1&newArrivals=1&onSale=1&type=EARRINGS&sort=price_asc&page=1
r.get("/", (0, error_1.ah)(async (req, res) => {
    const q = zod_1.z.object({
        category: zod_1.z.string().optional(), q: zod_1.z.string().optional(),
        minPrice: zod_1.z.coerce.number().optional(), maxPrice: zod_1.z.coerce.number().optional(),
        style: zod_1.z.string().optional(), colour: zod_1.z.string().optional(),
        inStock: zod_1.z.string().optional(), newArrivals: zod_1.z.string().optional(), onSale: zod_1.z.string().optional(),
        type: zod_1.z.nativeEnum(client_1.JewelleryType).optional(), tryOn: zod_1.z.string().optional(),
        ids: zod_1.z.string().optional().transform((v) => (v ? v.split(",").filter(Boolean).slice(0, 20) : undefined)),
        sort: zod_1.z.enum(["new", "price_asc", "price_desc", "name"]).default("new"),
        page: zod_1.z.coerce.number().int().min(1).default(1), limit: zod_1.z.coerce.number().int().min(1).max(60).default(24),
    }).parse(req.query);
    const where = {
        isActive: true,
        ...(q.category && { category: { slug: q.category } }),
        ...(q.q && { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { code: { contains: q.q, mode: "insensitive" } }, { description: { contains: q.q, mode: "insensitive" } }] }),
        ...((q.minPrice !== undefined || q.maxPrice !== undefined) && { price: { gte: q.minPrice, lte: q.maxPrice } }),
        ...(q.style && { style: q.style }),
        ...(q.colour && { colour: q.colour }),
        ...(q.inStock && { stock: { gt: 0 } }),
        ...(q.newArrivals && { isNewArrival: true }),
        ...(q.type && { jewelleryType: q.type }),
        ...(q.tryOn && { tryOnEnabled: true }),
        ...(q.ids && { id: { in: q.ids } }),
    };
    const orderBy = q.sort === "price_asc" ? { price: "asc" } : q.sort === "price_desc" ? { price: "desc" } : q.sort === "name" ? { name: "asc" } : { createdAt: "desc" };
    if (q.onSale) {
        // Offers can target products, categories or the whole shop, so filter after pricing.
        const offers = await (0, pricing_1.getActiveOffers)();
        const all = await db_1.db.product.findMany({ where, orderBy, include: firstImage });
        const onSale = all.map((p) => ({ ...p, ...(0, pricing_1.priceFor)(p, offers) })).filter((p) => p.salePrice !== null);
        const items = onSale.slice((q.page - 1) * q.limit, q.page * q.limit);
        return res.json({ items, total: onSale.length, page: q.page, pages: Math.max(1, Math.ceil(onSale.length / q.limit)) });
    }
    const [items, total] = await Promise.all([
        db_1.db.product.findMany({ where, orderBy, skip: (q.page - 1) * q.limit, take: q.limit, include: firstImage }),
        db_1.db.product.count({ where }),
    ]);
    res.json({ items: await (0, pricing_1.withPricing)(items), total, page: q.page, pages: Math.max(1, Math.ceil(total / q.limit)) });
}));
// Values for the filter panel
r.get("/filters", (0, error_1.ah)(async (_req, res) => {
    const [styles, colours, range] = await Promise.all([
        db_1.db.product.findMany({ where: { isActive: true, style: { not: null } }, distinct: ["style"], select: { style: true }, orderBy: { style: "asc" } }),
        db_1.db.product.findMany({ where: { isActive: true, colour: { not: null } }, distinct: ["colour"], select: { colour: true }, orderBy: { colour: "asc" } }),
        db_1.db.product.aggregate({ where: { isActive: true }, _min: { price: true }, _max: { price: true } }),
    ]);
    res.json({
        styles: styles.map((s) => s.style).filter(Boolean),
        colours: colours.map((c) => c.colour).filter(Boolean),
        minPrice: range._min.price ?? 0,
        maxPrice: range._max.price ?? 0,
    });
}));
r.get("/:slug", (0, error_1.ah)(async (req, res) => {
    const p = await db_1.db.product.findUnique({ where: { slug: req.params.slug }, include: { images: { orderBy: { sort: "asc" } }, category: true } });
    if (!p || !p.isActive)
        throw new error_1.HttpError(404, "This product isn't available.");
    const [priced] = await (0, pricing_1.withPricing)([p]);
    res.json(priced);
}));
r.get("/:slug/related", (0, error_1.ah)(async (req, res) => {
    const p = await db_1.db.product.findUnique({ where: { slug: req.params.slug }, select: { id: true, categoryId: true } });
    if (!p)
        return res.json([]);
    const items = await db_1.db.product.findMany({
        where: { isActive: true, categoryId: p.categoryId, NOT: { id: p.id } },
        orderBy: { createdAt: "desc" }, take: 4, include: firstImage,
    });
    res.json(await (0, pricing_1.withPricing)(items));
}));
// ---------- Admin ----------
const bool = zod_1.z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", zod_1.z.boolean());
const productBody = zod_1.z.object({
    code: zod_1.z.string().trim().min(1).max(30), name: zod_1.z.string().trim().min(2).max(120), description: zod_1.z.string().max(4000).optional(),
    price: zod_1.z.coerce.number().int().positive(), stock: zod_1.z.coerce.number().int().min(0).default(0),
    categoryId: zod_1.z.string().min(1), jewelleryType: zod_1.z.nativeEnum(client_1.JewelleryType),
    tryOnEnabled: bool.default(true), isNewArrival: bool.default(false), isActive: bool.default(true),
    style: zod_1.z.string().trim().max(40).optional().transform((v) => v || null),
    colour: zod_1.z.string().trim().max(40).optional().transform((v) => v || null),
});
const files = upload_1.upload.fields([{ name: "images", maxCount: 10 }, { name: "tryOnAsset", maxCount: 1 }]);
async function assertCodeFree(code, exceptId) {
    const clash = await db_1.db.product.findFirst({ where: { code, ...(exceptId && { NOT: { id: exceptId } }) } });
    if (clash)
        throw new error_1.HttpError(409, `Product code ${code} is already used by "${clash.name}".`);
}
r.post("/", auth_1.requireAdmin, files, (0, error_1.ah)(async (req, res) => {
    const b = productBody.parse(req.body);
    await assertCodeFree(b.code);
    const f = req.files;
    const p = await db_1.db.product.create({
        data: {
            ...b, slug: `${slugify(b.name)}-${slugify(b.code)}`,
            tryOnAssetUrl: f?.tryOnAsset?.[0] ? (0, upload_1.fileUrl)(f.tryOnAsset[0].filename) : undefined,
            images: { create: (f?.images ?? []).map((file, i) => ({ url: (0, upload_1.fileUrl)(file.filename), sort: i })) },
        },
        include: { images: true },
    });
    res.status(201).json(p);
}));
r.put("/:id", auth_1.requireAdmin, files, (0, error_1.ah)(async (req, res) => {
    const b = productBody.partial().parse(req.body);
    if (b.code)
        await assertCodeFree(b.code, req.params.id);
    const f = req.files;
    const current = await db_1.db.productImage.aggregate({ where: { productId: req.params.id }, _max: { sort: true } });
    const start = (current._max.sort ?? -1) + 1;
    const p = await db_1.db.product.update({
        where: { id: req.params.id },
        data: {
            ...b,
            ...(f?.tryOnAsset?.[0] && { tryOnAssetUrl: (0, upload_1.fileUrl)(f.tryOnAsset[0].filename) }),
            ...(f?.images?.length && { images: { create: f.images.map((file, i) => ({ url: (0, upload_1.fileUrl)(file.filename), sort: start + i })) } }),
        },
        include: { images: { orderBy: { sort: "asc" } } },
    });
    res.json(p);
}));
// Body: { order: [imageId, imageId, ...] } — first becomes the main image
r.put("/:id/images/order", auth_1.requireAdmin, (0, error_1.ah)(async (req, res) => {
    const { order } = zod_1.z.object({ order: zod_1.z.array(zod_1.z.string()) }).parse(req.body);
    await db_1.db.$transaction(order.map((id, i) => db_1.db.productImage.updateMany({ where: { id, productId: req.params.id }, data: { sort: i } })));
    res.status(204).end();
}));
r.delete("/:id/images/:imageId", auth_1.requireAdmin, (0, error_1.ah)(async (req, res) => {
    await db_1.db.productImage.deleteMany({ where: { id: req.params.imageId, productId: req.params.id } });
    res.status(204).end();
}));
r.delete("/:id/try-on-asset", auth_1.requireAdmin, (0, error_1.ah)(async (req, res) => {
    await db_1.db.product.update({ where: { id: req.params.id }, data: { tryOnAssetUrl: null } });
    res.status(204).end();
}));
// Hiding keeps order history intact; the product can be shown again from the edit form.
r.delete("/:id", auth_1.requireAdmin, (0, error_1.ah)(async (req, res) => {
    await db_1.db.product.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.status(204).end();
}));
exports.default = r;
