import { useState, useEffect } from "react";

const CLAWD_ADDRESS = "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07";

/**
 * Fetches live CLAWD/USD price from DexScreener.
 * Returns null while loading or on error.
 */
export function useCLAWDPrice(): number | null {
  const [priceUsd, setPriceUsd] = useState<number | null>(null);

  useEffect(() => {
    fetch(`https://api.dexscreener.com/latest/dex/tokens/${CLAWD_ADDRESS}`)
      .then(r => r.json())
      .then(data => {
        const pair = data.pairs?.[0];
        if (pair?.priceUsd) setPriceUsd(parseFloat(pair.priceUsd));
      })
      .catch(() => {});
  }, []);

  return priceUsd;
}
