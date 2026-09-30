"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const error_1 = require("../../middleware/error");
const auth_1 = require("../../middleware/auth");
const upload_1 = require("../../middleware/upload");
const r = (0, express_1.Router)();
const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
r.get("/", (0, error_1.ah)(async (_req, res) => {
    res.json(await db_1.db.category.findMany({
        orderBy: [{ sort: "asc" }, { name: "asc" }],
        include: { _count: { select: { products: { where: { isActive: true } } } } },
    }));
}));
// multipart/form-data: name, sort, image?
const body = zod_1.z.object({ name: zod_1.z.string().trim().min(1).max(60), sort: zod_1.z.coerce.number().int().optional() });
r.post("/", auth_1.requireAdmin, upload_1.upload.single("image"), (0, error_1.ah)(async (req, res) => {
    const b = body.parse(req.body);
    const slug = slugify(b.name);
    if (await db_1.db.category.findUnique({ where: { slug } }))
        throw new error_1.HttpError(409, "A category with this name already exists.");
    res.status(201).json(await db_1.db.category.create({ data: { ...b, slug, imageUrl: req.file ? (0, upload_1.fileUrl)(req.file.filename) : undefined } }));
}));
r.put("/:id", auth_1.requireAdmin, upload_1.upload.single("image"), (0, error_1.ah)(async (req, res) => {
    const b = body.partial().parse(req.body);
    const data = { ...b };
    if (b.name) {
        data.slug = slugify(b.name);
        const clash = await db_1.db.category.findFirst({ where: { slug: data.slug, NOT: { id: req.params.id } } });
        if (clash)
            throw new error_1.HttpError(409, "A category with this name already exists.");
    }
    if (req.file)
        data.imageUrl = (0, upload_1.fileUrl)(req.file.filename);
    res.json(await db_1.db.category.update({ where: { id: req.params.id }, data }));
}));
r.delete("/:id", auth_1.requireAdmin, (0, error_1.ah)(async (req, res) => {
    const count = await db_1.db.product.count({ where: { categoryId: req.params.id } });
    if (count)
        throw new error_1.HttpError(409, `This category has ${count} product${count === 1 ? "" : "s"}. Move them to another category first.`);
    await db_1.db.category.delete({ where: { id: req.params.id } });
    res.status(204).end();
}));
exports.default = r;
