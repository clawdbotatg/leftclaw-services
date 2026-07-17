/**
 * Dynamic pretty audit report — GET /result/<jobId>.html
 *
 * Static files in public/result/ take precedence (Next serves public assets
 * first), so reports rendered by the old manual prettify.sh pipeline are
 * untouched. Any completed job WITHOUT a static file lands here: we read its
 * resultCID on-chain, fetch the markdown report from IPFS, and render it with
 * the same template/renderer as prettify.sh (lib/audit-report). This is what
 * makes the job page's "pretty result" link appear for new audits with no
 * manual step — its HEAD probe of /result/<id>.html now succeeds as soon as
 * the job completes.
 */

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import deployedContracts from "~~/contracts/deployedContracts";
import { renderAuditReport } from "~~/lib/audit-report/render";

export const runtime = "nodejs";

const { address: contractAddress, abi } = deployedContracts[8453].LeftClawServicesV2;

const publicClient = createPublicClient({
  chain: base,
  transport: http(
    process.env.BASE_RPC_URL?.trim() ||
      (process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
        ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
        : undefined),
  ),
});

const MAX_REPORT_BYTES = 2_000_000;
const JOB_STATUS_COMPLETED = 2;

// Misses are cached briefly so a pending job's page doesn't hammer the RPC,
// but the link still appears within a couple minutes of completion.
const miss = (reason: string, status = 404) =>
  new NextResponse("Not found", {
    status,
    headers: { "Cache-Control": "public, s-maxage=120", "X-Report-Miss": reason },
  });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const m = file.match(/^(\d+)\.html$/);
  if (!m) return miss("bad-path");
  const jobId = m[1];

  let job: any;
  try {
    job = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: "getJob",
      args: [BigInt(jobId)],
    });
  } catch {
    return miss("no-such-job");
  }
  if (Number(job?.status) !== JOB_STATUS_COMPLETED) return miss("not-completed");

  // resultCID holds the delivered report URL (or a bare IPFS CID). Only fetch
  // https IPFS URLs — the same shape prettify.sh accepted — so a worker-set
  // result can't point us at arbitrary internal hosts.
  const cid = String(job?.resultCID || "").trim();
  if (!cid) return miss("no-result");
  let resultUrl = "";
  if (/^https:\/\//i.test(cid)) {
    resultUrl = cid;
  } else if (/^[a-z0-9]{46,}$/i.test(cid)) {
    resultUrl = `https://${cid.toLowerCase()}.ipfs.community.bgipfs.com/`;
  }
  let host = "";
  try {
    host = new URL(resultUrl).hostname;
  } catch {
    return miss("bad-result-url");
  }
  if (!/ipfs/i.test(host)) return miss("not-ipfs");

  let md: string;
  try {
    const res = await fetch(resultUrl, {
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });
    if (!res.ok) return miss(`fetch-${res.status}`, 502);
    md = await res.text();
  } catch {
    return miss("fetch-failed", 502);
  }
  if (!md.trim() || md.length > MAX_REPORT_BYTES) return miss("bad-report-size");

  // Some workers deliver ready-made HTML — never host third-party HTML
  // verbatim (same guard as prettify.sh exit 3).
  if (/<!doctype|<html/i.test(md.slice(0, 200))) return miss("result-is-html");

  const { html } = renderAuditReport({ jobId, md, ipfsUrl: resultUrl });

  // A completed job's report is immutable — cache hard at the edge. The
  // no-script CSP is defense in depth on top of the renderer's sanitizer.
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'",
    },
  });
}
