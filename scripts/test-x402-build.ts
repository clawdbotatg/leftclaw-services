/**
 * test-x402-build.ts
 *
 * End-to-end test: pay ~$1 USDC via x402 -> purchase a Build job on leftclaw.services.
 *
 * The x402 payment protocol works entirely off-chain from the client's perspective:
 * an EIP-3009 TransferWithAuthorization signature is created, and the facilitator
 * settles the USDC transfer on Base. No approval tx, no gas needed from the client.
 *
 * Usage:
 *   cd leftclaw-services
 *   npx tsx scripts/test-x402-build.ts
 *
 * Requires:
 *   scripts/test-x402-build.env  (gitignored — contains TEST_PRIVATE_KEY)
 *
 * The test wallet needs ~$1000 USDC on Base.
 * Check the derived address printed at startup and fund it before running.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  createWalletClient,
  createPublicClient,
  http,
  formatUnits,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || "https://leftclaw.services";
const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const USDC_DECIMALS = 6;

// Minimum USDC balance required — price is read live from on-chain contract
const MIN_USDC_BALANCE = 2; // ~$1 currently; keep a small buffer

// The build job description
const BUILD_DESCRIPTION = [
  "Build a simple on-chain guestbook dApp on Base.",
  "Users connect their wallet, sign a message with their name and a short greeting,",
  "and the message is stored on-chain.",
  "Frontend should use scaffold-eth-2.",
  "Include a deployed Solidity contract and a Next.js page that reads and displays all guestbook entries.",
].join(" ");

const BUILD_CONTEXT = [
  "Target chain: Base (mainnet).",
  "Use Scaffold-ETH 2 as the starting template.",
  "Solidity contract should store structs with sender address, name, greeting, and timestamp.",
  "Next.js page should list all entries in reverse chronological order.",
  "Include a form to submit a new guestbook entry.",
].join(" ");

// USDC balanceOf ABI fragment
const USDC_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ---------------------------------------------------------------------------
// Env loader
// ---------------------------------------------------------------------------

function loadEnv(): void {
  const envPath = join(__dirname, "test-x402-build.env");
  try {
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (key && value) process.env[key] = value;
    }
  } catch {
    console.error("Missing scripts/test-x402-build.env");
    console.error("Create it with: TEST_PRIVATE_KEY=0x...");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  loadEnv();

  // -- Derive wallet from private key --
  const privateKey = process.env.TEST_PRIVATE_KEY as `0x${string}`;
  if (!privateKey?.startsWith("0x")) {
    console.error("TEST_PRIVATE_KEY not set or missing 0x prefix in test-x402-build.env");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  console.log("Wallet address:", account.address);

  // -- Check USDC balance --
  const publicClient = createPublicClient({
    chain: base,
    transport: http(RPC_URL),
  });

  const usdcBalanceRaw = await publicClient.readContract({
    address: USDC,
    abi: USDC_BALANCE_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });

  const usdcBalance = Number(formatUnits(usdcBalanceRaw, USDC_DECIMALS));
  console.log(`USDC balance: $${usdcBalance.toFixed(2)}`);

  if (usdcBalance < MIN_USDC_BALANCE) {
    console.error(
      `Insufficient USDC. Need at least $${MIN_USDC_BALANCE} (price is ~$1, fetched live from contract), have $${usdcBalance.toFixed(2)}`
    );
    console.error(`Fund ${account.address} on Base with USDC`);
    process.exit(1);
  }

  // -- Check ETH balance (informational only — x402 is gasless for the client) --
  const ethBalance = await publicClient.getBalance({
    address: account.address,
  });
  console.log(
    `ETH balance: ${(Number(ethBalance) / 1e18).toFixed(6)} ETH (not needed — x402 is gasless for client)`
  );

  // -- Set up x402 payment-wrapped fetch --
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(RPC_URL),
  });

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

  // -- Make the x402-protected request --
  const endpoint = `${BASE_URL}/api/build`;
  console.log(`\nCalling ${endpoint} ...`);
  console.log("  x402 flow: initial 402 -> EIP-3009 signature -> retry with payment header");
  console.log(`  Description: "${BUILD_DESCRIPTION.slice(0, 80)}..."\n`);

  const requestBody = {
    description: BUILD_DESCRIPTION,
    context: BUILD_CONTEXT,
  };

  const response = await fetchWithPayment(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  // -- Handle response --
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Request failed with status ${response.status}:`);
    console.error(errorText);
    process.exit(1);
  }

  const result = await response.json() as {
    sessionId?: string;
    chatUrl?: string;
    status?: string;
    expiresAt?: string;
    maxMessages?: number;
  };

  console.log("Build job created successfully!\n");
  console.log("  Session ID:", result.sessionId);
  console.log("  Chat URL:  ", result.chatUrl);
  console.log("  Status:    ", result.status);
  console.log("  Expires:   ", result.expiresAt);
  console.log("  Max msgs:  ", result.maxMessages);
  console.log(
    "\nPayment signed via EIP-3009 TransferWithAuthorization."
  );
  console.log("Facilitator settles the USDC transfer on-chain asynchronously.");

  if (result.chatUrl) {
    console.log(`\nOpen the chat to interact with your build agent:`);
    console.log(`  ${result.chatUrl}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
