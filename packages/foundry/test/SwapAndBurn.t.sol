// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/SwapAndBurn.sol";

contract SwapAndBurnTest is Test {
    SwapAndBurn public swapAndBurn;

    IERC20 constant CLAWD = IERC20(0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07);
    IERC20 constant USDC  = IERC20(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
    address constant DEAD  = 0x000000000000000000000000000000000000dEaD;
    address constant USDC_WHALE = 0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A;

    function setUp() public {
        swapAndBurn = new SwapAndBurn();
    }

    function test_usdc_swap_and_burn() public {
        uint256 deadBefore = CLAWD.balanceOf(DEAD);

        // Send 1 USDC to contract
        vm.prank(USDC_WHALE);
        USDC.transfer(address(swapAndBurn), 1e6);

        swapAndBurn.execute();

        uint256 deadAfter = CLAWD.balanceOf(DEAD);
        assertGt(deadAfter, deadBefore, "CLAWD burned should increase");
    }

    function test_eth_swap_and_burn() public {
        uint256 deadBefore = CLAWD.balanceOf(DEAD);

        // Send 0.001 ETH
        (bool ok,) = address(swapAndBurn).call{value: 0.001 ether}("");
        require(ok);

        swapAndBurn.execute();

        uint256 deadAfter = CLAWD.balanceOf(DEAD);
        assertGt(deadAfter, deadBefore, "CLAWD burned should increase");
    }

    function test_both_usdc_and_eth() public {
        uint256 deadBefore = CLAWD.balanceOf(DEAD);

        vm.prank(USDC_WHALE);
        USDC.transfer(address(swapAndBurn), 1e6);
        (bool ok,) = address(swapAndBurn).call{value: 0.001 ether}("");
        require(ok);

        swapAndBurn.execute();

        uint256 deadAfter = CLAWD.balanceOf(DEAD);
        assertGt(deadAfter, deadBefore, "CLAWD burned should increase");
    }

    function test_zero_balances_no_revert() public {
        // Should not revert with zero balances
        swapAndBurn.execute();
    }

    function test_direct_clawd_burn() public {
        // If CLAWD is sent directly to the contract, execute() should burn it to dead
        uint256 deadBefore = CLAWD.balanceOf(DEAD);
        // Deal CLAWD directly to contract (fork cheat)
        deal(address(CLAWD), address(swapAndBurn), 1_000_000 ether);
        swapAndBurn.execute();
        assertEq(CLAWD.balanceOf(address(swapAndBurn)), 0, "Contract should hold no CLAWD");
        assertGt(CLAWD.balanceOf(DEAD), deadBefore, "Dead address CLAWD should increase");
    }
}
