import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { x402ResourceServer } from "@x402/next";

// clawdbotatg.eth receives USDC payments on Base
export const PAYMENT_ADDRESS = "0x11ce532845cE0eAcdA41f72FDc1C88c335981442";
export const BASE_NETWORK = "eip155:8453";

// Default Coinbase-hosted facilitator (free, no setup)
const facilitatorClient = new HTTPFacilitatorClient();

export const x402Server = new x402ResourceServer(facilitatorClient).register(BASE_NETWORK, new ExactEvmScheme());

// Service pricing in USD (matches contract)
export const SERVICE_PRICES = {
  CONSULT_QUICK: "$20.00",
  CONSULT_DEEP: "$30.00",
  BUILD_DAILY: "$1000.00",
  QA_REPORT: "$50.00",
  AUDIT_QUICK: "$200.00",
} as const;
