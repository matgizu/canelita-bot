import { unzipSync, strFromU8 } from "fflate";
import { prisma } from "../db";

// ── Parseo de la hoja (xlsx o csv) a matriz de celdas ──────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#10;/g, " ").replace(/&#13;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function colIndex(ref: string): number {
  const letters = ref.match(/^([A-Z]+)/)![1];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseXlsx(buffer: Buffer): string[][] {
  const files = unzipSync(new Uint8Array(buffer));
  const ssFile = files["xl/sharedStrings.xml"];
  const strings: string[] = [];
  if (ssFile) {
    const ss = strFromU8(ssFile);
    for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const parts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]);
      strings.push(decodeEntities(parts.join("")));
    }
  }
  // Primera hoja: busca cualquier worksheet.
  const sheetKey = Object.keys(files).find((k) => /^xl\/worksheets\/sheet1\.xml$/.test(k))
    ?? Object.keys(files).find((k) => /^xl\/worksheets\/.*\.xml$/.test(k));
  if (!sheetKey) throw new Error("no_worksheet");
  const sheet = strFromU8(files[sheetKey]);

  const rows: string[][] = [];
  for (const r of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    const cellRe = /<c r="([A-Z]+\d+)"(?:[^>]*t="([^"]*)")?[^>]*>(?:<v>([\s\S]*?)<\/v>|<is><t[^>]*>([\s\S]*?)<\/t><\/is>)?<\/c>/g;
    for (const c of r[1].matchAll(cellRe)) {
      const idx = colIndex(c[1]);
      const t = c[2];
      let val = c[3] !== undefined ? c[3] : (c[4] !== undefined ? c[4] : "");
      if (t === "s") val = strings[parseInt(val)] ?? "";
      else val = decodeEntities(val);
      row[idx] = val;
    }
    rows.push(row);
  }
  return rows;
}

function parseCsv(text: string): string[][] {
  const delim = (text.split("\n")[0].match(/;/g)?.length ?? 0) > (text.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (ch === delim && !inQ) { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

// ── Detección de columnas por encabezado ───────────────────────────────────

function norm(s: string): string {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

function findCol(headers: string[], ...candidates: string[]): number {
  const H = headers.map(norm);
  for (const cand of candidates) {
    const c = norm(cand);
    let i = H.indexOf(c);
    if (i >= 0) return i;
    i = H.findIndex((h) => h.includes(c));
    if (i >= 0) return i;
  }
  return -1;
}

const numOf = (v: string | undefined): number => {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
};

const normPhone = (p: string | undefined): string => {
  let s = String(p || "").replace(/\D/g, "");
  if (s.length === 10) s = "57" + s;
  return s;
};

// Intervalo de confianza de Wilson (95%) para una proporción — da cotas
// realistas para los escenarios optimista/pesimista a partir de la muestra.
function wilson(pos: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 0 };
  const p = pos / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: Math.max(0, (centre - spread) / d), high: Math.min(1, (centre + spread) / d) };
}

// ── Tipos de salida ────────────────────────────────────────────────────────

export interface PnlResult {
  fileName: string;
  totalRows: number;
  counted: number;
  excluded: { total: number; cancelado: number; rechazado: number };
  groups: {
    delivered: { count: number; income: number; supplier: number; flete: number; commission: number; profit: number };
    inTransit: { count: number; potential: number };
    returned: { count: number; fleteIda: number; returnFlete: number };
  };
  pnl: {
    income: number; supplier: number; flete: number; commission: number;
    netDelivered: number; returnLoss: number; netResult: number; pendingPotential: number;
    deliveryRate: number; returnRate: number;
  };
  projection: null | {
    inTransitCount: number;
    pendingPotential: number;
    observedRate: number;
    margin: number;
    scenarios: Array<{
      key: string; label: string; rate: number;
      deliveredExpected: number; incomeExpected: number;
      profitFromPending: number; returnLossExpected: number; totalNet: number;
    }>;
  };
  statusBreakdown: Array<{ status: string; count: number }>;
  db: {
    orders: number; revenue: number;
    inBoth: number; dropiOnly: number; dbOnly: number;
    dropiOnlyList: Array<{ phone: string; name: string; value: number; status: string }>;
    dbOnlyList: Array<{ phone: string; name: string; value: number }>;
  };
  warnings: string[];
}

// ── Cálculo principal ───────────────────────────────────────────────────────

export async function computeDropiPnl(buffer: Buffer, fileName: string): Promise<PnlResult> {
  const warnings: string[] = [];
  const rows = /\.csv$/i.test(fileName) ? parseCsv(buffer.toString("utf8")) : parseXlsx(buffer);
  if (!rows.length) throw new Error("empty_file");

  const headers = rows[0];
  const col = {
    id: findCol(headers, "ID"),
    status: findCol(headers, "ESTATUS", "ESTADO"),
    sale: findCol(headers, "VALOR DE COMPRA EN PRODUCTOS", "VALOR FACTURADO"),
    supplier: findCol(headers, "TOTAL EN PRECIOS DE PROVEEDOR"),
    flete: findCol(headers, "PRECIO FLETE"),
    returnFlete: findCol(headers, "COSTO DEVOLUCION FLETE"),
    commission: findCol(headers, "COMISION"),
    profit: findCol(headers, "GANANCIA"),
    phone: findCol(headers, "TELEFONO"),
    name: findCol(headers, "NOMBRE CLIENTE", "NOMBRE"),
  };
  if (col.status < 0) throw new Error("no_status_column");
  if (col.sale < 0) warnings.push("No se encontró la columna de valor de venta; los ingresos pueden ser 0.");

  const data = rows.slice(1).filter((r) => col.id >= 0 ? String(r[col.id] ?? "").trim() : r.some((c) => c));

  const G = {
    delivered: { count: 0, income: 0, supplier: 0, flete: 0, commission: 0, profit: 0 },
    inTransit: { count: 0, potential: 0 },
    returned: { count: 0, fleteIda: 0, returnFlete: 0 },
  };
  const excluded = { total: 0, cancelado: 0, rechazado: 0 };
  const statusCount = new Map<string, number>();
  const dropiRows: Array<{ phone: string; name: string; value: number; status: string }> = [];

  for (const r of data) {
    const status = norm(r[col.status]);
    statusCount.set(status || "(vacío)", (statusCount.get(status || "(vacío)") || 0) + 1);
    const sale = numOf(r[col.sale]);

    if (status.includes("CANCELAD")) { excluded.total++; excluded.cancelado++; continue; }
    if (status.includes("RECHAZ"))   { excluded.total++; excluded.rechazado++; continue; }

    dropiRows.push({ phone: normPhone(r[col.phone]), name: String(r[col.name] ?? "").trim(), value: sale, status });

    if (status.includes("ENTREGAD")) {
      G.delivered.count++;
      G.delivered.income += sale;
      G.delivered.supplier += numOf(r[col.supplier]);
      G.delivered.flete += numOf(r[col.flete]);
      G.delivered.commission += numOf(r[col.commission]);
      G.delivered.profit += numOf(r[col.profit]);
    } else if (status.includes("DEVOLUC")) {
      G.returned.count++;
      G.returned.fleteIda += numOf(r[col.flete]);
      G.returned.returnFlete += numOf(r[col.returnFlete]);
    } else {
      G.inTransit.count++;
      G.inTransit.potential += sale;
    }
  }

  const counted = G.delivered.count + G.inTransit.count + G.returned.count;
  const resolved = G.delivered.count + G.returned.count;
  const returnLoss = G.returned.fleteIda + G.returned.returnFlete;
  const netResult = G.delivered.profit - returnLoss;

  // ── Proyección de los pedidos en tránsito bajo 3 escenarios de entrega ──
  // Margen = ganancia por peso recaudado en entregados. Pérdida media por
  // devolución = pérdida total de devoluciones / nº de devoluciones.
  let projection: PnlResult["projection"] = null;
  if (G.inTransit.count > 0 && resolved > 0) {
    const margin = G.delivered.income > 0 ? G.delivered.profit / G.delivered.income : 0;
    const avgReturnLoss = G.returned.count > 0 ? returnLoss / G.returned.count : 0;
    const observed = G.delivered.count / resolved;
    const { low, high } = wilson(G.delivered.count, resolved);
    const scenario = (key: string, label: string, rateRaw: number) => {
      const rate = Math.max(0, Math.min(1, rateRaw));
      const incomeExpected = G.inTransit.potential * rate;
      const profitFromPending = incomeExpected * margin;
      const returnLossExpected = G.inTransit.count * (1 - rate) * avgReturnLoss;
      return {
        key, label, rate,
        deliveredExpected: G.inTransit.count * rate,
        incomeExpected,
        profitFromPending,
        returnLossExpected,
        totalNet: netResult + profitFromPending - returnLossExpected,
      };
    };
    projection = {
      inTransitCount: G.inTransit.count,
      pendingPotential: G.inTransit.potential,
      observedRate: observed,
      margin,
      scenarios: [
        scenario("pesimista", "Pesimista", low),
        scenario("realista", "Realista (tasa actual)", observed),
        scenario("optimista", "Optimista", high),
      ],
    };
  }

  // ── Cruce con la base de datos ──
  const dbOrders = await prisma.order.findMany({
    where: { status: { not: "CANCELLED" } },
    select: { total: true, conversation: { select: { waId: true, customerName: true } } },
  });
  const dbRevenue = dbOrders.reduce((s, o) => s + o.total, 0);
  const dbByPhone = new Map<string, { total: number; name: string }>();
  for (const o of dbOrders) {
    const p = normPhone(o.conversation?.waId);
    if (!dbByPhone.has(p)) dbByPhone.set(p, { total: o.total, name: o.conversation?.customerName ?? "" });
  }
  const dropiByPhone = new Map<string, { value: number; name: string; status: string }>();
  for (const d of dropiRows) if (!dropiByPhone.has(d.phone)) dropiByPhone.set(d.phone, { value: d.value, name: d.name, status: d.status });

  let inBoth = 0;
  const dropiOnlyList: PnlResult["db"]["dropiOnlyList"] = [];
  for (const [phone, d] of dropiByPhone) {
    if (dbByPhone.has(phone)) inBoth++;
    else dropiOnlyList.push({ phone, name: d.name, value: d.value, status: d.status });
  }
  const dbOnlyList: PnlResult["db"]["dbOnlyList"] = [];
  for (const [phone, o] of dbByPhone) {
    if (!dropiByPhone.has(phone)) dbOnlyList.push({ phone, name: o.name, value: o.total });
  }

  return {
    fileName,
    totalRows: data.length,
    counted,
    excluded,
    groups: G,
    pnl: {
      income: G.delivered.income,
      supplier: G.delivered.supplier,
      flete: G.delivered.flete,
      commission: G.delivered.commission,
      netDelivered: G.delivered.profit,
      returnLoss,
      netResult,
      pendingPotential: G.inTransit.potential,
      deliveryRate: resolved ? G.delivered.count / resolved : 0,
      returnRate: resolved ? G.returned.count / resolved : 0,
    },
    projection,
    statusBreakdown: Array.from(statusCount, ([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    db: {
      orders: dbOrders.length,
      revenue: dbRevenue,
      inBoth,
      dropiOnly: dropiOnlyList.length,
      dbOnly: dbOnlyList.length,
      dropiOnlyList: dropiOnlyList.sort((a, b) => b.value - a.value),
      dbOnlyList: dbOnlyList.sort((a, b) => b.value - a.value),
    },
    warnings,
  };
}
