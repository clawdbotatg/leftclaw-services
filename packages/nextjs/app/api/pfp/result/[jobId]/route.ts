/**
 * Serves the generated PFP image for a completed on-chain PFP job.
 * Populated by /api/job/pfp-sweep after generating the image and posting completion on-chain.
 *
 * GET /api/pfp/result/:jobId → image/png
 */

import { NextRequest } from "next/server";
import { getKV } from "~~/lib/kv";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!/^\d+$/.test(jobId)) {
    return new Response("Invalid jobId", { status: 400 });
  }

  const kv = getKV();
  if (!kv) return new Response("Storage not configured", { status: 500 });

  const b64 = (await kv.get(`pfp-result:${jobId}`)) as string | null;
  if (!b64) return new Response("Not found", { status: 404 });

  const clean = b64.replace(/^data:image\/png;base64,/, "");
  const buf = Buffer.from(clean, "base64");

  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
