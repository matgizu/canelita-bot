import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { prisma } from "../db";
import { sendText } from "../whatsapp/client";
import { markOwnerWindowOpen } from "../owner";
import { getConfig, setConfig } from "../botConfig";
import { formatCOP } from "../products";
import { anthropicHttpsAgent } from "../claude/httpAgent";

// maxRetries: el SDK reintenta con backoff exponencial + jitter ante errores de
// conexión ("Premature close" / socket cerrado) y 408/409/429/5xx.
const client = new Anthropic({
  apiKey: config.anthropic.apiKey,
  maxRetries: 4,
  timeout: 60_000,
  httpAgent: anthropicHttpsAgent,
});

const SYSTEM = `Eres el asistente de negocio de FreskaBox. Le respondes directamente al dueño con datos reales del negocio.

Reglas generales:
- Tono directo, como hablar con un socio de confianza. Nada de formalidades.
- Da números exactos siempre que los tengas — los tienes en el contexto que te paso antes de cada mensaje.
- Mensajes cortos y estructurados. Usa saltos de línea para separar métricas.
- Si calculan algo (CPA, margen, proyección), muestra el razonamiento en 1 línea.
- No uses emojis excesivos. Máximo 1-2 por mensaje.
- Nunca digas "no tengo ese dato" si el dato sí está en el contexto.

COMANDOS DE CONFIGURACIÓN:
Si el dueño pide cambiar alguna configuración del bot, responde SOLO con este JSON (sin texto antes ni después):
{"cmd":"config","key":"<clave>","value":"<valor>","confirm":"<mensaje corto confirmando el cambio>"}

Claves disponibles y formato del value:
- "pack3_price" → número en COP sin puntos ni símbolo (ej: "65000")
- "pack6_price" → número en COP sin puntos ni símbolo (ej: "115000")
- "remarketing_enabled" → "true" o "false"
- "remarketing_discount" → número en COP sin puntos (ej: "15000")
- "bot_paused" → "true" para pausar el bot para todos, "false" para reactivarlo
- "nequi_number" → número de celular sin espacios (ej: "3124743435")
- "available_colors" → JSON array de strings (ej: ["Rosa pastel","Blanco"])

Ejemplos de peticiones del dueño → JSON esperado:
- "sube el precio del pack x3 a 75000" → {"cmd":"config","key":"pack3_price","value":"75000","confirm":"Pack x3 actualizado a $75.000"}
- "pausa el bot" → {"cmd":"config","key":"bot_paused","value":"true","confirm":"Bot pausado. Nadie recibirá respuestas hasta que lo actives."}
- "activa el bot" → {"cmd":"config","key":"bot_paused","value":"false","confirm":"Bot reactivado."}
- "desactiva el remarketing" → {"cmd":"config","key":"remarketing_enabled","value":"false","confirm":"Remarketing desactivado."}
- "cambia el nequi a 3101234567" → {"cmd":"config","key":"nequi_number","value":"3101234567","confirm":"Número Nequi actualizado a 3101234567."}

Si no es un cambio de configuración, responde normalmente con texto.`;

function col(date: Date): string {
  return date.toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "short",
    timeStyle: "short",
  });
}

async function fetchStats(): Promise<string> {
  const now = new Date();

  const todayStart = new Date(now);
  todayStart.setUTCHours(5, 0, 0, 0);
  if (todayStart > now) todayStart.setUTCDate(todayStart.getUTCDate() - 1);

  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);

  const week  = new Date(now); week.setDate(week.getDate() - 7);
  const month = new Date(now); month.setDate(month.getDate() - 30);

  const [
    totalConvs, todayConvs, yesterdayConvs, weekConvs,
    totalOrders, todayOrders, yesterdayOrders, weekOrders, monthOrders,
    totalRevAgg, todayRevAgg, weekRevAgg, monthRevAgg,
    objRows,
    stateRows,
    recentOrders,
    hotConvs,
    remindersDue,
    cfg,
  ] = await Promise.all([
    prisma.conversation.count(),
    prisma.conversation.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.conversation.count({ where: { createdAt: { gte: yesterdayStart, lt: todayStart } } }),
    prisma.conversation.count({ where: { createdAt: { gte: week } } }),

    prisma.order.count({ where: { status: { not: "CANCELLED" } } }),
    prisma.order.count({ where: { status: { not: "CANCELLED" }, createdAt: { gte: todayStart } } }),
    prisma.order.count({ where: { status: { not: "CANCELLED" }, createdAt: { gte: yesterdayStart, lt: todayStart } } }),
    prisma.order.count({ where: { status: { not: "CANCELLED" }, createdAt: { gte: week } } }),
    prisma.order.count({ where: { status: { not: "CANCELLED" }, createdAt: { gte: month } } }),

    prisma.order.aggregate({ where: { status: { not: "CANCELLED" } }, _sum: { total: true } }),
    prisma.order.aggregate({ where: { status: { not: "CANCELLED" }, createdAt: { gte: todayStart } }, _sum: { total: true } }),
    prisma.order.aggregate({ where: { status: { not: "CANCELLED" }, createdAt: { gte: week } }, _sum: { total: true } }),
    prisma.order.aggregate({ where: { status: { not: "CANCELLED" }, createdAt: { gte: month } }, _sum: { total: true } }),

    prisma.message.groupBy({
      by: ["objectionType"],
      where: { objectionType: { not: null }, createdAt: { gte: month } },
      _count: { objectionType: true },
      orderBy: { _count: { objectionType: "desc" } },
      take: 6,
    }),

    prisma.conversation.groupBy({ by: ["state"], _count: { state: true } }),

    prisma.order.findMany({
      where: { status: { not: "CANCELLED" } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, total: true, createdAt: true, conversation: { select: { customerName: true, fullName: true, city: true } } },
    }),

    prisma.conversation.findMany({
      where: {
        automationEnabled: true,
        state: { notIn: ["CLOSED", "GREETING"] },
        lastInboundAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { lastInboundAt: "desc" },
      take: 10,
      select: { waId: true, customerName: true, state: true, lastInboundAt: true },
    }),

    prisma.reminder.findMany({
      where: { sent: false, dueAt: { lte: new Date(Date.now() + 24 * 60 * 60 * 1000) } },
      orderBy: { dueAt: "asc" },
      take: 5,
      select: { waId: true, note: true, dueAt: true },
    }),

    getConfig(),
  ]);

  const fmt = (n: number) => formatCOP(n);
  const totalRev = Number(totalRevAgg._sum.total ?? 0);
  const todayRev = Number(todayRevAgg._sum.total ?? 0);
  const weekRev  = Number(weekRevAgg._sum.total ?? 0);
  const monthRev = Number(monthRevAgg._sum.total ?? 0);

  const rate = (orders: number, convs: number) =>
    convs > 0 ? `${((orders / convs) * 100).toFixed(2)}%` : "n/d";

  const stateList = Object.entries(Object.fromEntries(stateRows.map(r => [r.state, r._count.state])))
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `  • ${s}: ${n}`)
    .join("\n");

  const objList = objRows.length
    ? objRows.map(r => `  • ${r.objectionType}: ${r._count.objectionType} veces`).join("\n")
    : "  • Ninguna registrada";

  const recentList = recentOrders.map(o => {
    const name = o.conversation.fullName ?? o.conversation.customerName ?? "—";
    return `  • #${o.id} ${name} (${o.conversation.city ?? "—"}) — ${fmt(o.total)} — ${col(o.createdAt)}`;
  }).join("\n") || "  • Sin pedidos aún";

  const hotList = hotConvs.length
    ? hotConvs.map(c => `  • ${c.customerName ?? c.waId} → ${c.state} (últ. ${col(c.lastInboundAt)})`).join("\n")
    : "  • Ninguno";

  const reminderList = remindersDue.length
    ? remindersDue.map(r => `  • +${r.waId}: "${r.note}" — vence ${col(r.dueAt)}`).join("\n")
    : "  • Ninguno";

  return `DATOS EN TIEMPO REAL — FreskaBox (${col(now)})

═══ CONVERSACIONES ═══
  Hoy:       ${todayConvs}
  Ayer:      ${yesterdayConvs}
  7 días:    ${weekConvs}
  Total:     ${totalConvs}

═══ PEDIDOS ═══
  Hoy:       ${todayOrders} (${fmt(todayRev)})
  Ayer:      ${yesterdayOrders}
  7 días:    ${weekOrders} (${fmt(weekRev)})
  30 días:   ${monthOrders} (${fmt(monthRev)})
  Total:     ${totalOrders} (${fmt(totalRev)})

═══ TASA DE CIERRE ═══
  Hoy:       ${rate(todayOrders, todayConvs)}
  7 días:    ${rate(weekOrders, weekConvs)}
  Histórica: ${rate(totalOrders, totalConvs)}

═══ CONFIGURACIÓN ACTUAL ═══
  Pack x3:            ${fmt(cfg.pack3Price)}
  Pack x6:            ${fmt(cfg.pack6Price)}
  Remarketing:        ${cfg.remarketingEnabled ? "activo" : "desactivado"}
  Descuento remarket: ${fmt(cfg.remarketingDiscount)}
  Bot pausado:        ${cfg.botPaused ? "SÍ" : "no"}
  Nequi:              ${cfg.nequiNumber}
  Colores:            ${cfg.availableColors.join(", ")}

═══ EMBUDO ACTUAL ═══
${stateList}

═══ ÚLTIMOS 5 PEDIDOS ═══
${recentList}

═══ LEADS CALIENTES (últimas 24h) ═══
${hotList}

═══ RECORDATORIOS PRÓXIMOS ═══
${reminderList}

═══ OBJECIONES TOP (30 días) ═══
${objList}`;
}

const VALID_KEYS = new Set([
  "pack3_price", "pack6_price", "remarketing_enabled", "remarketing_discount",
  "bot_paused", "nequi_number", "available_colors",
]);

interface ConfigCmd { cmd: "config"; key: string; value: string; confirm: string }

function parseConfigCmd(text: string): ConfigCmd | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (obj.cmd === "config" && VALID_KEYS.has(obj.key) && typeof obj.value === "string") {
      return obj as ConfigCmd;
    }
  } catch {}
  return null;
}

const ownerHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
const MAX_HISTORY = 12;

export async function handleOwnerMessage(text: string): Promise<void> {
  markOwnerWindowOpen();
  if (!text.trim()) return;

  let statsContext = "";
  try {
    statsContext = await fetchStats();
  } catch (e: any) {
    console.error("[ownerHandler.stats]", e.message);
    statsContext = "(Error cargando datos — revisa la conexión a DB)";
  }

  ownerHistory.push({ role: "user", content: text });
  if (ownerHistory.length > MAX_HISTORY) ownerHistory.splice(0, ownerHistory.length - MAX_HISTORY);

  // Solo turnos con contenido real: un turno vacío hace que la API responda 400
  // y tumbe toda la conversación a partir de ahí.
  const safeHistory = ownerHistory.filter(t => typeof t.content === "string" && t.content.trim());
  const safeStats = statsContext.trim() || "(Sin datos disponibles en este momento.)";

  let res: Anthropic.Message | null = null;
  let lastErr: any = null;
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      res = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 700,
        temperature: 0.2,
        system: SYSTEM,
        messages: [
          { role: "user", content: safeStats },
          { role: "assistant", content: "Datos cargados. ¿Qué necesitas?" },
          ...safeHistory,
        ],
      });
      break;
    } catch (e: any) {
      lastErr = e;
      const status: number | undefined = e?.status;
      const retryable = status === undefined || status === 429 || status >= 500;
      console.error(`[ownerHandler.claude] intento ${attempt}/${MAX_ATTEMPTS} status=${status ?? "net"}: ${e?.message}`);
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      await new Promise(r => setTimeout(r, attempt * 700));
    }
  }

  if (!res) {
    // Diagnóstico: el detalle del error va SOLO al dueño (no es PII de clientes),
    // para poder confirmar la causa raíz sin depender de los logs de producción.
    const status = lastErr?.status ?? "sin-status";
    const detail = String(lastErr?.message ?? lastErr ?? "desconocido").slice(0, 250);
    await sendText(config.owner.waNumber!, `⚠️ No pude procesar (status ${status}): ${detail}`);
    return;
  }

  const reply = res.content
    .filter(b => b.type === "text")
    .map(b => (b as Anthropic.TextBlock).text)
    .join("\n")
    .trim();

  if (!reply) return;

  try {
    const cmd = parseConfigCmd(reply);
    if (cmd) {
      try {
        await setConfig(cmd.key, cmd.value);
        await sendText(config.owner.waNumber!, `✅ ${cmd.confirm}`);
        ownerHistory.push({ role: "assistant", content: `✅ ${cmd.confirm}` });
      } catch (e: any) {
        await sendText(config.owner.waNumber!, `Error guardando config: ${e.message}`);
      }
    } else {
      ownerHistory.push({ role: "assistant", content: reply });
      await sendText(config.owner.waNumber!, reply);
    }

    if (ownerHistory.length > MAX_HISTORY) ownerHistory.splice(0, ownerHistory.length - MAX_HISTORY);
  } catch (e: any) {
    console.error("[ownerHandler.send]", e.message);
    await sendText(config.owner.waNumber!, `⚠️ Error al enviar la respuesta: ${String(e.message).slice(0, 200)}`);
  }
}
