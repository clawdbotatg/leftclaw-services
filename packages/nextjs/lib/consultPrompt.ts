import { getKV } from "./kv";
import deployedContracts from "~~/contracts/deployedContracts";

const CONTRACT_ADDR = deployedContracts[8453]?.LeftClawServicesV2?.address || "default";
const TTL_SECONDS = 365 * 24 * 60 * 60;

export const ON_CHAIN_PLACEHOLDER = "Consult — prompt stored off-chain (private)";

export interface ConsultPrompt {
  description: string;
  storedAt: string;
}

const memStore = new Map<string, ConsultPrompt>();

function key(jobId: string | number): string {
  return `consultPrompt:${CONTRACT_ADDR}:${jobId}`;
}

export async function saveConsultPrompt(jobId: string | number, description: string): Promise<void> {
  const payload: ConsultPrompt = {
    description,
    storedAt: new Date().toISOString(),
  };
  const kv = getKV();
  if (kv) {
    await kv.set(key(jobId), JSON.stringify(payload), { ex: TTL_SECONDS });
  } else {
    memStore.set(String(jobId), payload);
  }
}

export async function getConsultPrompt(jobId: string | number): Promise<string | null> {
  const kv = getKV();
  if (kv) {
    const data = await kv.get<string>(key(jobId));
    if (!data) return null;
    try {
      const parsed: ConsultPrompt = typeof data === "string" ? JSON.parse(data) : data;
      return parsed.description || null;
    } catch {
      return null;
    }
  }
  const cached = memStore.get(String(jobId));
  return cached?.description || null;
}
