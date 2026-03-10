import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

// Must match larv.ai's CV_SPEND_MESSAGE exactly — "larv.ai CV Spend"
const CV_SIGN_MESSAGE = "larv.ai CV Spend";
const CV_SPEND_URL = "https://larv.ai/api/cv/spend";

const rpcUrl = process.env.BASE_RPC_URL?.trim();

const publicClient = createPublicClient({
  chain: base,
  transport: http(rpcUrl),
});

export async function POST(req: NextRequest) {
  try {
    const { wallet, signature, amount } = await req.json();

    console.log("[cv-spend] request received", {
      wallet,
      signatureLength: signature?.length,
      signaturePrefix: signature?.slice(0, 20),
      amount,
      hasRpcUrl: !!rpcUrl,
      rpcUrlPrefix: rpcUrl?.slice(0, 40),
    });

    if (!wallet || !signature || !amount) {
      return NextResponse.json(
        { error: "Missing wallet, signature, or amount", detail: `wallet=${!!wallet} sig=${!!signature} amount=${!!amount}`, source: "validation" },
        { status: 400 },
      );
    }

    // Verify signature — supports both EOA and EIP-1271 smart wallets (e.g. Coinbase Smart Wallet)
    let valid = false;
    let verifyError: string | null = null;
    try {
      console.log("[cv-spend] verifying signature with publicClient.verifyMessage", {
        address: wallet,
        message: CV_SIGN_MESSAGE,
        signaturePrefix: signature?.slice(0, 20),
      });
      valid = await publicClient.verifyMessage({
        address: wallet as `0x${string}`,
        message: CV_SIGN_MESSAGE,
        signature: signature as `0x${string}`,
      });
      console.log("[cv-spend] verifyMessage result:", valid);
    } catch (e: any) {
      verifyError = e?.message?.slice(0, 500) || "verifyMessage threw";
      console.error("[cv-spend] verifyMessage threw error:", verifyError);
    }

    if (!valid) {
      console.error("[cv-spend] SIGNATURE INVALID", {
        wallet,
        signatureLength: signature?.length,
        signaturePrefix: signature?.slice(0, 20),
        signatureSuffix: signature?.slice(-10),
        message: CV_SIGN_MESSAGE,
        verifyError,
        validResult: valid,
      });
      return NextResponse.json(
        {
          error: "Signature verification failed",
          detail: verifyError
            ? `verifyMessage error: ${verifyError.slice(0, 300)}`
            : `verifyMessage returned false for wallet ${wallet} with message "${CV_SIGN_MESSAGE}"`,
          source: "local_verify",
        },
        { status: 401 },
      );
    }

    console.log("[cv-spend] signature verified OK, calling larv.ai...");

    // Spend CV via clawdviction API
    const secret = process.env.CV_SPEND_SECRET;
    if (!secret) {
      console.error("[cv-spend] CV_SPEND_SECRET not configured!");
      return NextResponse.json(
        { error: "CV spend not configured", detail: "CV_SPEND_SECRET env var is missing", source: "config" },
        { status: 500 },
      );
    }

    const larvBody = { wallet, signature, secret, amount };
    console.log("[cv-spend] calling larv.ai", {
      url: CV_SPEND_URL,
      wallet,
      amount,
      signaturePrefix: signature?.slice(0, 20),
      hasSecret: !!secret,
    });

    const res = await fetch(CV_SPEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(larvBody),
    });

    const resText = await res.text();
    console.log("[cv-spend] larv.ai response", {
      status: res.status,
      statusText: res.statusText,
      bodyPreview: resText.slice(0, 500),
    });

    let data: any;
    try {
      data = JSON.parse(resText);
    } catch {
      console.error("[cv-spend] larv.ai returned non-JSON:", resText.slice(0, 500));
      return NextResponse.json(
        {
          error: "CV API returned invalid response",
          detail: `Status ${res.status}: ${resText.slice(0, 200)}`,
          source: "larv_api",
        },
        { status: 502 },
      );
    }

    if (!res.ok || !data.success) {
      console.error("[cv-spend] larv.ai rejected spend", {
        status: res.status,
        data,
      });
      return NextResponse.json(
        {
          error: data.error || "CV spend failed",
          detail: `larv.ai status ${res.status}: ${JSON.stringify(data).slice(0, 300)}`,
          source: "larv_api",
        },
        { status: res.status >= 400 ? res.status : 400 },
      );
    }

    console.log("[cv-spend] SUCCESS", { wallet, amount, newBalance: data.newBalance });
    return NextResponse.json({ success: true, newBalance: data.newBalance });
  } catch (e: any) {
    console.error("[cv-spend] UNHANDLED ERROR:", e?.message, e?.stack?.slice(0, 500));
    return NextResponse.json(
      {
        error: "Internal server error",
        detail: e?.message?.slice(0, 300) || "Unknown error",
        source: "server",
      },
      { status: 500 },
    );
  }
}
