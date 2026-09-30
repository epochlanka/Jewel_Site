"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signToken = void 0;
exports.optionalAuth = optionalAuth;
exports.requireAuth = requireAuth;
exports.requireAdmin = requireAdmin;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
const db_1 = require("../config/db");
const signToken = (u) => jsonwebtoken_1.default.sign(u, env_1.env.jwtSecret, { expiresIn: "7d" });
exports.signToken = signToken;
// Reads the login token if there is one. A token for a user that no longer exists
// (for example after the database was reset) is ignored, so the request continues as a guest.
async function optionalAuth(req, _res, next) {
    const t = req.headers.authorization?.replace("Bearer ", "");
    if (t) {
        try {
            const payload = jsonwebtoken_1.default.verify(t, env_1.env.jwtSecret);
            const u = await db_1.db.user.findUnique({ where: { id: payload.id }, select: { id: true, role: true } });
            if (u)
                req.user = { id: u.id, role: u.role };
        }
        catch { /* bad or expired token: treat as guest */ }
    }
    next();
}
function requireAuth(req, res, next) {
    optionalAuth(req, res, () => (req.user ? next() : res.status(401).json({ error: "Sign in required" })));
}
function requireAdmin(req, res, next) {
    requireAuth(req, res, () => (req.user?.role === "ADMIN" ? next() : res.status(403).json({ error: "Admin only" })));
}
