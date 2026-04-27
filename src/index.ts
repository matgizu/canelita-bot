import "dotenv/config";
import path from "node:path";
import express from "express";
import { apiRouter } from "./api/routes";
import { testRouter } from "./api/test";
import { webhookRouter } from "./api/webhook";
import { config } from "./config";

const app = express();

app.use(express.static(path.resolve(__dirname, "..", "public"), {
  setHeaders: (res, filePath) => {
    if (filePath.includes("/assets/")) {
      res.setHeader("Cache-Control", "public, max-age=86400");
    }
  },
}));

app.use("/webhook", webhookRouter);

app.use(express.json({ limit: "2mb" }));
app.use("/api", apiRouter);
app.use("/api/test", testRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.listen(config.port, () => {
  console.log(`[canelita-bot] listening on :${config.port}`);
});
