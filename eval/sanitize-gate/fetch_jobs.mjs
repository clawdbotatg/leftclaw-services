// Pull every job description from LeftClawServicesV2 on Base into jobs_all.json.
// Usage: ALCHEMY_API_KEY=... node fetch_jobs.mjs
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { writeFileSync } from "fs";

const key = process.env.ALCHEMY_API_KEY;
if (!key) {
  console.error("Set ALCHEMY_API_KEY (https://dashboard.alchemy.com)");
  process.exit(1);
}

const abi = [
  { type: "function", name: "getTotalJobs", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getJob", stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [{ type: "tuple", components: [
      { name: "id", type: "uint256" },
      { name: "client", type: "address" },
      { name: "serviceTypeId", type: "uint256" },
      { name: "paymentClawd", type: "uint256" },
      { name: "priceUsd", type: "uint256" },
      { name: "description", type: "string" },
      { name: "status", type: "uint8" },
      { name: "createdAt", type: "uint256" },
      { name: "startedAt", type: "uint256" },
      { name: "completedAt", type: "uint256" },
      { name: "resultCID", type: "string" },
      { name: "worker", type: "address" },
      { name: "paymentClaimed", type: "bool" },
      { name: "paymentMethod", type: "uint8" },
      { name: "cvAmount", type: "uint256" },
      { name: "currentStage", type: "string" },
    ]}],
  },
];

const client = createPublicClient({ chain: base, transport: http(`https://base-mainnet.g.alchemy.com/v2/${key}`) });
const addr = "0xb2fb486a9569ad2c97d9c73936b46ef7fdaa413a";

const total = await client.readContract({ address: addr, abi, functionName: "getTotalJobs" });
console.error(`total jobs: ${total}`);

const out = [];
for (let id = 1n; id <= total; id++) {
  try {
    const j = await client.readContract({ address: addr, abi, functionName: "getJob", args: [id] });
    out.push({ id: Number(j.id), serviceTypeId: Number(j.serviceTypeId), status: Number(j.status), description: j.description });
  } catch (e) {
    console.error(`job ${id}: ${e.shortMessage || e.message}`);
  }
}
writeFileSync(new URL("./jobs_all.json", import.meta.url), JSON.stringify(out, null, 1));
console.error(`wrote ${out.length} jobs`);
