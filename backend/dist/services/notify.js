"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappLink = void 0;
exports.notifyOrderPlaced = notifyOrderPlaced;
exports.notifyStatusChanged = notifyStatusChanged;
exports.notifyPaymentConfirmed = notifyPaymentConfirmed;
const settings_1 = require("./settings");
// Messages are logged for now. To send real SMS or WhatsApp messages, call your provider
// (for example Notify.lk, Dialog eSMS or the WhatsApp Cloud API) inside send().
async function send(to, text) {
    if (!to)
        return;
    console.log(`[notify → ${to}]\n${text}\n`);
}
const lkr = (n) => `LKR ${n.toLocaleString("en-LK")}`;
async function notifyOrderPlaced(order) {
    const s = await (0, settings_1.getSettings)();
    const lines = order.items.map((i) => `${i.name} × ${i.qty}`).join("\n");
    await send(order.mobile, `${s.shopName}: order ${order.orderNo} received.\n${lines}\nTotal ${lkr(order.total)}.${order.paymentMethod === "COD" ? "" : "\nYour order is confirmed once we receive your payment."}\nTrack it with your order number and mobile number.`);
    await send(s.whatsapp || s.phone, `New order ${order.orderNo} from ${order.fullName} (${order.mobile}).\n${lines}\nTotal ${lkr(order.total)}`);
}
const statusText = {
    CONFIRMED: "has been confirmed",
    READY: "is ready",
    DISPATCHED: "is on its way",
    DELIVERED: "has been delivered",
    CANCELLED: "has been cancelled",
};
async function notifyStatusChanged(order) {
    const text = statusText[order.status];
    if (!text)
        return;
    const s = await (0, settings_1.getSettings)();
    await send(order.mobile, `${s.shopName}: your order ${order.orderNo} ${text}.`);
}
const whatsappLink = (phone, text) => `https://wa.me/94${phone.replace(/\D/g, "").replace(/^(94|0)/, "")}?text=${encodeURIComponent(text)}`;
exports.whatsappLink = whatsappLink;
async function notifyPaymentConfirmed(order) {
    const s = await (0, settings_1.getSettings)();
    await send(order.mobile, `${s.shopName}: we received your payment of ${lkr(order.total)}. Your order ${order.orderNo} is confirmed.`);
}
