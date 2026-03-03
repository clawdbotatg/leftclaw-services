// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal Uniswap V3 SwapRouter interface for multi-hop swaps
interface ISwapRouter {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

/// @title LeftClawServices
/// @notice A marketplace for hiring LeftClaw (AI Ethereum builder) — post jobs, pay with CLAWD or USDC
/// @dev Jobs are escrowed until completion + dispute window passes. USDC auto-swaps to CLAWD via Uniswap V3.
contract LeftClawServices is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Enums ────────────────────────────────────────────────────────────────

    enum ServiceType {
        CONSULT_S,   // 0 - 15-message consultation
        CONSULT_L,   // 1 - 30-message consultation
        BUILD_S,     // 2 - simple build ~$500
        BUILD_M,     // 3 - full build ~$1000
        BUILD_L,     // 4 - complex build ~$1500
        BUILD_XL,    // 5 - enterprise build ~$2500
        QA_AUDIT,    // 6 - QA report ~$200
        AUDIT_S,     // 7 - single contract audit ~$300
        AUDIT_L,     // 8 - multi-contract audit ~$600
        CUSTOM       // 9 - custom amount set by poster
    }

    enum JobStatus {
        OPEN,        // 0 - posted, waiting for executor
        IN_PROGRESS, // 1 - executor working
        COMPLETED,   // 2 - work done, in dispute window
        CANCELLED,   // 3 - cancelled by client, refunded
        DISPUTED     // 4 - client disputed result
    }

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct Job {
        uint256 id;
        address client;
        ServiceType serviceType;
        uint256 paymentClawd;       // CLAWD amount (18 decimals)
        uint256 paymentUsdcApprox;  // Informational: USDC cents value at posting time
        string descriptionCID;      // IPFS CID of job brief
        JobStatus status;
        uint256 createdAt;
        uint256 startedAt;
        uint256 completedAt;
        string resultCID;           // IPFS CID of result
        address executor;
        bool paymentClaimed;        // Whether executor claimed payment
    }

    // ─── State ────────────────────────────────────────────────────────────────

    mapping(uint256 => Job) public jobs;
    uint256 public nextJobId;

    mapping(ServiceType => uint256) public servicePriceInClawd;
    mapping(address => bool) public isExecutor;

    uint256 public protocolFeeBps; // basis points (500 = 5%)
    uint256 public accumulatedFees; // CLAWD fees accumulated

    IERC20 public immutable clawdToken;
    IERC20 public immutable usdcToken;
    ISwapRouter public immutable uniswapRouter;
    address public immutable weth;

    uint256 public constant DISPUTE_WINDOW = 7 days;
    uint256 public constant MAX_FEE_BPS = 1000; // 10% cap

    // ─── Events ───────────────────────────────────────────────────────────────

    event JobPosted(
        uint256 indexed jobId, address indexed client, ServiceType serviceType, uint256 paymentClawd, string descriptionCID
    );
    event JobAccepted(uint256 indexed jobId, address indexed executor);
    event JobCompleted(uint256 indexed jobId, address indexed executor, string resultCID);
    event JobCancelled(uint256 indexed jobId, address indexed client);
    event JobDisputed(uint256 indexed jobId, address indexed client);
    event DisputeResolved(uint256 indexed jobId, bool refundedClient);
    event PaymentClaimed(uint256 indexed jobId, address indexed executor, uint256 amount);
    event PriceUpdated(ServiceType indexed serviceType, uint256 newPrice);
    event ExecutorAdded(address indexed executor);
    event ExecutorRemoved(address indexed executor);
    event ProtocolFeeUpdated(uint256 newFeeBps);
    event FeesWithdrawn(address indexed to, uint256 amount);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyExecutor() {
        require(isExecutor[msg.sender], "Not an executor");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(
        address _clawdToken,
        address _usdcToken,
        address _uniswapRouter,
        address _weth
    ) Ownable(msg.sender) {
        require(_clawdToken != address(0), "Zero CLAWD address");
        require(_usdcToken != address(0), "Zero USDC address");
        require(_uniswapRouter != address(0), "Zero router address");
        require(_weth != address(0), "Zero WETH address");

        clawdToken = IERC20(_clawdToken);
        usdcToken = IERC20(_usdcToken);
        uniswapRouter = ISwapRouter(_uniswapRouter);
        weth = _weth;

        // Initial prices in CLAWD (at ~$0.0003/CLAWD)
        servicePriceInClawd[ServiceType.CONSULT_S] = 66_666e18;
        servicePriceInClawd[ServiceType.CONSULT_L] = 100_000e18;
        servicePriceInClawd[ServiceType.BUILD_S] = 1_666_666e18;
        servicePriceInClawd[ServiceType.BUILD_M] = 3_333_333e18;
        servicePriceInClawd[ServiceType.BUILD_L] = 5_000_000e18;
        servicePriceInClawd[ServiceType.BUILD_XL] = 8_333_333e18;
        servicePriceInClawd[ServiceType.QA_AUDIT] = 666_666e18;
        servicePriceInClawd[ServiceType.AUDIT_S] = 1_000_000e18;
        servicePriceInClawd[ServiceType.AUDIT_L] = 2_000_000e18;
        // CUSTOM price is 0 (set by poster)

        protocolFeeBps = 500; // 5%
        nextJobId = 1;

        // Add deployer as initial executor
        isExecutor[msg.sender] = true;
        emit ExecutorAdded(msg.sender);
    }

    // ─── Job Posting ──────────────────────────────────────────────────────────

    /// @notice Post a job with CLAWD payment (standard service types)
    function postJob(ServiceType serviceType, string calldata descriptionCID) external nonReentrant {
        require(serviceType != ServiceType.CUSTOM, "Use postJobCustom for CUSTOM");
        uint256 price = servicePriceInClawd[serviceType];
        require(price > 0, "Service price not set");

        clawdToken.safeTransferFrom(msg.sender, address(this), price);

        _createJob(msg.sender, serviceType, price, 0, descriptionCID);
    }

    /// @notice Post a CUSTOM job with any CLAWD amount
    function postJobCustom(uint256 clawdAmount, string calldata descriptionCID) external nonReentrant {
        require(clawdAmount > 0, "Amount must be > 0");
        require(bytes(descriptionCID).length > 0, "Description required");

        clawdToken.safeTransferFrom(msg.sender, address(this), clawdAmount);

        _createJob(msg.sender, ServiceType.CUSTOM, clawdAmount, 0, descriptionCID);
    }

    /// @notice Post a job paying with USDC — auto-swaps to CLAWD via Uniswap V3
    function postJobWithUsdc(
        ServiceType serviceType,
        string calldata descriptionCID,
        uint256 usdcAmount,
        uint256 minClawdOut
    ) external nonReentrant {
        require(usdcAmount > 0, "USDC amount must be > 0");

        // Pull USDC from sender
        usdcToken.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Approve router to spend USDC
        usdcToken.forceApprove(address(uniswapRouter), usdcAmount);

        // Multi-hop swap: USDC → WETH (0.05% fee) → CLAWD (1% fee)
        bytes memory path = abi.encodePacked(
            address(usdcToken),
            uint24(500),    // USDC/WETH 0.05%
            weth,
            uint24(10000),  // WETH/CLAWD 1%
            address(clawdToken)
        );

        ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
            path: path,
            recipient: address(this),
            deadline: block.timestamp + 300,
            amountIn: usdcAmount,
            amountOutMinimum: minClawdOut
        });

        uint256 clawdReceived = uniswapRouter.exactInput(params);

        _createJob(msg.sender, serviceType, clawdReceived, usdcAmount, descriptionCID);
    }

    // ─── Job Lifecycle ────────────────────────────────────────────────────────

    /// @notice Executor accepts an open job
    function acceptJob(uint256 jobId) external nonReentrant onlyExecutor {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job does not exist");
        require(job.status == JobStatus.OPEN, "Job not OPEN");

        job.status = JobStatus.IN_PROGRESS;
        job.executor = msg.sender;
        job.startedAt = block.timestamp;

        emit JobAccepted(jobId, msg.sender);
    }

    /// @notice Executor marks job as complete with result CID
    function completeJob(uint256 jobId, string calldata resultCID) external nonReentrant onlyExecutor {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job does not exist");
        require(job.status == JobStatus.IN_PROGRESS, "Job not IN_PROGRESS");
        require(job.executor == msg.sender, "Not the assigned executor");
        require(bytes(resultCID).length > 0, "Result CID required");

        job.status = JobStatus.COMPLETED;
        job.resultCID = resultCID;
        job.completedAt = block.timestamp;

        // Calculate and accumulate protocol fee
        uint256 fee = (job.paymentClawd * protocolFeeBps) / 10_000;
        accumulatedFees += fee;

        emit JobCompleted(jobId, msg.sender, resultCID);
    }

    /// @notice Executor claims payment after dispute window
    function claimPayment(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job does not exist");
        require(job.status == JobStatus.COMPLETED, "Job not COMPLETED");
        require(job.executor == msg.sender, "Not the executor");
        require(!job.paymentClaimed, "Already claimed");
        require(block.timestamp > job.completedAt + DISPUTE_WINDOW, "Dispute window active");

        job.paymentClaimed = true;

        uint256 fee = (job.paymentClawd * protocolFeeBps) / 10_000;
        uint256 payout = job.paymentClawd - fee;

        clawdToken.safeTransfer(msg.sender, payout);

        emit PaymentClaimed(jobId, msg.sender, payout);
    }

    /// @notice Client cancels an OPEN job (full refund)
    function cancelJob(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job does not exist");
        require(job.client == msg.sender, "Not the client");
        require(job.status == JobStatus.OPEN, "Can only cancel OPEN jobs");

        job.status = JobStatus.CANCELLED;

        clawdToken.safeTransfer(msg.sender, job.paymentClawd);

        emit JobCancelled(jobId, msg.sender);
    }

    /// @notice Client disputes a completed job within dispute window
    function disputeJob(uint256 jobId) external {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job does not exist");
        require(job.client == msg.sender, "Not the client");
        require(job.status == JobStatus.COMPLETED, "Job not COMPLETED");
        require(!job.paymentClaimed, "Payment already claimed");
        require(block.timestamp <= job.completedAt + DISPUTE_WINDOW, "Dispute window expired");

        job.status = JobStatus.DISPUTED;

        emit JobDisputed(jobId, msg.sender);
    }

    /// @notice Owner resolves a dispute
    function resolveDispute(uint256 jobId, bool refundClient) external onlyOwner nonReentrant {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job does not exist");
        require(job.status == JobStatus.DISPUTED, "Job not DISPUTED");

        uint256 fee = (job.paymentClawd * protocolFeeBps) / 10_000;

        if (refundClient) {
            // Refund client the full amount (fee is reversed)
            accumulatedFees -= fee;
            job.status = JobStatus.CANCELLED;
            clawdToken.safeTransfer(job.client, job.paymentClawd);
        } else {
            // Release to executor (minus fee)
            job.status = JobStatus.COMPLETED;
            job.paymentClaimed = true;
            uint256 payout = job.paymentClawd - fee;
            clawdToken.safeTransfer(job.executor, payout);
        }

        emit DisputeResolved(jobId, refundClient);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function updatePrice(ServiceType serviceType, uint256 priceInClawd) external onlyOwner {
        servicePriceInClawd[serviceType] = priceInClawd;
        emit PriceUpdated(serviceType, priceInClawd);
    }

    function addExecutor(address executor) external onlyOwner {
        require(executor != address(0), "Zero address");
        isExecutor[executor] = true;
        emit ExecutorAdded(executor);
    }

    function removeExecutor(address executor) external onlyOwner {
        isExecutor[executor] = false;
        emit ExecutorRemoved(executor);
    }

    function setProtocolFee(uint256 feeBps) external onlyOwner {
        require(feeBps <= MAX_FEE_BPS, "Fee too high");
        protocolFeeBps = feeBps;
        emit ProtocolFeeUpdated(feeBps);
    }

    function withdrawProtocolFees(address to) external onlyOwner nonReentrant {
        require(to != address(0), "Zero address");
        uint256 amount = accumulatedFees;
        require(amount > 0, "No fees to withdraw");
        accumulatedFees = 0;
        clawdToken.safeTransfer(to, amount);
        emit FeesWithdrawn(to, amount);
    }

    // ─── View Functions ───────────────────────────────────────────────────────

    function getJob(uint256 jobId) external view returns (Job memory) {
        require(jobs[jobId].id != 0, "Job does not exist");
        return jobs[jobId];
    }

    function getOpenJobs() external view returns (uint256[] memory) {
        return _getJobsByStatus(JobStatus.OPEN);
    }

    function getJobsByStatus(JobStatus status) external view returns (uint256[] memory) {
        return _getJobsByStatus(status);
    }

    function getJobsByClient(address client) external view returns (uint256[] memory) {
        uint256 count;
        for (uint256 i = 1; i < nextJobId; i++) {
            if (jobs[i].client == client) count++;
        }
        uint256[] memory result = new uint256[](count);
        uint256 idx;
        for (uint256 i = 1; i < nextJobId; i++) {
            if (jobs[i].client == client) {
                result[idx++] = i;
            }
        }
        return result;
    }

    function getTotalJobs() external view returns (uint256) {
        return nextJobId - 1;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _createJob(
        address client,
        ServiceType serviceType,
        uint256 clawdAmount,
        uint256 usdcApprox,
        string calldata descriptionCID
    ) internal {
        uint256 jobId = nextJobId++;

        jobs[jobId] = Job({
            id: jobId,
            client: client,
            serviceType: serviceType,
            paymentClawd: clawdAmount,
            paymentUsdcApprox: usdcApprox,
            descriptionCID: descriptionCID,
            status: JobStatus.OPEN,
            createdAt: block.timestamp,
            startedAt: 0,
            completedAt: 0,
            resultCID: "",
            executor: address(0),
            paymentClaimed: false
        });

        emit JobPosted(jobId, client, serviceType, clawdAmount, descriptionCID);
    }

    function _getJobsByStatus(JobStatus status) internal view returns (uint256[] memory) {
        uint256 count;
        for (uint256 i = 1; i < nextJobId; i++) {
            if (jobs[i].status == status) count++;
        }
        uint256[] memory result = new uint256[](count);
        uint256 idx;
        for (uint256 i = 1; i < nextJobId; i++) {
            if (jobs[i].status == status) {
                result[idx++] = i;
            }
        }
        return result;
    }
}
