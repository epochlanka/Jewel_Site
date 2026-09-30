"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileUrl = exports.upload = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const env_1 = require("../config/env");
fs_1.default.mkdirSync(env_1.env.uploadDir, { recursive: true });
exports.upload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: env_1.env.uploadDir,
        filename: (_r, f, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path_1.default.extname(f.originalname)}`),
    }),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_r, f, cb) => cb(null, /image\/(jpeg|png|webp)/.test(f.mimetype)),
});
const fileUrl = (filename) => `${env_1.env.publicUrl}/uploads/${filename}`;
exports.fileUrl = fileUrl;
