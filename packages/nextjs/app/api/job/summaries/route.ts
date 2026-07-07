import { NextRequest } from "next/server";
import { verifyAuthSignature } from "~~/lib/authSignature";
import { isOwnerOrWorker } from "~~/lib/workerAuth";
import { getSanitization } from "~~/lib/sanitize";

// Job summaries (tldr) are AI-generated one-liners of each job's request — and for
// consult jobs they summarize the deliberately off-chain private prompt. This is a
// cross-client feed, so it's restricted to the platform owner / registered workers
// (the admin dashboard is the only caller). Owner-scoping alone wouldn't fit: the
// dashboard triages *all* jobs. See PRIVACY_AUDIT.md F1.
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("jobIds");
  if (!raw) {
    return Response.json({ error: "jobIds query param required" }, { status: 400 });
  }

  const address = req.nextUrl.searchParams.get("address");
  const sig = req.nextUrl.searchParams.get("sig");
  if (!address || !sig) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await verifyAuthSignature(address, sig))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  if (!(await isOwnerOrWorker(address))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const ids = raw.split(",").filter(Boolean).slice(0, 200);
  const summaries: Record<string, string> = {};

  await Promise.all(
    ids.map(async (id) => {
      try {
        const result = await getSanitization(id);
        if (result?.tldr) {
          summaries[id] = result.tldr;
        }
      } catch {}
    }),
  );

  return Response.json({ summaries });
}
