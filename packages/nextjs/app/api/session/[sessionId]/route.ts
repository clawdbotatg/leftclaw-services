import { NextRequest, NextResponse } from "next/server";
import { getSession, updateSession } from "~~/lib/sessionStore";

export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const session = await getSession(sessionId);

  if (!session) {
    return NextResponse.json({ error: "Session not found or expired" }, { status: 404 });
  }

  return NextResponse.json({
    id: session.id,
    serviceType: session.serviceType,
    description: session.description,
    status: session.status,
    maxMessages: session.maxMessages,
    planGenerations: session.planGenerations || 0,
    expiresAt: session.expiresAt,
    messages: session.messages,
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
