"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const env_1 = require("./config/env");
const tryon_worker_1 = require("./services/ai/tryon.worker");
app_1.app.listen(env_1.env.port, "0.0.0.0", () => console.log(`API on :${env_1.env.port}`));
(0, tryon_worker_1.startTryOnWorker)();
