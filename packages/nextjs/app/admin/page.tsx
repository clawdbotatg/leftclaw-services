"use client";

import { useState } from "react";
import { useAccount, useReadContracts, useWriteContract, usePublicClient } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import { useCLAWDPrice } from "~~/hooks/scaffold-eth/useCLAWDPrice";
import deployedContracts from "~~/contracts/deployedContracts";

const CONTRACT_ADDRESS = deployedContracts[8453]?.LeftClawServices?.address as `0x${string}`;
const CONTRACT_ABI = deployedContracts[8453]?.LeftClawServices?.abi;

const SERVICE_TYPES = [
  { id: 0, name: "Quick Consult", emoji: "💬" },
  { id: 1, name: "Deep Consult", emoji: "🧠" },
  { id: 2, name: "Simple Build", emoji: "🔨" },
  { id: 3, name: "Standard Build", emoji: "🏗️" },
  { id: 4, name: "Complex Build", emoji: "⚙️" },
  { id: 5, name: "Enterprise Build", emoji: "🏢" },
  { id: 6, name: "QA Report", emoji: "🔍" },
  { id: 7, name: "Contract Audit", emoji: "🛡️" },
  { id: 8, name: "Multi-Contract Audit", emoji: "🔐" },
];

function parseError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/user rejected|user denied/i.test(msg)) return "Cancelled";
  if (/Not authorized/i.test(msg)) return "Not authorized — executor only";
  const m = msg.match(/reverted[^"']*["']([^"']{3,80})["']/i);
  if (m) return m[1];
  return "Transaction failed";
}

export default function AdminPage() {
  const { address } = useAccount();
  const clawdPrice = useCLAWDPrice();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [pending, setPending] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [success, setSuccess] = useState<Record<number, boolean>>({});

  // Check executor status
  const { data: isExecutorData } = useReadContracts({
    contracts: address ? [{ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any, functionName: "isExecutor", args: [address] }] : [],
    query: { enabled: !!address },
  });
  const isExecutor = !!(isExecutorData?.[0]?.result);

  // Read all service prices
  const { data: pricesData, refetch: refetchPrices } = useReadContracts({
    contracts: SERVICE_TYPES.map(s => ({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI as any,
      functionName: "servicePriceInClawd",
      args: [s.id],
    })),
  });

  const handleUpdate = async (serviceId: number) => {
    const usdInput = inputs[serviceId];
    if (!usdInput || !clawdPrice) return;

    const usdValue = parseFloat(usdInput);
    if (isNaN(usdValue) || usdValue <= 0) {
      setErrors(e => ({ ...e, [serviceId]: "Enter a valid USD amount" }));
      return;
    }

    const clawdAmount = usdValue / clawdPrice;
    const clawdWei = parseUnits(Math.round(clawdAmount).toString(), 18);

    setErrors(e => ({ ...e, [serviceId]: "" }));
    setSuccess(s => ({ ...s, [serviceId]: false }));
    setPending(serviceId);

    try {
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI as any,
        functionName: "updatePrice",
        args: [serviceId, clawdWei],
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      await refetchPrices();
      setInputs(i => ({ ...i, [serviceId]: "" }));
      setSuccess(s => ({ ...s, [serviceId]: true }));
      setTimeout(() => setSuccess(s => ({ ...s, [serviceId]: false })), 3000);
    } catch (e) {
      setErrors(err => ({ ...err, [serviceId]: parseError(e) }));
    } finally {
      setPending(null);
    }
  };

  if (!address) {
    return (
      <div className="flex justify-center py-20">
        <p className="opacity-60">Connect your wallet to access admin</p>
      </div>
    );
  }

  if (!isExecutor) {
    return (
      <div className="flex justify-center py-20">
        <p className="opacity-60">🚫 Executor access only</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-2xl">
        <h1 className="text-3xl font-bold mb-1">🦞 Admin</h1>
        <p className="opacity-50 text-sm mb-8">
          CLAWD price: {clawdPrice ? `$${clawdPrice.toFixed(8)}` : "loading..."}
        </p>

        <div className="card bg-base-200">
          <div className="card-body">
            <h2 className="font-bold mb-4">Service Prices</h2>
            <div className="space-y-4">
              {SERVICE_TYPES.map((service, i) => {
                const priceWei = pricesData?.[i]?.result as bigint | undefined;
                const priceClawd = priceWei ? Number(formatUnits(priceWei, 18)) : null;
                const priceUsd = priceClawd && clawdPrice ? priceClawd * clawdPrice : null;
                const isBusy = pending === service.id;

                return (
                  <div key={service.id} className="flex flex-col gap-1.5 bg-base-300 rounded-lg px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{service.emoji} {service.name}</span>
                      <div className="text-right">
                        <p className="font-mono text-sm font-bold">
                          {priceClawd ? priceClawd.toLocaleString() : "..."} CLAWD
                        </p>
                        <p className="text-xs opacity-50">
                          {priceUsd ? `~$${priceUsd.toFixed(2)}` : "..."}
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2 items-center mt-1">
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm opacity-50">$</span>
                        <input
                          type="number"
                          className="input input-bordered input-sm w-full pl-6 text-sm"
                          placeholder="New price in USD"
                          value={inputs[service.id] ?? ""}
                          onChange={e => setInputs(i => ({ ...i, [service.id]: e.target.value }))}
                          disabled={isBusy}
                          min="0"
                          step="1"
                        />
                      </div>
                      {inputs[service.id] && clawdPrice && (
                        <span className="text-xs opacity-40 whitespace-nowrap">
                          = {Math.round(parseFloat(inputs[service.id]) / clawdPrice).toLocaleString()} CLAWD
                        </span>
                      )}
                      <button
                        className={`btn btn-sm ${success[service.id] ? "btn-success" : "btn-primary"}`}
                        onClick={() => handleUpdate(service.id)}
                        disabled={isBusy || !inputs[service.id]}
                      >
                        {isBusy
                          ? <span className="loading loading-spinner loading-xs" />
                          : success[service.id] ? "✓" : "Update"}
                      </button>
                    </div>

                    {errors[service.id] && (
                      <p className="text-xs text-error">{errors[service.id]}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
