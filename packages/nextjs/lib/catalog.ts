// One source for the discovery files (/api/services, /.well-known/*).
// Prices come from the contract, so these files can't drift from the 402 responses.
import deployedContracts from "~~/contracts/deployedContracts";
import { BASE_NETWORK, PAYMENT_ADDRESS, getContractPriceUsd } from "~~/lib/x402";

export const SITE_URL = "https://leftclaw.services";
export const CONTRACT_ADDRESS = deployedContracts[8453]?.LeftClawServicesV2?.address;
export const ERC8004_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
export const ERC8004_AGENT_ID = 21548;

export const DESCRIPTION =
  "AI Ethereum builder bots for hire: $1 smart contract audits (also at onedollaraudit.com), frontend QA, research reports, consults, and full builds. Pay with USDC on Base via x402 — no account, no gas.";

type Field = { type: "string"; description: string };

type ServiceDef = {
  id: number; // service type id on the contract (1-indexed)
  endpoint: string;
  name: string;
  description: string;
  responseType: "session" | "inline";
  input: Record<string, Field>;
  required: string[];
};

const desc = (d: string): Field => ({ type: "string", description: d });
const context = desc("Additional context (optional)");

const SERVICES: ServiceDef[] = [
  {
    id: 1,
    endpoint: "/api/consult/quick",
    name: "Quick Consultation",
    description: "A focused 15-message chat session about your idea. Returns a written build plan.",
    responseType: "session",
    input: { description: desc("What you need help with (min 10 chars)"), context },
    required: ["description"],
  },
  {
    id: 2,
    endpoint: "/api/consult/deep",
    name: "Deep Consultation",
    description: "A deep-dive chat on complex architecture, protocol design, or strategy.",
    responseType: "session",
    input: { description: desc("What you need help with (min 10 chars)"), context },
    required: ["description"],
  },
  {
    id: 5,
    endpoint: "/api/qa",
    name: "Frontend QA Audit",
    description: "Pre-ship dApp quality audit. Send your dApp URL or contract address.",
    responseType: "session",
    input: { description: desc("dApp URL, contract address, or repo link (min 10 chars)"), context },
    required: ["description"],
  },
  {
    id: 4,
    endpoint: "/api/audit",
    name: "Smart Contract Audit",
    description:
      "Security review of a smart contract. Send contract address (verified on Basescan/Etherscan) or source code. Written report with severity ratings.",
    responseType: "session",
    input: {
      description: desc("Contract address (verified on Basescan/Etherscan) or source code (min 10 chars)"),
      context,
      callbackUrl: desc(
        "Optional https URL — when the job finishes, {jobId, status, reportUrl, statusUrl} is POSTed to it",
      ),
    },
    required: ["description"],
  },
  {
    id: 3,
    endpoint: "/api/pfp",
    name: "CLAWD PFP Generator",
    description:
      "Custom CLAWD mascot profile picture. Describe how to modify the character, get a 1024x1024 PNG inline.",
    responseType: "inline",
    input: { prompt: desc("How to modify the CLAWD character (e.g. 'wearing a cowboy hat')") },
    required: ["prompt"],
  },
  {
    id: 6,
    endpoint: "/api/build",
    name: "Build",
    description: "A dedicated build session. LeftClaw builds and ships your plan.",
    responseType: "session",
    input: { description: desc("What to build — be specific (min 20 chars)"), context },
    required: ["description"],
  },
  {
    id: 7,
    endpoint: "/api/research",
    name: "Research Report",
    description: "Comprehensive research on a protocol, topic, or codebase.",
    responseType: "session",
    input: { description: desc("What to research (protocol, topic, codebase, etc.) (min 10 chars)"), context },
    required: ["description"],
  },
  {
    id: 8,
    endpoint: "/api/judge",
    name: "Judge / Oracle",
    description: "Impartial evaluation of disputes, design decisions, or architecture choices.",
    responseType: "session",
    input: {
      description: desc("What to judge/evaluate (dispute, design decision, architecture choice, etc.) (min 10 chars)"),
      context,
    },
    required: ["description"],
  },
];

export type CatalogEntry = ServiceDef & { price: string };

// Sequential with one retry — the RPC 429s a wide parallel burst (see openapi.json route).
// After the first success the 60s price cache makes this free.
export async function getCatalog(): Promise<CatalogEntry[]> {
  const out: CatalogEntry[] = [];
  for (const s of SERVICES) {
    let price: string;
    try {
      price = await getContractPriceUsd(s.id);
    } catch {
      await new Promise(r => setTimeout(r, 750));
      price = await getContractPriceUsd(s.id);
    }
    out.push({ ...s, price });
  }
  return out;
}

export { BASE_NETWORK, PAYMENT_ADDRESS };
