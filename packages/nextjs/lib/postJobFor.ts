import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import deployedContracts from "~~/contracts/deployedContracts";

const CONTRACT_ADDRESS = deployedContracts[8453]?.LeftClawServicesV2?.address as `0x${string}`;
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

const CONTRACT_ABI = parseAbi([
  "function postJobFor(address client, uint256 serviceTypeId, string description, uint256 minClawdOut) external",
  "function nextJobId() view returns (uint256)",
]);

const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

function getClients() {
  const key = process.env.SANITIZER_PRIVATE_KEY;
  if (!key) throw new Error("SANITIZER_PRIVATE_KEY not configured");

  const account = privateKeyToAccount(key as `0x${string}`);
  const rpc = process.env.BASE_RPC_URL || "https://mainnet.base.org";

  const publicClient = createPublicClient({ chain: base, transport: http(rpc) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(rpc) });

  return { account, publicClient, walletClient };
}

async function ensureApproval(
  publicClient: any,
  walletClient: any,
  owner: `0x${string}`,
) {
  const allowance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, CONTRACT_ADDRESS],
  });

  // Approve max if allowance is below 10k USDC (arbitrary threshold)
  if (allowance < 10_000_000_000n) {
    const hash = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [CONTRACT_ADDRESS, 2n ** 256n - 1n],
      chain: base,
      account: walletClient.account!,
    });
    await publicClient.waitForTransactionReceipt({ hash, retryCount: 10, retryDelay: 3_000 });
  }
}

/**
 * Calls postJobFor on-chain via the sanitizer wallet.
 * Returns the numeric job ID.
 */
export async function postJobForOnChain(
  serviceTypeId: number,
  description: string,
): Promise<number> {
  const { account, publicClient, walletClient } = getClients();

  await ensureApproval(publicClient, walletClient, account.address as `0x${string}`);

  const nextId = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "nextJobId",
  });

  const hash = await walletClient.writeContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "postJobFor",
    args: [account.address, BigInt(serviceTypeId), description, 0n],
    chain: base,
    account: account,
  });

  await publicClient.waitForTransactionReceipt({ hash, retryCount: 20, retryDelay: 3_000 });

  return Number(nextId);
}
