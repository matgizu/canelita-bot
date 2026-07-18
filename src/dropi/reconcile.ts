import { prisma } from "../db";
import { dropi } from "./client";
import { notifyOwner } from "../owner";

// ─────────────────────────────────────────────────────────────────────────────
// Conciliación bot ↔ Dropi.
//
// Cruza los pedidos del bot (Order + Conversation) con los de Dropi por teléfono
// (WhatsApp + alternos). Los "solo en el bot" se categorizan según su estado y
// etiquetas para separar fugas reales (pedido cerrado que no se subió a Dropi)
// de casos explicados (no viable, mensajería interna, aún por despachar…).
// ─────────────────────────────────────────────────────────────────────────────

export function normPhone(p: unknown): string {
  let s = String(p ?? "").replace(/\D/g, "");
  if (s.length === 10) s = "57" + s;
  return s;
}

export function categorize(state: string | null, labels: string[]): { key: string; label: string } {
  if (state !== "CLOSED") return { key: "no_cerrada", label: "No cerrada" };
  const L = labels.map((l) => l.toUpperCase());
  if (L.some((l) => l.includes("NO VIABLE"))) return { key: "no_viable", label: "No viable" };
  if (L.some((l) => l.includes("INTERNA") || l.includes("MENSAJERIA"))) return { key: "interna", label: "Mensajería interna" };
  if (L.some((l) => l.includes("PENDIENTE"))) return { key: "pendiente", label: "Pendiente por despachar" };
  return { key: "revisar", label: "Revisar" };
}

export interface OnlyBotRow {
  id: number; name: string; phone: string; city: string; total: number;
  createdAt: Date; state: string | null; labels: string[]; category: { key: string; label: string };
}
export interface ReconResult {
  generatedAt: string;
  window: { from: string; until: string };
  counts: { bot: number; dropi: number; inBoth: number; onlyBot: number; onlyDropi: number; revisar: number };
  revisarValue: number;
  onlyBot: OnlyBotRow[];
  onlyDropi: Array<{ id: number; name: string; phone: string; total: number; status: string; city: string }>;
}

export async function reconcile(): Promise<ReconResult> {
  // Ventana: desde el pedido del bot más antiguo (o 90 días atrás).
  const oldest = await prisma.order.aggregate({ _min: { createdAt: true } });
  const from = oldest._min.createdAt
    ? new Date(oldest._min.createdAt.getTime() - 3 * 86400000)
    : new Date(Date.now() - 90 * 86400000);
  const fromYmd = from.toISOString().slice(0, 10);
  const untilYmd = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const [dbOrders, dropiOrders] = await Promise.all([
    prisma.order.findMany({
      where: { status: { not: "CANCELLED" } },
      select: {
        id: true, total: true, altPhone: true, fullName: true, city: true, createdAt: true,
        conversation: { select: { waId: true, customerName: true, altPhone: true, city: true, fullName: true, state: true, labels: true } },
      },
    }),
    dropi.listAllOrders({ from: fromYmd, until: untilYmd }, { pageSize: 100, max: 5000 }),
  ]);

  const dropiByPhone = new Map<string, { id: number; name: string; total: number; status: string; city: string }>();
  for (const o of dropiOrders) {
    const ph = normPhone(o.phone);
    if (ph.length >= 12 && !dropiByPhone.has(ph)) {
      dropiByPhone.set(ph, {
        id: o.id, name: [o.name, o.surname].filter(Boolean).join(" "),
        total: Math.round(Number(o.total_order ?? 0)) || 0, status: o.status, city: o.city ?? "",
      });
    }
  }
  const dropiPhones = new Set(dropiByPhone.keys());
  const dbPhones = new Set<string>();

  const dbMapped = dbOrders.map((o) => {
    const phones = [o.conversation?.waId, o.conversation?.altPhone, o.altPhone].map(normPhone).filter((p) => p.length >= 12);
    phones.forEach((p) => dbPhones.add(p));
    return {
      id: o.id, phones,
      name: o.fullName ?? o.conversation?.fullName ?? o.conversation?.customerName ?? "—",
      city: o.city ?? o.conversation?.city ?? "", total: o.total,
      createdAt: o.createdAt, state: o.conversation?.state ?? null, labels: o.conversation?.labels ?? [],
    };
  });

  const inBoth = dbMapped.filter((o) => o.phones.some((p) => dropiPhones.has(p)));
  const onlyBot: OnlyBotRow[] = dbMapped
    .filter((o) => !o.phones.some((p) => dropiPhones.has(p)))
    .map((o) => ({
      id: o.id, name: o.name, phone: o.phones[0] ?? "", city: o.city, total: o.total,
      createdAt: o.createdAt, state: o.state, labels: o.labels, category: categorize(o.state, o.labels),
    }))
    .sort((a, b) => (a.category.key === "revisar" ? -1 : 0) - (b.category.key === "revisar" ? -1 : 0) || b.total - a.total);

  const onlyDropi = [...dropiByPhone.entries()]
    .filter(([ph]) => !dbPhones.has(ph))
    .map(([phone, d]) => ({ ...d, phone }))
    .sort((a, b) => b.total - a.total);

  const revisar = onlyBot.filter((o) => o.category.key === "revisar");
  return {
    generatedAt: new Date().toISOString(),
    window: { from: fromYmd, until: untilYmd },
    counts: { bot: dbMapped.length, dropi: dropiOrders.length, inBoth: inBoth.length, onlyBot: onlyBot.length, onlyDropi: onlyDropi.length, revisar: revisar.length },
    revisarValue: revisar.reduce((s, o) => s + o.total, 0),
    onlyBot, onlyDropi,
  };
}

// Aviso diario al dueño: pedidos cerrados en el bot que NO están en Dropi
// ("a revisar"). Solo escribe si hay alguno. Silencioso ante errores (p. ej.
// token vencido — de eso ya avisa el tracker).
export async function sendReconcileAlert(): Promise<void> {
  let r: ReconResult;
  try {
    r = await reconcile();
  } catch (e: any) {
    console.error("[dropi.reconcileAlert]", e.message);
    return;
  }
  const revisar = r.onlyBot.filter((o) => o.category.key === "revisar");
  const pend = r.onlyBot.filter((o) => o.category.key === "pendiente");
  if (!revisar.length && !pend.length) return;

  const cop = (n: number) => "$" + n.toLocaleString("es-CO");
  const lines: string[] = ["📋 *Conciliación bot ↔ Dropi*", ""];
  if (revisar.length) {
    lines.push(`🔴 *${revisar.length} pedido(s) cerrado(s) sin subir a Dropi* (${cop(r.revisarValue)}):`);
    revisar.slice(0, 15).forEach((o) => lines.push(`• #${o.id} ${o.name} — ${o.city || "?"} — ${cop(o.total)}`));
    lines.push("");
  }
  if (pend.length) {
    lines.push(`🟡 ${pend.length} marcado(s) "pendiente por despachar" (aún sin guía en Dropi).`);
  }
  lines.push("", "Revísalos en el panel → /logistica (pestaña Conciliación).");
  await notifyOwner(lines.join("\n")).catch(() => {});
}
