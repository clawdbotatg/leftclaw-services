import { NextResponse } from "next/server";
import { computePfpCvCost } from "~~/lib/pfpCvCost";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

export async function GET() {
  try {
    const result = await computePfpCvCost();
    return NextResponse.json(
      {
        version: 1,
        generateCvCost: result.generateCvCost,
        cvDivisor: result.cvDivisor,
        highestCVBalance: result.highestCVBalance,
        priceUsd: result.priceUsd,
        formula: "ceil((highestCVBalance / 5) / cvDivisor)",
      },
      {
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (e: any) {
    console.error("/api/pfp/cost failed", e);
    return NextResponse.json(
      { error: e?.message || "Failed to compute CV cost" },
      { status: 503, headers: CORS_HEADERS },
    );
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
