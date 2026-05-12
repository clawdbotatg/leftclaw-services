"use client";

import { useEffect, useState } from "react";

interface CVPriceTickerProps {
  cvDivisor: number;
  className?: string;
}

export function CVPriceTicker({ cvDivisor, className = "" }: CVPriceTickerProps) {
  const [cvCost, setCvCost] = useState<number | null>(null);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    let mounted = true;

    const fetchCost = async () => {
      try {
        const res = await fetch("https://larv.ai/api/cv/highest");
        const data = await res.json();
        if (!data.success || !data.highestCVBalance) return;

        const cost = Math.ceil(data.highestCVBalance / cvDivisor);

        if (mounted) {
          setCvCost(prev => {
            if (prev !== null && prev !== cost) {
              setPulse(true);
              setTimeout(() => setPulse(false), 600);
            }
            return cost;
          });
        }
      } catch {
        // silent
      }
    };

    fetchCost();
    const interval = setInterval(fetchCost, 10_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [cvDivisor]);

  if (cvCost === null) {
    return <span className={`text-sm opacity-50 ${className}`}>Loading CV cost…</span>;
  }

  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-sm ${className} ${pulse ? "animate-pulse text-primary" : ""}`}
    >
      ⚡ <span className="font-bold">{cvCost.toLocaleString()}</span> CV
    </span>
  );
}
