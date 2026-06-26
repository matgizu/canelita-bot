import "dotenv/config";
import axios from "axios";
import { prisma } from "../src/db";
import { buildStatsReport } from "../src/reports/statsReport";

const OWNER = process.env.OWNER_WA_NUMBER ?? "+573124743435";
const TOKEN = process.env.WHATSAPP_TOKEN!;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!;
const API_VERSION = process.env.WHATSAPP_API_VERSION ?? "v21.0";
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

function chunk(s: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
}
async function sendWA(text: string) {
  for (const part of chunk(text, 3800)) {
    await axios.post(
      `https://graph.facebook.com/${API_VERSION}/${PHONE_ID}/messages`,
      { messaging_product: "whatsapp", to: OWNER, type: "text", text: { body: part } },
      { headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } },
    );
  }
}
async function sendTG(text: string) {
  if (!TG_TOKEN || !TG_CHAT) return;
  for (const part of chunk(text, 3800)) {
    await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      chat_id: TG_CHAT, text: part, parse_mode: "Markdown", disable_web_page_preview: true,
    });
  }
}

async function main() {
  const report = await buildStatsReport();
  console.log("\n========= REPORTE =========\n");
  console.log(report);
  if (process.argv.includes("--send")) {
    const ch = process.argv.includes("--wa") ? "wa" : process.argv.includes("--tg") ? "tg" : "both";
    if (ch !== "tg") await sendWA(report).then(() => console.log("\n[WA enviado]")).catch((e) => console.error("[WA error]", e.response?.data?.error ?? e.message));
    if (ch !== "wa") await sendTG(report).then(() => console.log("[TG enviado]")).catch((e) => console.error("[TG error]", e.response?.data ?? e.message));
  } else {
    console.log("\n(modo prueba — agrega --send para enviar al owner)");
  }
}
main().finally(() => prisma.$disconnect());
