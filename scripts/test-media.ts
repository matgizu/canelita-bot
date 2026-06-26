import "dotenv/config";
import axios from "axios";

const OWNER = process.env.OWNER_WA_NUMBER ?? "573124743435";
const TOKEN = process.env.WHATSAPP_TOKEN!;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!;
const API_VERSION = process.env.WHATSAPP_API_VERSION ?? "v21.0";
const IMAGE_URLS = (process.env.GREETING_IMAGE_URLS ?? "").split(",").map(u => u.trim()).filter(Boolean);
const VIDEO_URL = process.env.PRODUCT_VIDEO_URL ?? "";

const base = `https://graph.facebook.com/${API_VERSION}/${PHONE_ID}/messages`;
const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function sendImage(url: string) {
  const res = await axios.post(base, {
    messaging_product: "whatsapp", to: OWNER,
    type: "image", image: { link: url },
  }, { headers });
  console.log(`✓ Imagen enviada: ${url.split("/").pop()} (id: ${res.data?.messages?.[0]?.id})`);
}

async function sendVideo(url: string) {
  const res = await axios.post(base, {
    messaging_product: "whatsapp", to: OWNER,
    type: "video", video: { link: url },
  }, { headers });
  console.log(`✓ Video enviado: ${url.split("/").pop()} (id: ${res.data?.messages?.[0]?.id})`);
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log(`Enviando a: ${OWNER}`);

  if (!IMAGE_URLS.length) {
    console.error("❌ GREETING_IMAGE_URLS vacío en .env");
  } else {
    console.log(`\nEnviando ${IMAGE_URLS.length} fotos...`);
    for (const url of IMAGE_URLS) {
      await sendImage(url);
      await sleep(800);
    }
  }

  if (!VIDEO_URL) {
    console.error("❌ PRODUCT_VIDEO_URL vacío en .env");
  } else {
    console.log(`\nEnviando video...`);
    await sendVideo(VIDEO_URL);
  }

  console.log("\n✅ Prueba completada.");
}

main().catch(e => {
  console.error("❌ Error:", e.response?.data ?? e.message);
  process.exit(1);
});
