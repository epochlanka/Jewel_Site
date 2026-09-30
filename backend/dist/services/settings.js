"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSettings = void 0;
exports.deliveryFeeFor = deliveryFeeFor;
const db_1 = require("../config/db");
// The shop has one settings row (id = 1). It is created with defaults the first time it is read.
const getSettings = () => db_1.db.shopSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
exports.getSettings = getSettings;
function deliveryFeeFor(settings, subtotal) {
    if (settings.freeDeliveryOver && subtotal >= settings.freeDeliveryOver)
        return 0;
    return settings.deliveryFee;
}
