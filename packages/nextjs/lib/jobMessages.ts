import { nanoid } from "nanoid";
import { getKV } from "./kv";

export interface JobMessage {
  id: string;
  type: "client_message" | "ai_response" | "escalation" | "escalation_response" | "rollback_request";
  content: string;
  from: "client" | "bot" | "ai";
  timestamp: number;
  metadata?: Record<string, unknown>;
}

const JOB_MSG_TTL = 90 * 24 * 60 * 60; // 90 days

// In-memory fallback
const memMessages = new Map<string, JobMessage[]>();

function key(jobId: string) {
  return `jobmsgs:${jobId}`;
}

export async function getMessages(jobId: string): Promise<JobMessage[]> {
  const kv = getKV();
  if (!kv) return memMessages.get(jobId) || [];
  const data = await kv.get<string>(key(jobId));
  if (!data) return [];
  try {
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function addJobMessage(
  jobId: string,
  msg: Omit<JobMessage, "id" | "timestamp">,
): Promise<JobMessage> {
  const full: JobMessage = {
    ...msg,
    id: nanoid(21),
    timestamp: Date.now(),
  };
  const kv = getKV();
  const existing = await getMessages(jobId);
  existing.push(full);
  if (kv) {
    await kv.set(key(jobId), JSON.stringify(existing), { ex: JOB_MSG_TTL });
  } else {
    memMessages.set(jobId, existing);
  }
  return full;
}
