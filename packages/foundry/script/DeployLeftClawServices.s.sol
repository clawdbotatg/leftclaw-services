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

    function run() external {
        vm.startBroadcast();
        LeftClawServices services = new LeftClawServices(CLAWD, USDC, UNISWAP_ROUTER, WETH);
        console.log("LeftClawServices deployed at:", address(services));
        vm.stopBroadcast();
    }
}
