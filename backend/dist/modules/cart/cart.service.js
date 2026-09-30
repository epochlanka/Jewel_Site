"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCart = resolveCart;
exports.cartView = cartView;
exports.mergeGuestCart = mergeGuestCart;
const db_1 = require("../../config/db");
const error_1 = require("../../middleware/error");
const pricing_1 = require("../../services/pricing");
const settings_1 = require("../../services/settings");
// Logged-in → cart by userId. Guest → cart by X-Cart-Key header (uuid kept in localStorage).
async function resolveCart(req) {
    if (req.user) {
        return db_1.db.cart.upsert({ where: { userId: req.user.id }, update: {}, create: { userId: req.user.id } });
    }
    const guestKey = req.header("x-cart-key");
    if (!guestKey)
        throw new error_1.HttpError(400, "Missing cart key");
    return db_1.db.cart.upsert({ where: { guestKey }, update: {}, create: { guestKey } });
}
async function cartView(cartId) {
    const [rows, offers, settings] = await Promise.all([
        db_1.db.cartItem.findMany({
            where: { cartId },
            orderBy: { id: "asc" },
            include: { product: { include: { images: { take: 1, orderBy: { sort: "asc" } } } } },
        }),
        (0, pricing_1.getActiveOffers)(),
        (0, settings_1.getSettings)(),
    ]);
    const items = rows
        .filter((i) => i.product.isActive)
        .map((i) => {
        const pricing = (0, pricing_1.priceFor)(i.product, offers);
        const unitPrice = pricing.salePrice ?? i.product.price;
        return { ...i, product: { ...i.product, ...pricing }, unitPrice, lineTotal: unitPrice * i.qty, inStock: i.product.stock >= i.qty };
    });
    const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
    const deliveryFee = items.length ? (0, settings_1.deliveryFeeFor)(settings, subtotal) : 0;
    return { id: cartId, items, subtotal, deliveryFee, total: subtotal + deliveryFee, freeDeliveryOver: settings.freeDeliveryOver };
}
// Call after login: move guest cart items into the user cart.
async function mergeGuestCart(userId, guestKey) {
    const guest = await db_1.db.cart.findUnique({ where: { guestKey }, include: { items: true } });
    if (!guest)
        return;
    const user = await db_1.db.cart.upsert({ where: { userId }, update: {}, create: { userId } });
    for (const it of guest.items) {
        await db_1.db.cartItem.upsert({
            where: { cartId_productId: { cartId: user.id, productId: it.productId } },
            update: { qty: { increment: it.qty } },
            create: { cartId: user.id, productId: it.productId, qty: it.qty },
        });
    }
    await db_1.db.cart.delete({ where: { id: guest.id } });
}
