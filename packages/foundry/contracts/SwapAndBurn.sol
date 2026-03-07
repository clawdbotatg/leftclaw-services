// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IWETH {
    function deposit() external payable;
}

interface IENSReverseRegistrar {
    function setName(string calldata name) external returns (bytes32);
}

interface IV3SwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut);

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    function exactInput(ExactInputParams calldata params) external returns (uint256 amountOut);
}

/// @title SwapAndBurn
/// @notice Receives USDC or ETH, swaps to CLAWD via Uniswap V3, burns to dead address.
///         Fully permissionless — anyone can call execute() to trigger the swap+burn.
contract SwapAndBurn {
    using SafeERC20 for IERC20;

    IERC20        public constant CLAWD  = IERC20(0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07);
    IERC20        public constant USDC   = IERC20(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
    IERC20        public constant WETH   = IERC20(0x4200000000000000000000000000000000000006);
    IV3SwapRouter public constant ROUTER = IV3SwapRouter(0x2626664c2603336E57B271c5C0b26F421741e481);
    address       public constant DEAD   = 0x000000000000000000000000000000000000dEaD;

    uint24 public constant FEE_USDC_WETH  = 500;    // 0.05% — USDC/WETH pool on Base
    uint24 public constant FEE_WETH_CLAWD = 10000;  // 1%    — WETH/CLAWD pool on Base

    // ENS reverse registrar (Ethereum mainnet)
    IENSReverseRegistrar public constant ENS_REVERSE = IENSReverseRegistrar(0xa58E81fe9b61B5c3fE2AFD33CF304c454AbFc7Cb);
    string public constant ENS_NAME = "pay.clawdbotatg.eth";

    event Burned(uint256 clawdAmount);

    /// @notice Swap all held ETH and USDC to CLAWD and send to dead address. Permissionless.
    function execute() external {
        uint256 totalClawd = 0;

        // ── ETH → WETH → CLAWD ───────────────────────────────────────────
        uint256 ethBal = address(this).balance;
        if (ethBal > 0) {
            IWETH(address(WETH)).deposit{value: ethBal}();
            WETH.forceApprove(address(ROUTER), ethBal);
            totalClawd += ROUTER.exactInputSingle(
                IV3SwapRouter.ExactInputSingleParams({
                    tokenIn:           address(WETH),
                    tokenOut:          address(CLAWD),
                    fee:               FEE_WETH_CLAWD,
                    recipient:         DEAD,
                    amountIn:          ethBal,
                    amountOutMinimum:  0,
                    sqrtPriceLimitX96: 0
                })
            );
        }

        // ── USDC → WETH → CLAWD (multihop) ───────────────────────────────
        uint256 usdcBal = USDC.balanceOf(address(this));
        if (usdcBal > 0) {
            USDC.forceApprove(address(ROUTER), usdcBal);
            bytes memory path = abi.encodePacked(
                address(USDC),
                FEE_USDC_WETH,
                address(WETH),
                FEE_WETH_CLAWD,
                address(CLAWD)
            );
            totalClawd += ROUTER.exactInput(
                IV3SwapRouter.ExactInputParams({
                    path:             path,
                    recipient:        DEAD,
                    amountIn:         usdcBal,
                    amountOutMinimum: 0
                })
            );
        }

        // ── Burn any CLAWD held directly ─────────────────────────────────
        uint256 clawdBal = CLAWD.balanceOf(address(this));
        if (clawdBal > 0) {
            CLAWD.safeTransfer(DEAD, clawdBal);
            totalClawd += clawdBal;
        }

        if (totalClawd > 0) emit Burned(totalClawd);
    }

    /// @notice Set ENS reverse record to pay.clawdbotatg.eth. Permissionless — name is hardcoded.
    function setENSName() external {
        ENS_REVERSE.setName(ENS_NAME);
    }

    /// @notice Accept ETH directly
    receive() external payable {}
}
