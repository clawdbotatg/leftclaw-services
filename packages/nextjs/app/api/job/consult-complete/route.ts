import { NextRequest } from "next/server";
import { getKV } from "~~/lib/kv";
import { verifyAuthSignature } from "~~/lib/authSignature";

function kvKey(address: string) {
  return `consult-done:${address.toLowerCase()}`;
}

// The consult "done" set is per-wallet UI state. Both reading and writing it must
// be scoped to the wallet itself: derive the address from a verified signature
// rather than trusting the query/body, so nobody can read another wallet's list or
// mark consults done on their behalf. See PRIVACY_AUDIT.md F4.
async function verifiedAddress(
  address: string | null | undefined,
  sig: string | null | undefined,
): Promise<string | null> {
  if (!address || !sig) return null;
  return (await verifyAuthSignature(address, sig)) ? address.toLowerCase() : null;
}

export async function GET(req: NextRequest) {
  const address = await verifiedAddress(
    req.nextUrl.searchParams.get("address"),
    req.nextUrl.searchParams.get("sig"),
  );
  if (!address) return Response.json({ done: [] }, { status: 401 });

  const kv = getKV();
  if (!kv) return Response.json({ done: [] });

  try {
    const members = await kv.smembers(kvKey(address));
    const done = (members as string[]).map(Number).filter(n => !isNaN(n) && n > 0);
    return Response.json({ done });
  } catch {
    return Response.json({ done: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { consultJobId, address: bodyAddress, sig } = await req.json();
    const address = await verifiedAddress(bodyAddress, sig);
    if (!address) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (!consultJobId) return Response.json({ ok: false }, { status: 400 });

    const kv = getKV();
    if (!kv) return Response.json({ ok: false, reason: "KV unavailable" });

    await kv.sadd(kvKey(address), String(consultJobId));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
