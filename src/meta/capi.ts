import axios from "axios";
import { config } from "../config";

// Meta Conversions API for Business Messaging (CTWA CAPI).
//
// When a sale closes, the bot tells Meta "this person who clicked your
// click-to-WhatsApp ad actually bought" so the ad can attribute and optimize
// for real purchases. Events are sent server-to-server to the dataset/pixel.
//
// Docs: https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging

export type CapiEventName = "Purchase" | "Lead" | "Contact";

export interface CapiEvent {
  eventName: CapiEventName;
  // Click ID captured from the CTWA referral. Without it Meta can't attribute
  // the event to an ad, so we skip sending when it's missing.
  ctwaClid: string;
  // WhatsApp Business Account ID — taken from the inbound webhook (entry.id).
  wabaId: string;
  // Deterministic ID for deduplication across retries (e.g. "purchase_42").
  eventId: string;
  // Monetary fields — only meaningful for Purchase.
  value?: number;
  currency?: string;
  eventTime?: number; // unix seconds; defaults to now
}

export interface CapiResult {
  ok: boolean;
  status?: number;
  error?: string;
  skipped?: string;
}

function endpoint(): string {
  const { apiVersion, datasetId } = config.meta;
  return `https://graph.facebook.com/${apiVersion}/${datasetId}/events`;
}

function buildPayload(ev: CapiEvent): Record<string, unknown> {
  const data: Record<string, unknown> = {
    event_name: ev.eventName,
    event_time: ev.eventTime ?? Math.floor(Date.now() / 1000),
    event_id: ev.eventId,
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    user_data: {
      whatsapp_business_account_id: ev.wabaId,
      ctwa_clid: ev.ctwaClid,
    },
  };

  if (ev.value != null) {
    data.custom_data = {
      currency: ev.currency ?? "COP",
      value: String(ev.value),
    };
  }

  return { data: [data] };
}

// Fire a single conversion event. Never throws — failures are logged and
// returned so callers (e.g. order persistence) never break on Meta errors.
// Retries transient failures with simple exponential backoff.
export async function sendConversionEvent(ev: CapiEvent): Promise<CapiResult> {
  if (!config.meta.enabled) return { ok: false, skipped: "capi_disabled" };
  if (!config.meta.token) return { ok: false, skipped: "no_token" };
  if (!ev.ctwaClid) return { ok: false, skipped: "no_ctwa_clid" };
  if (!ev.wabaId) return { ok: false, skipped: "no_waba_id" };

  const url = endpoint();
  const payload = buildPayload(ev);
  const maxAttempts = 3;
  let lastErr = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await axios.post(url, payload, {
        params: { access_token: config.meta.token },
        timeout: 8000,
        headers: { "Content-Type": "application/json" },
      });
      console.log(
        `[capi] ${ev.eventName} sent (event_id=${ev.eventId}) → received=${res.data?.events_received ?? "?"}`,
      );
      return { ok: true, status: res.status };
    } catch (e: any) {
      const status = e?.response?.status;
      lastErr =
        e?.response?.data?.error?.message ?? e?.message ?? "unknown error";

      // 4xx (except 429) are permanent — bad payload / token, no point retrying.
      const retriable = !status || status === 429 || status >= 500;
      console.error(
        `[capi] ${ev.eventName} attempt ${attempt}/${maxAttempts} failed (status=${status}): ${lastErr}`,
      );
      if (!retriable || attempt === maxAttempts) break;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }

  return { ok: false, error: lastErr };
}
