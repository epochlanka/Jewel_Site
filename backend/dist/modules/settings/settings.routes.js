"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const error_1 = require("../../middleware/error");
const auth_1 = require("../../middleware/auth");
const settings_1 = require("../../services/settings");
const r = (0, express_1.Router)();
r.get("/", (0, error_1.ah)(async (_req, res) => res.json(await (0, settings_1.getSettings)())));
const body = zod_1.z.object({
    shopName: zod_1.z.string().min(1).max(80),
    tagline: zod_1.z.string().max(200),
    phone: zod_1.z.string().max(30),
    whatsapp: zod_1.z.string().max(30),
    email: zod_1.z.string().max(120),
    address: zod_1.z.string().max(300),
    deliveryFee: zod_1.z.coerce.number().int().min(0),
    freeDeliveryOver: zod_1.z.coerce.number().int().min(0).nullable(),
    bankDetails: zod_1.z.string().max(1000),
    codEnabled: zod_1.z.boolean(),
    bankEnabled: zod_1.z.boolean(),
    onlineEnabled: zod_1.z.boolean(),
    pickupEnabled: zod_1.z.boolean(),
    themeMode: zod_1.z.enum(["system", "light", "dark"]),
    themeAccent: zod_1.z.enum(["emerald", "gold", "rose", "blue"]),
}).partial();
r.put("/", auth_1.requireAdmin, (0, error_1.ah)(async (req, res) => {
    const data = body.parse(req.body);
    await (0, settings_1.getSettings)();
    res.json(await db_1.db.shopSettings.update({ where: { id: 1 }, data }));
}));
exports.default = r;
