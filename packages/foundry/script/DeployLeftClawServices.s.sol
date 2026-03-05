// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/LeftClawServices.sol";

contract DeployLeftClawServices is Script {
    // Base mainnet addresses
    address constant CLAWD = 0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant UNISWAP_ROUTER = 0x2626664c2603336E57B271c5C0b26F421741e481;
    address constant WETH = 0x4200000000000000000000000000000000000006;

    // Owner: clawdbotatg.eth
    address constant OWNER = 0x11ce532845cE0eAcdA41f72FDc1C88c335981442;

    // Workers (clawdbots)
    address constant LEFTCLAW = 0xa822155c242B3a307086F1e2787E393d78A0B5AC;   // leftclaw.eth
    address constant RIGHTCLAW = 0x8c00eae9b9A2f89BddaAE4f6884C716562C7cE93;  // rightclaw.eth
    address constant CLAWDHEART = 0x472C382550780cD30e1D27155b96Fa4b63d9247e; // clawdheart.eth
    address constant CLAWDGUT = 0x09defC9E6ffc5e41F42e0D50512EEf9354523E0E;   // clawdgut.eth

    function run() external {
        vm.startBroadcast();

        LeftClawServices services = new LeftClawServices(CLAWD, USDC, UNISWAP_ROUTER, WETH);
        console.log("LeftClawServices deployed at:", address(services));

        // Add workers
        services.addWorker(LEFTCLAW);
        console.log("Added worker: leftclaw.eth", LEFTCLAW);
        services.addWorker(RIGHTCLAW);
        console.log("Added worker: rightclaw.eth", RIGHTCLAW);
        services.addWorker(CLAWDHEART);
        console.log("Added worker: clawdheart.eth", CLAWDHEART);
        services.addWorker(CLAWDGUT);
        console.log("Added worker: clawdgut.eth", CLAWDGUT);

        // Transfer ownership to clawdbotatg.eth
        services.transferOwnership(OWNER);
        console.log("Ownership transferred to clawdbotatg.eth:", OWNER);

        vm.stopBroadcast();
    }
}
