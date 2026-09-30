"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unitPrice = void 0;
exports.getActiveOffers = getActiveOffers;
exports.priceFor = priceFor;
exports.withPricing = withPricing;
const db_1 = require("../config/db");
function getActiveOffers() {
    const now = new Date();
    return db_1.db.offer.findMany({
        where: { isActive: true, startsAt: { lte: now }, endsAt: { gte: now } },
        select: { id: true, title: true, percentOff: true, productId: true, categoryId: true },
    });
}
// Best offer wins: product-specific, category-wide or shop-wide.
function priceFor(p, offers) {
    let best = null;
    for (const o of offers) {
        const applies = o.productId ? o.productId === p.id : o.categoryId ? o.categoryId === p.categoryId : true;
        if (applies && (!best || o.percentOff > best.percentOff))
            best = o;
    }
    if (!best)
        return { salePrice: null, offerPercent: null, offerTitle: null };
    return {
        salePrice: Math.round((p.price * (100 - best.percentOff)) / 100),
        offerPercent: best.percentOff,
        offerTitle: best.title,
    };
}
const unitPrice = (p, offers) => priceFor(p, offers).salePrice ?? p.price;
exports.unitPrice = unitPrice;
async function withPricing(items) {
    const offers = await getActiveOffers();
    return items.map((p) => ({ ...p, ...priceFor(p, offers) }));
}
