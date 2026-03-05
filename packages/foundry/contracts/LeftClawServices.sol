// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Uniswap V3 SwapRouter02 interface
interface ISwapRouter {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

/// @title LeftClawServices
/// @notice Hire clawdbots — pay in CLAWD or USDC, prices in USD.
/// @dev Prices stored in USDC (6 decimals). CLAWD payments are calculated by the frontend at current market rate.
///      USDC payments auto-swap to CLAWD via Uniswap V3. Jobs always track CLAWD amount paid.
contract LeftClawServices is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Enums ────────────────────────────────────────────────────────────────

    enum ServiceType {
        CONSULT_S,   // 0 - Quick Consult ($20)
        CONSULT_L,   // 1 - Deep Consult ($30)
        BUILD_DAILY, // 2 - Daily Build ($1000)
        BUILD_M,     // 3 - reserved
        BUILD_L,     // 4 - reserved
        BUILD_XL,    // 5 - reserved
        QA_REPORT,   // 6 - QA Report ($50)
        AUDIT_S,     // 7 - Quick Audit ($200)
        AUDIT_L,     // 8 - reserved
        CUSTOM       // 9 - custom amount set by poster
    }

    enum JobStatus {
        OPEN,        // 0 - posted, waiting for worker
        IN_PROGRESS, // 1 - worker working
        COMPLETED,   // 2 - work done, in dispute window
        CANCELLED,   // 3 - cancelled by client, refunded
        DISPUTED     // 4 - client disputed result
    }

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct Job {
        uint256 id;
        address client;
        ServiceType serviceType;
        uint256 paymentClawd;       // CLAWD amount (18 decimals) — always in CLAWD
        uint256 priceUsd;           // USD price at time of posting (USDC 6 decimals)
        string descriptionCID;      // IPFS CID of job brief
        JobStatus status;
        uint256 createdAt;
        uint256 startedAt;
        uint256 completedAt;
        string resultCID;           // IPFS CID of result
        address worker;
        bool paymentClaimed;
        uint256 feeSnapshot;        // fee locked at completeJob
        uint256 disputedAt;
    }

    struct WorkLog {
        string note;
        uint256 timestamp;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    mapping(uint256 => Job) public jobs;
    uint256 public nextJobId;

    /// @notice Prices in USDC (6 decimals). $20 = 20_000_000.
    mapping(ServiceType => uint256) public servicePriceUsd;
    mapping(address => bool) public isWorker;
    mapping(uint256 => WorkLog[]) public workLogs;

    uint256 public protocolFeeBps;
    uint256 public accumulatedFees;
    uint256 public totalLockedClawd;

    IERC20 public immutable clawdToken;
    IERC20 public immutable usdcToken;
    ISwapRouter public immutable uniswapRouter;
    address public immutable weth;

    bytes public swapPath;

    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    uint256 public constant DISPUTE_WINDOW = 7 days;
    uint256 public constant MAX_FEE_BPS = 1000;
    uint256 public constant DISPUTE_TIMEOUT = 30 days;

    // ─── Events ───────────────────────────────────────────────────────────────

    event JobPosted(uint256 indexed jobId, address indexed client, ServiceType serviceType, uint256 paymentClawd, uint256 priceUsd, string descriptionCID);
    event JobAccepted(uint256 indexed jobId, address indexed worker);
    event JobCompleted(uint256 indexed jobId, address indexed worker, string resultCID);
    event JobCancelled(uint256 indexed jobId, address indexed client);
    event JobDisputed(uint256 indexed jobId, address indexed client);
    event DisputeResolved(uint256 indexed jobId, bool refundedClient);
    event PaymentClaimed(uint256 indexed jobId, address indexed worker, uint256 amount);
    event PriceUpdated(ServiceType indexed serviceType, uint256 newPriceUsd);
    event WorkerAdded(address indexed worker);
    event WorkerRemoved(address indexed worker);
    event ProtocolFeeUpdated(uint256 newFeeBps);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event SwapPathUpdated(bytes newPath);
    event ConsultationComplete(uint256 indexed jobId, address indexed client, string gistUrl, ServiceType recommendedBuildType);
    event JobRejected(uint256 indexed jobId, address indexed client);
    event WorkLogged(uint256 indexed jobId, address indexed worker, string note);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyWorker() {
        require(isWorker[msg.sender], "Not a worker");
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

        // Prices in USDC (6 decimals)
        servicePriceUsd[ServiceType.CONSULT_S]   = 20_000_000;   // $20
        servicePriceUsd[ServiceType.CONSULT_L]   = 30_000_000;   // $30
        servicePriceUsd[ServiceType.BUILD_DAILY] = 1_000_000_000; // $1,000
        servicePriceUsd[ServiceType.QA_REPORT]   = 50_000_000;   // $50
        servicePriceUsd[ServiceType.AUDIT_S]     = 200_000_000;  // $200

        protocolFeeBps = 500; // 5%
        nextJobId = 1;

        swapPath = abi.encodePacked(
            _usdcToken,
            uint24(500),   // USDC/WETH 0.05%
            _weth,
            uint24(10000), // WETH/CLAWD 1%
            _clawdToken
        );
    }

    // ─── Job Posting ──────────────────────────────────────────────────────────

    /// @notice Post a job paying with CLAWD. Frontend calculates clawdAmount from USD price / CLAWD market price.
    function postJob(ServiceType serviceType, uint256 clawdAmount, string calldata descriptionCID) external nonReentrant {
        require(serviceType != ServiceType.CUSTOM, "Use postJobCustom for CUSTOM");
        require(bytes(descriptionCID).length > 0, "Description required");
        uint256 priceUsd = servicePriceUsd[serviceType];
        require(priceUsd > 0, "Service not available");
        require(clawdAmount >= 1e18, "Min 1 CLAWD");

        clawdToken.safeTransferFrom(msg.sender, address(this), clawdAmount);

        _createJob(msg.sender, serviceType, clawdAmount, priceUsd, descriptionCID);
    }

    /// @notice Post a CUSTOM job with any CLAWD amount and custom USD value
    function postJobCustom(uint256 clawdAmount, uint256 customPriceUsd, string calldata descriptionCID) external nonReentrant {
        require(clawdAmount >= 1e18, "Min 1 CLAWD");
        require(bytes(descriptionCID).length > 0, "Description required");

        clawdToken.safeTransferFrom(msg.sender, address(this), clawdAmount);

        _createJob(msg.sender, ServiceType.CUSTOM, clawdAmount, customPriceUsd, descriptionCID);
    }

    /// @notice Post a job paying with USDC — exact USD price charged, auto-swaps to CLAWD
    function postJobWithUsdc(ServiceType serviceType, string calldata descriptionCID, uint256 minClawdOut) external nonReentrant {
        require(serviceType != ServiceType.CUSTOM, "Use postJobCustomUsdc for CUSTOM");
        require(bytes(descriptionCID).length > 0, "Description required");
        uint256 priceUsd = servicePriceUsd[serviceType];
        require(priceUsd > 0, "Service not available");
        require(minClawdOut >= 1e18, "Min 1 CLAWD out");

        usdcToken.safeTransferFrom(msg.sender, address(this), priceUsd);
        usdcToken.forceApprove(address(uniswapRouter), priceUsd);

        uint256 clawdReceived = uniswapRouter.exactInput(
            ISwapRouter.ExactInputParams({
                path: swapPath,
                recipient: address(this),
                amountIn: priceUsd,
                amountOutMinimum: minClawdOut
            })
        );

        _createJob(msg.sender, serviceType, clawdReceived, priceUsd, descriptionCID);
    }

    /// @notice Post a CUSTOM job paying with USDC
    function postJobCustomUsdc(uint256 usdcAmount, string calldata descriptionCID, uint256 minClawdOut) external nonReentrant {
        require(usdcAmount > 0, "USDC amount must be > 0");
        require(bytes(descriptionCID).length > 0, "Description required");
        require(minClawdOut >= 1e18, "Min 1 CLAWD out");

        usdcToken.safeTransferFrom(msg.sender, address(this), usdcAmount);
        usdcToken.forceApprove(address(uniswapRouter), usdcAmount);

        uint256 clawdReceived = uniswapRouter.exactInput(
            ISwapRouter.ExactInputParams({
                path: swapPath,
                recipient: address(this),
                amountIn: usdcAmount,
                amountOutMinimum: minClawdOut
            })
        );

        _createJob(msg.sender, ServiceType.CUSTOM, clawdReceived, usdcAmount, descriptionCID);
    }

    // ─── Job Lifecycle ────────────────────────────────────────────────────────

    function acceptJob(uint256 jobId) external nonReentrant onlyWorker {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job does not exist");
        require(job.status == JobStatus.OPEN, "Job not OPEN");

        job.status = JobStatus.IN_PROGRESS;
        job.worker = msg.sender;
        job.startedAt = block.timestamp;

        emit JobAccepted(jobId, msg.sender);
    }

    function completeJob(uint256 jobId, string calldata resultCID) external nonReentrant onlyWorker {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job does not exist");
        require(job.status == JobStatus.IN_PROGRESS, "Job not IN_PROGRESS");
        require(job.worker == msg.sender, "Not the assigned worker");
        require(bytes(resultCID).length > 0, "Result CID required");

        job.status = JobStatus.COMPLETED;
        job.resultCID = resultCID;
        job.completedAt = block.timestamp;
        job.feeSnapshot = (job.paymentClawd * protocolFeeBps) / 10_000;

        emit JobCompleted(jobId, msg.sender, resultCID);
    }

    function logWork(uint256 jobId, string calldata note) external nonReentrant onlyWorker {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job does not exist");
        require(job.status == JobStatus.IN_PROGRESS, "Job not IN_PROGRESS");
        require(job.worker == msg.sender, "Not the assigned worker");
        require(bytes(note).length > 0, "Note required");
        require(bytes(note).length <= 500, "Note too long (max 500 chars)");
        workLogs[jobId].push(WorkLog({ note: note, timestamp: block.timestamp }));
        emit WorkLogged(jobId, msg.sender, note);
    }

    function burnConsultation(uint256 jobId, string calldata gistUrl, ServiceType recommendedBuildType) external nonReentrant onlyWorker {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job does not exist");
        require(job.serviceType == ServiceType.CONSULT_S || job.serviceType == ServiceType.CONSULT_L, "Not a consultation job");
        require(job.status == JobStatus.IN_PROGRESS, "Job not IN_PROGRESS");
        require(job.worker == msg.sender, "Not the assigned worker");
        require(bytes(gistUrl).length > 0, "Gist URL required");
        require(!job.paymentClaimed, "Already claimed");

        job.paymentClaimed = true;
        job.status = JobStatus.COMPLETED;
        job.resultCID = gistUrl;
        job.completedAt = block.timestamp;
        totalLockedClawd -= job.paymentClawd;

        clawdToken.safeTransfer(DEAD_ADDRESS, job.paymentClawd);

        emit ConsultationComplete(jobId, job.client, gistUrl, recommendedBuildType);
        emit JobCompleted(jobId, msg.sender, gistUrl);
    }

    function claimPayment(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job does not exist");
        require(job.worker == msg.sender, "Not the worker");
        require(!job.paymentClaimed, "Already claimed");

        bool wasDisputed = job.status == JobStatus.DISPUTED;
        if (job.status == JobStatus.COMPLETED) {
            require(block.timestamp > job.completedAt + DISPUTE_WINDOW, "Dispute window active");
        } else if (wasDisputed) {
            require(block.timestamp > job.disputedAt + DISPUTE_TIMEOUT, "Dispute timeout not reached");
        } else {
            revert("Job not claimable");
        }

        job.paymentClaimed = true;
        job.status = JobStatus.COMPLETED;

        uint256 fee = job.feeSnapshot;
        uint256 payout = job.paymentClawd - fee;

        totalLockedClawd -= job.paymentClawd;
        accumulatedFees += fee;

        clawdToken.safeTransfer(msg.sender, payout);

        if (wasDisputed) emit DisputeResolved(jobId, false);
        emit PaymentClaimed(jobId, msg.sender, payout);
    }

    function rejectJob(uint256 jobId) external nonReentrant onlyWorker {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job does not exist");
        require(job.status == JobStatus.OPEN, "Can only reject OPEN jobs");

        job.status = JobStatus.CANCELLED;
        totalLockedClawd -= job.paymentClawd;

        clawdToken.safeTransfer(job.client, job.paymentClawd);

        emit JobRejected(jobId, job.client);
    }

    function cancelJob(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job does not exist");
        require(job.client == msg.sender, "Not the client");
        require(job.status == JobStatus.OPEN, "Can only cancel OPEN jobs");

        job.status = JobStatus.CANCELLED;
        totalLockedClawd -= job.paymentClawd;

        clawdToken.safeTransfer(msg.sender, job.paymentClawd);

        emit JobCancelled(jobId, msg.sender);
    }

    function disputeJob(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job does not exist");
        require(job.client == msg.sender, "Not the client");
        require(job.status == JobStatus.COMPLETED, "Job not COMPLETED");
        require(!job.paymentClaimed, "Payment already claimed");
        require(block.timestamp <= job.completedAt + DISPUTE_WINDOW, "Dispute window expired");

        job.status = JobStatus.DISPUTED;
        job.disputedAt = block.timestamp;

        emit JobDisputed(jobId, msg.sender);
    }

    function resolveDispute(uint256 jobId, bool refundClient) external onlyOwner nonReentrant {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job does not exist");
        require(job.status == JobStatus.DISPUTED, "Job not DISPUTED");

        totalLockedClawd -= job.paymentClawd;

        if (refundClient) {
            job.status = JobStatus.CANCELLED;
            clawdToken.safeTransfer(job.client, job.paymentClawd);
        } else {
            uint256 fee = job.feeSnapshot;
            uint256 payout = job.paymentClawd - fee;
            accumulatedFees += fee;
            job.status = JobStatus.COMPLETED;
            job.paymentClaimed = true;
            clawdToken.safeTransfer(job.worker, payout);
        }

        emit DisputeResolved(jobId, refundClient);
    }

    // ─── Admin (Owner Only) ───────────────────────────────────────────────────

    function updatePrice(ServiceType serviceType, uint256 priceUsd) external onlyOwner {
        servicePriceUsd[serviceType] = priceUsd;
        emit PriceUpdated(serviceType, priceUsd);
    }

    function addWorker(address worker) external onlyOwner {
        require(worker != address(0), "Zero address");
        isWorker[worker] = true;
        emit WorkerAdded(worker);
    }

    function removeWorker(address worker) external onlyOwner {
        isWorker[worker] = false;
        emit WorkerRemoved(worker);
    }

    function setProtocolFee(uint256 feeBps) external onlyOwner {
        require(feeBps <= MAX_FEE_BPS, "Fee too high");
        protocolFeeBps = feeBps;
        emit ProtocolFeeUpdated(feeBps);
    }

    function setSwapPath(bytes calldata newPath) external onlyOwner {
        require(newPath.length >= 43, "Invalid path");
        swapPath = newPath;
        emit SwapPathUpdated(newPath);
    }

    function withdrawStuckTokens(address token, address to) external onlyOwner nonReentrant {
        require(to != address(0), "Zero address");
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No tokens to withdraw");

        if (token == address(clawdToken)) {
            uint256 locked = totalLockedClawd + accumulatedFees;
            require(balance > locked, "No surplus CLAWD to withdraw");
            IERC20(token).safeTransfer(to, balance - locked);
        } else {
            IERC20(token).safeTransfer(to, balance);
        }
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

    function getWorkLogs(uint256 jobId) external view returns (WorkLog[] memory) {
        return workLogs[jobId];
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _createJob(
        address client,
        ServiceType serviceType,
        uint256 clawdAmount,
        uint256 priceUsd,
        string calldata descriptionCID
    ) internal {
        uint256 jobId = nextJobId++;

        totalLockedClawd += clawdAmount;

        jobs[jobId] = Job({
            id: jobId,
            client: client,
            serviceType: serviceType,
            paymentClawd: clawdAmount,
            priceUsd: priceUsd,
            descriptionCID: descriptionCID,
            status: JobStatus.OPEN,
            createdAt: block.timestamp,
            startedAt: 0,
            completedAt: 0,
            resultCID: "",
            worker: address(0),
            paymentClaimed: false,
            feeSnapshot: 0,
            disputedAt: 0
        });

        emit JobPosted(jobId, client, serviceType, clawdAmount, priceUsd, descriptionCID);
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
