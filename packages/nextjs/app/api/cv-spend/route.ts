import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const CV_SIGN_MESSAGE = "ClawdViction CV Spend";
const CV_SPEND_URL = "https://larv.ai/api/cv/spend";

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL),
});

export async function POST(req: NextRequest) {
  try {
    const { wallet, signature, amount } = await req.json();

    if (!wallet || !signature || !amount) {
      return NextResponse.json({ error: "Missing wallet, signature, or amount" }, { status: 400 });
    }

    // Verify signature — supports both EOA and EIP-1271 smart wallets (e.g. Coinbase Smart Wallet)
    let valid = false;
    let verifyError: string | null = null;
    try {
      valid = await publicClient.verifyMessage({
        address: wallet as `0x${string}`,
        message: CV_SIGN_MESSAGE,
        signature: signature as `0x${string}`,
      });
    } catch (e: any) {
      verifyError = e?.message || "verifyMessage threw";
    }

    if (!valid) {
      console.error("[cv-spend] invalid signature", {
        wallet,
        signaturePrefix: signature?.slice(0, 20),
        signatureLength: signature?.length,
        message: CV_SIGN_MESSAGE,
        verifyError,
      });
      return NextResponse.json(
        {
          error: "Invalid signature",
          detail: verifyError || "verifyMessage returned false",
        },
        { status: 401 },
      );
    }

    // Spend CV via clawdviction API
    const secret = process.env.CV_SPEND_SECRET;
    if (!secret) {
      return NextResponse.json({ error: "CV spend not configured" }, { status: 500 });
    }

    const res = await fetch(CV_SPEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, signature, secret, amount }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      return NextResponse.json({ error: data.error || "CV spend failed" }, { status: 400 });
    }

    return NextResponse.json({ success: true, newBalance: data.newBalance });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
