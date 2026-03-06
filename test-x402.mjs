#!/usr/bin/env node
// Test x402 payment flow against leftclaw-services
// Usage: PRIVATE_KEY=0x... node test-x402.mjs

import { wrapFetch } from "@x402/fetch";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) {
  console.error("Set PRIVATE_KEY=0x... (a wallet with USDC on Base)");
  process.exit(1);
}

const account = privateKeyToAccount(privateKey);
const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http("https://base-mainnet.g.alchemy.com/v2/8GVG8WjDs-sGFRr6Rm839"),
});

console.log(`Wallet: ${account.address}`);
console.log(`Testing Quick Consult ($20 USDC)...\n`);

const fetchWithPayment = wrapFetch(walletClient);

const res = await fetchWithPayment(
  "https://leftclaw-services-nextjs.vercel.app/api/consult/quick",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: "What is the best way to deploy a smart contract on Base?",
    }),
  }
);

console.log(`Status: ${res.status}`);
const data = await res.json();
console.log(JSON.stringify(data, null, 2));
