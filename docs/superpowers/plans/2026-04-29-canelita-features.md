# CANELITA-BOT 8 Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ad-source attribution, 4-touch remarketing, remarketing stats, duplicate-order fix, owner WA notifications, internal reminders, and daily reports to CANELITA-BOT.

**Architecture:** Each feature is independent; DB migrations come first. Owner notifications go through a new `src/owner.ts` module that calls `sendText`. Remarketing is unified into a single `scheduleFullSequence`. Reminders flow through Claude's JSON output → DB → a periodic checker.

**Tech Stack:** TypeScript, Prisma/PostgreSQL, Express, Node.js built-in test runner (`node:test`), vanilla JS dashboard.

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `prisma/schema.prisma` | Modify | Add `adSource`, `adHeadline`, `ctwaClid` to Conversation; `objectionType` to Message; new `Reminder` model |
| `src/config.ts` | Modify | Add `owner.waNumber` |
| `src/owner.ts` | Create | `notifyOwner(text)` — sends WA to owner, silently skips on error |
| `src/api/webhook.ts` | Modify | Parse `m.referral` → extend `InboundEvent` |
| `src/bot/flow.ts` | Modify | New `REMARKETING_MESSAGES` (t1-t4), remove old delays/messages, add `adSource`/`adHeadline`/`ctwaClid` to `Session`, add `msUntilNextDayColTime` helper |
| `src/bot/remarketing.ts` | Rewrite | Single `scheduleFullSequence(session)` replacing all current exports except `cancelRemarketing` |
| `src/bot/handler.ts` | Modify | Use `scheduleFullSequence`, upsert orders, add reminder creation, add `objectionType` to persist, call `notifyOwner` on close |
| `src/bot/parser.ts` | Modify | Add `Reminder` interface + `reminder` field to `ClaudeReply` |
| `src/bot/prompts.ts` | Modify | Add `reminder` to `OUTPUT_FORMAT` |
| `src/sessions.ts` | Modify | Hydrate `adSource`/`adHeadline`/`ctwaClid` from DB |
| `src/api/routes.ts` | Modify | Add `/remarketing-stats` and `/reminders` endpoints |
| `src/index.ts` | Modify | Add reminder checker interval + daily report scheduler |
| `public/index.html` | Modify | Add remarketing stats to metrics bar, reminders section in info panel, ad source in conversation info |
| `tests/remarketing.test.ts` | Create | Tests for `msUntilNextDayColTime` and touch guard logic |
| `tests/orders.test.ts` | Create | Tests for duplicate-order prevention logic |
| `tests/reminders.test.ts` | Create | Tests for `normalizeReminder` parser |

---

## Task 1: DB Migrations

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Edit schema.prisma**

Open `prisma/schema.prisma`. Apply these changes:

In `model Conversation`, add after the `email` field:
```prisma
  adSource   String?
  adHeadline String?
  ctwaClid   String?
```

In `model Message`, add after `whatsappMsgId`:
```prisma
  objectionType String?
```

Add new model at the end of the file:
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

- [ ] **Step 2: Run migration**

```bash
cd /Users/mateogiraldo/CANELITA-BOT
npx prisma migrate dev --name add_adsource_reminder_objectiontype
```

Expected: migration file created, client regenerated, no errors.

- [ ] **Step 3: Verify**

```bash
npx prisma studio --browser none &
sleep 3
kill %1
echo "Schema OK"
```

Or just: `npx prisma validate` — expected: "The schema at prisma/schema.prisma is valid"

- [ ] **Step 4: Commit**

```bash
git add prisma/
git commit -m "feat: add adSource, Reminder, and objectionType to schema"
```

---

## Task 2: Owner Notification Module

**Files:**
- Modify: `src/config.ts`
- Create: `src/owner.ts`

- [ ] **Step 1: Add owner config**

In `src/config.ts`, add inside the `config` object after `greeting`:
```typescript
  owner: {
    waNumber: optional("OWNER_WA_NUMBER", "+573124743435"),
  },
```

- [ ] **Step 2: Create src/owner.ts**

```typescript
import { sendText } from "./whatsapp/client";
import { config } from "./config";

export async function notifyOwner(text: string): Promise<void> {
  const to = config.owner.waNumber;
  if (!to) return;
  try {
    await sendText(to, text);
  } catch (e: any) {
    console.error("[owner.notify]", e.message);
  }
}
```

- [ ] **Step 3: Verify types compile**

```bash
cd /Users/mateogiraldo/CANELITA-BOT
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/config.ts src/owner.ts
git commit -m "feat: add owner WhatsApp notification module"
```

---

## Task 3: Ad Source Parsing from CTWA Webhook

**Files:**
- Modify: `src/api/webhook.ts`
- Modify: `src/bot/flow.ts` (Session type)
- Modify: `src/sessions.ts` (DB hydration)
- Modify: `src/bot/handler.ts` (persist on first inbound)

- [ ] **Step 1: Extend InboundEvent in src/api/webhook.ts**

Find the `InboundEvent` interface (it's actually in `src/bot/handler.ts` — check there). It's in `handler.ts`:
```typescript
export interface InboundEvent {
  waId: string;
  customerName?: string;
  type: "text" | "audio" | "image" | "other";
  text?: string;
  mediaId?: string;
  whatsappMsgId?: string;
}
```

Add `referral` field:
```typescript
export interface InboundEvent {
  waId: string;
  customerName?: string;
  type: "text" | "audio" | "image" | "other";
  text?: string;
  mediaId?: string;
  whatsappMsgId?: string;
  referral?: {
    sourceId?: string;
    headline?: string;
    sourceUrl?: string;
    ctwaClid?: string;
  };
}
```

- [ ] **Step 2: Parse referral in parseMessage (src/api/webhook.ts)**

Find the `parseMessage` function. Add referral extraction before the `if (m.type === "text")` block:

```typescript
function parseMessage(m: any, names: Map<string, string>): InboundEvent | null {
  const waId = m?.from;
  if (!waId) return null;
  const customerName = names.get(waId);
  const whatsappMsgId = m?.id;

  // Parse CTWA referral if present
  const referral = m.referral
    ? {
        sourceId:  m.referral.source_id   ?? undefined,
        headline:  m.referral.headline    ?? undefined,
        sourceUrl: m.referral.source_url  ?? undefined,
        ctwaClid:  m.referral.ctwa_clid   ?? undefined,
      }
    : undefined;

  if (m.type === "text") {
    return { waId, customerName, whatsappMsgId, type: "text", text: m.text?.body ?? "", referral };
  }
  if (m.type === "audio" || m.type === "voice") {
    return { waId, customerName, whatsappMsgId, type: "audio", mediaId: m.audio?.id ?? m.voice?.id, referral };
  }
  if (m.type === "image") {
    return { waId, customerName, whatsappMsgId, type: "image", mediaId: m.image?.id, text: m.image?.caption ?? "", referral };
  }
  if (m.type === "interactive") {
    const reply =
      m.interactive?.button_reply?.title ??
      m.interactive?.list_reply?.title ??
      "";
    return { waId, customerName, whatsappMsgId, type: "text", text: reply, referral };
  }
  return { waId, customerName, whatsappMsgId, type: "other", text: "", referral };
}
```

- [ ] **Step 3: Add adSource fields to Session (src/bot/flow.ts)**

Find the `Session` interface and add after `email?`:
```typescript
  adSource?: string;
  adHeadline?: string;
  ctwaClid?: string;
```

- [ ] **Step 4: Hydrate adSource from DB (src/sessions.ts)**

In `getOrLoadSession`, find where the session object is constructed. Add after `createdAt: conv.createdAt.getTime()`:
```typescript
        adSource:   conv.adSource   ?? undefined,
        adHeadline: conv.adHeadline ?? undefined,
        ctwaClid:   conv.ctwaClid   ?? undefined,
```

- [ ] **Step 5: Persist adSource on first inbound (src/bot/handler.ts)**

In `handleInbound`, after the `if (ev.customerName && !session.customerName)` block, add:
```typescript
  if (ev.referral && !session.adSource) {
    session.adSource   = ev.referral.sourceId;
    session.adHeadline = ev.referral.headline;
    session.ctwaClid   = ev.referral.ctwaClid;
  }
```

In `ensureConversation`'s `update` block, add (after `altPhone`):
```typescript
      adSource:   session.adSource   ?? undefined,
      adHeadline: session.adHeadline ?? undefined,
      ctwaClid:   session.ctwaClid   ?? undefined,
```

And in the `create` block, add:
```typescript
      adSource:   session.adSource,
      adHeadline: session.adHeadline,
      ctwaClid:   session.ctwaClid,
```

- [ ] **Step 6: Show ad source in dashboard (public/index.html)**

Find the `renderInfoTab` function. Find the "Sesión" section:
```javascript
    <div class="isec">
      <div class="isec-title">Sesión</div>
      ${row('Estado',    `<span class="sbadge s-${d.state}">${slabel(d.state)}</span>`)}
      ${row('Objeciones', d.objectionCount ?? 0)}
      ${row('Creado',    d.createdAt ? new Date(d.createdAt).toLocaleDateString('es-CO') : '—')}
    </div>`;
```

Replace with:
```javascript
    <div class="isec">
      <div class="isec-title">Sesión</div>
      ${row('Estado',    `<span class="sbadge s-${d.state}">${slabel(d.state)}</span>`)}
      ${row('Objeciones', d.objectionCount ?? 0)}
      ${d.adHeadline ? row('Anuncio', x(d.adHeadline)) : ''}
      ${d.adSource   ? row('Ad ID',   x(d.adSource))   : ''}
      ${row('Creado',    d.createdAt ? new Date(d.createdAt).toLocaleDateString('es-CO') : '—')}
    </div>`;
```

- [ ] **Step 7: Verify types compile**

```bash
cd /Users/mateogiraldo/CANELITA-BOT
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/api/webhook.ts src/bot/flow.ts src/sessions.ts src/bot/handler.ts public/index.html
git commit -m "feat: parse CTWA referral and show ad source in dashboard"
```

---

## Task 4: 4-Touch Remarketing Sequence

**Files:**
- Modify: `src/bot/flow.ts`
- Rewrite: `src/bot/remarketing.ts`
- Modify: `src/bot/handler.ts`
- Create: `tests/remarketing.test.ts`

- [ ] **Step 1: Write failing tests for time helper**

Create `tests/remarketing.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { msUntilNextDayColTime } from "../src/bot/flow";

test("msUntilNextDayColTime: next 8am COL is always in future", () => {
  const now = Date.now();
  const delay = msUntilNextDayColTime(now, 8);
  assert.ok(delay > 0, "delay must be positive");
});

test("msUntilNextDayColTime: next 8am COL is within 25 to 49 hours", () => {
  // 8am next day should never be more than 48h away and at least ~1h away (we use +24h as base)
  const now = Date.now();
  const delay = msUntilNextDayColTime(now, 8);
  const hours = delay / (60 * 60 * 1000);
  assert.ok(hours >= 1,  `delay too short: ${hours.toFixed(1)}h`);
  assert.ok(hours <= 49, `delay too long: ${hours.toFixed(1)}h`);
});

test("msUntilNextDayColTime: 3pm COL is at least 7h after 8am COL same day", () => {
  const now = Date.now();
  const t3 = msUntilNextDayColTime(now, 8);
  const t4 = msUntilNextDayColTime(now, 15);
  assert.ok(t4 > t3, "3pm must be after 8am");
  const diffH = (t4 - t3) / (60 * 60 * 1000);
  assert.ok(Math.abs(diffH - 7) < 0.1, `expected 7h gap, got ${diffH.toFixed(2)}h`);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/mateogiraldo/CANELITA-BOT
npx tsx tests/remarketing.test.ts
```

Expected: error — `msUntilNextDayColTime` not exported from `flow.ts`.

- [ ] **Step 3: Update REMARKETING_MESSAGES and add time helper (src/bot/flow.ts)**

Replace the existing `REMARKETING_MESSAGES` and `REMARKETING_DELAYS` constants with:

```typescript
export const REMARKETING_MESSAGES = {
  t1: `Reina, ¿pudiste ver bien la info? 💛\n\nMira los resultados que están teniendo nuestras clientas con Canelita... el bronceado queda natural y divino.\n\nRecuerda: envío GRATIS a toda Colombia y pagas solo cuando lo recibes. Sin riesgo ✨\n\n¿Te lo mandamos hoy?`,
  t2: `Hola de nuevo ✨ Te cuento que el autobronceador sigue disponible con envío gratis y pagas al recibirlo — sin riesgo.\n\nLa mayoría que lo prueba repite. ¿Le damos?`,
  t3: `Buenos días reina ☀️ Hoy tenemos despachos y quería saber si ya te decidiste.\n\nSi lo cerramos hoy mismo sale en camino. ¿Qué me dices?`,
  t4: `Última cosita reina 💛 Hoy es el último día que te puedo aplicar el precio especial.\n\n¿Lo llevamos o lo dejamos para después?`,
};

// Helper: ms until the next occurrence of colHour on the *next calendar day* (COL = UTC-5)
export function msUntilNextDayColTime(fromMs: number, colHour: number): number {
  const utcHour = (colHour + 5) % 24; // COL UTC-5: 8am→13:00 UTC, 15pm→20:00 UTC
  const candidate = new Date(fromMs + 24 * 60 * 60 * 1000); // start from tomorrow
  candidate.setUTCHours(utcHour, 0, 0, 0);
  // If candidate ended up before fromMs (e.g., hour wrap), add another day
  if (candidate.getTime() <= fromMs) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate.getTime() - fromMs;
}
```

Also **remove** the old `REMARKETING_DELAYS` export entirely (it will no longer be used).

- [ ] **Step 4: Run tests — they should pass**

```bash
cd /Users/mateogiraldo/CANELITA-BOT
npx tsx tests/remarketing.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 5: Rewrite src/bot/remarketing.ts**

Replace the entire file with:

```typescript
import { config } from "../config";
import { sendImageUrl, sendText } from "../whatsapp/client";
import { REMARKETING_MESSAGES, Session, msUntilNextDayColTime } from "./flow";
import { events } from "../events";
import { prisma } from "../db";

interface Tracker {
  timers: NodeJS.Timeout[];
}

const trackers = new Map<string, Tracker>();

function clearTimers(waId: string) {
  const t = trackers.get(waId);
  if (t) {
    for (const x of t.timers) clearTimeout(x);
    trackers.delete(waId);
  }
}

export function cancelRemarketing(waId: string) {
  clearTimers(waId);
}

// Single entry point: schedule all 4 touches from session.createdAt.
// Safe to call repeatedly — recalculates and replaces existing timers.
export function scheduleFullSequence(session: Session) {
  clearTimers(session.waId);

  const start = session.createdAt;
  const WINDOW_72H = 72 * 60 * 60 * 1000;

  const touches: Array<{ delay: number; type: string }> = [
    { delay: 2  * 60 * 60 * 1000,           type: "t1" },
    { delay: 10 * 60 * 60 * 1000,           type: "t2" },
    { delay: msUntilNextDayColTime(start, 8),  type: "t3" },
    { delay: msUntilNextDayColTime(start, 15), type: "t4" },
  ];

  const timers: NodeJS.Timeout[] = [];

  for (const touch of touches) {
    const absoluteFire = start + touch.delay;
    const remaining    = absoluteFire - Date.now();

    if (remaining <= 0)                   continue; // already past
    if (touch.delay > WINDOW_72H)         continue; // outside Meta window

    const { type } = touch;
    timers.push(
      setTimeout(() => fireTouch(session.waId, type), remaining),
    );
  }

  if (timers.length) trackers.set(session.waId, { timers });
}

async function fireTouch(waId: string, type: string) {
  // Guard: re-check window hasn't expired in DB
  try {
    const conv = await prisma.conversation.findUnique({ where: { waId } });
    if (!conv) return;
    if (conv.windowExpired) return;
    if (conv.state === "CLOSED") return;

    if (type === "t1") {
      await sendT1(waId, conv.id);
    } else {
      const msg = REMARKETING_MESSAGES[type as keyof typeof REMARKETING_MESSAGES];
      if (!msg) return;
      await sendRemarketingText(waId, conv.id, msg, type);
    }
  } catch (e: any) {
    console.error(`[remarketing.${type}]`, e.message);
  }
}

async function sendT1(waId: string, convId: number) {
  const imgs = config.greeting.imageUrls;
  for (const url of imgs) {
    await sendImageUrl(waId, url);
    await new Promise((r) => setTimeout(r, 1000));
  }
  await sendRemarketingText(waId, convId, REMARKETING_MESSAGES.t1, "t1");
}

async function sendRemarketingText(waId: string, convId: number, text: string, type: string) {
  await sendText(waId, text);

  events.emitDashboard({
    type: "message",
    waId,
    direction: "outbound",
    body: text,
    messageType: `remarketing:${type}`,
    at: Date.now(),
  });

  await prisma.message.create({
    data: {
      conversationId: convId,
      direction: "outbound",
      type: `remarketing:${type}`,
      body: text,
    },
  });
}
```

- [ ] **Step 6: Update handler.ts — replace scheduling calls**

In `processCombined`, find the greeting branch and change `scheduleGreetingRemarketing(session.waId)` to `scheduleFullSequence(session)`.

Change this:
```typescript
    scheduleGreetingRemarketing(session.waId);
    return;
```
To:
```typescript
    scheduleFullSequence(session);
    return;
```

Find the non-CLOSED branch and change `scheduleRemarketing(session)` to `scheduleFullSequence(session)`:
```typescript
  } else {
    scheduleFullSequence(session);
  }
```

Update the import at the top of handler.ts — remove `scheduleGreetingRemarketing` and `scheduleRemarketing`, add `scheduleFullSequence`:
```typescript
import { cancelRemarketing, scheduleFullSequence } from "./remarketing";
```

- [ ] **Step 7: Verify compile**

```bash
cd /Users/mateogiraldo/CANELITA-BOT
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/bot/flow.ts src/bot/remarketing.ts src/bot/handler.ts tests/remarketing.test.ts
git commit -m "feat: 4-touch remarketing sequence within 72h window"
```

---

## Task 5: Fix Duplicate Orders + Missing Data

**Files:**
- Modify: `src/bot/handler.ts`
- Create: `tests/orders.test.ts`

- [ ] **Step 1: Write failing test for upsert logic**

Create `tests/orders.test.ts` (uses inline logic to avoid pulling Prisma into tests):
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";

// Mirrors shouldCreateNewOrder in handler.ts — tested independently to keep tests fast
function shouldCreateNewOrder(existing: { id: number; status: string } | null): boolean {
  if (!existing) return true;
  return existing.status === "CANCELLED";
}

test("shouldCreateNewOrder: returns true when no existing order", () => {
  assert.equal(shouldCreateNewOrder(null), true);
});

test("shouldCreateNewOrder: returns false when order exists", () => {
  assert.equal(shouldCreateNewOrder({ id: 1, status: "PENDING" }), false);
});

test("shouldCreateNewOrder: returns true when only CANCELLED order exists", () => {
  assert.equal(shouldCreateNewOrder({ id: 2, status: "CANCELLED" }), true);
});
```

- [ ] **Step 2: Run test to verify it passes immediately (pure logic test)**

```bash
cd /Users/mateogiraldo/CANELITA-BOT
npx tsx tests/orders.test.ts
```

Expected: all 3 tests pass. (The test defines the expected behavior, not an import — we implement handler.ts next to match it.)

- [ ] **Step 3: Rewrite persistOrderIfNeeded and export helper (src/bot/handler.ts)**

Find the `persistOrderIfNeeded` function and replace it entirely:

```typescript
// Exported for testing
export function shouldCreateNewOrder(existing: { id: number; status: string } | null): boolean {
  if (!existing) return true;
  return existing.status === "CANCELLED";
}

async function persistOrderIfNeeded(session: Session) {
  if (!session.cart.length) return;
  const total = computeTotal(session.cart);

  try {
    const conv = await ensureConversation(session);

    const existing = await prisma.order.findFirst({
      where: { conversationId: conv.id, status: { not: "CANCELLED" } },
      select: { id: true, status: true },
    });

    const orderData = {
      cart:          session.cart as any,
      total,
      paymentMethod: session.pendingOrder?.paymentMethod ?? "cod",
      fullName:      session.fullName      ?? null,
      idNumber:      session.idNumber      ?? null,
      email:         session.email         ?? null,
      address:       session.address       ?? null,
      city:          session.city          ?? null,
      department:    session.department    ?? null,
      altPhone:      session.altPhone      ?? null,
      reference:     session.reference     ?? null,
    };

    let order: { id: number };

    if (shouldCreateNewOrder(existing)) {
      order = await prisma.order.create({
        data: { conversationId: conv.id, status: "PENDING", ...orderData },
      });

      events.emitDashboard({
        type: "order_created",
        waId: session.waId,
        orderId: order.id,
        total,
        at: Date.now(),
      });

      await notifyOwner(
        `🛒 *Nuevo pedido*\n\n${orderSummary(session, total)}`,
      );

      notify(
        TELEGRAM_TEMPLATES.newOrder(session.waId, orderSummary(session, total)),
      );
    } else {
      // Update with latest session data (fills in fields that weren't set at creation time)
      order = await prisma.order.update({
        where: { id: existing!.id },
        data: orderData,
      });

      events.emitDashboard({
        type: "order_updated" as any,
        waId: session.waId,
        orderId: order.id,
        total,
        at: Date.now(),
      });
    }
  } catch (e: any) {
    console.error("[handler.persistOrder]", e.message);
  }
}
```

Add the import for `notifyOwner` at the top of handler.ts:
```typescript
import { notifyOwner } from "../owner";
```

- [ ] **Step 4: Run tests — they should pass**

```bash
cd /Users/mateogiraldo/CANELITA-BOT
npx tsx tests/orders.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 5: Also track objectionType in persisted messages**

In `processCombined`, find where the objection is detected:
```typescript
  if (objection && session.state !== "GREETING") {
    session.objectionCount += 1;
    claudeText = buildObjectionResponse(objection);
    nextState = "OBJECTION_HANDLING";
```

After this block (before `const sanitized`), store the objection type in a local variable:
```typescript
  const detectedObjectionType = objection?.type ?? null;
```

In `persistOutbound`, add an optional fourth parameter:

Change signature from:
```typescript
async function persistOutbound(session: Session, body: string, state: State) {
```
To:
```typescript
async function persistOutbound(session: Session, body: string, state: State, objectionType?: string) {
```

In `persistOutbound`'s `prisma.message.create`, add:
```typescript
        objectionType: objectionType ?? null,
```

Call site in `processCombined` — change from:
```typescript
  await persistOutbound(session, sanitized, nextState);
```
To:
```typescript
  await persistOutbound(session, sanitized, nextState, detectedObjectionType ?? undefined);
```

- [ ] **Step 6: Verify compile**

```bash
cd /Users/mateogiraldo/CANELITA-BOT
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/bot/handler.ts tests/orders.test.ts
git commit -m "fix: prevent duplicate orders, update with latest session data, track objection type"
```

---

## Task 6: Remarketing Stats API

**Files:**
- Modify: `src/api/routes.ts`

- [ ] **Step 1: Add /remarketing-stats endpoint**

In `src/api/routes.ts`, add after the `/metrics` endpoint:

```typescript
apiRouter.get("/remarketing-stats", async (_req, res) => {
  try {
    const types = ["t1", "t2", "t3", "t4"] as const;
    const result: Record<string, { sent: number; replied: number; converted: number }> = {};

    for (const t of types) {
      const msgType = `remarketing:${t}`;

      // Count messages of this type sent
      const sent = await prisma.message.count({
        where: { type: msgType, direction: "outbound" },
      });

      // Count conversations where an inbound message follows this remarketing type
      const repliedRows = await prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT m2."conversationId") AS count
        FROM "Message" m1
        JOIN "Message" m2
          ON m2."conversationId" = m1."conversationId"
          AND m2.direction = 'inbound'
          AND m2."createdAt" > m1."createdAt"
        WHERE m1.type = ${msgType}
          AND m1.direction = 'outbound'
      `;
      const replied = Number(repliedRows[0]?.count ?? 0);

      // Count conversations that eventually reached CLOSED after this remarketing
      const convertedRows = await prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT c.id) AS count
        FROM "Conversation" c
        JOIN "Message" m
          ON m."conversationId" = c.id
          AND m.type = ${msgType}
          AND m.direction = 'outbound'
        WHERE c.state = 'CLOSED'
      `;
      const converted = Number(convertedRows[0]?.count ?? 0);

      result[t] = { sent, replied, converted };
    }

    const totalSent      = Object.values(result).reduce((s, r) => s + r.sent, 0);
    const totalReplied   = Object.values(result).reduce((s, r) => s + r.replied, 0);
    const totalConverted = Object.values(result).reduce((s, r) => s + r.converted, 0);

    res.json({
      ...result,
      overall: {
        sent:           totalSent,
        replied:        totalReplied,
        converted:      totalConverted,
        replyRate:      totalSent > 0 ? totalReplied   / totalSent : 0,
        conversionRate: totalSent > 0 ? totalConverted / totalSent : 0,
      },
    });
  } catch (e: any) {
    console.error("[remarketing-stats]", e.message);
    res.status(500).json({ error: "stats_error" });
  }
});
```

- [ ] **Step 2: Verify compile**

```bash
cd /Users/mateogiraldo/CANELITA-BOT
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Add remarketing stats to dashboard (public/index.html)**

Find the metrics bar in the HTML (around line 558):
```html
<div id="metrics-bar">
  <div class="metric-item">
    <span class="metric-label">Tasa de respuesta</span>
    <span class="metric-value gray" id="m-response">…</span>
  </div>
  <div class="metric-divider"></div>
  <div class="metric-item">
    <span class="metric-label">Tasa de cierre</span>
    <span class="metric-value gray" id="m-close">…</span>
  </div>
  <div class="metric-divider"></div>
  <div class="metric-item"></div>
```

The metrics bar currently ends with several metric items. Add at the end before the closing `</div>`:
```html
  <div class="metric-divider"></div>
  <div class="metric-item">
    <span class="metric-label">Remarketing reply</span>
    <span class="metric-value gray" id="m-rmk-reply">…</span>
  </div>
  <div class="metric-divider"></div>
  <div class="metric-item">
    <span class="metric-label">Remarketing conv.</span>
    <span class="metric-value gray" id="m-rmk-conv">…</span>
  </div>
```

In `loadMetrics` JS function, add after the existing metric calls:
```javascript
  try {
    const rmk = await fetch('/api/remarketing-stats').then(r => r.json());
    const rrPct = ((rmk.overall?.replyRate ?? 0) * 100).toFixed(1) + '%';
    const rcPct = ((rmk.overall?.conversionRate ?? 0) * 100).toFixed(1) + '%';
    const rrColor = (rmk.overall?.replyRate ?? 0) >= 0.20 ? 'green' : 'orange';
    const rcColor = (rmk.overall?.conversionRate ?? 0) >= 0.10 ? 'green' : 'orange';
    setMetric('m-rmk-reply', rrPct, rrColor);
    setMetric('m-rmk-conv',  rcPct, rcColor);
  } catch(_) {}
```

- [ ] **Step 4: Commit**

```bash
git add src/api/routes.ts public/index.html
git commit -m "feat: remarketing stats API endpoint and dashboard metrics"
```

---

## Task 7: Internal Reminders

**Files:**
- Modify: `src/bot/parser.ts`
- Modify: `src/bot/prompts.ts`
- Modify: `src/bot/handler.ts`
- Modify: `src/api/routes.ts`
- Create: `tests/reminders.test.ts`

- [ ] **Step 1: Write failing tests for reminder parser**

Create `tests/reminders.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClaudeReply } from "../src/bot/parser";

test("parseClaudeReply: extracts reminder when present", () => {
  const raw = JSON.stringify({
    message: "Claro reina, te escribo el jueves 💛",
    state: "INTEREST",
    cartUpdate: null,
    fields: null,
    reminder: { note: "Cliente dijo que escribe el jueves", daysFromNow: 3 },
  });
  const result = parseClaudeReply(raw, "INTEREST");
  assert.ok(result.reminder !== null, "reminder should be set");
  assert.equal(result.reminder!.daysFromNow, 3);
  assert.equal(result.reminder!.note, "Cliente dijo que escribe el jueves");
});

test("parseClaudeReply: reminder is null when absent", () => {
  const raw = JSON.stringify({
    message: "Hola reina ✨",
    state: "INTEREST",
    cartUpdate: null,
    fields: null,
  });
  const result = parseClaudeReply(raw, "INTEREST");
  assert.equal(result.reminder, null);
});

test("parseClaudeReply: reminder with daysFromNow=0 is rejected", () => {
  const raw = JSON.stringify({
    message: "Hola",
    state: "INTEREST",
    cartUpdate: null,
    fields: null,
    reminder: { note: "test", daysFromNow: 0 },
  });
  const result = parseClaudeReply(raw, "INTEREST");
  assert.equal(result.reminder, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/mateogiraldo/CANELITA-BOT
npx tsx tests/reminders.test.ts
```

Expected: error or tests fail because `reminder` field doesn't exist on `ClaudeReply`.

- [ ] **Step 3: Add Reminder type and field to parser (src/bot/parser.ts)**

At the top of the file, add the interface:
```typescript
export interface ReminderEntry {
  note: string;
  daysFromNow: number;
}
```

In the `ClaudeReply` interface, add:
```typescript
  reminder: ReminderEntry | null;
```

In `parseClaudeReply`, find each `return {` statement and add `reminder: normalizeReminder(parsed?.reminder ?? direct?.reminder ?? null)` (or just use the parsed object). Concretely, for the main return at the end and in the JSON parse branches, add `reminder: normalizeReminder(...)`.

Specifically, for the direct JSON parse branch:
```typescript
    if (direct && typeof direct.message === "string") {
      return {
        message: direct.message,
        state: isValidState(direct.state) ? direct.state : fallbackState,
        cartUpdate: normalizeCartUpdate(direct.cartUpdate),
        fields: normalizeFields(direct.fields),
        reminder: normalizeReminder(direct.reminder),
      };
    }
```

For the block JSON parse branch:
```typescript
      if (parsed && typeof parsed.message === "string") {
        return {
          message: parsed.message,
          state: isValidState(parsed.state) ? parsed.state : fallbackState,
          cartUpdate: normalizeCartUpdate(parsed.cartUpdate),
          fields: normalizeFields(parsed.fields),
          reminder: normalizeReminder(parsed.reminder),
        };
      }
```

For the `messageMatch` fallback and final fallback, add `reminder: null`.

Add the normalizer function at the bottom of the file:
```typescript
function normalizeReminder(raw: unknown): ReminderEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const note = typeof r.note === "string" && r.note.trim() ? r.note.trim() : null;
  const days = typeof r.daysFromNow === "number" && r.daysFromNow > 0
    ? Math.ceil(r.daysFromNow)
    : null;
  if (!note || !days) return null;
  return { note, daysFromNow: days };
}
```

- [ ] **Step 4: Run tests — they should pass**

```bash
cd /Users/mateogiraldo/CANELITA-BOT
npx tsx tests/reminders.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 5: Update OUTPUT_FORMAT in prompts.ts**

Find `OUTPUT_FORMAT` and update the JSON example line and description.

Change the output format description to include `reminder`:
```typescript
export const OUTPUT_FORMAT = `FORMATO DE SALIDA OBLIGATORIO:
Responde SIEMPRE y SOLO con un JSON válido en una sola línea, sin markdown, sin texto antes ni después:

{"message":"texto que ve el cliente","state":"ESTADO_NUEVO","cartUpdate":[{"variant":"natural|intenso","quantity":N}] o null,"fields":{"fullName":null,"idNumber":null,"email":null,"city":null,"department":null,"address":null,"reference":null,"altPhone":null},"reminder":null}

- "message": el texto de WhatsApp que verá el cliente. Puede tener saltos de línea con \\n.
- "state": uno de GREETING, INTEREST, VARIANT_SELECTION, QUANTITY, OBJECTION_HANDLING, CONFIRM_ORDER, ADDRESS_COLLECTION, PAYMENT_METHOD, CLOSED.
- "cartUpdate": null si no hubo cambio en carrito; arreglo de items si sí (reemplaza el carrito completo).
- "fields": SIEMPRE incluido. Pon null en cada campo si no fue mencionado. Si el cliente dio un dato, extráelo aquí aunque ya estuviera en el contexto.
- "reminder": null por defecto. Si el cliente menciona una fecha futura específica en que volverá a escribir o a dar respuesta (ej: "el jueves te cuento", "el fin de semana te aviso", "cuando me paguen te escribo"), pon {"note":"resumen corto de lo que dijo","daysFromNow":N} donde N es el número estimado de días hasta ese momento. Si no hay compromiso temporal claro, deja null.`;
```

- [ ] **Step 6: Create reminder in handler.ts after Claude reply**

In `processCombined`, after the `applyFields` call and before `sendInParts`, add:

```typescript
  // Schedule internal reminder if Claude detected a temporal commitment
  if (!objection && reply.reminder) {
    const dueAt = new Date(Date.now() + reply.reminder.daysFromNow * 24 * 60 * 60 * 1000);
    prisma.reminder
      .create({ data: { waId: session.waId, note: reply.reminder.note, dueAt } })
      .catch((e: any) => console.error("[reminder.create]", e.message));
  }
```

This goes right after:
```typescript
  if (reply.fields) applyFields(session, reply.fields);
```

Also update the type of `reply` — `askClaude` returns a `ClaudeReply`. The `reminder` field is now part of that type, so it should work without further changes.

- [ ] **Step 7: Add /reminders API endpoint (src/api/routes.ts)**

Add after the `/remarketing-stats` endpoint:

```typescript
apiRouter.get("/reminders", async (_req, res) => {
  try {
    const reminders = await prisma.reminder.findMany({
      where: { sent: false },
      orderBy: { dueAt: "asc" },
      take: 50,
    });
    res.json(reminders);
  } catch (e: any) {
    res.status(500).json({ error: "fetch_failed" });
  }
});

apiRouter.patch("/reminders/:id/dismiss", async (req, res) => {
  const id = Number(req.params.id);
  await prisma.reminder.update({ where: { id }, data: { sent: true } }).catch(() => {});
  res.json({ ok: true });
});
```

- [ ] **Step 8: Add reminders section to dashboard (public/index.html)**

Find the info panel tabs section (around line 636-641):
```html
      <div class="tabs">
        <div class="tab active" id="tab-btn-info"   onclick="switchTab('info')">Cliente</div>
        <div class="tab"        id="tab-btn-orders" onclick="switchTab('orders')">Pedidos</div>
      </div>
      <div id="tab-info"   class="tab-pane"></div>
      <div id="tab-orders" class="tab-pane" hidden></div>
```

Add a reminders tab:
```html
      <div class="tabs">
        <div class="tab active" id="tab-btn-info"      onclick="switchTab('info')">Cliente</div>
        <div class="tab"        id="tab-btn-orders"    onclick="switchTab('orders')">Pedidos</div>
        <div class="tab"        id="tab-btn-reminders" onclick="switchTab('reminders')">🔔</div>
      </div>
      <div id="tab-info"      class="tab-pane"></div>
      <div id="tab-orders"    class="tab-pane" hidden></div>
      <div id="tab-reminders" class="tab-pane" hidden></div>
```

In `switchTab` JS function, add the reminders case:
```javascript
function switchTab(name) {
  tab = name;
  document.getElementById('tab-btn-info').classList.toggle('active',      name==='info');
  document.getElementById('tab-btn-orders').classList.toggle('active',    name==='orders');
  document.getElementById('tab-btn-reminders').classList.toggle('active', name==='reminders');
  document.getElementById('tab-info').hidden      = name !== 'info';
  document.getElementById('tab-orders').hidden    = name !== 'orders';
  document.getElementById('tab-reminders').hidden = name !== 'reminders';
  if (name === 'reminders') loadRemindersTab();
}
```

Add the `loadRemindersTab` function in the ACTIONS section of the JS:
```javascript
async function loadRemindersTab() {
  const pane = document.getElementById('tab-reminders');
  pane.innerHTML = '<div style="text-align:center;color:#9ca3af;font-size:13px;padding:24px">Cargando…</div>';
  try {
    const reminders = await fetch('/api/reminders').then(r => r.json());
    if (!reminders.length) {
      pane.innerHTML = '<div style="text-align:center;color:#9ca3af;font-size:13px;padding:24px">Sin recordatorios pendientes</div>';
      return;
    }
    pane.innerHTML = reminders.map(r => `
      <div class="order-card" style="margin-bottom:10px">
        <div style="font-size:11px;color:#9ca3af;margin-bottom:4px">🕐 ${new Date(r.dueAt).toLocaleString('es-CO',{dateStyle:'short',timeStyle:'short'})}</div>
        <div style="font-size:13px;font-weight:600">${x(r.waId ? '+'+r.waId : '—')}</div>
        <div style="font-size:12px;color:#374151;margin-top:4px">${x(r.note)}</div>
        <button onclick="dismissReminder(${r.id},this)" style="margin-top:8px;font-size:11px;padding:4px 10px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:6px;cursor:pointer">
          Descartar
        </button>
      </div>`).join('');
  } catch(e) {
    pane.innerHTML = '<div style="text-align:center;color:var(--red);font-size:13px;padding:24px">Error cargando</div>';
  }
}

async function dismissReminder(id, btn) {
  btn.disabled = true;
  await fetch(`/api/reminders/${id}/dismiss`, { method: 'PATCH' });
  btn.closest('.order-card').remove();
}
```

- [ ] **Step 9: Verify compile**

```bash
cd /Users/mateogiraldo/CANELITA-BOT
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/bot/parser.ts src/bot/prompts.ts src/bot/handler.ts src/api/routes.ts public/index.html tests/reminders.test.ts
git commit -m "feat: internal reminders via Claude output, DB storage, and dashboard tab"
```

---

## Task 8: Reminder Checker + Daily Report Scheduler

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add reminder checker to index.ts**

Add imports at the top of `src/index.ts`:
```typescript
import { prisma } from "./db";
import { notifyOwner } from "./owner";
```

After `app.listen(...)`, add:
```typescript
// Check for due reminders every 10 minutes
setInterval(async () => {
  try {
    const due = await prisma.reminder.findMany({
      where: { sent: false, dueAt: { lte: new Date() } },
    });
    for (const r of due) {
      const dateStr = new Date(r.dueAt).toLocaleString("es-CO", {
        timeZone: "America/Bogota",
        dateStyle: "short",
        timeStyle: "short",
      });
      await notifyOwner(
        `🔔 *Recordatorio pendiente*\n\n${r.note}\n\n👤 +${r.waId}\n📅 Venció: ${dateStr}`,
      );
      await prisma.reminder.update({ where: { id: r.id }, data: { sent: true } });
    }
  } catch (e: any) {
    console.error("[reminder.checker]", e.message);
  }
}, 10 * 60 * 1000).unref();
```

- [ ] **Step 2: Add daily report function and scheduler**

Add these functions to `src/index.ts` (before `app.listen`):

```typescript
async function sendDailyReport(): Promise<void> {
  try {
    // COL midnight = 05:00 UTC
    const now = new Date();
    const colMidnight = new Date(now);
    colMidnight.setUTCHours(5, 0, 0, 0);
    if (colMidnight > now) colMidnight.setUTCDate(colMidnight.getUTCDate() - 1);

    const [orders, newConvs, closedConvs, totalConvs, objRows] = await Promise.all([
      prisma.order.findMany({
        where: { createdAt: { gte: colMidnight }, status: { not: "CANCELLED" } },
      }),
      prisma.conversation.count({ where: { createdAt: { gte: colMidnight } } }),
      prisma.conversation.count({ where: { state: "CLOSED", updatedAt: { gte: colMidnight } } }),
      prisma.conversation.count({ where: { createdAt: { gte: colMidnight } } }),
      prisma.$queryRaw<Array<{ objectionType: string; count: bigint }>>`
        SELECT "objectionType", COUNT(*) AS count
        FROM "Message"
        WHERE "objectionType" IS NOT NULL
          AND "createdAt" >= ${colMidnight}
        GROUP BY "objectionType"
        ORDER BY count DESC
        LIMIT 5
      `,
    ]);

    // Replied (≥2 inbound messages)
    const repliedRows = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count FROM (
        SELECT "conversationId"
        FROM "Message"
        WHERE direction = 'inbound'
          AND "createdAt" >= ${colMidnight}
        GROUP BY "conversationId"
        HAVING COUNT(*) >= 2
      ) sub
    `;
    const replied = Number(repliedRows[0]?.count ?? 0);

    const totalRevenue = orders.reduce((s, o) => s + o.total, 0);
    const dateStr = new Date().toLocaleDateString("es-CO", {
      timeZone: "America/Bogota",
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    const responseRate = newConvs > 0 ? ((replied / newConvs) * 100).toFixed(1) : "0.0";
    const closeRate    = newConvs > 0 ? ((closedConvs / newConvs) * 100).toFixed(1) : "0.0";

    const objLines = objRows.length
      ? objRows.map((r) => `• ${r.objectionType} (${r.count} veces)`).join("\n")
      : "• Ninguna registrada";

    const msg = [
      `📊 *Reporte Canelita — ${dateStr}*`,
      ``,
      `💰 Ventas: *${orders.length} pedidos* | $${totalRevenue.toLocaleString("es-CO")} COP`,
      `💬 Conversaciones nuevas: *${newConvs}*`,
      `📈 Tasa de cierre: *${closeRate}%*`,
      `📨 Tasa de respuesta: *${responseRate}%*`,
      ``,
      `🚧 *Objeciones del día:*`,
      objLines,
    ].join("\n");

    await notifyOwner(msg);
  } catch (e: any) {
    console.error("[daily.report]", e.message);
  }
}

function scheduleDailyReport(): void {
  // Send at 9am COL = 14:00 UTC
  const now = Date.now();
  const next = new Date(now);
  next.setUTCHours(14, 0, 0, 0);
  if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);

  const delay = next.getTime() - now;
  setTimeout(() => {
    sendDailyReport().catch(() => {});
    setInterval(() => sendDailyReport().catch(() => {}), 24 * 60 * 60 * 1000).unref();
  }, delay);
}
```

After `app.listen(...)`, add:
```typescript
scheduleDailyReport();
```

- [ ] **Step 3: Verify compile**

```bash
cd /Users/mateogiraldo/CANELITA-BOT
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: reminder checker and daily report at 9am COL"
```

---

## Task 9: Run Full Test Suite + Final Verification

- [ ] **Step 1: Run all tests**

```bash
cd /Users/mateogiraldo/CANELITA-BOT
npm test
```

Expected: all tests pass. If any fail, fix before proceeding.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Note on audio transcription**

Audio transcription is **already implemented** in `src/whatsapp/transcribe.ts` and called in `src/bot/handler.ts`. To enable it, add `OPENAI_API_KEY=sk-...` to `.env`. No code changes required.

- [ ] **Step 4: Final commit with overall summary**

```bash
git add -A
git status  # verify nothing untracked/unexpected
git commit -m "chore: final cleanup and test run for 8-feature release"
```

---

## Env Variables Added / Required

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `OWNER_WA_NUMBER` | No | `+573124743435` | WA number for sale notifications and daily report |
| `OPENAI_API_KEY` | No | — | Enable audio transcription via Whisper |

---

## Notes

- **Daily report delivery:** The first daily report fires at the next 9am COL after server start. Owner must have sent at least one message to the bot to open a 24h window, OR a recent sale notification must have refreshed the window.
- **Reminder detection:** Claude detects temporal commitments like "el jueves te escribo" and outputs `{"reminder":{"note":"...","daysFromNow":3}}`. The checker runs every 10 minutes and notifies the owner.
- **CTWA Ad source:** Only populated on the first inbound message of a conversation. Non-CTWA messages will have null `adSource`.
