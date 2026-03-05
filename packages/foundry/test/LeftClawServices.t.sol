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
        services.addWorker(executor);

        // Deal CLAWD to client (use deal cheat to set balance)
        deal(CLAWD, client, 100_000_000e18);
    }

    // ─── Test 1: Post Job with CLAWD ──────────────────────────────────────────

    function test_PostJobWithClawd() public {
        uint256 price = services.servicePriceInClawd(LeftClawServices.ServiceType.CONSULT_S);
        assertEq(price, 260_000e18);

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
        assertEq(job.worker, executor);
        assertTrue(job.startedAt > 0);
    }

    function test_AcceptJob_NonExecutorReverts() public {
        _postJob(LeftClawServices.ServiceType.CONSULT_S);

        vm.prank(nonExecutor);
        vm.expectRevert("Not a worker");
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
        // Post, complete, and claim two jobs — fees accumulate at claimPayment, not completeJob
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S);
        vm.prank(executor);
        services.completeJob(1, "QmResult1");

        _postJob(LeftClawServices.ServiceType.CONSULT_L);
        vm.prank(executor);
        services.acceptJob(2);
        vm.prank(executor);
        services.completeJob(2, "QmResult2");

        // fees not yet accumulated — claimPayment hasn't run
        assertEq(services.accumulatedFees(), 0);

        // warp past dispute window and claim both
        vm.warp(block.timestamp + 8 days);
        vm.prank(executor);
        services.claimPayment(1);
        vm.prank(executor);
        services.claimPayment(2);

        // now fees are in
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
        assertFalse(services.isWorker(newExec));

        services.addWorker(newExec);
        assertTrue(services.isWorker(newExec));

        services.removeWorker(newExec);
        assertFalse(services.isWorker(newExec));
    }

    // ─── Test 15: Protocol Fee Cap ──────────────────────────────────────────

    function test_SetProtocolFee_MaxCap() public {
        services.setProtocolFee(1000); // 10% max
        assertEq(services.protocolFeeBps(), 1000);

        vm.expectRevert("Fee too high");
        services.setProtocolFee(1001);
    }

    // ─── Test 16 (FIX HIGH): withdrawStuckTokens cannot drain active job escrow ─

    function test_WithdrawStuckTokens_CannotDrainLockedClawd() public {
        _postJob(LeftClawServices.ServiceType.CONSULT_S);

        // All CLAWD is locked for the job — should revert
        vm.expectRevert("No surplus CLAWD to withdraw");
        services.withdrawStuckTokens(address(CLAWD), address(this));
    }

    function test_WithdrawStuckTokens_AllowsSurplusClawd() public {
        // Airdrop 1000 extra CLAWD directly into the contract
        deal(CLAWD, address(services), 1000e18);

        // Also post a job
        _postJob(LeftClawServices.ServiceType.CONSULT_S);

        // Surplus = balance - locked - fees = (1000e18 + jobPrice) - jobPrice - 0 = 1000e18
        uint256 balBefore = IERC20(CLAWD).balanceOf(address(this));
        services.withdrawStuckTokens(address(CLAWD), address(this));
        uint256 balAfter = IERC20(CLAWD).balanceOf(address(this));
        assertEq(balAfter - balBefore, 1000e18);
    }

    // ─── Test 17 (FIX MEDIUM): fee is snapshotted at completeJob, immune to bps change ─

    function test_FeeSnapshot_ImmuneToProtocolFeeChange() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S);

        vm.prank(executor);
        services.completeJob(1, "QmResultCID");

        // Owner doubles the fee after completion
        services.setProtocolFee(1000); // 10%

        vm.warp(block.timestamp + 8 days);

        uint256 price = services.servicePriceInClawd(LeftClawServices.ServiceType.CONSULT_S);
        uint256 feeAt5pct = (price * 500) / 10_000;
        uint256 expectedPayout = price - feeAt5pct; // 5% was locked, not 10%

        uint256 balBefore = IERC20(CLAWD).balanceOf(executor);
        vm.prank(executor);
        services.claimPayment(1);
        uint256 balAfter = IERC20(CLAWD).balanceOf(executor);

        assertEq(balAfter - balBefore, expectedPayout);

        LeftClawServices.Job memory job = services.getJob(1);
        assertEq(job.feeSnapshot, feeAt5pct);
    }

    // ─── Test 18 (FIX WALKAWAY): executor can claim disputed job after timeout ─

    function test_WalkawayTest_ExecutorClaimsAfterDisputeTimeout() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S);

        vm.prank(executor);
        services.completeJob(1, "QmResultCID");

        // Client disputes
        vm.prank(client);
        services.disputeJob(1);

        LeftClawServices.Job memory job = services.getJob(1);
        assertTrue(job.disputedAt > 0);

        // Owner walks away — never calls resolveDispute
        // Executor tries to claim before timeout — should revert
        vm.warp(block.timestamp + 29 days);
        vm.prank(executor);
        vm.expectRevert("Dispute timeout not reached");
        services.claimPayment(1);

        // After DISPUTE_TIMEOUT (30 days), executor can claim regardless of owner
        vm.warp(block.timestamp + 2 days); // 31 days total from disputedAt
        uint256 price = services.servicePriceInClawd(LeftClawServices.ServiceType.CONSULT_S);
        uint256 fee = (price * 500) / 10_000;
        uint256 expectedPayout = price - fee;

        uint256 balBefore = IERC20(CLAWD).balanceOf(executor);
        vm.prank(executor);
        services.claimPayment(1);
        uint256 balAfter = IERC20(CLAWD).balanceOf(executor);

        assertEq(balAfter - balBefore, expectedPayout);
    }

    function test_WalkawayTest_NoFundsLockedForever() public {
        // Verify: after dispute timeout, totalLockedClawd is correctly released
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S);
        vm.prank(executor);
        services.completeJob(1, "QmResultCID");
        vm.prank(client);
        services.disputeJob(1);

        uint256 price = services.servicePriceInClawd(LeftClawServices.ServiceType.CONSULT_S);
        assertEq(services.totalLockedClawd(), price);

        vm.warp(block.timestamp + 31 days);
        vm.prank(executor);
        services.claimPayment(1);

        // All funds released — nothing locked
        assertEq(services.totalLockedClawd(), 0);
    }

    // ─── H-1: postJobWithUsdc enforces service price ─────────────────────────

    function test_PostJobWithUsdc_MinClawdOutBelowPricReverts() public {
        uint256 price = services.servicePriceInClawd(LeftClawServices.ServiceType.CONSULT_S);
        deal(USDC, client, 1_000e6); // $1000 USDC
        vm.startPrank(client);
        IERC20(USDC).approve(address(services), 1_000e6);
        // minClawdOut < service price → revert
        vm.expectRevert("minClawdOut must cover service price");
        services.postJobWithUsdc(
            LeftClawServices.ServiceType.CONSULT_S,
            "QmDescCID",
            1_000e6,
            price - 1
        );
        vm.stopPrank();
    }

    function test_PostJobWithUsdc_CustomZeroMinReverts() public {
        deal(USDC, client, 100e6);
        vm.startPrank(client);
        IERC20(USDC).approve(address(services), 100e6);
        vm.expectRevert("Min 1 CLAWD");
        services.postJobWithUsdc(
            LeftClawServices.ServiceType.CUSTOM,
            "QmDescCID",
            100e6,
            0
        );
        vm.stopPrank();
    }

    function test_PostJobWithUsdc_RealSwap() public {
        uint256 price = services.servicePriceInClawd(LeftClawServices.ServiceType.CONSULT_S);
        deal(USDC, client, 500e6); // $500 USDC — more than enough for CONSULT_S
        vm.startPrank(client);
        IERC20(USDC).approve(address(services), 500e6);
        // minClawdOut = service price (we're sending plenty of USDC)
        services.postJobWithUsdc(
            LeftClawServices.ServiceType.CONSULT_S,
            "QmDescCID",
            500e6,
            price
        );
        vm.stopPrank();
        LeftClawServices.Job memory job = services.getJob(1);
        assertEq(uint256(job.serviceType), uint256(LeftClawServices.ServiceType.CONSULT_S));
        assertGe(job.paymentClawd, price, "CLAWD received should cover service price");
    }

    // ─── L-1: setSwapPath ─────────────────────────────────────────────────────

    function test_SetSwapPath_OwnerCanUpdate() public {
        bytes memory newPath = abi.encodePacked(
            USDC, uint24(100), WETH, uint24(3000), CLAWD
        );
        services.setSwapPath(newPath);
        assertEq(services.swapPath(), newPath);
    }

    function test_SetSwapPath_NonOwnerReverts() public {
        bytes memory newPath = abi.encodePacked(USDC, uint24(100), WETH, uint24(3000), CLAWD);
        vm.prank(client);
        vm.expectRevert();
        services.setSwapPath(newPath);
    }

    // ─── L-3: DisputeResolved event on timeout claim ──────────────────────────

    function test_DisputeResolvedEmitted_OnTimeoutClaim() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S);
        vm.prank(executor);
        services.completeJob(1, "QmResultCID");
        vm.prank(client);
        services.disputeJob(1);

        vm.warp(block.timestamp + 31 days);

        vm.expectEmit(true, false, false, true);
        emit LeftClawServices.DisputeResolved(1, false);

        vm.prank(executor);
        services.claimPayment(1);
    }

    // ─── burnConsultation Tests ──────────────────────────────────────────────

    function test_BurnConsultation_HappyPath() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S);
        uint256 price = services.servicePriceInClawd(LeftClawServices.ServiceType.CONSULT_S);
        uint256 deadBefore = IERC20(CLAWD).balanceOf(address(0xdEaD));

        vm.prank(executor);
        services.burnConsultation(1, "https://gist.github.com/test/123", LeftClawServices.ServiceType.BUILD_S);

        LeftClawServices.Job memory job = services.getJob(1);
        assertEq(uint8(job.status), uint8(LeftClawServices.JobStatus.COMPLETED));
        assertTrue(job.paymentClaimed);
        assertEq(job.resultCID, "https://gist.github.com/test/123");
        assertEq(services.totalLockedClawd(), 0);

        uint256 deadAfter = IERC20(CLAWD).balanceOf(address(0xdEaD));
        assertEq(deadAfter - deadBefore, price);
    }

    function test_BurnConsultation_RevertNonConsultation() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.BUILD_S);
        uint256 jobId = services.nextJobId() - 1;

        vm.prank(executor);
        vm.expectRevert("Not a consultation job");
        services.burnConsultation(jobId, "https://gist.github.com/test/123", LeftClawServices.ServiceType.BUILD_S);
    }

    function test_BurnConsultation_RevertNonExecutor() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S);

        vm.prank(nonExecutor);
        vm.expectRevert("Not a worker");
        services.burnConsultation(1, "https://gist.github.com/test/123", LeftClawServices.ServiceType.BUILD_S);
    }

    function test_BurnConsultation_RevertEmptyGist() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S);

        vm.prank(executor);
        vm.expectRevert("Gist URL required");
        services.burnConsultation(1, "", LeftClawServices.ServiceType.BUILD_S);
    }

    function test_BurnConsultation_RevertDoubleClaim() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S);

        vm.prank(executor);
        services.burnConsultation(1, "https://gist.github.com/test/123", LeftClawServices.ServiceType.BUILD_S);

        vm.prank(executor);
        vm.expectRevert("Job not IN_PROGRESS");
        services.burnConsultation(1, "https://gist.github.com/test/456", LeftClawServices.ServiceType.BUILD_M);
    }

    // ─── rejectJob Tests ──────────────────────────────────────────────────

    function test_RejectJob_ExecutorCanRejectOpenJob() public {
        _postJob(LeftClawServices.ServiceType.CONSULT_S);
        uint256 price = services.servicePriceInClawd(LeftClawServices.ServiceType.CONSULT_S);
        uint256 balBefore = IERC20(CLAWD).balanceOf(client);

        vm.prank(executor);
        services.rejectJob(1);

        uint256 balAfter = IERC20(CLAWD).balanceOf(client);
        assertEq(balAfter - balBefore, price);

        LeftClawServices.Job memory job = services.getJob(1);
        assertEq(uint8(job.status), uint8(LeftClawServices.JobStatus.CANCELLED));
        assertEq(services.totalLockedClawd(), 0);
    }

    function test_RejectJob_NonExecutorReverts() public {
        _postJob(LeftClawServices.ServiceType.CONSULT_S);

        vm.prank(nonExecutor);
        vm.expectRevert("Not a worker");
        services.rejectJob(1);
    }

    function test_RejectJob_CannotRejectAcceptedJob() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S);

        vm.prank(executor);
        vm.expectRevert("Can only reject OPEN jobs");
        services.rejectJob(1);
    }

    function test_RejectJob_CannotRejectNonExistentJob() public {
        vm.prank(executor);
        vm.expectRevert("Job does not exist");
        services.rejectJob(999);
    }

    // ─── Work Log Tests ──────────────────────────────────────────────────────

    function test_LogWork_Success() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.BUILD_S);
        uint256 jobId = services.nextJobId() - 1;

        vm.prank(executor);
        services.logWork(jobId, "Setting up Scaffold-ETH 2 and deploying contracts to Base Sepolia");

        LeftClawServices.WorkLog[] memory logs = services.getWorkLogs(jobId);
        assertEq(logs.length, 1);
        assertEq(logs[0].note, "Setting up Scaffold-ETH 2 and deploying contracts to Base Sepolia");
        assertEq(logs[0].timestamp, block.timestamp);
    }

    function test_LogWork_RevertsIfNotInProgress() public {
        _postJob(LeftClawServices.ServiceType.BUILD_S);
        uint256 jobId = services.nextJobId() - 1;

        vm.prank(executor);
        vm.expectRevert("Job not IN_PROGRESS");
        services.logWork(jobId, "This should fail");
    }

    function test_LogWork_RevertsIfNotExecutor() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.BUILD_S);
        uint256 jobId = services.nextJobId() - 1;

        vm.prank(nonExecutor);
        vm.expectRevert("Not a worker");
        services.logWork(jobId, "This should fail");
    }

    function test_LogWork_RevertsIfNotAssignedExecutor() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.BUILD_S);
        uint256 jobId = services.nextJobId() - 1;

        address otherExecutor = makeAddr("otherExecutor");
        services.addWorker(otherExecutor);

        vm.prank(otherExecutor);
        vm.expectRevert("Not the assigned worker");
        services.logWork(jobId, "This should fail");
    }

    function test_LogWork_RevertsIfNoteTooLong() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.BUILD_S);
        uint256 jobId = services.nextJobId() - 1;

        // Build a 501-char string
        string memory longNote = new string(501);
        bytes memory b = bytes(longNote);
        for (uint i = 0; i < 501; i++) b[i] = "a";
        longNote = string(b);

        vm.prank(executor);
        vm.expectRevert("Note too long (max 500 chars)");
        services.logWork(jobId, longNote);
    }

    function test_LogWork_MultipleEntries() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.BUILD_S);
        uint256 jobId = services.nextJobId() - 1;

        vm.startPrank(executor);
        services.logWork(jobId, "Started: reviewing spec and setting up repo");
        vm.warp(block.timestamp + 1 hours);
        services.logWork(jobId, "Contracts deployed to Base Sepolia, tests passing");
        vm.warp(block.timestamp + 2 hours);
        services.logWork(jobId, "Frontend complete, IPFS build uploading");
        vm.stopPrank();

        LeftClawServices.WorkLog[] memory logs = services.getWorkLogs(jobId);
        assertEq(logs.length, 3);
        assertEq(logs[0].note, "Started: reviewing spec and setting up repo");
        assertEq(logs[1].note, "Contracts deployed to Base Sepolia, tests passing");
        assertEq(logs[2].note, "Frontend complete, IPFS build uploading");
        assertTrue(logs[1].timestamp > logs[0].timestamp);
        assertTrue(logs[2].timestamp > logs[1].timestamp);
    }

    function test_LogWork_EmptyNoteReverts() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.BUILD_S);
        uint256 jobId = services.nextJobId() - 1;

        vm.prank(executor);
        vm.expectRevert("Note required");
        services.logWork(jobId, "");
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
