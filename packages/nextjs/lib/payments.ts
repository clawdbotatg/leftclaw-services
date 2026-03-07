/**
 * Unified payment verification for LeftClaw Services.
 * Supports 4 payment methods:
 *   - cv: ClawdViction points (off-chain, via clawdviction API)
 *   - clawd: CLAWD token burn to 0xdead (on-chain, verified)
 *   - usdc: USDC transfer to payTo address (on-chain, verified)
 *   - eth: ETH transfer to payTo address (on-chain, verified)
 */

import { createPublicClient, http, verifyMessage } from "viem";
import { base } from "viem/chains";
import { getKV } from "./kv";

const CLAWD_ADDRESS = "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07";
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const PAY_TO = "0x11ce532845cE0eAcdA41f72FDc1C88c335981442";
const CV_SPEND_URL = "https://clawdviction.vercel.app/api/cv/spend";
const CV_SIGN_MESSAGE = "ClawdViction CV Spend";

// ERC20 Transfer event topic
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function getRpcUrl(): string {
  const url = process.env.BASE_RPC_URL;
  if (!url) throw new Error("BASE_RPC_URL not configured");
  return url;
}

function getClient() {
  return createPublicClient({ chain: base, transport: http(getRpcUrl()) });
}

// CV pricing — cheap for now to encourage usage
export const CV_PRICES: Record<string, number> = {
  PFP_GENERATE: 50_000,
  CONSULT_QUICK: 200_000,
  CONSULT_DEEP: 300_000,
  QA_REPORT: 500_000,
  AUDIT_QUICK: 2_000_000,
};

// USD prices (for USDC/ETH verification)
export const USD_PRICES: Record<string, number> = {
  PFP_GENERATE: 0.5,
  CONSULT_QUICK: 20,
  CONSULT_DEEP: 30,
  QA_REPORT: 50,
  AUDIT_QUICK: 200,
};

export type PaymentMethod = "cv" | "clawd" | "usdc" | "eth";

export interface PaymentProof {
  method: PaymentMethod;
  wallet: string;
  // For CV:
  signature?: string;
  // For on-chain (clawd/usdc/eth):
  txHash?: string;
}

export interface PaymentResult {
  success: boolean;
  error?: string;
  details?: Record<string, any>;
}

// In-memory fallback for tx replay protection
const usedTxHashes = new Set<string>();

async function isTxUsed(txHash: string): Promise<boolean> {
  const key = `pay-tx:${txHash}`;
  const kv = getKV();
  if (kv) {
    return !!(await kv.get(key));
  }
  return usedTxHashes.has(txHash);
}

async function markTxUsed(txHash: string): Promise<void> {
  const key = `pay-tx:${txHash}`;
  const kv = getKV();
  if (kv) {
    await kv.set(key, "1", { ex: 86400 * 365 });
  }
  usedTxHashes.add(txHash);
}

/**
 * Verify payment for a service.
 */
export async function verifyPayment(
  serviceType: string,
  proof: PaymentProof,
): Promise<PaymentResult> {
  const { method, wallet } = proof;

  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return { success: false, error: "Valid wallet address required" };
  }

  switch (method) {
    case "cv":
      return verifyCvPayment(serviceType, wallet, proof.signature);
    case "clawd":
      return verifyClawdBurn(serviceType, wallet, proof.txHash);
    case "usdc":
      return verifyUsdcTransfer(serviceType, wallet, proof.txHash);
    case "eth":
      return verifyEthTransfer(serviceType, wallet, proof.txHash);
    default:
      return { success: false, error: `Unknown payment method: ${method}` };
  }
}

// --- CV Payment ---
async function verifyCvPayment(
  serviceType: string,
  wallet: string,
  signature?: string,
): Promise<PaymentResult> {
  const cvCost = CV_PRICES[serviceType];
  if (!cvCost) return { success: false, error: `No CV price for service: ${serviceType}` };
  if (!signature) return { success: false, error: "Signature required for CV payment" };

  // Verify signature locally
  const valid = await verifyMessage({
    address: wallet as `0x${string}`,
    message: CV_SIGN_MESSAGE,
    signature: signature as `0x${string}`,
  });
  if (!valid) return { success: false, error: "Invalid signature" };

  // Spend CV
  const secret = process.env.CV_SPEND_SECRET;
  if (!secret) return { success: false, error: "CV spend not configured" };

  const res = await fetch(CV_SPEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, signature, secret, amount: cvCost }),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    return {
      success: false,
      error: data.error || "CV spend failed",
      details: { currentBalance: data.balance, required: cvCost },
    };
  }

  return { success: true, details: { cvSpent: cvCost, newBalance: data.newBalance } };
}

// --- CLAWD Burn ---
async function verifyClawdBurn(
  serviceType: string,
  wallet: string,
  txHash?: string,
): Promise<PaymentResult> {
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return { success: false, error: "Valid txHash required" };
  }

  const txLower = txHash.toLowerCase();
  if (await isTxUsed(txLower)) {
    return { success: false, error: "Transaction already used" };
  }

  const client = getClient();
  const [receipt, tx] = await Promise.all([
    client.getTransactionReceipt({ hash: txHash as `0x${string}` }),
    client.getTransaction({ hash: txHash as `0x${string}` }),
  ]);

  if (!receipt || receipt.status !== "success") {
    return { success: false, error: "Transaction failed or not found" };
  }
  if (tx.from.toLowerCase() !== wallet.toLowerCase()) {
    return { success: false, error: "Transaction sender does not match wallet" };
  }

  // Find CLAWD transfer to 0xdead
  const burnLog = receipt.logs.find(log => {
    if (log.address.toLowerCase() !== CLAWD_ADDRESS.toLowerCase()) return false;
    if (log.topics.length < 3 || log.topics[0] !== TRANSFER_TOPIC) return false;
    const toAddr = "0x" + log.topics[2]!.slice(26);
    return toAddr.toLowerCase() === DEAD_ADDRESS.toLowerCase();
  });

  if (!burnLog) return { success: false, error: "No CLAWD burn found in transaction" };

  const amount = BigInt(burnLog.data);
  // Minimum 1K CLAWD (loose floor — frontend should calculate proper amount)
  if (amount < BigInt("1000") * BigInt(10) ** BigInt(18)) {
    return { success: false, error: "Burn amount too low" };
  }

  await markTxUsed(txLower);
  return { success: true, details: { burnAmount: amount.toString(), txHash } };
}

// --- USDC Transfer ---
async function verifyUsdcTransfer(
  serviceType: string,
  wallet: string,
  txHash?: string,
): Promise<PaymentResult> {
  const usdPrice = USD_PRICES[serviceType];
  if (!usdPrice) return { success: false, error: `No USD price for service: ${serviceType}` };
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return { success: false, error: "Valid txHash required" };
  }

  const txLower = txHash.toLowerCase();
  if (await isTxUsed(txLower)) {
    return { success: false, error: "Transaction already used" };
  }

  const client = getClient();
  const [receipt, tx] = await Promise.all([
    client.getTransactionReceipt({ hash: txHash as `0x${string}` }),
    client.getTransaction({ hash: txHash as `0x${string}` }),
  ]);

  if (!receipt || receipt.status !== "success") {
    return { success: false, error: "Transaction failed or not found" };
  }
  if (tx.from.toLowerCase() !== wallet.toLowerCase()) {
    return { success: false, error: "Transaction sender does not match wallet" };
  }

  // Find USDC transfer to PAY_TO
  const usdcLog = receipt.logs.find(log => {
    if (log.address.toLowerCase() !== USDC_ADDRESS.toLowerCase()) return false;
    if (log.topics.length < 3 || log.topics[0] !== TRANSFER_TOPIC) return false;
    const toAddr = "0x" + log.topics[2]!.slice(26);
    return toAddr.toLowerCase() === PAY_TO.toLowerCase();
  });

  if (!usdcLog) return { success: false, error: "No USDC transfer to payment address found" };

  const amount = BigInt(usdcLog.data);
  const minAmount = BigInt(Math.floor(usdPrice * 0.99 * 1e6)); // 1% tolerance, 6 decimals
  if (amount < minAmount) {
    return { success: false, error: `USDC amount too low. Need at least $${usdPrice}` };
  }

  await markTxUsed(txLower);
  return { success: true, details: { usdcAmount: amount.toString(), txHash } };
}

// --- ETH Transfer ---
async function verifyEthTransfer(
  serviceType: string,
  wallet: string,
  txHash?: string,
): Promise<PaymentResult> {
  const usdPrice = USD_PRICES[serviceType];
  if (!usdPrice) return { success: false, error: `No USD price for service: ${serviceType}` };
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return { success: false, error: "Valid txHash required" };
  }

  const txLower = txHash.toLowerCase();
  if (await isTxUsed(txLower)) {
    return { success: false, error: "Transaction already used" };
  }

  const client = getClient();
  const [receipt, tx] = await Promise.all([
    client.getTransactionReceipt({ hash: txHash as `0x${string}` }),
    client.getTransaction({ hash: txHash as `0x${string}` }),
  ]);

  if (!receipt || receipt.status !== "success") {
    return { success: false, error: "Transaction failed or not found" };
  }
  if (tx.from.toLowerCase() !== wallet.toLowerCase()) {
    return { success: false, error: "Transaction sender does not match wallet" };
  }
  if (tx.to?.toLowerCase() !== PAY_TO.toLowerCase()) {
    return { success: false, error: "ETH not sent to payment address" };
  }

  // We need ETH/USD price to verify amount. Fetch from DexScreener.
  let ethPrice = 0;
  try {
    const res = await fetch("https://api.dexscreener.com/latest/dex/tokens/0x4200000000000000000000000000000000000006");
    const data = await res.json();
    ethPrice = parseFloat(data.pairs?.[0]?.priceUsd || "0");
  } catch {
    // Fallback: accept any ETH > 0 if we can't get price
  }

  if (ethPrice > 0) {
    const minEthWei = BigInt(Math.floor((usdPrice * 0.95 / ethPrice) * 1e18)); // 5% tolerance
    if (tx.value < minEthWei) {
      return { success: false, error: `ETH amount too low. Need ~$${usdPrice} worth of ETH` };
    }
  } else if (tx.value === BigInt(0)) {
    return { success: false, error: "No ETH value in transaction" };
  }

  await markTxUsed(txLower);
  return { success: true, details: { ethAmount: tx.value.toString(), txHash } };
}
