import { nanoid } from "nanoid";
import { getKV } from "./kv";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface X402Session {
  id: string;
  serviceType: string;
  description: string;
  context?: string;
  status: "active" | "completed" | "expired";
  priceUsd: string;
  payerAddress?: string;
  messages: ChatMessage[];
  maxMessages: number;
  createdAt: string;
  expiresAt: string;
}

const SESSION_LIMITS: Record<string, { maxMessages: number; ttlHours: number }> = {
  CONSULT_QUICK: { maxMessages: 15, ttlHours: 168 },
  CONSULT_DEEP: { maxMessages: 30, ttlHours: 168 },
  QA_REPORT: { maxMessages: 20, ttlHours: 168 },
  AUDIT: { maxMessages: 20, ttlHours: 168 },
};

// In-memory fallback for dev
const memStore = new Map<string, X402Session>();

function kvKey(id: string): string {
  return `x402session:${id}`;
}

export async function createSession(params: {
  serviceType: string;
  description: string;
  context?: string;
  priceUsd: string;
  payerAddress?: string;
}): Promise<X402Session> {
  const id = `x402_${nanoid(21)}`;
  const limits = SESSION_LIMITS[params.serviceType] || { maxMessages: 15, ttlHours: 1 };
  const now = new Date();
  const expiresAt = new Date(now.getTime() + limits.ttlHours * 60 * 60 * 1000);

  const session: X402Session = {
    id,
    serviceType: params.serviceType,
    description: params.description,
    context: params.context,
    status: "active",
    priceUsd: params.priceUsd,
    payerAddress: params.payerAddress,
    messages: [],
    maxMessages: limits.maxMessages,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const kv = getKV();
  if (kv) {
    await kv.set(kvKey(id), JSON.stringify(session), { ex: limits.ttlHours * 60 * 60 });
  } else {
    memStore.set(id, session);
  }

  return session;
}

export async function getSession(id: string): Promise<X402Session | null> {
  const kv = getKV();
  if (kv) {
    const data = await kv.get<string>(kvKey(id));
    if (!data) return null;
    const session: X402Session = typeof data === "string" ? JSON.parse(data) : data;
    if (new Date(session.expiresAt) < new Date()) {
      session.status = "expired";
    }
    return session;
  }

  const session = memStore.get(id) || null;
  if (session && new Date(session.expiresAt) < new Date()) {
    session.status = "expired";
  }
  return session;
}

export async function addMessage(id: string, message: ChatMessage): Promise<X402Session | null> {
  const session = await getSession(id);
  if (!session || session.status !== "active") return null;

  session.messages.push(message);

  const kv = getKV();
  if (kv) {
    const ttlMs = new Date(session.expiresAt).getTime() - Date.now();
    const ttlSec = Math.max(Math.floor(ttlMs / 1000), 60);
    await kv.set(kvKey(id), JSON.stringify(session), { ex: ttlSec });
  } else {
    memStore.set(id, session);
  }

  return session;
}

// --- Job chat persistence (on-chain + CV jobs) ---
const JOB_CHAT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function jobChatKey(jobId: string): string {
  return `jobchat:${jobId}`;
}

export async function saveJobMessage(jobId: string, message: ChatMessage): Promise<void> {
  const kv = getKV();
  if (!kv) return;
  const existing = await getJobMessages(jobId);
  existing.push(message);
  await kv.set(jobChatKey(jobId), JSON.stringify(existing), { ex: JOB_CHAT_TTL_SECONDS });
}

export async function getJobMessages(jobId: string): Promise<ChatMessage[]> {
  const kv = getKV();
  if (!kv) return [];
  const data = await kv.get<string>(jobChatKey(jobId));
  if (!data) return [];
  try {
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function updateSession(id: string, updates: Partial<X402Session>): Promise<X402Session | null> {
  const session = await getSession(id);
  if (!session) return null;

  Object.assign(session, updates);

  const kv = getKV();
  if (kv) {
    const ttlMs = new Date(session.expiresAt).getTime() - Date.now();
    const ttlSec = Math.max(Math.floor(ttlMs / 1000), 60);
    await kv.set(kvKey(id), JSON.stringify(session), { ex: ttlSec });
  } else {
    memStore.set(id, session);
  }

  return session;
}
