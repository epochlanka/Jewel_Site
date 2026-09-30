"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allowedNext = exports.needsPaymentFirst = exports.nextStatuses = void 0;
exports.placeOrder = placeOrder;
exports.changeStatus = changeStatus;
exports.setPayment = setPayment;
const client_1 = require("@prisma/client");
const db_1 = require("../../config/db");
const error_1 = require("../../middleware/error");
const pricing_1 = require("../../services/pricing");
const settings_1 = require("../../services/settings");
const notify_1 = require("../../services/notify");
// PENDING → CONFIRMED → PROCESSING → READY → DISPATCHED → DELIVERED; CANCELLED before dispatch.
exports.nextStatuses = {
    PENDING: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["PROCESSING", "CANCELLED"],
    PROCESSING: ["READY", "CANCELLED"],
    READY: ["DISPATCHED", "DELIVERED", "CANCELLED"], // DELIVERED straight from READY for store pickup
    DISPATCHED: ["DELIVERED"],
    DELIVERED: [],
    CANCELLED: [],
};
// Bank transfer and online orders are confirmed only after the payment is received.
// Cash on delivery is paid at the door, so those orders are confirmed by the shop.
const needsPaymentFirst = (o) => o.paymentMethod !== "COD" && o.paymentStatus !== "PAID";
exports.needsPaymentFirst = needsPaymentFirst;
const allowedNext = (o) => exports.nextStatuses[o.status].filter((s) => !(s === "CONFIRMED" && (0, exports.needsPaymentFirst)(o)));
exports.allowedNext = allowedNext;
async function nextOrderNo(tx) {
    const last = await tx.order.findFirst({ orderBy: { createdAt: "desc" }, select: { orderNo: true } });
    const n = last ? Number(last.orderNo.replace(/\D/g, "")) + 1 : 1;
    return `ORD-${String(n).padStart(6, "0")}`;
}
async function placeOrder(cartId, userId, input) {
    const settings = await (0, settings_1.getSettings)();
    if (input.deliveryMethod === "DELIVERY" && (!input.address || !input.city))
        throw new error_1.HttpError(400, "Enter your address and city for delivery.");
    if (input.deliveryMethod === "PICKUP" && !settings.pickupEnabled)
        throw new error_1.HttpError(400, "Store pickup isn't available right now.");
    const methodOn = { COD: settings.codEnabled, BANK_TRANSFER: settings.bankEnabled, ONLINE: settings.onlineEnabled }[input.paymentMethod];
    if (!methodOn)
        throw new error_1.HttpError(400, "That payment method isn't available. Choose another one.");
    const offers = await (0, pricing_1.getActiveOffers)();
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await db_1.db.$transaction(async (tx) => {
                const items = await tx.cartItem.findMany({ where: { cartId }, include: { product: true } });
                const live = items.filter((i) => i.product.isActive);
                if (!live.length)
                    throw new error_1.HttpError(400, "Your cart is empty.");
                for (const i of live) {
                    const updated = await tx.product.updateMany({ where: { id: i.productId, stock: { gte: i.qty } }, data: { stock: { decrement: i.qty } } });
                    if (!updated.count)
                        throw new error_1.HttpError(409, `${i.product.name} doesn't have enough stock. Update your cart and try again.`);
                }
                const lines = live.map((i) => ({ productId: i.productId, name: i.product.name, price: (0, pricing_1.unitPrice)(i.product, offers), qty: i.qty }));
                const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
                const deliveryFee = input.deliveryMethod === "DELIVERY" ? (0, settings_1.deliveryFeeFor)(settings, subtotal) : 0;
                const order = await tx.order.create({
                    data: {
                        ...input, userId, orderNo: await nextOrderNo(tx), subtotal, deliveryFee, total: subtotal + deliveryFee,
                        items: { create: lines },
                        history: { create: { status: "PENDING" } },
                    },
                    include: { items: true },
                });
                await tx.cartItem.deleteMany({ where: { cartId } });
                return order;
            });
        }
        catch (e) {
            // Two orders at the same moment can pick the same number; retry with the next one.
            if (e instanceof client_1.Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 2)
                continue;
            throw e;
        }
    }
    throw new error_1.HttpError(500, "Couldn't place the order. Try again.");
}
async function changeStatus(orderId, to) {
    const o = await db_1.db.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!o)
        throw new error_1.HttpError(404, "Order not found");
    if (!exports.nextStatuses[o.status].includes(to))
        throw new error_1.HttpError(409, `An order that is ${o.status.toLowerCase()} can't be moved to ${to.toLowerCase()}.`);
    if (to === "CONFIRMED" && (0, exports.needsPaymentFirst)(o))
        throw new error_1.HttpError(409, "Mark the payment as paid first. The order is confirmed when the payment is received.");
    const updated = await db_1.db.$transaction(async (tx) => {
        if (to === "CANCELLED") {
            for (const i of o.items)
                await tx.product.update({ where: { id: i.productId }, data: { stock: { increment: i.qty } } });
        }
        await tx.orderStatusLog.create({ data: { orderId, status: to } });
        return tx.order.update({ where: { id: orderId }, data: { status: to } });
    });
    (0, notify_1.notifyStatusChanged)(updated).catch(console.error);
    return updated;
}
// Marking a pending order as paid confirms it and tells the customer.
async function setPayment(orderId, paymentStatus) {
    const o = await db_1.db.order.findUnique({ where: { id: orderId } });
    if (!o)
        throw new error_1.HttpError(404, "Order not found");
    const confirm = paymentStatus === "PAID" && o.status === "PENDING";
    const updated = await db_1.db.$transaction(async (tx) => {
        if (confirm)
            await tx.orderStatusLog.create({ data: { orderId, status: "CONFIRMED" } });
        return tx.order.update({ where: { id: orderId }, data: { paymentStatus, ...(confirm ? { status: "CONFIRMED" } : {}) } });
    });
    if (confirm)
        (0, notify_1.notifyPaymentConfirmed)(updated).catch(console.error);
    return { ...updated, confirmed: confirm };
}
