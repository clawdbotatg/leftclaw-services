"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useBalance, usePublicClient, useReadContract, useReadContracts } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";
import { AddressInput } from "@scaffold-ui/components";
import { Address, RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { useCLAWDPrice } from "~~/hooks/scaffold-eth/useCLAWDPrice";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

const CONTRACT_ADDRESS = deployedContracts[8453]?.LeftClawServicesV2?.address as `0x${string}`;
const CONTRACT_ABI = deployedContracts[8453]?.LeftClawServicesV2?.abi;

const SANITIZER_ADDRESS = "0xCfB32a7d01Ca2B4B538C83B2b38656D3502D76EA" as `0x${string}`;
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const ERC20_BALANCE_ABI = [{ inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" }] as const;

const STATUS_LABELS: Record<number, { text: string; badge: string }> = {
  0: { text: "OPEN", badge: "badge-info" },
  1: { text: "IN PROGRESS", badge: "badge-warning" },
  2: { text: "COMPLETED", badge: "badge-success" },
  3: { text: "DECLINED", badge: "badge-error" },
  4: { text: "CANCELLED", badge: "badge-ghost" },
  5: { text: "REASSIGNED", badge: "badge-secondary" },
};

const STATUS_FILTERS = [
  { value: -1, label: "All" },
  { value: 0, label: "Open" },
  { value: 1, label: "In Progress" },
  { value: 2, label: "Completed" },
  { value: 3, label: "Declined" },
  { value: 4, label: "Cancelled" },
  { value: 5, label: "Reassigned" },
];

function parseError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/user rejected|user denied/i.test(msg)) return "Cancelled";
  const m = msg.match(/reverted[^"']*["']([^"']{3,80})["']/i);
  if (m) return m[1];
  return msg.length > 200 ? msg.slice(0, 200) + "…" : msg || "Transaction failed";
}

function truncAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function timeAgo(ts: number) {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Workers Hook ──────────────────────────────────────────────

interface WorkerInfo {
  address: string;
  activeJobs: number[];
  ethBalance: string | null;
}

function useWorkers() {
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWorkers = useCallback(async () => {
    try {
      const res = await fetch("/api/job/workers");
      const data = await res.json();
      setWorkers(data.workers || []);
    } catch (e) {
      console.error("Failed to fetch workers", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchWorkers(); }, [fetchWorkers]);

  return { workers, loading, refetch: fetchWorkers };
}

// ─── Service Type ──────────────────────────────────────────────

// ─── Sanitizer Wallet Panel ────────────────────────────────────────

function SanitizerPanel() {
  const { data: ethBalance } = useBalance({
    address: SANITIZER_ADDRESS,
    chainId: 8453,
  });

  const { data: usdcBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [SANITIZER_ADDRESS],
    chainId: 8453,
  });

  const ethFormatted = ethBalance ? Number(formatUnits(ethBalance.value, 18)).toFixed(5) : "—";
  const usdcFormatted = usdcBalance !== undefined ? Number(formatUnits(usdcBalance, 6)).toFixed(2) : "—";

  return (
    <div className="card bg-base-200 mb-8">
      <div className="card-body">
        <h2 className="font-bold mb-3">💸 Sanitizer Wallet (x402)</h2>
        <p className="text-xs opacity-50 mb-4">
          All x402 payments route through this address before being posted on-chain via <code>postJobFor</code>.
        </p>

        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs opacity-50">Address:</span>
          <Address address={SANITIZER_ADDRESS} />
        </div>

        <div className="flex gap-6">
          <div className="bg-base-300 rounded-lg px-5 py-3 flex-1">
            <div className="text-xs opacity-50 mb-1">ETH Balance</div>
            <div className="font-mono text-lg font-bold">
              {ethBalance ? ethFormatted : <span className="loading loading-spinner loading-xs" />}
              {ethBalance && <span className="text-xs opacity-50 ml-1">ETH</span>}
            </div>
          </div>
          <div className="bg-base-300 rounded-lg px-5 py-3 flex-1">
            <div className="text-xs opacity-50 mb-1">USDC Balance</div>
            <div className="font-mono text-lg font-bold">
              {usdcBalance !== undefined ? `$${usdcFormatted}` : <span className="loading loading-spinner loading-xs" />}
              {usdcBalance !== undefined && <span className="text-xs opacity-50 ml-1">USDC</span>}
            </div>
          </div>
        </div>

        {ethBalance && ethBalance.value < BigInt(1e15) && (
          <div className="alert alert-warning mt-4 py-2">
            <span className="text-xs">⚠️ Low ETH — sanitizer needs gas to call <code>postJobFor</code>.</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Service Type ──────────────────────────────────────────────

interface ServiceTypeData {
  id: bigint;
  name: string;
  slug: string;
  priceUsd: bigint;
  cvDivisor: bigint;
  status: string;
}

// ─── Service Types Table ──────────────────────────────────────────────

function ServiceTypesPanel({ refetch }: { refetch: () => void }) {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useScaffoldWriteContract("LeftClawServicesV2");

  const [serviceTypes, setServiceTypes] = useState<ServiceTypeData[]>([]);
  const [loading, setLoading] = useState(true);

  // Editable row state: keyed by id
  const [edits, setEdits] = useState<Record<string, { name: string; slug: string; priceUsd: string; cvDivisor: string; status: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, { type: "success" | "error"; text: string }>>({});

  // New service type form
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newCvDiv, setNewCvDiv] = useState("100");
  const [addBusy, setAddBusy] = useState(false);
  const [addMsg, setAddMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchTypes = async () => {
    if (!publicClient) return;
    try {
      const types = (await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "getAllServiceTypes",
      })) as ServiceTypeData[];
      setServiceTypes(types);

      // Initialize edit state
      const newEdits: typeof edits = {};
      for (const t of types) {
        const key = t.id.toString();
        newEdits[key] = {
          name: t.name,
          slug: t.slug,
          priceUsd: (Number(t.priceUsd) / 1e6).toString(),
          cvDivisor: t.cvDivisor.toString(),
          status: t.status,
        };
      }
      setEdits(newEdits);
    } catch (e) {
      console.error("Failed to load service types", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTypes();
  }, [publicClient]);

  const handleSave = async (id: bigint) => {
    const key = id.toString();
    const e = edits[key];
    if (!e) return;

    setSaving(key);
    setRowMsg(m => ({ ...m, [key]: undefined as any }));

    try {
      const priceUsdc = parseUnits(e.priceUsd, 6);
      await writeContractAsync({
        functionName: "updateServiceType",
        args: [id, e.name, e.slug, priceUsdc, BigInt(e.cvDivisor), e.status],
      });

      setRowMsg(m => ({ ...m, [key]: { type: "success", text: "Saved ✓" } }));
      setTimeout(() => setRowMsg(m => ({ ...m, [key]: undefined as any })), 3000);
      await fetchTypes();
    } catch (err) {
      setRowMsg(m => ({ ...m, [key]: { type: "error", text: parseError(err) } }));
    } finally {
      setSaving(null);
    }
  };

  const handleAdd = async () => {
    if (!newName || !newSlug || !newPrice || !newCvDiv) return;
    setAddBusy(true);
    setAddMsg(null);

    try {
      const priceUsdc = parseUnits(newPrice, 6);
      await writeContractAsync({
        functionName: "addServiceType",
        args: [newName, newSlug, priceUsdc, BigInt(newCvDiv)],
      });

      setAddMsg({ type: "success", text: "Added!" });
      setNewName("");
      setNewSlug("");
      setNewPrice("");
      setNewCvDiv("100");
      await fetchTypes();
      refetch();
    } catch (err) {
      setAddMsg({ type: "error", text: parseError(err) });
    } finally {
      setAddBusy(false);
    }
  };

  const updateEdit = (key: string, field: string, value: string) => {
    setEdits(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  if (loading) {
    return (
      <div className="card bg-base-200 mb-8">
        <div className="card-body"><span className="loading loading-spinner" /></div>
      </div>
    );
  }

  return (
    <div className="card bg-base-200 mb-8">
      <div className="card-body">
        <h2 className="font-bold mb-4">📋 Service Types</h2>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="table table-xs w-full">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Slug</th>
                <th>Price (USD)</th>
                <th>CV Divisor</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {serviceTypes.map(st => {
                const key = st.id.toString();
                const e = edits[key];
                if (!e) return null;
                const isSaving = saving === key;

                return (
                  <tr key={key}>
                    <td className="font-mono text-xs">{key}</td>
                    <td>
                      <input
                        className="input input-bordered input-xs w-28"
                        value={e.name}
                        onChange={ev => updateEdit(key, "name", ev.target.value)}
                        disabled={isSaving}
                      />
                    </td>
                    <td>
                      <input
                        className="input input-bordered input-xs w-24 font-mono"
                        value={e.slug}
                        onChange={ev => updateEdit(key, "slug", ev.target.value)}
                        disabled={isSaving}
                      />
                    </td>
                    <td>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs opacity-50">$</span>
                        <input
                          className="input input-bordered input-xs w-24 pl-5 font-mono"
                          type="number"
                          value={e.priceUsd}
                          onChange={ev => updateEdit(key, "priceUsd", ev.target.value)}
                          disabled={isSaving}
                        />
                      </div>
                    </td>
                    <td>
                      <input
                        className="input input-bordered input-xs w-16 font-mono"
                        type="number"
                        value={e.cvDivisor}
                        onChange={ev => updateEdit(key, "cvDivisor", ev.target.value)}
                        disabled={isSaving}
                      />
                    </td>
                    <td>
                      <select
                        className="select select-bordered select-xs"
                        value={e.status}
                        onChange={ev => updateEdit(key, "status", ev.target.value)}
                        disabled={isSaving}
                      >
                        <option value="active">active</option>
                        <option value="paused">paused</option>
                        <option value="deprecated">deprecated</option>
                      </select>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          className="btn btn-xs btn-primary"
                          onClick={() => handleSave(st.id)}
                          disabled={isSaving}
                        >
                          {isSaving ? <span className="loading loading-spinner loading-xs" /> : "Save"}
                        </button>
                        {rowMsg[key] && (
                          <span className={`text-xs ${rowMsg[key].type === "success" ? "text-success" : "text-error"}`}>
                            {rowMsg[key].text}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Add New */}
        <div className="border-t border-base-300 mt-4 pt-4">
          <h3 className="text-sm font-bold mb-3">Add Service Type</h3>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="text-xs opacity-50 block mb-1">Name</label>
              <input className="input input-bordered input-sm w-40" value={newName} onChange={e => setNewName(e.target.value)} placeholder="PFP Generator" disabled={addBusy} />
            </div>
            <div>
              <label className="text-xs opacity-50 block mb-1">Slug</label>
              <input className="input input-bordered input-sm w-28 font-mono" value={newSlug} onChange={e => setNewSlug(e.target.value)} placeholder="pfp" disabled={addBusy} />
            </div>
            <div>
              <label className="text-xs opacity-50 block mb-1">Price (USD)</label>
              <input className="input input-bordered input-sm w-24 font-mono" type="number" value={newPrice} onChange={e => setNewPrice(e.target.value)} placeholder="50" disabled={addBusy} />
            </div>
            <div>
              <label className="text-xs opacity-50 block mb-1">CV Divisor</label>
              <input className="input input-bordered input-sm w-20 font-mono" type="number" value={newCvDiv} onChange={e => setNewCvDiv(e.target.value)} placeholder="100" disabled={addBusy} />
            </div>
            <button className="btn btn-sm btn-primary" onClick={handleAdd} disabled={addBusy || !newName || !newSlug || !newPrice}>
              {addBusy ? <span className="loading loading-spinner loading-xs" /> : "Add"}
            </button>
          </div>
          {addMsg && (
            <p className={`text-xs mt-2 ${addMsg.type === "success" ? "text-success" : "text-error"}`}>
              {addMsg.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Job Card ────────────────────────────────────────────────────────────────

interface JobData {
  id: bigint;
  client: string;
  serviceTypeId: bigint;
  paymentClawd: bigint;
  priceUsd: bigint;
  description: string;
  status: number;
  createdAt: bigint;
  startedAt: bigint;
  completedAt: bigint;
  resultCID: string;
  worker: string;
  paymentClaimed: boolean;
  paymentMethod: number;
  cvAmount: bigint;
  currentStage: string;
}

function JobCard({
  job,
  clawdPrice,
  onAction,
  serviceTypeName,
  tldr,
}: {
  job: JobData;
  clawdPrice: number | null;
  onAction: (action: string, jobId: bigint, args?: any) => Promise<void>;
  serviceTypeName?: string;
  tldr?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [resultCID, setResultCID] = useState("");
  const [workNote, setWorkNote] = useState("");
  const [workStage, setWorkStage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const clawdAmount = Number(formatUnits(job.paymentClawd, 18));
  const usdValue = job.priceUsd > 0n ? Number(formatUnits(job.priceUsd, 6)) : clawdPrice ? clawdAmount * clawdPrice : null;
  const statusInfo = STATUS_LABELS[job.status] || { text: "UNKNOWN", badge: "badge-ghost" };
  const paymentLabels = ["CLAWD", "USDC", "ETH", "CV"];

  const { data: workLogs, refetch: refetchLogs } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI as any,
    functionName: "getWorkLogs",
    args: [job.id],
    query: { enabled: expanded },
  });

  const doAction = async (action: string, args?: any) => {
    setBusy(action);
    setError("");
    setSuccessMsg("");
    try {
      await onAction(action, job.id, args);
      setSuccessMsg(`${action} ✓`);
      setTimeout(() => setSuccessMsg(""), 3000);
      if (action === "logWork") { setWorkNote(""); setWorkStage(""); refetchLogs(); }
    } catch (e) {
      setError(parseError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-base-300 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-sm">#{Number(job.id)}</span>
          <span className={`badge ${statusInfo.badge} badge-sm`}>{statusInfo.text}</span>
          <span className="text-xs opacity-60">{serviceTypeName || `Type #${Number(job.serviceTypeId)}`}</span>
          <span className="badge badge-ghost badge-xs">{paymentLabels[job.paymentMethod] || "?"}</span>
        </div>
        <button className="btn btn-ghost btn-xs" onClick={() => setExpanded(!expanded)}>
          {expanded ? "▲" : "▼"}
        </button>
      </div>

      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-3">
          <span className="opacity-60 flex items-center gap-1">Client: <Address address={job.client as `0x${string}`} size="xs" /></span>
          <span className="opacity-40">·</span>
          <span className="opacity-60">{timeAgo(Number(job.createdAt))}</span>
        </div>
        <div className="text-right">
          <span className="font-mono font-bold">
            {usdValue ? `$${usdValue.toLocaleString()}` : job.cvAmount > 0n ? `${Number(job.cvAmount).toLocaleString()} CV` : `${clawdAmount.toLocaleString()} CLAWD`}
          </span>
        </div>
      </div>

      {/* Quick description preview — prefer TLDR summary over raw text */}
      {(tldr || job.description) && (
        <p className="text-xs opacity-50 mt-1 truncate">{tldr || job.description.slice(0, 120)}</p>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 mt-3">
        {job.status === 0 && (
          <>
            <button className="btn btn-sm btn-primary" disabled={busy !== null} onClick={() => doAction("accept")}>
              {busy === "accept" ? <span className="loading loading-spinner loading-xs" /> : "Accept"}
            </button>
            <button className="btn btn-sm btn-error btn-outline" disabled={busy !== null} onClick={() => doAction("decline")}>
              {busy === "decline" ? <span className="loading loading-spinner loading-xs" /> : "Decline"}
            </button>
          </>
        )}
      </div>

      {expanded && (
        <div className="mt-4 space-y-4 border-t border-base-100 pt-4">
          {tldr && (
            <div className="text-xs">
              <span className="opacity-50">Summary: </span>
              <span>{tldr}</span>
            </div>
          )}
          {job.description && (
            <details className="text-xs">
              <summary className="opacity-50 cursor-pointer hover:opacity-70">Raw description</summary>
              <span className="break-all opacity-70 mt-1 block">{job.description}</span>
            </details>
          )}
          {job.resultCID && (
            <div className="text-xs">
              <span className="opacity-50">Result: </span>
              <a href={job.resultCID.startsWith("http") ? job.resultCID : `https://ipfs.io/ipfs/${job.resultCID}`} target="_blank" className="link link-primary font-mono break-all">{job.resultCID}</a>
            </div>
          )}
          {job.worker !== "0x0000000000000000000000000000000000000000" && (
            <div className="text-xs flex items-center gap-1"><span className="opacity-50">Worker: </span><Address address={job.worker as `0x${string}`} size="xs" /></div>
          )}
          {job.currentStage && (
            <div className="text-xs"><span className="opacity-50">Stage: </span><span className="badge badge-info badge-xs">{job.currentStage}</span></div>
          )}

          {/* IN_PROGRESS actions */}
          {job.status === 1 && (
            <div className="space-y-3">
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="text-xs opacity-50 mb-1 block">Result CID</label>
                  <input type="text" className="input input-bordered input-sm w-full font-mono text-xs" placeholder="bafybei..." value={resultCID} onChange={e => setResultCID(e.target.value)} />
                </div>
                <button className="btn btn-sm btn-success" disabled={busy !== null || !resultCID} onClick={() => doAction("complete", { resultCID })}>
                  {busy === "complete" ? <span className="loading loading-spinner loading-xs" /> : "Complete"}
                </button>
              </div>

              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="text-xs opacity-50 mb-1 block">Work Log ({workNote.length}/500)</label>
                  <input type="text" className="input input-bordered input-sm w-full text-xs" placeholder="Progress update..." maxLength={500} value={workNote} onChange={e => setWorkNote(e.target.value)} />
                </div>
                <div className="w-28">
                  <label className="text-xs opacity-50 mb-1 block">Stage</label>
                  <input type="text" className="input input-bordered input-sm w-full text-xs" placeholder="stage" value={workStage} onChange={e => setWorkStage(e.target.value)} />
                </div>
                <button className="btn btn-sm btn-outline" disabled={busy !== null || !workNote} onClick={() => doAction("logWork", { note: workNote, stage: workStage })}>
                  {busy === "logWork" ? <span className="loading loading-spinner loading-xs" /> : "Log"}
                </button>
              </div>
            </div>
          )}

          {/* Work Logs */}
          {Array.isArray(workLogs) && (workLogs as any[]).length > 0 && (
            <div>
              <h4 className="text-xs font-bold opacity-70 mb-2">📝 Work Logs</h4>
              <div className="space-y-1">
                {(workLogs as any[]).map((log: any, i: number) => (
                  <div key={i} className="text-xs bg-base-200 rounded px-3 py-2 flex justify-between">
                    <span>{log.note}</span>
                    <span className="opacity-40 ml-2 whitespace-nowrap">{timeAgo(Number(log.timestamp))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-xs text-error">{error}</p>}
          {successMsg && <p className="text-xs text-success">{successMsg}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Main Admin Page ─────────────────────────────────────────────────────────

export default function AdminPage() {
  const { address } = useAccount();
  const clawdPrice = useCLAWDPrice();
  const { writeContractAsync } = useScaffoldWriteContract("LeftClawServicesV2");
  const publicClient = usePublicClient();

  const [statusFilter, setStatusFilter] = useState(-1);

  // Check worker/owner
  const ADMIN_ADDRESSES = [
    "0x34aA3F359A9D614239015126635CE7732c18fDF3", // austingriffith.eth
  ].map(a => a.toLowerCase());
  const isAdmin = !!address && ADMIN_ADDRESSES.includes(address.toLowerCase());

  const { data: isWorkerData } = useReadContracts({
    contracts: address
      ? [{ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI as any, functionName: "isWorker", args: [address] }]
      : [],
    query: { enabled: !!address },
  });
  const isWorker = !!isWorkerData?.[0]?.result;

  const { data: ownerData } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI as any,
    functionName: "owner",
  });
  const isOwner = address?.toLowerCase() === (ownerData as string)?.toLowerCase();

  // Owner panel state
  const [addWorkerAddr, setAddWorkerAddr] = useState("");
  const [removeWorkerAddr, setRemoveWorkerAddr] = useState("");
  const [ownerBusy, setOwnerBusy] = useState<string | null>(null);
  const [ownerMsg, setOwnerMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Admin Reset Job state
  const [resetJobId, setResetJobId] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [resetJobPreview, setResetJobPreview] = useState<JobData | null>(null);
  const [resetPreviewLoading, setResetPreviewLoading] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);

  // Workers list
  const { workers, loading: workersLoading, refetch: refetchWorkers } = useWorkers();

  // Total jobs
  const { data: totalJobsData } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI as any,
    functionName: "getTotalJobs",
  });
  const totalJobs = totalJobsData ? Number(totalJobsData) : 0;

  const { data: jobsData, refetch: refetchJobs } = useReadContracts({
    contracts: Array.from({ length: totalJobs }, (_, i) => ({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI as any,
      functionName: "getJob",
      args: [BigInt(i + 1)],
    })),
    query: { enabled: totalJobs > 0 },
  });

  const allJobs: JobData[] = (jobsData || []).map(d => d.result as JobData | undefined).filter((j): j is JobData => !!j);
  const filteredJobs = statusFilter === -1 ? allJobs : allJobs.filter(j => j.status === statusFilter);
  const sortedJobs = [...filteredJobs].sort((a, b) => Number(b.id) - Number(a.id));

  // Service type lookup for human-readable names
  const { data: serviceTypesRaw } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI as any,
    functionName: "getAllServiceTypes",
  });
  const serviceTypeMap: Record<string, string> = {};
  if (serviceTypesRaw) {
    for (const st of serviceTypesRaw as ServiceTypeData[]) {
      serviceTypeMap[st.id.toString()] = st.name;
    }
  }

  // Job TLDR summaries from sanitization cache
  const [tldrMap, setTldrMap] = useState<Record<string, string>>({});
  useEffect(() => {
    if (allJobs.length === 0) return;
    const jobIds = allJobs.map(j => Number(j.id)).join(",");
    fetch(`/api/job/summaries?jobIds=${jobIds}`)
      .then(r => r.json())
      .then(data => { if (data.summaries) setTldrMap(data.summaries); })
      .catch(() => {});
  }, [allJobs.length, totalJobs]);

  // Job actions
  const handleJobAction = async (action: string, jobId: bigint, args?: any) => {
    switch (action) {
      case "accept":
        await writeContractAsync({ functionName: "acceptJob", args: [jobId] });
        break;
      case "decline":
        await writeContractAsync({ functionName: "declineJob", args: [jobId] });
        break;
      case "complete":
        await writeContractAsync({ functionName: "completeJob", args: [jobId, args.resultCID] });
        break;
      case "logWork":
        await writeContractAsync({ functionName: "logWork", args: [jobId, args.note, args.stage || ""] });
        break;
      default:
        throw new Error("Unknown action");
    }
    await refetchJobs();
  };

  // Owner actions
  const handleAddWorker = async () => {
    if (!addWorkerAddr) return;
    setOwnerBusy("add");
    setOwnerMsg(null);
    try {
      await writeContractAsync({ functionName: "addWorker", args: [addWorkerAddr as `0x${string}`] });

      setAddWorkerAddr("");
      setOwnerMsg({ type: "success", text: `Worker added` });
      refetchWorkers();
    } catch (e) {
      setOwnerMsg({ type: "error", text: parseError(e) });
    } finally {
      setOwnerBusy(null);
    }
  };

  const handleRemoveWorker = async (addrOverride?: string) => {
    const addr = addrOverride || removeWorkerAddr;
    if (!addr) return;
    setOwnerBusy("remove");
    setOwnerMsg(null);
    try {
      await writeContractAsync({ functionName: "removeWorker", args: [addr as `0x${string}`] });

      setRemoveWorkerAddr("");
      setOwnerMsg({ type: "success", text: `Worker removed` });
      refetchWorkers();
    } catch (e) {
      setOwnerMsg({ type: "error", text: parseError(e) });
    } finally {
      setOwnerBusy(null);
    }
  };

  // Admin Reset Job handlers
  const handleResetJobPreview = async () => {
    if (!resetJobId || !publicClient) return;
    setResetPreviewLoading(true);
    setResetJobPreview(null);
    setResetMsg(null);
    setResetConfirm(false);
    try {
      const job = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "getJob",
        args: [BigInt(resetJobId)],
      }) as JobData;
      if (!job || job.id === 0n) {
        setResetMsg({ type: "error", text: "Job not found" });
      } else {
        setResetJobPreview(job);
      }
    } catch (e) {
      setResetMsg({ type: "error", text: parseError(e) });
    } finally {
      setResetPreviewLoading(false);
    }
  };

  const handleResetJob = async () => {
    if (!resetJobId) return;
    setResetBusy(true);
    setResetMsg(null);
    try {
      await writeContractAsync({
        functionName: "adminResetJob",
        args: [BigInt(resetJobId)],
      });
      setResetMsg({ type: "success", text: `Job #${resetJobId} reset to REASSIGNED ✓` });
      setResetJobPreview(null);
      setResetJobId("");
      setResetConfirm(false);
      await refetchJobs();
    } catch (e) {
      setResetMsg({ type: "error", text: parseError(e) });
    } finally {
      setResetBusy(false);
    }
  };

  const isWorkerLoaded = isWorkerData !== undefined;
  const isOwnerLoaded = ownerData !== undefined;
  const isLoading = !isWorkerLoaded || !isOwnerLoaded;

  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-lg opacity-60">Connect your wallet to access admin</p>
        <RainbowKitCustomConnectButton />
      </div>
    );
  }

  if (isLoading) {
    return <div className="flex justify-center py-20"><span className="loading loading-spinner loading-lg" /></div>;
  }

  if (!isWorker && !isOwner && !isAdmin) {
    return <div className="flex justify-center py-20"><p className="opacity-60">🚫 Worker access only</p></div>;
  }

  return (
    <div className="flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-4xl">
        <h1 className="text-3xl font-bold mb-1">🦞 Admin</h1>
        <p className="opacity-50 text-sm mb-8">CLAWD price: {clawdPrice ? `$${clawdPrice.toFixed(8)}` : "loading..."}</p>

        {/* Sanitizer Wallet */}
        <SanitizerPanel />

        {/* Owner Panel */}
        {isOwner && (
          <div className="card bg-base-200 mb-8">
            <div className="card-body">
              <h2 className="font-bold mb-3">👑 Owner Panel</h2>
              <div className="flex gap-2 items-end mb-3">
                <div className="flex-1">
                  <label className="text-xs opacity-50 mb-1 block">Add Worker</label>
                  <AddressInput value={addWorkerAddr} onChange={setAddWorkerAddr} placeholder="0x..." disabled={ownerBusy !== null} />
                </div>
                <button className="btn btn-sm btn-primary" disabled={ownerBusy !== null || !addWorkerAddr} onClick={handleAddWorker}>
                  {ownerBusy === "add" ? <span className="loading loading-spinner loading-xs" /> : "Add Worker"}
                </button>
              </div>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="text-xs opacity-50 mb-1 block">Remove Worker</label>
                  <AddressInput value={removeWorkerAddr} onChange={setRemoveWorkerAddr} placeholder="0x..." disabled={ownerBusy !== null} />
                </div>
                <button className="btn btn-sm btn-error btn-outline" disabled={ownerBusy !== null || !removeWorkerAddr} onClick={() => handleRemoveWorker()}>
                  {ownerBusy === "remove" ? <span className="loading loading-spinner loading-xs" /> : "Remove Worker"}
                </button>
              </div>
              {ownerMsg && <p className={`text-xs mt-2 ${ownerMsg.type === "success" ? "text-success" : "text-error"}`}>{ownerMsg.text}</p>}

              {/* Workers List */}
              <div className="border-t border-base-300 mt-4 pt-4">
                <h3 className="text-sm font-bold mb-3">👷 Workers ({workers.length})</h3>
                {workersLoading ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : workers.length === 0 ? (
                  <p className="text-xs opacity-50">No workers registered</p>
                ) : (
                  <div className="space-y-2">
                    {workers.map(w => {
                      const balWei = w.ethBalance ? BigInt(w.ethBalance) : null;
                      const balEth = balWei !== null ? Number(formatUnits(balWei, 18)) : null;
                      const low = balWei !== null && balWei < BigInt(1e15); // < 0.001 ETH
                      return (
                        <div key={w.address} className="flex items-center justify-between bg-base-300 rounded-lg px-4 py-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <Address address={w.address as `0x${string}`} onlyEnsOrAddress disableAddressLink />
                            <span className="badge badge-sm badge-ghost">{w.activeJobs.length} active</span>
                            <span
                              className={`font-mono text-xs ${low ? "text-error font-bold" : "opacity-70"}`}
                              title={low ? "Low gas — worker may stop processing jobs" : "ETH balance"}
                            >
                              {balEth !== null ? `${balEth.toFixed(4)} ETH${low ? " ⚠️" : ""}` : "—"}
                            </span>
                          </div>
                          <button
                            className="btn btn-xs btn-error btn-outline shrink-0"
                            disabled={ownerBusy !== null}
                            onClick={() => handleRemoveWorker(w.address)}
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Admin Reset Job */}
              <div className="border-t border-base-300 mt-4 pt-4">
                <h3 className="text-sm font-bold mb-2">🔄 Reset Job (Admin Reassign)</h3>
                <p className="text-xs opacity-50 mb-3">
                  Move an IN_PROGRESS or COMPLETED job back to REASSIGNED so another worker can pick it up.
                </p>
                <div className="flex gap-2 items-end mb-3">
                  <div className="flex-1">
                    <label className="text-xs opacity-50 mb-1 block">Job ID</label>
                    <input
                      type="number"
                      className="input input-bordered input-sm w-full font-mono"
                      placeholder="e.g. 42"
                      value={resetJobId}
                      onChange={e => { setResetJobId(e.target.value); setResetJobPreview(null); setResetConfirm(false); setResetMsg(null); }}
                      disabled={resetBusy}
                    />
                  </div>
                  <button
                    className="btn btn-sm btn-outline"
                    disabled={!resetJobId || resetPreviewLoading || resetBusy}
                    onClick={handleResetJobPreview}
                  >
                    {resetPreviewLoading ? <span className="loading loading-spinner loading-xs" /> : "Look Up"}
                  </button>
                </div>

                {/* Job Preview */}
                {resetJobPreview && (
                  <div className="bg-base-300 rounded-lg p-3 mb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-mono font-bold text-sm">#{Number(resetJobPreview.id)}</span>
                      <span className={`badge ${(STATUS_LABELS[resetJobPreview.status] || { badge: "badge-ghost" }).badge} badge-sm`}>
                        {(STATUS_LABELS[resetJobPreview.status] || { text: "UNKNOWN" }).text}
                      </span>
                    </div>
                    {resetJobPreview.worker !== "0x0000000000000000000000000000000000000000" && (
                      <div className="text-xs flex items-center gap-1 mb-1">
                        <span className="opacity-50">Worker:</span>
                        <Address address={resetJobPreview.worker as `0x${string}`} size="xs" />
                      </div>
                    )}
                    <div className="text-xs opacity-50 mb-2">
                      Client: {truncAddr(resetJobPreview.client)} · Created {timeAgo(Number(resetJobPreview.createdAt))}
                    </div>

                    {resetJobPreview.status === 1 || resetJobPreview.status === 2 ? (
                      !resetConfirm ? (
                        <button
                          className="btn btn-sm btn-warning"
                          onClick={() => setResetConfirm(true)}
                          disabled={resetBusy}
                        >
                          Reset to REASSIGNED
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-warning">⚠️ Are you sure?</span>
                          <button
                            className="btn btn-sm btn-warning"
                            disabled={resetBusy}
                            onClick={handleResetJob}
                          >
                            {resetBusy ? <span className="loading loading-spinner loading-xs" /> : "Confirm Reset"}
                          </button>
                          <button
                            className="btn btn-sm btn-ghost"
                            disabled={resetBusy}
                            onClick={() => setResetConfirm(false)}
                          >
                            Cancel
                          </button>
                        </div>
                      )
                    ) : (
                      <p className="text-xs text-warning">
                        ⚠️ Only IN_PROGRESS or COMPLETED jobs can be reset.
                      </p>
                    )}
                  </div>
                )}

                {resetMsg && (
                  <p className={`text-xs ${resetMsg.type === "success" ? "text-success" : "text-error"}`}>
                    {resetMsg.text}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Service Types */}
        {isOwner && <ServiceTypesPanel refetch={() => refetchJobs()} />}

        {/* Jobs */}
        <div className="card bg-base-200 mb-8">
          <div className="card-body">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold">Jobs ({totalJobs})</h2>
              <button className="btn btn-ghost btn-xs" onClick={() => refetchJobs()}>↻ Refresh</button>
            </div>

            <div className="tabs tabs-boxed mb-4">
              {STATUS_FILTERS.map(f => (
                <button key={f.value} className={`tab tab-sm ${statusFilter === f.value ? "tab-active" : ""}`} onClick={() => setStatusFilter(f.value)}>
                  {f.label}
                  {f.value >= 0 && <span className="ml-1 opacity-50">({allJobs.filter(j => j.status === f.value).length})</span>}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {sortedJobs.length === 0 ? (
                <p className="text-sm opacity-50 text-center py-4">No jobs</p>
              ) : (
                sortedJobs.map(job => (
                  <JobCard
                    key={Number(job.id)}
                    job={job}
                    clawdPrice={clawdPrice}
                    onAction={handleJobAction}
                    serviceTypeName={serviceTypeMap[job.serviceTypeId.toString()]}
                    tldr={tldrMap[job.id.toString()]}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
