function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),

  whatsapp: {
    token: required("WHATSAPP_TOKEN"),
    phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
    wabaId: optional("WHATSAPP_WABA_ID"),
    appSecret: required("META_APP_SECRET"),
    verifyToken: required("META_VERIFY_TOKEN"),
    apiVersion: optional("WHATSAPP_API_VERSION", "v21.0"),
  },

  // Meta Conversions API for Business Messaging (CTWA CAPI).
  // Sends conversion events (Purchase, Contact) back to Meta so click-to-WhatsApp
  // ads can attribute and optimize for real sales.
  meta: {
    // Dataset / pixel that receives the events. Defaults to "Píxel Entrenubes".
    datasetId: optional("CAPI_DATASET_ID", "962416301588536"),
    // Token with whatsapp_business_manage_events scope. Falls back to the
    // WhatsApp token, which already carries that scope in this project.
    token: optional("CAPI_TOKEN") || optional("WHATSAPP_TOKEN"),
    apiVersion: optional("WHATSAPP_API_VERSION", "v21.0"),
    // Master switch — set CAPI_ENABLED=false to silence all event sending.
    enabled: optional("CAPI_ENABLED", "true") !== "false",
  },

  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
  },

  openai: {
    apiKey: optional("OPENAI_API_KEY"),
  },

  telegram: {
    botToken: optional("TELEGRAM_BOT_TOKEN"),
    chatId: optional("TELEGRAM_CHAT_ID"),
  },

  shipping: {
    defaultCost: Number(optional("SHIPPING_COST_DEFAULT", "0")),
  },

  greeting: {
    imageUrls: optional("GREETING_IMAGE_URLS")
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean),
  },

  product: {
    videoUrl: optional("PRODUCT_VIDEO_URL"),
  },

  owner: {
    waNumber: optional("OWNER_WA_NUMBER", "573124743435"),
  },
};

export type AppConfig = typeof config;
