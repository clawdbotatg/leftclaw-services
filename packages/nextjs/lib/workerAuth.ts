import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import deployedContracts from "~~/contracts/deployedContracts";

const { address: contractAddress, abi } = deployedContracts[8453].LeftClawServicesV2;

const publicClient = createPublicClient({
  chain: base,
  transport: http(
    process.env.BASE_RPC_URL?.trim() ||
      (process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
        ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
        : undefined),
  ),
});

// Cache workers list for 60s to avoid hammering the RPC on every poll
let workersCache: { list: string[]; ts: number } | null = null;

export async function getRegisteredWorkers(): Promise<string[]> {
  if (workersCache && Date.now() - workersCache.ts < 60_000) {
    return workersCache.list;
  }
  try {
    const workers = (await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: "getWorkers",
    })) as `0x${string}`[];
    const list = workers.map(w => w.toLowerCase());
    workersCache = { list, ts: Date.now() };
    return list;
  } catch {
    return workersCache?.list ?? [];
  }
}

// Verifies a time-windowed EIP-191 signature (current + previous 5-min window).
export async function verifyWindowedSig(
  callerAddress: string,
  sig: string,
  messageFn: (window: number) => string,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 300_000) * 300_000;
  for (const w of [now, now - 300_000]) {
    try {
      const valid = await publicClient.verifyMessage({
        address: callerAddress as `0x${string}`,
        message: messageFn(w),
        signature: sig as `0x${string}`,
      });
      if (valid) return true;
    } catch {}
  }
  return false;
}

// Message format workers sign to authenticate against pipeline/ready endpoints.
export const workerAuthMessage = (window: number) => `LeftClaw Worker Auth - ${window}`;
