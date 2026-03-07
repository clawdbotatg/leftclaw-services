import { NextResponse } from "next/server";

export async function GET(_req: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  try {
    const res = await fetch(`https://clawdviction.vercel.app/api/clawdviction/${wallet}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ clawdviction: "0" }, { status: 500 });
  }
}
