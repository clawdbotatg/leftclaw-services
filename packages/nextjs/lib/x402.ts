import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
// Dynamic price resolution from contract
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import deployedContracts from "~~/contracts/deployedContracts";
import { x402ResourceServer } from "~~/lib/x402-next-adapter";

// Sanitizer wallet — receives x402 USDC and calls postJobFor on-chain
export const PAYMENT_ADDRESS = "0xCfB32a7d01Ca2B4B538C83B2b38656D3502D76EA";
export const BASE_NETWORK = "eip155:8453";

// Self-hosted facilitator — Base mainnet (eip155:8453)
const facilitatorClient = new HTTPFacilitatorClient({ url: "https://clawd-facilitator.vercel.app/api" });

export const x402Server = new x402ResourceServer(facilitatorClient)
  .register(BASE_NETWORK, new ExactEvmScheme())
  .registerExtension(bazaarResourceServerExtension);

const SERVICE_TYPE_ABI = parseAbi([
  "function getServiceType(uint256 id) view returns ((uint256 id, string name, string slug, uint256 priceUsd, uint256 cvDivisor, string status))",
]);

const SERVICE_TYPE_CONTRACT = deployedContracts[8453]?.LeftClawServicesV2?.address as `0x${string}`;

const priceCache = new Map<number, { price: string; ts: number }>();
const CACHE_TTL_MS = 60_000;

export async function getContractPriceUsd(serviceTypeId: number): Promise<string> {
  const cached = priceCache.get(serviceTypeId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.price;

  const client = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
  });

  let result;
  try {
    result = await client.readContract({
      address: SERVICE_TYPE_CONTRACT,
      abi: SERVICE_TYPE_ABI,
      functionName: "getServiceType",
      args: [BigInt(serviceTypeId)],
    });
  } catch (e) {
    // Serve a stale price over failing the request — the public RPC 429s under
    // bursts, and a slightly old price beats a 5xx on every payable route.
    if (cached) return cached.price;
    throw e;
  }

  const rawPrice = Number(result.priceUsd) / 1_000_000;
  const price = `$${rawPrice.toFixed(2)}`;
  priceCache.set(serviceTypeId, { price, ts: Date.now() });
  return price;
}
