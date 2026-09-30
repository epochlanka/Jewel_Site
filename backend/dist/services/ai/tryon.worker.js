"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startTryOnWorker = startTryOnWorker;
const db_1 = require("../../config/db");
const provider_1 = require("./provider");
// Simple DB-polling queue. Swap for BullMQ + Redis when traffic grows.
let running = false;
let lastError = "";
async function processNext() {
    const job = await db_1.db.tryOn.findFirst({
        where: { status: "PENDING" }, orderBy: { createdAt: "asc" },
        include: { items: { include: { product: { include: { images: { take: 1, orderBy: { sort: "asc" } } } } } } },
    });
    if (!job)
        return false;
    const claimed = await db_1.db.tryOn.updateMany({ where: { id: job.id, status: "PENDING" }, data: { status: "PROCESSING" } });
    if (!claimed.count)
        return true;
    try {
        const resultUrl = await provider_1.aiProvider.generate({
            personImageUrl: job.inputUrl,
            items: job.items.map((i) => ({ imageUrl: i.product.tryOnAssetUrl ?? i.product.images[0]?.url ?? "", type: i.product.jewelleryType })),
        });
        await db_1.db.tryOn.update({ where: { id: job.id }, data: { status: "DONE", resultUrl } });
    }
    catch (e) {
        await db_1.db.tryOn.update({ where: { id: job.id }, data: { status: "FAILED", error: String(e).slice(0, 500) } });
    }
    return true;
}
function startTryOnWorker(intervalMs = 1500) {
    setInterval(async () => {
        if (running)
            return;
        running = true;
        try {
            while (await processNext())
                ;
            lastError = "";
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg !== lastError)
                console.error("[tryon worker]", msg);
            lastError = msg;
        }
        finally {
            running = false;
        }
    }, intervalMs);
}
