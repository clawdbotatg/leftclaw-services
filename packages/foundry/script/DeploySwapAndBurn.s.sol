// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/SwapAndBurn.sol";

contract DeploySwapAndBurn is Script {
    function run() external returns (SwapAndBurn) {
        vm.startBroadcast();
        SwapAndBurn swapAndBurn = new SwapAndBurn();
        vm.stopBroadcast();

        console.log("SwapAndBurn deployed at:", address(swapAndBurn));
        return swapAndBurn;
    }
}
