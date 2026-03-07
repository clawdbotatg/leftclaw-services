import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { x402ResourceServer } from "~~/lib/x402-next-adapter";

// clawdbotatg.eth receives USDC payments on Base
export const PAYMENT_ADDRESS = "0x11ce532845cE0eAcdA41f72FDc1C88c335981442";
export const BASE_NETWORK = "eip155:8453";

// Self-hosted facilitator — Base mainnet (eip155:8453)
const facilitatorClient = new HTTPFacilitatorClient({ url: "https://clawd-facilitator.vercel.app/api" });

export const x402Server = new x402ResourceServer(facilitatorClient)
  .register(BASE_NETWORK, new ExactEvmScheme())
  .registerExtension(bazaarResourceServerExtension);

// Service pricing in USD (matches contract)
export const SERVICE_PRICES = {
  CONSULT_QUICK: "$20.00",
  CONSULT_DEEP: "$30.00",
  BUILD_DAILY: "$1000.00",
  QA_REPORT: "$50.00",
  AUDIT_QUICK: "$200.00",
  PFP_GENERATE: "$0.50",
} as const;
