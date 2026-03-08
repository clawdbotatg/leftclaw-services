"use client";

import { PaymentMethod } from "~~/hooks/scaffold-eth/usePaymentContext";

const LABELS: Record<PaymentMethod, { icon: string; label: string }> = {
  cv: { icon: "⚡", label: "CV" },
  clawd: { icon: "🔥", label: "CLAWD" },
  usdc: { icon: "💵", label: "USDC" },
  eth: { icon: "⟠", label: "ETH" },
};

interface Props {
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
  disabled?: boolean;
  disabledMethods?: PaymentMethod[];
}

export function PaymentMethodSelector({ value, onChange, disabled, disabledMethods = [] }: Props) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium mb-2">Pay with</label>
      <div className="grid grid-cols-4 gap-1">
        {(["cv", "clawd", "usdc", "eth"] as PaymentMethod[]).map(m => (
          <button
            key={m}
            className={`btn btn-xs text-xs ${value === m ? "btn-primary" : "btn-outline"}`}
            onClick={() => onChange(m)}
            disabled={disabled || disabledMethods.includes(m)}
          >
            {LABELS[m].icon} {LABELS[m].label}
          </button>
        ))}
      </div>
    </div>
  );
}
