# CANELITA-BOT — 8 Features Design Spec
**Date:** 2026-04-29  
**Status:** Approved

---

## Feature 1: Ad Source Identification (CTWA)

Meta's webhook includes a `referral` object on Click-to-WhatsApp ad messages. Currently ignored.

**Scope:**
- Parse `m.referral` in `src/api/webhook.ts` → `parseMessage`
- Extend `InboundEvent` with `referral?: { sourceId?: string; headline?: string; sourceUrl?: string; ctwaClid?: string }`
- Extend `Session` with `adSource?: string; adHeadline?: string; ctwaClid?: string`
- Add fields to `Conversation` model: `adSource String?`, `adHeadline String?`, `ctwaClid String?`
- Persist on first inbound only (don't overwrite)
- Display in dashboard conversation detail panel as "Fuente: [headline]"
- New Prisma migration

**Data available from webhook referral:**
- `source_id` → ad ID
- `headline` → ad creative headline
- `source_url` → ad URL
- `ctwa_clid` → click ID for attribution

---

## Feature 2: Multi-touch Remarketing (4 touches, 72h window)

Replace current fragmented system (greeting 2h + state-based + 24h recovery) with a single unified 4-touch sequence.

**Sequence (all cancelled on any inbound):**
| Touch | Delay from first contact | Message tone |
|-------|--------------------------|--------------|
| T1 | 2h | Testimonials + "¿Te lo mandamos hoy?" |
| T2 | 10h | Value prop + envío gratis + contraentrega |
| T3 | Next day 8am COL (UTC-5) | FOMO soft — "hoy despachamos" |
| T4 | Next day 3pm COL (UTC-5) | Last chance + descuento especial |

**Guard conditions (skip touch if any true):**
- `windowExpired === true` on conversation
- `Date.now() - session.createdAt > 72 * 60 * 60 * 1000`
- User has responded since last touch

**Changes:**
- Refactor `src/bot/remarketing.ts`: single `scheduleFullSequence(session)` replacing all current scheduling functions
- Update `REMARKETING_MESSAGES` and `REMARKETING_DELAYS` in `src/bot/flow.ts`
- Helper `msUntilNextDay(hour, minuteOffset=0)` calculates ms until next occurrence of a given hour in COL timezone
- Each touch persisted to DB as `remarketing:t1`, `remarketing:t2`, `remarketing:t3`, `remarketing:t4`
- Keep `cancelRemarketing(waId)` interface unchanged (called from handler on inbound)

---

## Feature 3: Remarketing Stats in Dashboard

**New endpoint** `GET /api/remarketing-stats`:

Query logic:
1. Count outbound messages by `remarketing:t1..t4` type → `sent` per type
2. For each, count distinct conversations where an inbound message follows the remarketing outbound (same conversationId, inbound.createdAt > remarketing.createdAt) → `replied`
3. Count conversations that reached CLOSED state after a remarketing message → `converted`

Response shape:
```json
{
  "t1": { "sent": 42, "replied": 18, "converted": 9 },
  "t2": { "sent": 30, "replied": 10, "converted": 5 },
  "t3": { "sent": 20, "replied": 6,  "converted": 3 },
  "t4": { "sent": 12, "replied": 3,  "converted": 1 },
  "overall": { "sent": 104, "replied": 37, "replyRate": 0.356, "conversionRate": 0.173 }
}
```

**Dashboard:** add remarketing section below metrics bar. Shows overall reply rate pill + table with per-touch breakdown. Auto-refreshes with other metrics.

---

## Features 4 & 5: Fix Duplicate Orders + Missing Data

**Root cause:** `persistOrderIfNeeded` does `prisma.order.create` unconditionally every time state reaches CLOSED. Since `CLOSED→CLOSED` is a valid transition, each subsequent bot message creates a new order.

**Fix:** Replace `create` with an upsert pattern:
1. `findFirst({ where: { conversationId: conv.id, status: { not: "CANCELLED" } } })`
2. If found → `update` with latest session fields (fixes missing data for orders created before all fields were collected)
3. If not found → `create`

**Additional:** When an order is updated with new field data, emit a `order_updated` dashboard event.

---

## Feature 6: WhatsApp Notification to Owner on Sale Close

**New module** `src/owner.ts`:
- `OWNER_WA = process.env.OWNER_WA_NUMBER ?? "+573124743435"` (also add to config)
- `notifyOwner(text: string)` → calls `sendText(OWNER_WA, text)`, logs error on failure, no crash
- Called from `persistOrderIfNeeded` after order created/updated with the same `orderSummary` string

**Note:** requires owner to have sent at least one message to the bot to open a 24h window. For daily report (Feature 9) a template may be needed eventually, but for sale notifications this is acceptable since activity is likely frequent.

---

## Feature 7: Audio Transcription

**Already implemented** in `src/whatsapp/transcribe.ts` using OpenAI Whisper (`whisper-1`, language `es`). Called in `src/bot/handler.ts` for `type === "audio"`.

**Action required:** add `OPENAI_API_KEY=sk-...` to `.env`. No code changes needed.

---

## Feature 8: Internal Reminders

**New Prisma model:**
```prisma
model Reminder {
  id        Int      @id @default(autoincrement())
  waId      String
  note      String
  dueAt     DateTime
  sent      Boolean  @default(false)
  createdAt DateTime @default(now())

  @@index([sent, dueAt])
}
```

**Detection:** Add optional `reminder` field to Claude's output JSON schema in `src/bot/prompts.ts`. When Claude detects a temporal commitment ("el jueves te escribo", "el fin de semana", "mañana"), it outputs:
```json
{ "reminder": { "note": "Cliente dijo que escribe el jueves", "daysFromNow": 3 } }
```

**Parsing:** extend `ClaudeReply` and `parseClaudeReply` in `src/bot/parser.ts` to extract `reminder`.

**Scheduling:** in `src/bot/handler.ts`, after parsing Claude reply, if `reminder` exists → `prisma.reminder.create({ data: { waId, note, dueAt: addDays(now, daysFromNow) } })`.

**Firing:** `setInterval` every 10 minutes in `src/index.ts` checks for `sent: false, dueAt: <= now` → sends owner WhatsApp notification per due reminder → marks `sent: true`.

**Dashboard:** new "Recordatorios" tab or section in sidebar showing pending reminders with waId, note, dueAt.

---

## Feature 9: Daily Report to Owner

**Scheduler:** on server start, calculate ms until next 9:00am COL (UTC-5). `setTimeout` → send report → `setInterval` for 24h thereafter.

**Report content (WhatsApp message):**
```
📊 Reporte Canelita — [fecha]

💰 Ventas hoy: X pedidos | $X.XXX.XXX COP
💬 Conversaciones nuevas: X
📈 Tasa de cierre: X%
📨 Tasa de respuesta: X%
🔁 Remarketing efectivo: X%

🚧 Principales objeciones hoy:
• precio (X veces)
• duda_resultados (X veces)
```

**Objection tracking:** add `objectionType String?` to `Message` model, populated in `handler.ts` when `detectObjection` fires. Daily report queries today's objection messages grouped by type.

---

## DB Migrations Summary

```
Migration 1: add adSource/adHeadline/ctwaClid to Conversation
Migration 2: add Reminder model
Migration 3: add objectionType to Message
```

---

## Files Touched

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add fields + Reminder model |
| `src/api/webhook.ts` | Parse referral object |
| `src/bot/flow.ts` | Update REMARKETING_MESSAGES, REMARKETING_DELAYS, Session type |
| `src/bot/remarketing.ts` | Full refactor → scheduleFullSequence |
| `src/bot/handler.ts` | Fix persistOrderIfNeeded, add reminder creation, add objection type |
| `src/bot/parser.ts` | Add reminder to ClaudeReply |
| `src/bot/prompts.ts` | Add reminder to Claude output schema |
| `src/bot/specialCases.ts` | No change |
| `src/api/routes.ts` | Add /remarketing-stats endpoint, /reminders endpoint |
| `src/config.ts` | Add OWNER_WA_NUMBER |
| `src/owner.ts` | New — notifyOwner() |
| `src/sessions.ts` | Add adSource/adHeadline/ctwaClid to Session hydration |
| `src/index.ts` | Add reminder checker + daily report scheduler |
| `public/index.html` | Add remarketing stats section + reminders section |
