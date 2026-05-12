import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import deployedContracts from "~~/contracts/deployedContracts";

const CV_HIGHEST_URL = "https://larv.ai/api/cv/highest";
const PFP_SERVICE_TYPE_ID = 3;

const SERVICE_TYPE_ABI = parseAbi([
  "function getServiceType(uint256 id) view returns ((uint256 id, string name, string slug, uint256 priceUsd, uint256 cvDivisor, string status))",
]);

const SERVICE_TYPE_CONTRACT = deployedContracts[8453]?.LeftClawServicesV2?.address as `0x${string}`;

export interface PfpCvCostResult {
  generateCvCost: number;
  cvDivisor: number;
  highestCVBalance: number;
  priceUsd: number;
}

// Matches the UI formula in useCVCost: ceil(highestCVBalance / cvDivisor)
export async function computePfpCvCost(): Promise<PfpCvCostResult> {
  const client = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
  });
  const [svc, highestRes] = await Promise.all([
    client.readContract({
      address: SERVICE_TYPE_CONTRACT,
      abi: SERVICE_TYPE_ABI,
      functionName: "getServiceType",
      args: [BigInt(PFP_SERVICE_TYPE_ID)],
    }),
    fetch(CV_HIGHEST_URL).then(r => r.json()),
  ]);
  const cvDivisor = Number(svc.cvDivisor);
  const highest = Number(highestRes?.highestCVBalance);
  if (!cvDivisor || !highest || !isFinite(highest)) throw new Error("Failed to compute CV cost");
  return {
    generateCvCost: Math.ceil(highest / cvDivisor),
    cvDivisor,
    highestCVBalance: highest,
    priceUsd: Number(svc.priceUsd) / 1_000_000,
  };
}
