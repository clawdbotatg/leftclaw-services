/**
 * test-x402-pfp.ts
 *
 * End-to-end test: pay $0.25 USDC via x402 → generate a CLAWD PFP.
 *
 * Usage:
 *   cd leftclaw-services
 *   npx tsx scripts/test-x402-pfp.ts
 *
 * Requires: scripts/test-x402-pfp.env (gitignored, contains TEST_PRIVATE_KEY)
 *
 * The test wallet needs ~$0.30 USDC on Base (and a tiny bit of ETH for gas).
 * Fund it at: 0xf4c39B051CEafc2304C78ABe68aF34f136D4cA2A
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createWalletClient, createPublicClient, http, parseUnits } from "viem";
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

// Load private key from .env file
function loadEnv() {
  const envPath = join(__dirname, "test-x402-pfp.env");
  try {
    const lines = readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) process.env[match[1].trim()] = match[2].trim();
    }
  } catch {
    console.error("❌ Missing scripts/test-x402-pfp.env — create it with TEST_PRIVATE_KEY=0x...");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();

  const privateKey = process.env.TEST_PRIVATE_KEY as `0x${string}`;
  if (!privateKey) {
    console.error("❌ TEST_PRIVATE_KEY not set in test-x402-pfp.env");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  console.log("🦞 Test wallet:", account.address);

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

  if (usdcFormatted < 0.25) {
    console.error(`❌ Insufficient USDC. Need at least $0.25, have $${usdcFormatted.toFixed(6)}`);
    console.error(`   Fund: ${account.address} on Base`);
    process.exit(1);
  }

  // x402 uses Permit2 signatures — no ETH needed for gas (facilitator settles on-chain)
  const ethBalance = await publicClient.getBalance({ address: account.address });
  console.log(`⛽ ETH balance: ${(Number(ethBalance) / 1e18).toFixed(6)} ETH (not needed — x402 is gasless for client)`);

  // Set up x402 fetch
  const walletClient = createWalletClient({ account, chain: base, transport: http(RPC_URL) });
  // toClientEvmSigner reads signer.address but WalletClient exposes it at account.address
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

  console.log(`\n📡 Calling ${BASE_URL}/api/pfp ...`);
  console.log("   (x402: signs EIP-3009 TransferWithAuthorization — no approval tx, no gas)\n");

  const prompt = "wearing a cowboy hat and holding a lasso";

  const response = await fetchWithPayment(`${BASE_URL}/api/pfp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`❌ Request failed ${response.status}:`, err);
    process.exit(1);
  }

  const result = await response.json();
  console.log("✅ Success!");
  console.log("   Prompt:", result.prompt);
  console.log("   Message:", result.message);

  if (result.image?.startsWith("data:image/png;base64,")) {
    const outputPath = join(__dirname, "test-pfp-output.png");
    const base64 = result.image.replace("data:image/png;base64,", "");
    writeFileSync(outputPath, Buffer.from(base64, "base64"));
    console.log(`   Image saved → ${outputPath}`);
  }

  // Note: EIP-3009 settlement is async — facilitator submits the transferWithAuthorization
  // tx after the response. Balance may not reflect immediately.
  console.log(`\n💸 Payment signed and submitted via EIP-3009. Facilitator settles on-chain async.`);
}

main().catch(err => {
  console.error("❌ Fatal:", err);
  process.exit(1);
});
