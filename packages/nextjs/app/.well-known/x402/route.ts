import { NextResponse } from "next/server";
import { SITE_URL, getCatalog } from "~~/lib/catalog";

export const revalidate = 300;

// x402 discovery fan-out (x402scan, 402index crawl this).
export async function GET() {
  const catalog = await getCatalog();
  return NextResponse.json(
    {
      version: 1,
      resources: catalog.map(s => `${SITE_URL}${s.endpoint}`),
      instructions: `POST JSON to any resource; it answers 402 with x402 payment requirements (USDC on Base). Docs: ${SITE_URL}/skill.md`,
    },
    { headers: { "Access-Control-Allow-Origin": "*" } },
  );
}
