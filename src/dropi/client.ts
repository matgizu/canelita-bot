import axios, { AxiosInstance } from "axios";
import { config } from "../config";
import { prisma } from "../db";

// ─────────────────────────────────────────────────────────────────────────────
// Cliente de la API interna (NO oficial) de Dropi Colombia.
//
// Descubierta por reverse-engineering del panel app.dropi.co. Contrato:
//   • Login:  POST /api/login  { email, password, white_brand_id }  → { token }
//   • Auth:   header  X-Authorization: Bearer <token>   (NO "Authorization")
//             + x-captcha-token: ''  + Accept: application/json,text/plain,*/*
//   • Listar: GET /api/orders/myorders?orderBy=id&orderDirection=desc&...
//   • Guía:   GET /api/orders/consultarhistoricoguia?shipping_guide=XXX
//
// El token es un JWT que expira; acá lo cacheamos y re-logueamos solo cuando
// falta poco para vencer o si una llamada devuelve 401.
//
// ⚠️ API no documentada: puede cambiar sin aviso. Si algo empieza a fallar,
// revisar los endpoints/campos contra el panel.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = "https://api.dropi.co/api";

// Se lanza cuando el DROPI_TOKEN pegado a mano venció (modo manual).
export const DROPI_TOKEN_EXPIRED = "DROPI_TOKEN_EXPIRED";
// Se lanza cuando no hay token válido y hay que pedirle al dueño el código 2FA.
export const DROPI_NEEDS_2FA = "DROPI_NEEDS_2FA";

// Claves en BotConfig: token real (12h) y token temporal 2FA (~1h) en curso.
const TOKEN_KEY = "dropi_token";
const PENDING_KEY = "dropi_2fa_pending";

async function upsertConfig(key: string, value: string): Promise<void> {
  try {
    await prisma.botConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
  } catch (e: any) {
    console.error(`[dropi.client] no se pudo persistir ${key}:`, e.message);
  }
}

async function readConfig(key: string): Promise<string | null> {
  try {
    const row = await prisma.botConfig.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch {
    return null;
  }
}

// El WAF (nginx) de Dropi rechaza con 403 "Access denied" cualquier request que
// no parezca venir del navegador. Hay que imitar los headers que manda el panel
// Angular (Origin/Referer/Sec-Fetch/User-Agent) o nada funciona desde el server.
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  "Accept-Language": "es-419,es;q=0.9,en;q=0.8",
  Origin: "https://app.dropi.co",
  Referer: "https://app.dropi.co/",
  "sec-ch-ua": '"Chromium";v="149", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "Sec-Fetch-Site": "same-site",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
};

export interface DropiOrder {
  id: number;
  status: string;             // Estado real de la guía (PENDIENTE, EN REPARTO, …)
  shipping_guide: string | null;
  phone: string | null;       // 10 dígitos (COL, sin indicativo)
  name: string | null;
  surname: string | null;
  city: string | null;
  state: string | null;       // departamento
  total_order: string | null; // valor a recaudar (COD), viene como string
  shipping_amount: string | null;
  dropshipper_amount_to_win: string | null; // utilidad si se entrega
  rate_type: string | null;   // "CON RECAUDO" | "SIN RECAUDO"
  shipping_company: string | null; // nombre plano: ENVIA, INTERRAPIDISIMO…
  distribution_company?: { id: number; name: string } | null;
  created_at: string | null;
  updated_at: string | null;
  [k: string]: unknown;       // el objeto real trae ~123 campos
}

interface MyOrdersResponse {
  isSuccess: boolean;
  status?: number;
  objects?: DropiOrder[];
  message?: string;
}

// "FECHA CREADO" | "FECHA DE CAMBIO DE ESTATUS" | "FECHA DE DESPACHADO".
// El panel usa estos valores en el parámetro filter_date_by.
export type DateFilterBy = "" | "FECHA_STATUS" | "FECHA_DISPATCH";

export interface ListOrdersParams {
  resultNumber?: number;
  start?: number;
  status?: string;        // filtra por un estado exacto
  from?: string;          // YYYY-MM-DD
  until?: string;         // YYYY-MM-DD
  filterDateBy?: DateFilterBy;
  textToSearch?: string;
}

class DropiClient {
  private http: AxiosInstance;
  private token: string | null = null;
  private tokenExpMs = 0;
  private pending2faToken: string | null = null;
  private pending2faExp = 0;

  constructor() {
    this.http = axios.create({ baseURL: BASE, timeout: 20_000 });
  }

  private authHeaders(token: string) {
    return {
      ...BROWSER_HEADERS,
      "X-Authorization": `Bearer ${token}`,
      "x-captcha-token": "",
      Accept: "application/json, text/plain, */*",
    };
  }

  // Decodifica el `exp` del JWT (segundos epoch) sin verificar la firma —
  // solo para saber cuándo re-loguear. Si no se puede leer, asume 1h.
  private readExp(token: string): number {
    try {
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1], "base64").toString("utf8"),
      );
      return typeof payload.exp === "number" ? payload.exp * 1000 : Date.now() + 3_600_000;
    } catch {
      return Date.now() + 3_600_000;
    }
  }

  // Cuerpo base de login/beforeLogin (replicado del panel Angular).
  private loginBody(extra: Record<string, unknown> = {}) {
    const { email, password, whiteBrandId } = config.dropi;
    return { email, password, white_brand_id: whiteBrandId, brand: "", ipAddress: "", ...extra };
  }

  // ── Paso 1 del login: password → token temporal de 2FA ─────────────────────
  // Replica el arranque del panel: beforeLoginUnknownDevice + login(otp:"").
  // Con Google Authenticator, el login devuelve un token 2FA temporal que luego
  // se valida con el código de 6 dígitos (ver submitTwoFactor).
  async requestTwoFactor(): Promise<void> {
    const { email, password } = config.dropi;
    if (!email || !password) {
      throw new Error("Dropi no configurado: falta DROPI_EMAIL / DROPI_PASSWORD");
    }
    const h = { ...BROWSER_HEADERS, "Content-Type": "application/json", "x-captcha-token": "", Accept: "application/json, text/plain, */*" };
    await this.http.post("/beforeLoginUnknownDevice", this.loginBody(), { headers: h, validateStatus: () => true });
    const res = await this.http.post("/login", this.loginBody({ otp: "", with_cdc: false }), { headers: h, validateStatus: () => true });
    const data = res.data ?? {};
    if (!data.token) throw new Error(`Login Dropi falló: ${data.message ?? "sin token"}`);
    this.pending2faToken = data.token as string;
    this.pending2faExp = this.readExp(this.pending2faToken);
    // Se persiste para poder validar el código en otro proceso / tras un reinicio.
    await upsertConfig(PENDING_KEY, this.pending2faToken);
  }

  // ── Paso 2 del login: valida el código 2FA → token real (12h) ──────────────
  // Replica los pasos 3-5 del panel: auth/2fa/verify + beforeLogin + login(otp:code).
  // `code` son los 6 dígitos de Google Authenticator. Devuelve true si funcionó.
  async submitTwoFactor(code: string): Promise<boolean> {
    // Recupera el token temporal de memoria o del persistido (otro proceso).
    let pending = this.pending2faToken;
    if (!pending || Date.now() >= this.pending2faExp) {
      pending = await readConfig(PENDING_KEY);
      if (pending) this.pending2faExp = this.readExp(pending);
    }
    if (!pending || Date.now() >= this.pending2faExp) {
      throw new Error(DROPI_NEEDS_2FA); // el token temporal venció; reiniciar el flujo
    }
    const c = String(code).trim();
    const h = this.authHeaders(pending);

    // 3) Verifica el código (confía el dispositivo).
    const v = await this.http.post("/auth/2fa/verify", { token: pending, code: c }, { headers: h, validateStatus: () => true });
    if (!v.data?.isSuccess) return false; // código incorrecto o vencido

    // 4-5) beforeLogin + login con el código en `otp` → token real.
    await this.http.post("/beforeLoginUnknownDevice", this.loginBody({ otp: "", with_cdc: false }), { headers: h, validateStatus: () => true });
    const l = await this.http.post("/login", this.loginBody({ otp: c, with_cdc: false }), { headers: h, validateStatus: () => true });
    const token = l.data?.token as string | undefined;
    if (!token) return false;

    this.token = token;
    this.tokenExpMs = this.readExp(token);
    this.pending2faToken = null;
    await Promise.all([upsertConfig(TOKEN_KEY, token), upsertConfig(PENDING_KEY, "")]);
    return true;
  }

  // Devuelve un token válido, en orden de preferencia:
  //  1. En memoria (aún vigente).
  //  2. DROPI_TOKEN pegado a mano en el .env (modo manual de respaldo).
  //  3. El persistido en BotConfig (del último 2FA exitoso).
  // Si nada sirve → lanza DROPI_NEEDS_2FA para que se dispare el flujo por WhatsApp.
  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpMs - 60_000) return this.token;

    const manual = config.dropi.token;
    if (manual) {
      const exp = this.readExp(manual);
      if (Date.now() < exp) { this.token = manual; this.tokenExpMs = exp; return manual; }
      throw new Error(DROPI_TOKEN_EXPIRED);
    }

    const stored = await readConfig(TOKEN_KEY);
    if (stored) {
      const exp = this.readExp(stored);
      if (Date.now() < exp) { this.token = stored; this.tokenExpMs = exp; return stored; }
    }

    throw new Error(DROPI_NEEDS_2FA);
  }

  // GET autenticado. Si el token es rechazado (401) lo invalida y pide 2FA.
  private async authGet<T>(path: string, params: Record<string, string>): Promise<T> {
    const token = await this.ensureToken();
    try {
      const res = await this.http.get(path, { params, headers: this.authHeaders(token) });
      return res.data as T;
    } catch (e: any) {
      if (e.response?.status === 401) {
        this.token = null;
        this.tokenExpMs = 0;
        throw new Error(config.dropi.token ? DROPI_TOKEN_EXPIRED : DROPI_NEEDS_2FA);
      }
      throw e;
    }
  }

  // Lista pedidos. Sin filtros trae los más recientes (orderBy=id desc).
  async listOrders(params: ListOrdersParams = {}): Promise<DropiOrder[]> {
    const q: Record<string, string> = {
      orderBy: "id", // OJO: created_at da error SQL en este endpoint
      orderDirection: "desc",
      result_number: String(params.resultNumber ?? 50),
      start: String(params.start ?? 0),
      textToSearch: params.textToSearch ?? "",
      status: params.status ?? "",
      from: params.from ?? "",
      until: params.until ?? "",
      filter_date_by: params.filterDateBy ?? "",
    };
    const data = await this.authGet<MyOrdersResponse>("/orders/myorders", q);
    if (!data.isSuccess) throw new Error(`myorders falló: ${data.message ?? "?"}`);
    return data.objects ?? [];
  }

  // Pagina automáticamente hasta traer todos los pedidos que matcheen (o hasta
  // `max`). Útil para el barrido de estados.
  async listAllOrders(
    params: ListOrdersParams = {},
    { pageSize = 100, max = 2000 }: { pageSize?: number; max?: number } = {},
  ): Promise<DropiOrder[]> {
    const all: DropiOrder[] = [];
    for (let start = 0; start < max; start += pageSize) {
      const page = await this.listOrders({ ...params, resultNumber: pageSize, start });
      all.push(...page);
      if (page.length < pageSize) break;
    }
    return all;
  }

  // Historial de movimientos de la transportadora para una guía.
  async getGuideHistory(shippingGuide: string): Promise<unknown> {
    return this.authGet("/orders/consultarhistoricoguia", { shipping_guide: shippingGuide });
  }
}

export const dropi = new DropiClient();
