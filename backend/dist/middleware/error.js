"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ah = exports.HttpError = void 0;
exports.errorHandler = errorHandler;
const zod_1 = require("zod");
const multer_1 = require("multer");
const client_1 = require("@prisma/client");
class HttpError extends Error {
    status;
    constructor(status, msg) {
        super(msg);
        this.status = status;
    }
}
exports.HttpError = HttpError;
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);
exports.ah = ah;
function errorHandler(err, _req, res, _next) {
    if (err instanceof zod_1.ZodError) {
        const first = err.issues[0];
        const field = first?.path.join(".");
        const message = first?.message && first.message !== "Required" ? first.message : `Check the ${field || "form"} field`;
        return res.status(400).json({ error: message, field, details: err.flatten() });
    }
    if (err instanceof HttpError)
        return res.status(err.status).json({ error: err.message });
    if (err instanceof multer_1.MulterError) {
        return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "That image is over 8 MB. Choose a smaller one." : "That upload didn't work. Try another image." });
    }
    if (err instanceof client_1.Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2025")
            return res.status(404).json({ error: "That item no longer exists." });
        if (err.code === "P2002")
            return res.status(409).json({ error: "That value is already in use." });
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong on our side. Try again." });
}
