"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const error_1 = require("../../middleware/error");
const auth_1 = require("../../middleware/auth");
const r = (0, express_1.Router)();
const publicUser = { id: true, name: true, email: true, phone: true, role: true };
const phone = zod_1.z.string().regex(/^0\d{9}$/, "Use a mobile number like 07XXXXXXXX").optional().or(zod_1.z.literal("").transform(() => undefined));
r.post("/register", (0, error_1.ah)(async (req, res) => {
    const b = zod_1.z.object({ name: zod_1.z.string().trim().min(2), email: zod_1.z.string().trim().toLowerCase().email(), phone, password: zod_1.z.string().min(6) }).parse(req.body);
    if (await db_1.db.user.findUnique({ where: { email: b.email } }))
        throw new error_1.HttpError(409, "An account with this email already exists. Sign in instead.");
    const u = await db_1.db.user.create({ data: { ...b, password: await bcryptjs_1.default.hash(b.password, 10) }, select: publicUser });
    res.status(201).json({ token: (0, auth_1.signToken)({ id: u.id, role: u.role }), user: u });
}));
r.post("/login", (0, error_1.ah)(async (req, res) => {
    const b = zod_1.z.object({ email: zod_1.z.string().trim().toLowerCase().email(), password: zod_1.z.string() }).parse(req.body);
    const u = await db_1.db.user.findUnique({ where: { email: b.email } });
    if (!u || !(await bcryptjs_1.default.compare(b.password, u.password)))
        throw new error_1.HttpError(401, "Wrong email or password.");
    res.json({ token: (0, auth_1.signToken)({ id: u.id, role: u.role }), user: { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role } });
}));
r.get("/me", auth_1.requireAuth, (0, error_1.ah)(async (req, res) => {
    const u = await db_1.db.user.findUnique({ where: { id: req.user.id }, select: publicUser });
    if (!u)
        throw new error_1.HttpError(401, "Sign in required");
    res.json(u);
}));
r.patch("/me", auth_1.requireAuth, (0, error_1.ah)(async (req, res) => {
    const b = zod_1.z.object({ name: zod_1.z.string().trim().min(2).optional(), phone }).parse(req.body);
    res.json(await db_1.db.user.update({ where: { id: req.user.id }, data: { name: b.name, phone: b.phone ?? null }, select: publicUser }));
}));
r.post("/password", auth_1.requireAuth, (0, error_1.ah)(async (req, res) => {
    const b = zod_1.z.object({ current: zod_1.z.string(), next: zod_1.z.string().min(6, "New password needs at least 6 characters") }).parse(req.body);
    const u = await db_1.db.user.findUnique({ where: { id: req.user.id } });
    if (!u || !(await bcryptjs_1.default.compare(b.current, u.password)))
        throw new error_1.HttpError(400, "Current password is wrong.");
    await db_1.db.user.update({ where: { id: u.id }, data: { password: await bcryptjs_1.default.hash(b.next, 10) } });
    res.status(204).end();
}));
exports.default = r;
