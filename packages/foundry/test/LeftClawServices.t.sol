// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/LeftClawServices.sol";

contract LeftClawServicesTest is Test {
    LeftClawServices public services;

    address constant CLAWD = 0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant UNISWAP_ROUTER = 0x2626664c2603336E57B271c5C0b26F421741e481;
    address constant WETH = 0x4200000000000000000000000000000000000006;

    address owner;
    address worker;
    address client;
    address nonWorker;

    // Default CLAWD amount for tests (frontend would calculate this from USD price / CLAWD price)
    uint256 constant CONSULT_S_CLAWD = 260_000e18;
    uint256 constant CONSULT_L_CLAWD = 390_000e18;
    uint256 constant BUILD_CLAWD = 5_000_000e18;

    function setUp() public {
        owner = address(this);
        worker = makeAddr("worker");
        client = makeAddr("client");
        nonWorker = makeAddr("nonWorker");

        services = new LeftClawServices(CLAWD, USDC, UNISWAP_ROUTER, WETH);
        services.addWorker(worker);

        deal(CLAWD, client, 100_000_000e18);
    }

    // ─── USD Prices ──────────────────────────────────────────────────────────

    function test_PricesInUsd() public view {
        assertEq(services.servicePriceUsd(LeftClawServices.ServiceType.CONSULT_S), 20_000_000);   // $20
        assertEq(services.servicePriceUsd(LeftClawServices.ServiceType.CONSULT_L), 30_000_000);   // $30
        assertEq(services.servicePriceUsd(LeftClawServices.ServiceType.BUILD_DAILY), 1_000_000_000); // $1000
        assertEq(services.servicePriceUsd(LeftClawServices.ServiceType.QA_REPORT), 50_000_000);   // $50
        assertEq(services.servicePriceUsd(LeftClawServices.ServiceType.AUDIT_S), 200_000_000);    // $200
    }

    // ─── Post Job with CLAWD ─────────────────────────────────────────────────

    function test_PostJobWithClawd() public {
        vm.startPrank(client);
        IERC20(CLAWD).approve(address(services), CONSULT_S_CLAWD);
        services.postJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD, "QmTestCID123");
        vm.stopPrank();

        LeftClawServices.Job memory job = services.getJob(1);
        assertEq(job.id, 1);
        assertEq(job.client, client);
        assertEq(uint8(job.serviceType), uint8(LeftClawServices.ServiceType.CONSULT_S));
        assertEq(job.paymentClawd, CONSULT_S_CLAWD);
        assertEq(job.priceUsd, 20_000_000); // $20
        assertEq(uint8(job.status), uint8(LeftClawServices.JobStatus.OPEN));
    }

    // ─── Accept Job ──────────────────────────────────────────────────────────

    function test_AcceptJob() public {
        _postJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);

        vm.prank(worker);
        services.acceptJob(1);

        LeftClawServices.Job memory job = services.getJob(1);
        assertEq(uint8(job.status), uint8(LeftClawServices.JobStatus.IN_PROGRESS));
        assertEq(job.worker, worker);
    }

    function test_AcceptJob_NonWorkerReverts() public {
        _postJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);

        vm.prank(nonWorker);
        vm.expectRevert("Not a worker");
        services.acceptJob(1);
    }

    // ─── Complete Job and Claim ──────────────────────────────────────────────

    function test_CompleteJob_And_ClaimAfterWindow() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);

        vm.prank(worker);
        services.completeJob(1, "QmResultCID");

        vm.warp(block.timestamp + 8 days);

        uint256 balBefore = IERC20(CLAWD).balanceOf(worker);
        vm.prank(worker);
        services.claimPayment(1);
        uint256 balAfter = IERC20(CLAWD).balanceOf(worker);

        uint256 fee = (CONSULT_S_CLAWD * 500) / 10_000;
        assertEq(balAfter - balBefore, CONSULT_S_CLAWD - fee);
    }

    function test_CannotClaimDuringDisputeWindow() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);

        vm.prank(worker);
        services.completeJob(1, "QmResultCID");

        vm.warp(block.timestamp + 3 days);

        vm.prank(worker);
        vm.expectRevert("Dispute window active");
        services.claimPayment(1);
    }

    // ─── Dispute ─────────────────────────────────────────────────────────────

    function test_DisputeAndRefund() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);

        vm.prank(worker);
        services.completeJob(1, "QmResultCID");

        vm.prank(client);
        services.disputeJob(1);

        uint256 balBefore = IERC20(CLAWD).balanceOf(client);
        services.resolveDispute(1, true);
        uint256 balAfter = IERC20(CLAWD).balanceOf(client);
        assertEq(balAfter - balBefore, CONSULT_S_CLAWD);
    }

    function test_DisputeAndReleaseToWorker() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);

        vm.prank(worker);
        services.completeJob(1, "QmResultCID");

        vm.prank(client);
        services.disputeJob(1);

        uint256 balBefore = IERC20(CLAWD).balanceOf(worker);
        services.resolveDispute(1, false);
        uint256 balAfter = IERC20(CLAWD).balanceOf(worker);

        uint256 fee = (CONSULT_S_CLAWD * 500) / 10_000;
        assertEq(balAfter - balBefore, CONSULT_S_CLAWD - fee);
    }

    // ─── Cancel ──────────────────────────────────────────────────────────────

    function test_CancelOpenJob() public {
        _postJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);

        uint256 balBefore = IERC20(CLAWD).balanceOf(client);
        vm.prank(client);
        services.cancelJob(1);
        uint256 balAfter = IERC20(CLAWD).balanceOf(client);
        assertEq(balAfter - balBefore, CONSULT_S_CLAWD);
    }

    function test_CannotCancelInProgress() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);

        vm.prank(client);
        vm.expectRevert("Can only cancel OPEN jobs");
        services.cancelJob(1);
    }

    // ─── Custom Job ──────────────────────────────────────────────────────────

    function test_CustomJob() public {
        uint256 amount = 500_000e18;

        vm.startPrank(client);
        IERC20(CLAWD).approve(address(services), amount);
        services.postJobCustom(amount, 100_000_000, "QmCustomJobCID"); // $100 custom
        vm.stopPrank();

        LeftClawServices.Job memory job = services.getJob(1);
        assertEq(job.paymentClawd, amount);
        assertEq(job.priceUsd, 100_000_000);
        assertEq(uint8(job.serviceType), uint8(LeftClawServices.ServiceType.CUSTOM));
    }

    // ─── Update Price (Owner Only) ───────────────────────────────────────────

    function test_UpdatePrice_OnlyOwner() public {
        services.updatePrice(LeftClawServices.ServiceType.CONSULT_S, 25_000_000); // $25
        assertEq(services.servicePriceUsd(LeftClawServices.ServiceType.CONSULT_S), 25_000_000);

        vm.prank(nonWorker);
        vm.expectRevert();
        services.updatePrice(LeftClawServices.ServiceType.CONSULT_S, 50_000_000);
    }

    // ─── Fuzz Custom Job ─────────────────────────────────────────────────────

    function test_Fuzz_PostCustomJob(uint256 amount) public {
        amount = bound(amount, 1e18, 1_000_000_000e18);

        deal(CLAWD, client, amount);

        vm.startPrank(client);
        IERC20(CLAWD).approve(address(services), amount);
        services.postJobCustom(amount, 0, "QmFuzzCID");
        vm.stopPrank();

        LeftClawServices.Job memory job = services.getJob(1);
        assertEq(job.paymentClawd, amount);
    }

    // ─── Withdraw Fees ───────────────────────────────────────────────────────

    function test_WithdrawFees() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);
        vm.prank(worker);
        services.completeJob(1, "QmResult1");

        _postJob(LeftClawServices.ServiceType.CONSULT_L, CONSULT_L_CLAWD);
        vm.prank(worker);
        services.acceptJob(2);
        vm.prank(worker);
        services.completeJob(2, "QmResult2");

        assertEq(services.accumulatedFees(), 0);

        vm.warp(block.timestamp + 8 days);
        vm.prank(worker);
        services.claimPayment(1);
        vm.prank(worker);
        services.claimPayment(2);

        uint256 expectedFees = (CONSULT_S_CLAWD * 500) / 10_000 + (CONSULT_L_CLAWD * 500) / 10_000;
        assertEq(services.accumulatedFees(), expectedFees);

        address treasury = makeAddr("treasury");
        services.withdrawProtocolFees(treasury);
        assertEq(IERC20(CLAWD).balanceOf(treasury), expectedFees);
    }

    // ─── View Functions ──────────────────────────────────────────────────────

    function test_GetOpenJobs() public {
        _postJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);
        _postJob(LeftClawServices.ServiceType.BUILD_DAILY, BUILD_CLAWD);

        uint256[] memory openJobs = services.getOpenJobs();
        assertEq(openJobs.length, 2);
    }

    function test_GetJobsByClient() public {
        _postJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);
        _postJob(LeftClawServices.ServiceType.BUILD_DAILY, BUILD_CLAWD);

        uint256[] memory clientJobs = services.getJobsByClient(client);
        assertEq(clientJobs.length, 2);
    }

    // ─── Worker Management ───────────────────────────────────────────────────

    function test_AddRemoveWorker() public {
        address newW = makeAddr("newW");
        assertFalse(services.isWorker(newW));

        services.addWorker(newW);
        assertTrue(services.isWorker(newW));

        services.removeWorker(newW);
        assertFalse(services.isWorker(newW));
    }

    // ─── Protocol Fee Cap ────────────────────────────────────────────────────

    function test_SetProtocolFee_MaxCap() public {
        services.setProtocolFee(1000);
        assertEq(services.protocolFeeBps(), 1000);

        vm.expectRevert("Fee too high");
        services.setProtocolFee(1001);
    }

    // ─── Escrow Protection ───────────────────────────────────────────────────

    function test_WithdrawStuckTokens_CannotDrainLockedClawd() public {
        _postJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);

        vm.expectRevert("No surplus CLAWD to withdraw");
        services.withdrawStuckTokens(address(CLAWD), address(this));
    }

    function test_WithdrawStuckTokens_AllowsSurplusClawd() public {
        deal(CLAWD, address(services), 1000e18);
        _postJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);

        uint256 balBefore = IERC20(CLAWD).balanceOf(address(this));
        services.withdrawStuckTokens(address(CLAWD), address(this));
        uint256 balAfter = IERC20(CLAWD).balanceOf(address(this));
        assertEq(balAfter - balBefore, 1000e18);
    }

    // ─── Fee Snapshot ────────────────────────────────────────────────────────

    function test_FeeSnapshot_ImmuneToProtocolFeeChange() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);

        vm.prank(worker);
        services.completeJob(1, "QmResultCID");

        services.setProtocolFee(1000); // change to 10%

        vm.warp(block.timestamp + 8 days);

        uint256 feeAt5pct = (CONSULT_S_CLAWD * 500) / 10_000;
        uint256 expectedPayout = CONSULT_S_CLAWD - feeAt5pct;

        uint256 balBefore = IERC20(CLAWD).balanceOf(worker);
        vm.prank(worker);
        services.claimPayment(1);
        uint256 balAfter = IERC20(CLAWD).balanceOf(worker);

        assertEq(balAfter - balBefore, expectedPayout);
    }

    // ─── Walkaway Protection ─────────────────────────────────────────────────

    function test_WalkawayTest_WorkerClaimsAfterDisputeTimeout() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);

        vm.prank(worker);
        services.completeJob(1, "QmResultCID");

        vm.prank(client);
        services.disputeJob(1);

        vm.warp(block.timestamp + 29 days);
        vm.prank(worker);
        vm.expectRevert("Dispute timeout not reached");
        services.claimPayment(1);

        vm.warp(block.timestamp + 2 days); // 31 days total
        uint256 fee = (CONSULT_S_CLAWD * 500) / 10_000;

        uint256 balBefore = IERC20(CLAWD).balanceOf(worker);
        vm.prank(worker);
        services.claimPayment(1);
        uint256 balAfter = IERC20(CLAWD).balanceOf(worker);

        assertEq(balAfter - balBefore, CONSULT_S_CLAWD - fee);
    }

    function test_WalkawayTest_NoFundsLockedForever() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);
        vm.prank(worker);
        services.completeJob(1, "QmResultCID");
        vm.prank(client);
        services.disputeJob(1);

        assertEq(services.totalLockedClawd(), CONSULT_S_CLAWD);

        vm.warp(block.timestamp + 31 days);
        vm.prank(worker);
        services.claimPayment(1);

        assertEq(services.totalLockedClawd(), 0);
    }

    // ─── USDC Payment ────────────────────────────────────────────────────────

    function test_PostJobWithUsdc_RealSwap() public {
        deal(USDC, client, 500e6);
        vm.startPrank(client);
        IERC20(USDC).approve(address(services), 500e6);
        // $20 consult, minClawdOut = 1 CLAWD (just needs some)
        services.postJobWithUsdc(LeftClawServices.ServiceType.CONSULT_S, "QmDescCID", 1e18);
        vm.stopPrank();

        LeftClawServices.Job memory job = services.getJob(1);
        assertEq(uint256(job.serviceType), uint256(LeftClawServices.ServiceType.CONSULT_S));
        assertEq(job.priceUsd, 20_000_000); // $20
        assertGt(job.paymentClawd, 0);
    }

    function test_PostJobWithUsdc_ZeroMinClawdReverts() public {
        deal(USDC, client, 100e6);
        vm.startPrank(client);
        IERC20(USDC).approve(address(services), 100e6);
        vm.expectRevert("Min 1 CLAWD out");
        services.postJobWithUsdc(LeftClawServices.ServiceType.CONSULT_S, "QmDescCID", 0);
        vm.stopPrank();
    }

    // ─── Swap Path ───────────────────────────────────────────────────────────

    function test_SetSwapPath_OwnerCanUpdate() public {
        bytes memory newPath = abi.encodePacked(USDC, uint24(100), WETH, uint24(3000), CLAWD);
        services.setSwapPath(newPath);
        assertEq(services.swapPath(), newPath);
    }

    function test_SetSwapPath_NonOwnerReverts() public {
        bytes memory newPath = abi.encodePacked(USDC, uint24(100), WETH, uint24(3000), CLAWD);
        vm.prank(client);
        vm.expectRevert();
        services.setSwapPath(newPath);
    }

    // ─── Burn Consultation ───────────────────────────────────────────────────

    function test_BurnConsultation_HappyPath() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);
        uint256 deadBefore = IERC20(CLAWD).balanceOf(address(0xdEaD));

        vm.prank(worker);
        services.burnConsultation(1, "https://gist.github.com/test/123", LeftClawServices.ServiceType.BUILD_DAILY);

        LeftClawServices.Job memory job = services.getJob(1);
        assertEq(uint8(job.status), uint8(LeftClawServices.JobStatus.COMPLETED));
        assertTrue(job.paymentClaimed);
        assertEq(services.totalLockedClawd(), 0);

        uint256 deadAfter = IERC20(CLAWD).balanceOf(address(0xdEaD));
        assertEq(deadAfter - deadBefore, CONSULT_S_CLAWD);
    }

    function test_BurnConsultation_RevertNonConsultation() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.BUILD_DAILY, BUILD_CLAWD);
        uint256 jobId = services.nextJobId() - 1;

        vm.prank(worker);
        vm.expectRevert("Not a consultation job");
        services.burnConsultation(jobId, "https://gist.github.com/test/123", LeftClawServices.ServiceType.BUILD_DAILY);
    }

    function test_BurnConsultation_RevertNonWorker() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);

        vm.prank(nonWorker);
        vm.expectRevert("Not a worker");
        services.burnConsultation(1, "https://gist.github.com/test/123", LeftClawServices.ServiceType.BUILD_DAILY);
    }

    // ─── Reject Job ──────────────────────────────────────────────────────────

    function test_RejectJob() public {
        _postJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);
        uint256 balBefore = IERC20(CLAWD).balanceOf(client);

        vm.prank(worker);
        services.rejectJob(1);

        uint256 balAfter = IERC20(CLAWD).balanceOf(client);
        assertEq(balAfter - balBefore, CONSULT_S_CLAWD);
    }

    function test_RejectJob_NonWorkerReverts() public {
        _postJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);

        vm.prank(nonWorker);
        vm.expectRevert("Not a worker");
        services.rejectJob(1);
    }

    function test_RejectJob_CannotRejectAcceptedJob() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);

        vm.prank(worker);
        vm.expectRevert("Can only reject OPEN jobs");
        services.rejectJob(1);
    }

    // ─── Work Logs ───────────────────────────────────────────────────────────

    function test_LogWork_Success() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.BUILD_DAILY, BUILD_CLAWD);
        uint256 jobId = services.nextJobId() - 1;

        vm.prank(worker);
        services.logWork(jobId, "Setting up SE2 and deploying contracts");

        LeftClawServices.WorkLog[] memory logs = services.getWorkLogs(jobId);
        assertEq(logs.length, 1);
    }

    function test_LogWork_RevertsIfNotWorker() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.BUILD_DAILY, BUILD_CLAWD);
        uint256 jobId = services.nextJobId() - 1;

        vm.prank(nonWorker);
        vm.expectRevert("Not a worker");
        services.logWork(jobId, "This should fail");
    }

    function test_LogWork_RevertsIfNotAssignedWorker() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.BUILD_DAILY, BUILD_CLAWD);
        uint256 jobId = services.nextJobId() - 1;

        address otherWorker = makeAddr("otherWorker");
        services.addWorker(otherWorker);

        vm.prank(otherWorker);
        vm.expectRevert("Not the assigned worker");
        services.logWork(jobId, "This should fail");
    }

    // ─── DisputeResolved event on timeout ────────────────────────────────────

    function test_DisputeResolvedEmitted_OnTimeoutClaim() public {
        _postAndAcceptJob(LeftClawServices.ServiceType.CONSULT_S, CONSULT_S_CLAWD);
        vm.prank(worker);
        services.completeJob(1, "QmResultCID");
        vm.prank(client);
        services.disputeJob(1);

        vm.warp(block.timestamp + 31 days);

        vm.expectEmit(true, false, false, true);
        emit LeftClawServices.DisputeResolved(1, false);

        vm.prank(worker);
        services.claimPayment(1);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _postJob(LeftClawServices.ServiceType serviceType, uint256 clawdAmount) internal {
        vm.startPrank(client);
        IERC20(CLAWD).approve(address(services), clawdAmount);
        services.postJob(serviceType, clawdAmount, "QmDescCID");
        vm.stopPrank();
    }

    function _postAndAcceptJob(LeftClawServices.ServiceType serviceType, uint256 clawdAmount) internal {
        _postJob(serviceType, clawdAmount);
        uint256 jobId = services.nextJobId() - 1;
        vm.prank(worker);
        services.acceptJob(jobId);
    }
}
