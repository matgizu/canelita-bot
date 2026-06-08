import { prisma } from "./db";
import { CartItem, Session, State, newSession } from "./bot/flow";

const TTL_MS = 24 * 60 * 60 * 1000;
const sessions = new Map<string, Session>();

// Sync — only returns an in-memory session or a blank new one.
// Use getOrLoadSession in message handlers.
export function getSession(waId: string): Session {
  const existing = sessions.get(waId);
  if (existing) {
    if (Date.now() - existing.lastInboundAt > TTL_MS) {
      sessions.delete(waId);
    } else {
      return existing;
    }
  }
  const fresh = newSession(waId);
  sessions.set(waId, fresh);
  return fresh;
}

// Async — checks memory first, then reconstructs from DB if missing.
export async function getOrLoadSession(waId: string): Promise<Session> {
  const existing = sessions.get(waId);
  if (existing) {
    if (Date.now() - existing.lastInboundAt > TTL_MS) {
      sessions.delete(waId);
    } else {
      return existing;
    }
  }

  try {
    const conv = await prisma.conversation.findUnique({
      where: { waId },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 16,
        },
      },
    });

    if (conv) {
      const msgs = conv.messages.reverse(); // desc → asc
      const history = msgs
        .filter((m) => m.direction === "inbound" || m.type === "text")
        .map((m) => ({
          role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
          content:
            m.direction === "outbound"
              ? JSON.stringify({ message: m.body, state: m.rawState ?? conv.state, cartUpdate: null })
              : m.body,
        }));

      const session: Session = {
        waId,
        state: conv.state as State,
        cart: (conv.cart as unknown as CartItem[]) ?? [],
        customerName: conv.customerName ?? undefined,
        fullName: conv.fullName ?? undefined,
        phone: conv.phone ?? undefined,
        altPhone: conv.altPhone ?? undefined,
        idNumber: conv.idNumber ?? undefined,
        email: conv.email ?? undefined,
        address: conv.address ?? undefined,
        reference: conv.reference ?? undefined,
        city: conv.city ?? undefined,
        department: conv.department ?? undefined,
        history,
        pendingOrder: (conv.pendingOrder as unknown as Session["pendingOrder"]) ?? undefined,
        discountOffered: conv.discountOffered,
        automationEnabled: conv.automationEnabled,
        objectionCount: conv.objectionCount,
        lastInboundAt: conv.lastInboundAt.getTime(),
        lastOutboundAt: conv.lastOutboundAt.getTime(),
        createdAt: conv.createdAt.getTime(),
        adSource:   conv.adSource   ?? undefined,
        adHeadline: conv.adHeadline ?? undefined,
        ctwaClid:   conv.ctwaClid   ?? undefined,
      };

      sessions.set(waId, session);
      return session;
    }
  } catch (e: any) {
    console.error("[sessions.load]", e.message);
  }

  const fresh = newSession(waId);
  sessions.set(waId, fresh);
  return fresh;
}

export function listSessions(): Session[] {
  return Array.from(sessions.values());
}

export function dropSession(waId: string): void {
  sessions.delete(waId);
}

export function setAutomation(waId: string, enabled: boolean): Session {
  const s = getSession(waId);
  s.automationEnabled = enabled;
  return s;
}

// Updates a session already held in memory, without creating one if absent —
// used for out-of-band events (e.g. remarketing touches) that shouldn't spin
// up a session for a contact that isn't actively chatting.
export function patchSessionIfLoaded(waId: string, patch: Partial<Session>): void {
  const s = sessions.get(waId);
  if (s) Object.assign(s, patch);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) {
    if (now - s.lastInboundAt > TTL_MS) sessions.delete(k);
  }
}, 60 * 60 * 1000).unref();
