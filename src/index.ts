import "dotenv/config";
import express from "express";
import { apiRouter } from "./api/routes";
import { webhookRouter } from "./api/webhook";
import { config } from "./config";

const app = express();

app.use("/webhook", webhookRouter);

app.use(express.json({ limit: "2mb" }));
app.use("/api", apiRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.listen(config.port, () => {
  console.log(`[canelita-bot] listening on :${config.port}`);
});
