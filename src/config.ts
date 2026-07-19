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

  // Integración con la API interna (no oficial) de Dropi para notificar a los
  // clientes el estado de su guía. Ver src/dropi/.
  dropi: {
    email: optional("DROPI_EMAIL"),
    password: optional("DROPI_PASSWORD"),
    whiteBrandId: Number(optional("DROPI_WHITE_BRAND_ID", "1")),
    // Token pegado a mano desde el navegador (localStorage.DROPI_LoginResult.token).
    // Necesario porque la cuenta tiene 2FA y el login por password no basta.
    // Dura ~12h; cuando vence, el bot avisa al dueño para pegar uno nuevo.
    token: optional("DROPI_TOKEN"),
    // Master switch — con DROPI_TRACKING_ENABLED=false no se corre el poller.
    enabled: optional("DROPI_TRACKING_ENABLED", "false") === "true",
    // Cada cuántos minutos barre los pedidos activos.
    pollMinutes: Number(optional("DROPI_POLL_MINUTES", "30")),
    // Cuántos días hacia atrás mirar (por fecha de creación) en cada barrido.
    lookbackDays: Number(optional("DROPI_LOOKBACK_DAYS", "20")),
    // Mapa etapa→plantilla Meta aprobada (para clientes fuera de la ventana 24h).
    // Si una plantilla no está configurada, fuera de ventana solo se registra.
    templates: {
      shipped: optional("DROPI_TPL_SHIPPED"),
      outForDelivery: optional("DROPI_TPL_OUT_FOR_DELIVERY"),
      delivered: optional("DROPI_TPL_DELIVERED"),
      deliveryAttempt: optional("DROPI_TPL_DELIVERY_ATTEMPT"),
      pickupOffice: optional("DROPI_TPL_PICKUP_OFFICE"),
    } as Record<string, string>,
    templateLang: optional("DROPI_TPL_LANG", "es"),
    // Si es true, manda mensajes de verdad. En false hace dry-run (solo log).
    sendEnabled: optional("DROPI_SEND_ENABLED", "false") === "true",
    // Pedidos despachados por mensajería interna (no pasan por Dropi). Se cuentan
    // en las finanzas como entregados sin devolución, con esta utilidad fija.
    internalLabel: optional("DROPI_INTERNAL_LABEL", "MENSAJERIA INTERNA"),
    internalProfit: Number(optional("DROPI_INTERNAL_PROFIT", "5000")),
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
