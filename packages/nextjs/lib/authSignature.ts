import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

export const AUTH_SIGN_MESSAGE = "LeftClaw Services Auth";

const rpcUrl =
  process.env.BASE_RPC_URL?.trim() ||
  (process.env.NEXT_PUBLIC_ALCHEMY_API_KEY
    ? `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
    : undefined);

const publicClient = createPublicClient({
  chain: base,
  transport: http(rpcUrl),
});

/**
 * Verify an auth signature server-side.
 * Uses publicClient.verifyMessage for EIP-1271 smart wallet support.
 */
export async function verifyAuthSignature(clientAddress: string, signature: string): Promise<boolean> {
  try {
    return await publicClient.verifyMessage({
      address: clientAddress as `0x${string}`,
      message: AUTH_SIGN_MESSAGE,
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}
