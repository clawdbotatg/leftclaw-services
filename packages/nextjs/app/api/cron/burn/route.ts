/**
 * Burn keeper: sweeps the SwapAndBurn sink (pay.clawdbotatg.eth).
 *
 * All product revenue — LeftClawServicesV2 job escrow (treasury → sink),
 * PFP CLAWD transfers, and denar.ai USDC top-ups — accumulates at the sink.
 * When the combined USD value crosses BURN_THRESHOLD_USD, this cron calls the
 * sink's permissionless execute(), which swaps USDC/ETH → CLAWD straight to
 * 0xdEaD and sweeps any held CLAWD to 0xdEaD.
 *
 * The sink's execute() has no slippage protection (known audit finding, V2
 * pending), so the threshold is kept low — small swaps are small sandwiches.
 *
 * GET/POST /api/cron/burn (Vercel cron: GET with Bearer CRON_SECRET)
 */
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, parseAbi, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { getClawdPriceUsd } from "~~/lib/clawdPrice";
import { getKV } from "~~/lib/kv";

const BURN_SINK = (process.env.BURN_SINK_ADDRESS || "0x0C1a3DB07304D2E4E551AB4A7b083382a33f25ad") as `0x${string}`;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const CLAWD = "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07" as const;
const WETH = "0x4200000000000000000000000000000000000006" as const;
const THRESHOLD_USD = Number(process.env.BURN_THRESHOLD_USD || 5);

const SINK_ABI = parseAbi(["function execute() external", "event Burned(uint256 clawdAmount)"]);
const ERC20_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const AUTH_SECRET = process.env.CRON_SECRET;

async function wethPriceUsd(): Promise<number | null> {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${WETH}`);
    const p = parseFloat((await r.json()).pairs?.[0]?.priceUsd || "0");
    return p > 0 ? p : null;
  } catch {
    return null;
  }
}

async function handle(req: NextRequest) {
  if (AUTH_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${AUTH_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const rpc = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  const publicClient = createPublicClient({ chain: base, transport: http(rpc) });

  const [usdcBal, clawdBal, ethBal] = await Promise.all([
    publicClient.readContract({ address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [BURN_SINK] }),
    publicClient.readContract({ address: CLAWD, abi: ERC20_ABI, functionName: "balanceOf", args: [BURN_SINK] }),
    publicClient.getBalance({ address: BURN_SINK }),
  ]);

  const [clawdPrice, ethPrice] = await Promise.all([getClawdPriceUsd(), wethPriceUsd()]);
  const usdcUsd = Number(usdcBal) / 1e6;
  const clawdUsd = clawdPrice ? (Number(clawdBal) / 1e18) * clawdPrice : 0;
  const ethUsd = ethPrice ? (Number(ethBal) / 1e18) * ethPrice : 0;
  const totalUsd = usdcUsd + clawdUsd + ethUsd;

  const balances = {
    usdc: usdcUsd.toFixed(2),
    clawd: (Number(clawdBal) / 1e18).toFixed(0),
    eth: (Number(ethBal) / 1e18).toFixed(6),
    totalUsd: totalUsd.toFixed(2),
  };

  if (totalUsd < THRESHOLD_USD) {
    return NextResponse.json({ burned: false, reason: `below $${THRESHOLD_USD} threshold`, balances });
  }

  const key = process.env.SANITIZER_PRIVATE_KEY;
  if (!key) {
    return NextResponse.json({ error: "SANITIZER_PRIVATE_KEY not configured" }, { status: 503 });
  }

  // KV lock so overlapping invocations can't double-fire execute()
  const kv = getKV();
  if (kv) {
    const locked = await kv.set("burn-cron:lock", "1", { nx: true, ex: 300 });
    if (!locked) {
      return NextResponse.json({ burned: false, reason: "another run holds the lock", balances });
    }
  }

  try {
    const account = privateKeyToAccount(key as `0x${string}`);
    const walletClient = createWalletClient({ account, chain: base, transport: http(rpc) });

    const hash = await walletClient.writeContract({
      address: BURN_SINK,
      abi: SINK_ABI,
      functionName: "execute",
      chain: base,
      account,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, retryCount: 20, retryDelay: 3_000 });

    const burnedEvents = parseEventLogs({ abi: SINK_ABI, eventName: "Burned", logs: receipt.logs });
    const clawdBurned = burnedEvents.reduce((sum, e) => sum + e.args.clawdAmount, 0n);

    console.log(`[burn-cron] burned ${Number(clawdBurned) / 1e18} CLAWD (tx ${hash})`);
    return NextResponse.json({
      burned: true,
      txHash: hash,
      clawdBurned: (Number(clawdBurned) / 1e18).toFixed(0),
      balances,
    });
  } catch (err) {
    console.error("[burn-cron] execute failed:", err);
    return NextResponse.json({ error: "execute failed", detail: String(err).slice(0, 300) }, { status: 500 });
  } finally {
    if (kv) await kv.del("burn-cron:lock").catch(() => {});
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
