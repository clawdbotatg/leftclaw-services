"use client";

import { PaymentMethod } from "~~/hooks/scaffold-eth/usePaymentContext";

interface Props {
  method: PaymentMethod;
  clawdBalance?: bigint;
  usdcBalance?: bigint;
  ethBalance?: bigint;
  cvBalance: number | null;
}

export function formatBalance(props: Props): string {
  const { method, clawdBalance, usdcBalance, ethBalance, cvBalance } = props;
  switch (method) {
    case "cv":
      return cvBalance !== null ? `${cvBalance.toLocaleString()} CV` : "—";
    case "clawd":
      return clawdBalance !== undefined
        ? `${Number(clawdBalance / BigInt(10) ** BigInt(18)).toLocaleString()} CLAWD`
        : "—";
    case "usdc":
      return usdcBalance !== undefined ? `$${(Number(usdcBalance) / 1e6).toFixed(2)} USDC` : "—";
    case "eth":
      return ethBalance !== undefined ? `${(Number(ethBalance) / 1e18).toFixed(4)} ETH` : "—";
  }
}

export function BalanceDisplay(props: Props) {
  return <span>{formatBalance(props)}</span>;
}
