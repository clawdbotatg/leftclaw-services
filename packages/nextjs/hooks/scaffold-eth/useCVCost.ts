import { useEffect, useState } from "react";

/**
 * Fetches the highest CV balance from larv.ai and computes CV cost for a given service.
 * cvCost = Math.ceil(highestCVBalance / cvDivisor)
 *
 * Caches the highestCVBalance across renders and components via module-level cache.
 */

let _highestCache: { highest: number | null; fetchedAt: number } = { highest: null, fetchedAt: 0 };
const HIGHEST_TTL = 30_000; // 30s cache

export function useCVCost(cvDivisor: number): { cvCost: number | null; highest: number | null; loading: boolean } {
  const [highest, setHighest] = useState<number | null>(_highestCache.highest);
  const [loading, setLoading] = useState(_highestCache.highest === null);

  useEffect(() => {
    const now = Date.now();
    if (_highestCache.highest !== null && now - _highestCache.fetchedAt < HIGHEST_TTL) {
      setHighest(_highestCache.highest);
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);

    fetch("https://larv.ai/api/cv/highest")
      .then(r => r.json())
      .then(data => {
        if (!mounted) return;
        if (data.success !== false && data.highestCVBalance) {
          const h = data.highestCVBalance;
          _highestCache = { highest: h, fetchedAt: Date.now() };
          setHighest(h);
        }
      })
      .catch(() => {})
      .finally(() => { if (mounted) setLoading(false); });

    return () => { mounted = false; };
  }, []);

  const cvCost = highest !== null && cvDivisor > 0 ? Math.ceil(highest / cvDivisor) : null;

  return { cvCost, highest, loading };
}
