export const lkr = (n) => `LKR ${Math.round(n).toLocaleString("en-LK")}`;

export const shortDate = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const dateTime = (iso) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const statusLabel = {
  PENDING: "Pending", CONFIRMED: "Confirmed", PROCESSING: "Processing", READY: "Ready",
  DISPATCHED: "Dispatched", DELIVERED: "Delivered", CANCELLED: "Cancelled",
};

export const customerStatus = {
  PENDING: "Order received", CONFIRMED: "Order confirmed", PROCESSING: "Being prepared", READY: "Ready",
  DISPATCHED: "On the way", DELIVERED: "Delivered", CANCELLED: "Cancelled",
};

export const paymentLabel = { BANK_TRANSFER: "Bank transfer", COD: "Cash on delivery", ONLINE: "Online payment" };
export const paymentStatusLabel = { UNPAID: "Not paid", PAID: "Paid", REFUNDED: "Refunded" };
export const deliveryLabel = { DELIVERY: "Delivery", PICKUP: "Store pickup" };

export const typeLabel = {
  EARRINGS: "Earrings", NECKLACE: "Necklace", CHAIN: "Chain", LONG_CHAIN: "Long chain", BANGLE: "Bangle",
  BRACELET: "Bracelet", RING: "Ring", ANKLET: "Anklet", HAIR: "Hair accessory", OTHER: "Other",
};
export const jewelleryTypes = Object.keys(typeLabel);

export const phoneLink = (n) => `tel:${n.replace(/\s/g, "")}`;
export const whatsappLink = (n, text = "") =>
  `https://wa.me/94${n.replace(/\D/g, "").replace(/^(94|0)/, "")}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
