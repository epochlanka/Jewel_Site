"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../../config/db");
const error_1 = require("../../middleware/error");
const auth_1 = require("../../middleware/auth");
const pricing_1 = require("../../services/pricing");
const r = (0, express_1.Router)();
r.use(auth_1.requireAuth);
r.get("/", (0, error_1.ah)(async (req, res) => {
    const rows = await db_1.db.wishlistItem.findMany({
        where: { userId: req.user.id, product: { isActive: true } },
        orderBy: { id: "desc" },
        include: { product: { include: { images: { orderBy: { sort: "asc" }, take: 1 } } } },
    });
    res.json(await (0, pricing_1.withPricing)(rows.map((w) => w.product)));
}));
r.get("/ids", (0, error_1.ah)(async (req, res) => {
    const rows = await db_1.db.wishlistItem.findMany({ where: { userId: req.user.id }, select: { productId: true } });
    res.json(rows.map((w) => w.productId));
}));
r.post("/:productId", (0, error_1.ah)(async (req, res) => {
    const p = await db_1.db.product.findUnique({ where: { id: req.params.productId } });
    if (!p || !p.isActive)
        throw new error_1.HttpError(404, "Product not found");
    await db_1.db.wishlistItem.upsert({
        where: { userId_productId: { userId: req.user.id, productId: p.id } },
        update: {},
        create: { userId: req.user.id, productId: p.id },
    });
    res.status(204).end();
}));
r.delete("/:productId", (0, error_1.ah)(async (req, res) => {
    await db_1.db.wishlistItem.deleteMany({ where: { userId: req.user.id, productId: req.params.productId } });
    res.status(204).end();
}));
exports.default = r;
