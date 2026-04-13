// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/LeftClawServicesV2.sol";

contract DeployLeftClawServicesV2 is Script {
    // ─── Base Mainnet Addresses ───────────────────────────────────────────────
    address constant CLAWD          = 0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07;
    address constant USDC           = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant UNISWAP_ROUTER = 0x2626664c2603336E57B271c5C0b26F421741e481;
    address constant WETH           = 0x4200000000000000000000000000000000000006;

    address constant TREASURY       = 0x90eF2A9211A3E7CE788561E5af54C76B0Fa3aEd0; // safe.clawd.atg.eth

    // Owner: clawdbotatg.eth
    address constant OWNER          = 0x11ce532845cE0eAcdA41f72FDc1C88c335981442;

    // Workers
    address constant LEFTCLAW   = 0xa822155c242B3a307086F1e2787E393d78A0B5AC;
    address constant RIGHTCLAW  = 0x8c00eae9b9A2f89BddaAE4f6884C716562C7cE93;
    address constant CLAWDHEART = 0x472C382550780cD30e1D27155b96Fa4b63d9247e;
    address constant CLAWDGUT   = 0x09defC9E6ffc5e41F42e0D50512EEf9354523E0E;
    address constant NEW_WORKER = 0x862b4474b449777d2a2622F6a04b9D879D891D19;

    // Server wallet used by /api/job/close-consultation and postJobFor —
    // must be a registered worker so completeJob() doesn't revert.
    address constant SANITIZER  = 0xCfB32a7d01Ca2B4B538C83B2b38656D3502D76EA;

    // ─── Seed Service Types ───────────────────────────────────────────────────
    // Edit this array to add more service types before deploying.
    struct SeedService {
        string name;
        string slug;
        uint256 priceUsd;
        uint256 cvDivisor;
    }

    function _getSeedServices() internal pure returns (SeedService[] memory) {
        SeedService[] memory seeds = new SeedService[](10);
        // TEST MODE: priceUsd ÷ 50, cvDivisor × 10
        seeds[0] = SeedService("Quick Consultation",  "consult",       400_000,        1000);    // was 20_000_000 / 100
        seeds[1] = SeedService("Deep Consultation",   "consult-deep",  600_000,         500);    // was 30_000_000 / 50
        seeds[2] = SeedService("PFP Generator",       "pfp",           5_000,        5000);    // was 250_000 / 500
        seeds[3] = SeedService("Contract Audit",      "audit",         4_000_000,     250);    // was 200_000_000 / 25
        seeds[4] = SeedService("Frontend QA Audit",   "qa",            1_000_000,     500);    // was 50_000_000 / 50
        seeds[5] = SeedService("Build",              "build",         20_000_000,      10);    // was 1_000_000_000 / 1
        seeds[6] = SeedService("Research Report",    "research",       2_000_000,      130);    // was 100_000_000 / 13
        seeds[7] = SeedService("Judge / Oracle",      "judge",         1_000_000,      500);    // was 50_000_000 / 50
        seeds[8] = SeedService("HumanQA",            "humanqa",        4_000_000,     250);    // was 200_000_000 / 25
        seeds[9] = SeedService("Feature",            "feature",       10_000_000,       50);    // was 500_000_000 / 5
        return seeds;
    }

    function run() external {
        vm.startBroadcast();

        // ⚠️ BEFORE DEPLOYING: Read nextJobId from the live contract:
        //   cast call <OLD_CONTRACT> "nextJobId()(uint256)" --rpc-url https://mainnet.base.org
        // Pass that value as _startJobId below so the new contract continues the sequence.
        // This prevents new jobs from colliding with existing GitHub repos (leftclaw-service-job-N).
        uint256 currentNextJobId = 35; // ← UPDATE THIS before every redeploy

        LeftClawServicesV2 services = new LeftClawServicesV2(
            CLAWD, USDC, UNISWAP_ROUTER, WETH, TREASURY, currentNextJobId
        );
        console.log("LeftClawServicesV2 deployed at:", address(services));

        // Seed service types
        SeedService[] memory seeds = _getSeedServices();
        for (uint256 i = 0; i < seeds.length; i++) {
            services.addServiceType(seeds[i].name, seeds[i].slug, seeds[i].priceUsd, seeds[i].cvDivisor);
            console.log("Added service:", seeds[i].name);
        }

        // Add workers
        services.addWorker(LEFTCLAW);
        services.addWorker(RIGHTCLAW);
        services.addWorker(CLAWDHEART);
        services.addWorker(CLAWDGUT);
        services.addWorker(NEW_WORKER);
        services.addWorker(SANITIZER);

        // Note: do NOT add msg.sender as a worker here.
        // DeployScript.sol uses `new DeployLeftClawServicesV2()` which creates an
        // intermediate contract. That contract's address becomes msg.sender —
        // adding it as a worker registers a useless address with no private key.
        // Workers must be added manually by the owner after deployment.

        // Transfer ownership
        services.transferOwnership(OWNER);
        console.log("Ownership transferred to:", OWNER);

        vm.stopBroadcast();
    }
}
