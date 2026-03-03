// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/LeftClawServices.sol";

contract LeftClawServicesTest is Test {
    LeftClawServices public services;

    // Base mainnet addresses
    address constant CLAWD = 0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant UNISWAP_ROUTER = 0x2626664c2603336E57B271c5C0b26F421741e481;
    address constant WETH = 0x4200000000000000000000000000000000000006;

    address owner;
    address executor;
    address client;
    address nonExecutor;

    function setUp() public {
        owner = address(this);
        executor = makeAddr("executor");
        client = makeAddr("client");
        nonExecutor = makeAddr("nonExecutor");

        services = new LeftClawServices(CLAWD, USDC, UNISWAP_ROUTER, WETH);

        // Add executor
        services.addExecutor(executor);

        // Deal CLAWD to client (use deal cheat to set balance)
        deal(CLAWD, client, 100_000_000e18);
    }

    // ─── Test 1: Post Job with CLAWD ──────────────────────────────────────────

    function test_PostJobWithClawd() public {
        uint256 price = services.servicePriceInClawd(LeftClawServices.ServiceType.CONSULT_S);
        assertEq(price, 66_666e18);

        vm.startPrank(client);
        IERC20(CLAWD).approve(address(services), price);
        services.postJob(LeftClawServices.ServiceType.CONSULT_S, "QmTestCID123");
        vm.stopPrank();

        LeftClawServices.Job memory job = services.getJob(1);
        assertEq(job.id, 1);
        assertEq(job.client, client);
        assertEq(uint8(job.serviceType), uint8(LeftClawServices.ServiceType.CONSULT_S));
        assertEq(job.paymentClawd, price);
        assertEq(uint8(job.status), uint8(LeftClawServices.JobStatus.OPEN));
        assertEq(job.descriptionCID, "QmTestCID123");
        assertEq(services.getTotalJobs(), 1);
    }

    // ─── Test 2: Accept Job ──────────────────────────────────────────────────

    function test_AcceptJob() public {
        _postJob(LeftClawServices.ServiceType.CONSULT_S);

        vm.prank(executor);
        services.acceptJob(1);

        LeftClawServices.Job memory job = services.getJob(1);
        assertEq(uint8(job.status), uint8(LeftClawServices.JobStatus.IN_PROGRESS));
        assertEq(job.executor, executor);
        assertTrue(job.startedAt > 0);
    }

    function test_AcceptJob_NonExecutorReverts() public {
        _postJob(LeftClawServices.ServiceType.CONSULT_S);

        vm.prank(nonExecutor);
        vm.expectRevert("Not an executor");
        services.acceptJob(1);
    }

    // ─── Test 3: Complete Job and Claim After Window ─────────────────────────

    function test_CompleteJob_And_ClaimAfterWindow() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S);

        vm.prank(executor);
        services.completeJob(1, "QmResultCID");

        LeftClawServices.Job memory job = services.getJob(1);
        assertEq(uint8(job.status), uint8(LeftClawServices.JobStatus.COMPLETED));
        assertEq(job.resultCID, "QmResultCID");

        // Warp past dispute window
        vm.warp(block.timestamp + 8 days);

        uint256 balBefore = IERC20(CLAWD).balanceOf(executor);
        vm.prank(executor);
        services.claimPayment(1);
        uint256 balAfter = IERC20(CLAWD).balanceOf(executor);

        uint256 fee = (job.paymentClawd * 500) / 10_000; // 5%
        uint256 expectedPayout = job.paymentClawd - fee;
        assertEq(balAfter - balBefore, expectedPayout);
    }

    // ─── Test 4: Cannot Claim During Dispute Window ─────────────────────────

    function test_CompleteJob_CannotClaimDuringDisputeWindow() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S);

        vm.prank(executor);
        services.completeJob(1, "QmResultCID");

        // Try to claim within 7 days
        vm.warp(block.timestamp + 3 days);

        vm.prank(executor);
        vm.expectRevert("Dispute window active");
        services.claimPayment(1);
    }

    // ─── Test 5: Dispute and Refund ─────────────────────────────────────────

    function test_DisputeAndRefund() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S);

        vm.prank(executor);
        services.completeJob(1, "QmResultCID");

        // Client disputes
        vm.prank(client);
        services.disputeJob(1);

        LeftClawServices.Job memory job = services.getJob(1);
        assertEq(uint8(job.status), uint8(LeftClawServices.JobStatus.DISPUTED));

        // Owner resolves: refund client
        uint256 balBefore = IERC20(CLAWD).balanceOf(client);
        services.resolveDispute(1, true);
        uint256 balAfter = IERC20(CLAWD).balanceOf(client);

        assertEq(balAfter - balBefore, job.paymentClawd);
    }

    // ─── Test 6: Dispute and Release to Executor ────────────────────────────

    function test_DisputeAndReleaseToExecutor() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S);

        vm.prank(executor);
        services.completeJob(1, "QmResultCID");

        vm.prank(client);
        services.disputeJob(1);

        // Owner resolves: executor wins
        uint256 balBefore = IERC20(CLAWD).balanceOf(executor);
        services.resolveDispute(1, false);
        uint256 balAfter = IERC20(CLAWD).balanceOf(executor);

        LeftClawServices.Job memory job = services.getJob(1);
        uint256 fee = (job.paymentClawd * 500) / 10_000;
        assertEq(balAfter - balBefore, job.paymentClawd - fee);
    }

    // ─── Test 7: Cancel Open Job ────────────────────────────────────────────

    function test_CancelOpenJob() public {
        _postJob(LeftClawServices.ServiceType.CONSULT_S);

        uint256 balBefore = IERC20(CLAWD).balanceOf(client);

        vm.prank(client);
        services.cancelJob(1);

        uint256 balAfter = IERC20(CLAWD).balanceOf(client);
        uint256 price = services.servicePriceInClawd(LeftClawServices.ServiceType.CONSULT_S);
        assertEq(balAfter - balBefore, price);

        LeftClawServices.Job memory job = services.getJob(1);
        assertEq(uint8(job.status), uint8(LeftClawServices.JobStatus.CANCELLED));
    }

    // ─── Test 8: Cannot Cancel In Progress ──────────────────────────────────

    function test_CannotCancelInProgress() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S);

        vm.prank(client);
        vm.expectRevert("Can only cancel OPEN jobs");
        services.cancelJob(1);
    }

    // ─── Test 9: Custom Job ─────────────────────────────────────────────────

    function test_CustomJob() public {
        uint256 amount = 500_000e18;

        vm.startPrank(client);
        IERC20(CLAWD).approve(address(services), amount);
        services.postJobCustom(amount, "QmCustomJobCID");
        vm.stopPrank();

        LeftClawServices.Job memory job = services.getJob(1);
        assertEq(job.paymentClawd, amount);
        assertEq(uint8(job.serviceType), uint8(LeftClawServices.ServiceType.CUSTOM));
    }

    // ─── Test 10: Update Price Only Owner ───────────────────────────────────

    function test_UpdatePrice_OnlyOwner() public {
        services.updatePrice(LeftClawServices.ServiceType.CONSULT_S, 100_000e18);
        assertEq(services.servicePriceInClawd(LeftClawServices.ServiceType.CONSULT_S), 100_000e18);

        vm.prank(nonExecutor);
        vm.expectRevert();
        services.updatePrice(LeftClawServices.ServiceType.CONSULT_S, 200_000e18);
    }

    // ─── Test 11: Fuzz Custom Job ───────────────────────────────────────────

    function test_Fuzz_PostCustomJob(uint256 amount) public {
        amount = bound(amount, 1e18, 1_000_000_000e18);

        deal(CLAWD, client, amount);

        vm.startPrank(client);
        IERC20(CLAWD).approve(address(services), amount);
        services.postJobCustom(amount, "QmFuzzCID");
        vm.stopPrank();

        LeftClawServices.Job memory job = services.getJob(1);
        assertEq(job.paymentClawd, amount);
    }

    // ─── Test 12: Withdraw Fees ─────────────────────────────────────────────

    function test_WithdrawFees() public {
        // Post and complete two jobs
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S);
        vm.prank(executor);
        services.completeJob(1, "QmResult1");

        _postJob(LeftClawServices.ServiceType.CONSULT_L);
        vm.prank(executor);
        services.acceptJob(2);
        vm.prank(executor);
        services.completeJob(2, "QmResult2");

        // Check accumulated fees
        uint256 price1 = services.servicePriceInClawd(LeftClawServices.ServiceType.CONSULT_S);
        uint256 price2 = services.servicePriceInClawd(LeftClawServices.ServiceType.CONSULT_L);
        uint256 expectedFees = (price1 * 500) / 10_000 + (price2 * 500) / 10_000;
        assertEq(services.accumulatedFees(), expectedFees);

        // Withdraw
        address treasury = makeAddr("treasury");
        services.withdrawProtocolFees(treasury);
        assertEq(IERC20(CLAWD).balanceOf(treasury), expectedFees);
        assertEq(services.accumulatedFees(), 0);
    }

    // ─── Test 13: View Functions ────────────────────────────────────────────

    function test_GetOpenJobs() public {
        _postJob(LeftClawServices.ServiceType.CONSULT_S);
        _postJob(LeftClawServices.ServiceType.BUILD_S);

        uint256[] memory openJobs = services.getOpenJobs();
        assertEq(openJobs.length, 2);
        assertEq(openJobs[0], 1);
        assertEq(openJobs[1], 2);
    }

    function test_GetJobsByClient() public {
        _postJob(LeftClawServices.ServiceType.CONSULT_S);
        _postJob(LeftClawServices.ServiceType.BUILD_S);

        uint256[] memory clientJobs = services.getJobsByClient(client);
        assertEq(clientJobs.length, 2);
    }

    // ─── Test 14: Executor Management ───────────────────────────────────────

    function test_AddRemoveExecutor() public {
        address newExec = makeAddr("newExec");
        assertFalse(services.isExecutor(newExec));

        services.addExecutor(newExec);
        assertTrue(services.isExecutor(newExec));

        services.removeExecutor(newExec);
        assertFalse(services.isExecutor(newExec));
    }

    // ─── Test 15: Protocol Fee Cap ──────────────────────────────────────────

    function test_SetProtocolFee_MaxCap() public {
        services.setProtocolFee(1000); // 10% max
        assertEq(services.protocolFeeBps(), 1000);

        vm.expectRevert("Fee too high");
        services.setProtocolFee(1001);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    function _postJob(LeftClawServices.ServiceType serviceType) internal {
        uint256 price = services.servicePriceInClawd(serviceType);
        vm.startPrank(client);
        IERC20(CLAWD).approve(address(services), price);
        services.postJob(serviceType, "QmDescCID");
        vm.stopPrank();
    }

    function _postAndAcceptJob(LeftClawServices.ServiceType serviceType) internal {
        _postJob(serviceType);
        uint256 jobId = services.nextJobId() - 1;
        vm.prank(executor);
        services.acceptJob(jobId);
    }
}
