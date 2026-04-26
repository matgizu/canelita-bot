import { Session, newSession } from "./bot/flow";

const TTL_MS = 24 * 60 * 60 * 1000;
const sessions = new Map<string, Session>();

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

setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) {
    if (now - s.lastInboundAt > TTL_MS) sessions.delete(k);
  }
}, 60 * 60 * 1000).unref();
