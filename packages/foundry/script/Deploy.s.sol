// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DeployHelpers.s.sol";
import { DeployLeftClawServices } from "./DeployLeftClawServices.s.sol";

contract DeployScript is ScaffoldETHDeploy {
    function run() external {
        DeployLeftClawServices deploy = new DeployLeftClawServices();
        deploy.run();
    }
}
