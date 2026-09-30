"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const error_1 = require("../../middleware/error");
const auth_1 = require("../../middleware/auth");
const cart_service_1 = require("./cart.service");
const r = (0, express_1.Router)();
r.use(auth_1.optionalAuth);
r.get("/", (0, error_1.ah)(async (req, res) => res.json(await (0, cart_service_1.cartView)((await (0, cart_service_1.resolveCart)(req)).id))));
// Single item or a "Create your look" set: { items: [{ productId, qty }] }
r.post("/items", (0, error_1.ah)(async (req, res) => {
    const b = zod_1.z.object({ items: zod_1.z.array(zod_1.z.object({ productId: zod_1.z.string(), qty: zod_1.z.number().int().min(1).max(20).default(1) })).min(1).max(10) }).parse(req.body);
    const cart = await (0, cart_service_1.resolveCart)(req);
    for (const it of b.items) {
        const p = await db_1.db.product.findUnique({ where: { id: it.productId } });
        if (!p || !p.isActive)
            throw new error_1.HttpError(404, "This product isn't available.");
        const existing = await db_1.db.cartItem.findUnique({ where: { cartId_productId: { cartId: cart.id, productId: p.id } } });
        const want = (existing?.qty ?? 0) + it.qty;
        if (p.stock < want)
            throw new error_1.HttpError(409, p.stock ? `Only ${p.stock} of ${p.name} left.` : `${p.name} is sold out.`);
        await db_1.db.cartItem.upsert({
            where: { cartId_productId: { cartId: cart.id, productId: p.id } },
            update: { qty: want },
            create: { cartId: cart.id, productId: p.id, qty: it.qty },
        });
    }
    res.json(await (0, cart_service_1.cartView)(cart.id));
}));
r.patch("/items/:productId", (0, error_1.ah)(async (req, res) => {
    const { qty } = zod_1.z.object({ qty: zod_1.z.number().int().min(1).max(20) }).parse(req.body);
    const cart = await (0, cart_service_1.resolveCart)(req);
    const p = await db_1.db.product.findUnique({ where: { id: req.params.productId } });
    if (!p)
        throw new error_1.HttpError(404, "This product isn't available.");
    if (p.stock < qty)
        throw new error_1.HttpError(409, p.stock ? `Only ${p.stock} of ${p.name} left.` : `${p.name} is sold out.`);
    await db_1.db.cartItem.update({ where: { cartId_productId: { cartId: cart.id, productId: p.id } }, data: { qty } });
    res.json(await (0, cart_service_1.cartView)(cart.id));
}));
r.delete("/items/:productId", (0, error_1.ah)(async (req, res) => {
    const cart = await (0, cart_service_1.resolveCart)(req);
    await db_1.db.cartItem.deleteMany({ where: { cartId: cart.id, productId: req.params.productId } });
    res.json(await (0, cart_service_1.cartView)(cart.id));
}));
r.post("/merge", auth_1.requireAuth, (0, error_1.ah)(async (req, res) => {
    const { guestKey } = zod_1.z.object({ guestKey: zod_1.z.string() }).parse(req.body);
    await (0, cart_service_1.mergeGuestCart)(req.user.id, guestKey);
    res.json(await (0, cart_service_1.cartView)((await (0, cart_service_1.resolveCart)(req)).id));
}));
exports.default = r;
