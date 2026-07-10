import { prisma } from "./db";

export interface DynConfig {
  pack3Price: number;
  pack6Price: number;
  remarketingEnabled: boolean;
  remarketingDiscount: number;
  botPaused: boolean;
  nequiNumber: string;
  availableColors: string[];
}

const DEFAULTS: DynConfig = {
  pack3Price: 69900,
  pack6Price: 119900,
  remarketingEnabled: true,
  remarketingDiscount: 10000,
  botPaused: false,
  nequiNumber: process.env.NEQUI_NUMBER ?? "3124743435",
  availableColors: ["Blanco", "Verde menta", "Rosado"],
};

let cache: { cfg: DynConfig; at: number } | null = null;
const TTL = 60_000;

export async function getConfig(): Promise<DynConfig> {
  if (cache && Date.now() - cache.at < TTL) return cache.cfg;

  try {
    const rows = await prisma.botConfig.findMany();
    const cfg = { ...DEFAULTS };
    for (const { key, value } of rows) {
      switch (key) {
        case "pack3_price":          cfg.pack3Price          = Number(value); break;
        case "pack6_price":          cfg.pack6Price          = Number(value); break;
        case "remarketing_enabled":  cfg.remarketingEnabled  = value === "true"; break;
        case "remarketing_discount": cfg.remarketingDiscount = Number(value); break;
        case "bot_paused":           cfg.botPaused           = value === "true"; break;
        case "nequi_number":         cfg.nequiNumber         = value; break;
        case "available_colors":
          try { cfg.availableColors = JSON.parse(value); } catch {}
          break;
      }
    }
    cache = { cfg, at: Date.now() };
    return cfg;
  } catch {
    return DEFAULTS;
  }
}

export async function setConfig(key: string, value: string): Promise<void> {
  await prisma.botConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
  cache = null;
}

export function invalidateConfigCache(): void {
  cache = null;
}
