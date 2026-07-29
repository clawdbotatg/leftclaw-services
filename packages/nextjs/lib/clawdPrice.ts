const CLAWD_ADDRESS = "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07";

let cache: { price: number; at: number } | null = null;
const TTL = 60_000;

/** Live CLAWD/USD from DexScreener (same source the frontends use). Null on failure. */
export async function getClawdPriceUsd(): Promise<number | null> {
  if (cache && Date.now() - cache.at < TTL) return cache.price;
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${CLAWD_ADDRESS}`);
    const data = await r.json();
    const p = parseFloat(data.pairs?.[0]?.priceUsd || "0");
    if (p > 0) {
      cache = { price: p, at: Date.now() };
      return p;
    }
  } catch {
    // fall through
  }
  return cache?.price ?? null;
}

/** Slippage floor for a USD-priced swap into CLAWD: 95% of the quoted output,
 * in CLAWD wei (18 decimals). Returns 0n (no protection — pre-existing behavior)
 * if the price feed is unavailable, so a DexScreener blip never blocks payments. */
export async function getMinClawdOut(priceUsd: number): Promise<bigint> {
  const clawdPrice = await getClawdPriceUsd();
  if (!clawdPrice || priceUsd <= 0) return 0n;
  const minTokens = (priceUsd / clawdPrice) * 0.95;
  return BigInt(Math.floor(minTokens * 1e6)) * 10n ** 12n;
}
