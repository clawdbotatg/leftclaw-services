import { NextRequest, NextResponse } from "next/server";
import { getSession, updateSession } from "~~/lib/sessionStore";
import { verifyAuthSignature } from "~~/lib/authSignature";

export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const session = await getSession(sessionId);

  if (!session) {
    return NextResponse.json({ error: "Session not found or expired" }, { status: 404 });
  }

  // Verify caller owns the session before returning the prompt or chat history.
  // Auth is the long-lived "LeftClaw Services Auth" signature (same pattern as
  // /api/job/[id]/messages). Sessions without a payerAddress (legacy) cannot be
  // verified, so sensitive fields stay redacted.
  const callerAddress = req.nextUrl.searchParams.get("address");
  const sig = req.nextUrl.searchParams.get("sig");

  let authed = false;
  if (callerAddress && sig && session.payerAddress) {
    const sigValid = await verifyAuthSignature(callerAddress, sig);
    if (sigValid && callerAddress.toLowerCase() === session.payerAddress.toLowerCase()) {
      authed = true;
    }
  }

  return NextResponse.json({
    id: session.id,
    serviceType: session.serviceType,
    status: session.status,
    maxMessages: session.maxMessages,
    planGenerations: session.planGenerations || 0,
    expiresAt: session.expiresAt,
    authed,
    description: authed ? session.description : null,
    messages: authed ? session.messages : [],
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action !== "close") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found or expired" }, { status: 404 });
  }

  if (session.status === "completed") {
    return NextResponse.json({ ok: true, status: session.status });
  }

  const updated = await updateSession(sessionId, { status: "completed" });
  return NextResponse.json({ ok: true, status: updated?.status ?? "completed" });
}
