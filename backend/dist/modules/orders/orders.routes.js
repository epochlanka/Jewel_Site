"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const error_1 = require("../../middleware/error");
const auth_1 = require("../../middleware/auth");
const cart_service_1 = require("../cart/cart.service");
const orders_service_1 = require("./orders.service");
const notify_1 = require("../../services/notify");
const r = (0, express_1.Router)();
const optionalText = zod_1.z.string().trim().max(300).optional().transform((v) => v || undefined);
const checkout = zod_1.z.object({
    fullName: zod_1.z.string().trim().min(2, "Enter your full name"),
    mobile: zod_1.z.string().trim().regex(/^0\d{9}$/, "Enter a mobile number like 07XXXXXXXX"),
    whatsapp: optionalText, email: zod_1.z.string().trim().email("Enter a valid email").optional().or(zod_1.z.literal("").transform(() => undefined)),
    address: optionalText, city: optionalText, postalCode: optionalText, note: optionalText,
    deliveryMethod: zod_1.z.enum(["DELIVERY", "PICKUP"]), paymentMethod: zod_1.z.enum(["BANK_TRANSFER", "COD", "ONLINE"]),
});
const orderDetail = {
    items: { include: { product: { select: { slug: true, images: { orderBy: { sort: "asc" }, take: 1 } } } } },
    history: { orderBy: { createdAt: "asc" } },
};
r.post("/", auth_1.optionalAuth, (0, error_1.ah)(async (req, res) => {
    const input = checkout.parse(req.body);
    const cart = await (0, cart_service_1.resolveCart)(req);
    const order = await (0, orders_service_1.placeOrder)(cart.id, req.user?.id, input);
    (0, notify_1.notifyOrderPlaced)(order).catch(console.error);
    res.status(201).json(await db_1.db.order.findUnique({ where: { id: order.id }, include: orderDetail }));
}));
r.get("/mine", auth_1.requireAuth, (0, error_1.ah)(async (req, res) => {
    res.json(await db_1.db.order.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: "desc" }, include: orderDetail }));
}));
// Public tracking: order number + mobile number
r.get("/track", (0, error_1.ah)(async (req, res) => {
    const { orderNo, mobile } = zod_1.z.object({ orderNo: zod_1.z.string().trim(), mobile: zod_1.z.string().trim() }).parse(req.query);
    const normalized = orderNo.toUpperCase().startsWith("ORD-") ? orderNo.toUpperCase() : `ORD-${orderNo.replace(/\D/g, "").padStart(6, "0")}`;
    const o = await db_1.db.order.findFirst({ where: { orderNo: normalized.replace(/^#/, ""), mobile }, include: orderDetail });
    if (!o)
        throw new error_1.HttpError(404, "No order matches that order number and mobile number.");
    res.json(o);
}));
exports.default = r;
