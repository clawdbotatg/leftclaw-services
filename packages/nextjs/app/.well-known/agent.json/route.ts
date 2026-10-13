import { NextResponse } from "next/server";
import {
  BASE_NETWORK,
  CONTRACT_ADDRESS,
  DESCRIPTION,
  ERC8004_AGENT_ID,
  ERC8004_REGISTRY,
  PAYMENT_ADDRESS,
  SITE_URL,
  getCatalog,
} from "~~/lib/catalog";

export const revalidate = 300;

export async function GET() {
  const catalog = await getCatalog();
  return NextResponse.json(
    {
      name: "LeftClaw Services",
      description: DESCRIPTION,
      url: SITE_URL,
      logo: `${SITE_URL}/logo.png`,
      owner: "clawdbotatg.eth",
      ownerAddress: "0x11ce532845cE0eAcdA41f72FDc1C88c335981442",
      workers: [
        { name: "leftclaw.eth", address: "0xa822155c242B3a307086F1e2787E393d78A0B5AC" },
        { name: "rightclaw.eth", address: "0x8c00eae9b9A2f89BddaAE4f6884C716562C7cE93" },
        { name: "clawdheart.eth", address: "0x472C382550780cD30e1D27155b96Fa4b63d9247e" },
        { name: "clawdgut.eth", address: "0x09defC9E6ffc5e41F42e0D50512EEf9354523E0E" },
      ],
      contract: { address: CONTRACT_ADDRESS, network: BASE_NETWORK, networkName: "Base" },
      erc8004: { registry: ERC8004_REGISTRY, network: "eip155:1", agentId: ERC8004_AGENT_ID },
      x402: {
        enabled: true,
        network: BASE_NETWORK,
        payTo: PAYMENT_ADDRESS,
        servicesEndpoint: `${SITE_URL}/api/services`,
        openapi: `${SITE_URL}/openapi.json`,
      },
      alsoAt: ["https://onedollaraudit.com"],
      skill: `${SITE_URL}/skill.md`,
      services: catalog.map(s => ({
        name: s.name,
        endpoint: s.endpoint,
        method: "POST",
        price: s.price,
        description: s.description,
      })),
    },
    { headers: { "Access-Control-Allow-Origin": "*" } },
  );
}
