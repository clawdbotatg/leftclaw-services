"use client";

import { useState, useEffect } from "react";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { formatUnits, parseUnits } from "viem";
import { useAccount } from "wagmi";
import {
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useScaffoldEventHistory,
} from "~~/hooks/scaffold-eth";

const CLAWD_TOKEN = "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07";
const AUCTION_ADDRESS = "0x673c29ed989C604CCdddd691F4b4Df995A4cbCd2";

const formatClawd = (v: bigint | undefined): string => {
  if (!v) return "0";
  const n = parseFloat(formatUnits(v, 18));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
};

const DURATIONS = [
  { label: "1 Hour", seconds: 3600 },
  { label: "6 Hours", seconds: 21600 },
  { label: "1 Day", seconds: 86400 },
  { label: "3 Days", seconds: 259200 },
  { label: "1 Week", seconds: 604800 },
];

const Home: NextPage = () => {
  const { address } = useAccount();
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [startPrice, setStartPrice] = useState("");
  const [endPrice, setEndPrice] = useState("");
  const [durIdx, setDurIdx] = useState(2);
  const [isCreating, setIsCreating] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [buyingId, setBuyingId] = useState<number | null>(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  const { data: nextId } = useScaffoldReadContract({ contractName: "CLAWDAuction", functionName: "nextAuctionId" });
  const { data: totalBurned } = useScaffoldReadContract({ contractName: "CLAWDAuction", functionName: "totalBurned" });
  const { data: totalSales } = useScaffoldReadContract({ contractName: "CLAWDAuction", functionName: "totalSales" });
  const { data: allowance } = useScaffoldReadContract({ contractName: "CLAWD", functionName: "allowance", args: [address, AUCTION_ADDRESS] });

  const { writeContractAsync: writeAuction } = useScaffoldWriteContract("CLAWDAuction");
  const { writeContractAsync: writeClawd } = useScaffoldWriteContract("CLAWD");

  const { data: createEvents } = useScaffoldEventHistory({
    contractName: "CLAWDAuction", eventName: "AuctionCreated", fromBlock: 0n, watch: true,
  });

  useEffect(() => { const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(i); }, []);

  const handleApprove = async () => {
    setIsApproving(true);
    try { await writeClawd({ functionName: "approve", args: [AUCTION_ADDRESS, parseUnits("999999999", 18)] }); }
    catch (e) { console.error(e); } finally { setIsApproving(false); }
  };

  const handleCreate = async () => {
    if (!title || !startPrice || !endPrice) return;
    setIsCreating(true);
    try {
      await writeAuction({ functionName: "createAuction", args: [title, parseUnits(startPrice, 18), parseUnits(endPrice, 18), BigInt(DURATIONS[durIdx].seconds)] });
      setTitle(""); setStartPrice(""); setEndPrice(""); setShowCreate(false);
    } catch (e) { console.error(e); } finally { setIsCreating(false); }
  };

  const handleBuy = async (id: number) => {
    setBuyingId(id);
    try { await writeAuction({ functionName: "buy", args: [BigInt(id)] }); }
    catch (e) { console.error(e); } finally { setBuyingId(null); }
  };

  const auctionList = (createEvents || []).map(e => ({
    id: Number(e.args.id || 0),
    seller: e.args.seller,
    title: e.args.title || "",
    startPrice: e.args.startPrice || 0n,
    endPrice: e.args.endPrice || 0n,
    duration: Number(e.args.duration || 0),
  })).reverse();

  const fmtRemaining = (startTime: number, duration: number) => {
    const end = startTime + duration;
    const rem = end - now;
    if (rem <= 0) return "Ended";
    const h = Math.floor(rem / 3600);
    const m = Math.floor((rem % 3600) / 60);
    if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  return (
    <div className="flex flex-col items-center grow pt-6 px-4 pb-12">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">🔨 CLAWD Auction</h1>
          <p className="opacity-60">Dutch auctions. Price drops over time. 5% burned.</p>
        </div>

        <div className="flex gap-4 mb-6 text-sm opacity-60">
          <span>🔨 {totalSales?.toString() || "0"} sales</span>
          <span>🔥 {formatClawd(totalBurned)} burned</span>
        </div>

        {address && !showCreate && (
          <button className="btn btn-primary w-full mb-6" onClick={() => setShowCreate(true)}>+ Create Auction</button>
        )}

        {showCreate && (
          <div className="bg-base-200 rounded-2xl p-6 mb-6">
            <h2 className="text-lg font-bold mb-4">New Dutch Auction</h2>
            <input className="input input-bordered w-full mb-3" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} maxLength={100} />
            <div className="grid grid-cols-2 gap-3 mb-3">
              <input className="input input-bordered" type="number" placeholder="Start price (CLAWD)" value={startPrice} onChange={e => setStartPrice(e.target.value)} />
              <input className="input input-bordered" type="number" placeholder="End price (CLAWD)" value={endPrice} onChange={e => setEndPrice(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {DURATIONS.map((d, i) => (
                <button key={i} className={`btn btn-sm ${i === durIdx ? "btn-primary" : "btn-ghost"}`} onClick={() => setDurIdx(i)}>{d.label}</button>
              ))}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary flex-1" disabled={isCreating || !title || !startPrice || !endPrice} onClick={handleCreate}>
                {isCreating ? "Creating..." : "Create"}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </div>
        )}

        {auctionList.length === 0 ? (
          <div className="bg-base-200 rounded-2xl p-12 text-center opacity-40">
            <p className="text-4xl mb-2">🔨</p><p>No auctions yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {auctionList.map(a => (
              <AuctionCard key={a.id} auction={a} address={address} now={now} allowance={allowance} buyingId={buyingId} onBuy={handleBuy} onApprove={handleApprove} isApproving={isApproving} fmtRemaining={fmtRemaining} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function AuctionCard({ auction: a, address, now, allowance, buyingId, onBuy, onApprove, isApproving, fmtRemaining }: any) {
  const { data } = useScaffoldReadContract({ contractName: "CLAWDAuction", functionName: "getCurrentPrice", args: [BigInt(a.id)] });
  const currentPrice = data as bigint | undefined;
  const { data: info } = useScaffoldReadContract({ contractName: "CLAWDAuction", functionName: "auctions", args: [BigInt(a.id)] });
  const buyer = info ? (info as any)[6] : undefined;
  const sold = buyer && buyer !== "0x0000000000000000000000000000000000000000";
  const needsApproval = currentPrice && currentPrice > 0n && (!allowance || allowance < currentPrice);

  return (
    <div className="bg-base-200 rounded-2xl p-5">
      <div className="flex justify-between mb-2">
        <h3 className="font-bold text-lg">{a.title}</h3>
        <span className="badge badge-ghost">#{a.id}</span>
      </div>
      <div className="text-sm opacity-60 mb-2 flex items-center gap-1">by <Address address={a.seller} /></div>
      <div className="flex justify-between items-end">
        <div>
          <p className="text-2xl font-bold text-primary">{formatClawd(currentPrice)} <span className="text-sm font-normal">CLAWD</span></p>
          <p className="text-xs opacity-40">{formatClawd(a.startPrice)} → {formatClawd(a.endPrice)}</p>
        </div>
        <div className="text-right">
          {sold ? (
            <span className="badge badge-success">Sold ✅</span>
          ) : address && address !== a.seller ? (
            needsApproval ? (
              <button className="btn btn-primary btn-sm" disabled={isApproving} onClick={onApprove}>{isApproving ? "..." : "Approve"}</button>
            ) : (
              <button className="btn btn-primary btn-sm" disabled={buyingId === a.id} onClick={() => onBuy(a.id)}>
                {buyingId === a.id ? "..." : "Buy Now"}
              </button>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default Home;
