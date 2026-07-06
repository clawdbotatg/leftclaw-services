import { getKV } from "./kv";
import deployedContracts from "~~/contracts/deployedContracts";

const CONTRACT_ADDR = deployedContracts[8453]?.LeftClawServicesV2?.address || "default";
const TTL_SECONDS = 7 * 24 * 60 * 60;
const PENDING_SET = `jobWebhooks:pending:${CONTRACT_ADDR}`;

export const MAX_WEBHOOK_ATTEMPTS = 5;

export interface JobWebhook {
  jobId: number;
  callbackUrl: string;
  createdAt: string;
  attempts: number;
}

function key(jobId: string | number): string {
  return `jobWebhook:${CONTRACT_ADDR}:${jobId}`;
}

/** Only allow http(s) URLs so a callbackUrl can't smuggle in another scheme. */
export function isValidCallbackUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 2000) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export async function registerJobWebhook(jobId: number, callbackUrl: string): Promise<boolean> {
  const kv = getKV();
  if (!kv) return false;
  const payload: JobWebhook = {
    jobId,
    callbackUrl,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  await kv.set(key(jobId), JSON.stringify(payload), { ex: TTL_SECONDS });
  await kv.sadd(PENDING_SET, String(jobId));
  return true;
}

export async function listPendingWebhookJobIds(): Promise<string[]> {
  const kv = getKV();
  if (!kv) return [];
  return (await kv.smembers(PENDING_SET)) as string[];
}

export async function getJobWebhook(jobId: string | number): Promise<JobWebhook | null> {
  const kv = getKV();
  if (!kv) return null;
  const data = await kv.get<string>(key(jobId));
  if (!data) return null;
  try {
    return typeof data === "string" ? JSON.parse(data) : (data as unknown as JobWebhook);
  } catch {
    return null;
  }
}

export async function bumpWebhookAttempts(hook: JobWebhook): Promise<void> {
  const kv = getKV();
  if (!kv) return;
  await kv.set(key(hook.jobId), JSON.stringify({ ...hook, attempts: hook.attempts + 1 }), { ex: TTL_SECONDS });
}

export async function clearJobWebhook(jobId: string | number): Promise<void> {
  const kv = getKV();
  if (!kv) return;
  await kv.srem(PENDING_SET, String(jobId));
  await kv.del(key(jobId));
}
