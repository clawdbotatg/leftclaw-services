/**
 * test-x402-research.ts
 *
 * End-to-end test: pay $1 USDC via x402 → start a research session.
 *
 * Usage:
 *   cd packages/nextjs
 *   cp scripts/test-x402-research.env.example scripts/test-x402-research.env
 *   # edit test-x402-research.env with your private key
 *   npx tsx scripts/test-x402-research.ts
 *
 * Requires: scripts/test-x402-research.env (gitignored, contains TEST_RESEARCH_PRIVATE_KEY)
 *
 * The test wallet needs ~$1.10 USDC on Base (and a tiny bit of ETH for gas).
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createWalletClient, createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || "https://leftclaw.services";
const RPC_URL = "https://mainnet.base.org";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

function loadEnv() {
  const envPath = join(__dirname, "test-x402-research.env");
  try {
    const lines = readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) process.env[match[1].trim()] = match[2].trim();
    }
  } catch {
    console.error("❌ Missing scripts/test-x402-research.env — copy test-x402-research.env.example and fill in your key");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();

  const privateKey = process.env.TEST_RESEARCH_PRIVATE_KEY as `0x${string}`;
  if (!privateKey) {
    console.error("❌ TEST_RESEARCH_PRIVATE_KEY not set in test-x402-research.env");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  console.log("🦞 Research test wallet:", account.address);

  // Check USDC balance
  const publicClient = createPublicClient({ chain: base, transport: http(RPC_URL) });
  const usdcBalance = await publicClient.readContract({
    address: USDC,
    abi: [{ name: "balanceOf", type: "function", stateMutability: "view",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ name: "", type: "uint256" }] }],
    functionName: "balanceOf",
    args: [account.address],
  });
  const usdcFormatted = Number(usdcBalance) / 1_000_000;
  console.log(`💵 USDC balance: $${usdcFormatted.toFixed(6)}`);

  if (usdcFormatted < 1.0) {
    console.error(`❌ Insufficient USDC. Need at least $1.00, have $${usdcFormatted.toFixed(6)}`);
    console.error(`   Fund: ${account.address} on Base`);
    process.exit(1);
  }

  const ethBalance = await publicClient.getBalance({ address: account.address });
  console.log(`⛽ ETH balance: ${(Number(ethBalance) / 1e18).toFixed(6)} ETH (not needed — x402 is gasless for client)`);

  // Set up x402 fetch
  const walletClient = createWalletClient({ account, chain: base, transport: http(RPC_URL) });
  const rawSigner = toClientEvmSigner(walletClient as any, publicClient as any);
  const signer = { ...rawSigner, address: account.address as `0x${string}` };
  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: "eip155:8453",
        client: new ExactEvmScheme(signer),
      },
    ],
  });

  console.log(`\n📡 Calling ${BASE_URL}/api/research ...`);
  console.log("   (x402: signs EIP-3009 TransferWithAuthorization — no approval tx, no gas)\n");

  const researchTopic = "Deep dive on ERC-7521: account abstraction standards and smart account implementations on Base";
  const researchContext = "Focus on ERC-4337 bundlers, paymasters, and EntryPoint v0.6 compatibility";

  const response = await fetchWithPayment(`${BASE_URL}/api/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description: researchTopic,
      context: researchContext,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`❌ Request failed ${response.status}:`, err);
    process.exit(1);
  }

  const result = await response.json();
  console.log("✅ Success!");
  console.log("   sessionId:", result.sessionId);
  console.log("   chatUrl:", result.chatUrl);
  console.log("   expiresAt:", result.expiresAt);
  console.log("   maxMessages:", result.maxMessages);
  console.log(`\n💸 Payment signed via EIP-3009. Facilitator settles on-chain async.`);
}

main().catch(err => {
  console.error("❌ Fatal:", err);
  process.exit(1);
});
