// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Uniswap V3 SwapRouter02 interface
interface ISwapRouter02 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

/// @notice WETH interface
interface IWETH9 {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @title LeftClawServices V2
/// @notice Hire clawdbots — dynamic service types, escrow in CLAWD, no disputes, no fees, no burn.
contract LeftClawServicesV2 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Enums ────────────────────────────────────────────────────────────────

    enum JobStatus { OPEN, IN_PROGRESS, COMPLETED, DECLINED, CANCELLED, REASSIGNED }
    enum PaymentMethod { CLAWD, USDC, ETH, CV }

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct ServiceType {
        uint256 id;
        string name;
        string slug;
        uint256 priceUsd;   // USDC 6 decimals
        uint256 cvDivisor;  // CV cost = fifth / cvDivisor. 1 = full fifth, 250 = pfp, etc.
        string status;      // "active" | "paused" | "deprecated"
    }

    struct Job {
        uint256 id;
        address client;
        uint256 serviceTypeId;
        uint256 paymentClawd;
        uint256 priceUsd;
        string description;
        JobStatus status;
        uint256 createdAt;
        uint256 startedAt;
        uint256 completedAt;
        string resultCID;
        address worker;
        bool paymentClaimed;
        PaymentMethod paymentMethod;
        uint256 cvAmount;
        string currentStage;
    }

    struct WorkLog {
        string note;
        uint256 timestamp;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    mapping(uint256 => ServiceType) public serviceTypes;
    uint256 public nextServiceTypeId;

    mapping(uint256 => Job) public jobs;
    uint256 public nextJobId;

    address[] public workers;
    mapping(uint256 => WorkLog[]) public workLogs;

    uint256 public totalLockedClawd;

    IERC20 public immutable clawdToken;
    IERC20 public immutable usdcToken;
    ISwapRouter02 public immutable uniswapRouter;
    address public immutable weth;
    address public treasury;

    bytes public swapPath;     // USDC → WETH → CLAWD
    bytes public ethSwapPath;  // WETH → CLAWD

    // ─── Events ───────────────────────────────────────────────────────────────

    event ServiceTypeAdded(uint256 indexed id, string name, string slug, uint256 priceUsd, uint256 cvDivisor);
    event ServiceTypeUpdated(uint256 indexed id, string name, string slug, uint256 priceUsd, uint256 cvDivisor, string status);
    event JobPosted(uint256 indexed jobId, address indexed client, uint256 serviceTypeId, uint256 paymentClawd, uint256 priceUsd, PaymentMethod paymentMethod, uint256 cvAmount);
    event JobAccepted(uint256 indexed jobId, address indexed worker);
    event JobCompleted(uint256 indexed jobId, address indexed worker, string resultCID);
    event JobDeclined(uint256 indexed jobId, address indexed client);
    event JobCancelled(uint256 indexed jobId, address indexed client);
    event WorkLogged(uint256 indexed jobId, address indexed worker, string note);
    event WorkerAdded(address indexed worker);
    event WorkerRemoved(address indexed worker);
    event JobReassigned(uint256 indexed jobId, address indexed previousWorker);
    event TreasuryUpdated(address indexed newTreasury);
    event SwapPathUpdated(bytes newPath);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyWorker() {
        bool isWk = false;
        for (uint i = 0; i < workers.length; i++) {
            if (workers[i] == msg.sender) { isWk = true; break; }
        }
        require(isWk, "!worker");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(
        address _clawdToken,
        address _usdcToken,
        address _uniswapRouter,
        address _weth,
        address _treasury,
        uint256 _startJobId
    ) Ownable(msg.sender) {
        require(_clawdToken != address(0) && _usdcToken != address(0), "!addr");
        require(_uniswapRouter != address(0) && _weth != address(0), "!addr");
        require(_treasury != address(0), "!treasury");

        clawdToken = IERC20(_clawdToken);
        usdcToken = IERC20(_usdcToken);
        uniswapRouter = ISwapRouter02(_uniswapRouter);
        weth = _weth;
        treasury = _treasury;

        nextServiceTypeId = 1;
        nextJobId = _startJobId;

        swapPath = abi.encodePacked(
            _usdcToken,
            uint24(500),    // USDC/WETH 0.05%
            _weth,
            uint24(10000),  // WETH/CLAWD 1% (pool 0xCD55381a has massive liquidity)
            _clawdToken
        );

        ethSwapPath = abi.encodePacked(
            _weth,
            uint24(10000),  // WETH/CLAWD 1% (pool 0xCD55381a has massive liquidity)
            _clawdToken
        );

        // Workers are added by the owner via addWorker() after deployment.
        // See DeployLeftClawServicesV2.s.sol for the list of workers to add.
    }

    // ─── Service Type Admin ───────────────────────────────────────────────────

    function addServiceType(string calldata name, string calldata slug, uint256 priceUsd, uint256 cvDivisor) external onlyOwner {
        require(bytes(name).length > 0 && bytes(slug).length > 0, "!name");
        require(cvDivisor > 0, "!cvDiv");
        uint256 id = nextServiceTypeId++;
        serviceTypes[id] = ServiceType(id, name, slug, priceUsd, cvDivisor, "active");
        emit ServiceTypeAdded(id, name, slug, priceUsd, cvDivisor);
    }

    function updateServiceType(uint256 id, string calldata name, string calldata slug, uint256 priceUsd, uint256 cvDivisor, string calldata status) external onlyOwner {
        require(id > 0 && id < nextServiceTypeId, "!id");
        require(cvDivisor > 0, "!cvDiv");
        ServiceType storage st = serviceTypes[id];
        st.name = name;
        st.slug = slug;
        st.priceUsd = priceUsd;
        st.cvDivisor = cvDivisor;
        st.status = status;
        emit ServiceTypeUpdated(id, name, slug, priceUsd, cvDivisor, status);
    }

    function getServiceType(uint256 id) external view returns (ServiceType memory) {
        require(id > 0 && id < nextServiceTypeId, "!id");
        return serviceTypes[id];
    }

    function getAllServiceTypes() external view returns (ServiceType[] memory) {
        uint256 count = nextServiceTypeId - 1;
        ServiceType[] memory result = new ServiceType[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = serviceTypes[i + 1];
        }
        return result;
    }

    // ─── Job Posting ──────────────────────────────────────────────────────────

    /// @notice Post a job paying with CLAWD. Frontend calculates clawdAmount from USD price at market rate.
    function postJob(uint256 serviceTypeId, uint256 clawdAmount, string calldata description) external nonReentrant {
        (uint256 priceUsd, ) = _validateService(serviceTypeId);
        require(bytes(description).length > 0, "!desc");
        require(clawdAmount >= 1e18, "!min");

        clawdToken.safeTransferFrom(msg.sender, address(this), clawdAmount);
        _createJob(msg.sender, serviceTypeId, clawdAmount, priceUsd, description, PaymentMethod.CLAWD, 0);
    }

    /// @notice Post a job on behalf of a client. Server calls this after receiving USDC via x402.
    /// @param client  The actual client address (the person paying via x402)
    /// @param serviceTypeId  The service type ID
    /// @param description  Job description
    /// @param minClawdOut  Minimum CLAWD expected from the USDC→CLAWD swap (slippage protection)
    function postJobFor(address client, uint256 serviceTypeId, string calldata description, uint256 minClawdOut) external nonReentrant {
        require(client != address(0), "!client");
        (uint256 priceUsd, ) = _validateService(serviceTypeId);
        require(bytes(description).length > 0, "!desc");

        usdcToken.safeTransferFrom(msg.sender, address(this), priceUsd);
        usdcToken.forceApprove(address(uniswapRouter), priceUsd);

        uint256 clawdReceived = uniswapRouter.exactInput(
            ISwapRouter02.ExactInputParams({
                path: swapPath,
                recipient: address(this),
                amountIn: priceUsd,
                amountOutMinimum: minClawdOut
            })
        );

        _createJob(client, serviceTypeId, clawdReceived, priceUsd, description, PaymentMethod.USDC, 0);
    }

    /// @notice Post a job paying with USDC — swaps to CLAWD
    function postJobWithUsdc(uint256 serviceTypeId, string calldata description, uint256 minClawdOut) external nonReentrant {
        (uint256 priceUsd, ) = _validateService(serviceTypeId);
        require(bytes(description).length > 0, "!desc");

        usdcToken.safeTransferFrom(msg.sender, address(this), priceUsd);
        usdcToken.forceApprove(address(uniswapRouter), priceUsd);

        uint256 clawdReceived = uniswapRouter.exactInput(
            ISwapRouter02.ExactInputParams({
                path: swapPath,
                recipient: address(this),
                amountIn: priceUsd,
                amountOutMinimum: minClawdOut
            })
        );

        _createJob(msg.sender, serviceTypeId, clawdReceived, priceUsd, description, PaymentMethod.USDC, 0);
    }

    /// @notice Post a job paying with ETH — wraps + swaps to CLAWD
    /// @param minClawdOut Minimum CLAWD expected from the ETH→CLAWD swap (slippage protection)
    function postJobWithETH(uint256 serviceTypeId, string calldata description, uint256 minClawdOut) external payable nonReentrant {
        (uint256 priceUsd, ) = _validateService(serviceTypeId);
        require(bytes(description).length > 0, "!desc");
        require(msg.value > 0, "!eth");
        require(minClawdOut > 0, "!minOut");

        uint256 clawdReceived = _swapETHToClawd(msg.value, minClawdOut);
        _createJob(msg.sender, serviceTypeId, clawdReceived, priceUsd, description, PaymentMethod.ETH, 0);
    }

    /// @notice Post a job paying with CV (off-chain, no on-chain payment)
    function postJobWithCV(uint256 serviceTypeId, uint256 cvAmount, string calldata description) external nonReentrant {
        (uint256 priceUsd, ) = _validateService(serviceTypeId);
        require(bytes(description).length > 0, "!desc");
        require(cvAmount > 0, "!cv");

        _createJob(msg.sender, serviceTypeId, 0, priceUsd, description, PaymentMethod.CV, cvAmount);
    }

    /// @notice Post a custom job with CLAWD
    function postJobCustom(uint256 clawdAmount, uint256 customPriceUsd, string calldata description) external nonReentrant {
        require(clawdAmount >= 1e18, "!min");
        require(bytes(description).length > 0, "!desc");

        clawdToken.safeTransferFrom(msg.sender, address(this), clawdAmount);
        _createJob(msg.sender, 0, clawdAmount, customPriceUsd, description, PaymentMethod.CLAWD, 0);
    }

    // ─── Job Lifecycle ────────────────────────────────────────────────────────

    function acceptJob(uint256 jobId) external nonReentrant onlyWorker {
        Job storage job = jobs[jobId];
        require(job.id != 0, "!job");
        require(job.status == JobStatus.OPEN || job.status == JobStatus.REASSIGNED, "!open");

        job.status = JobStatus.IN_PROGRESS;
        job.worker = msg.sender;
        job.startedAt = block.timestamp;
        job.currentStage = "accepted";

        // Transfer CLAWD escrow to treasury (skip if already claimed — REASSIGNED jobs have already been paid)
        if (job.paymentClawd > 0 && !job.paymentClaimed) {
            totalLockedClawd -= job.paymentClawd;
            job.paymentClaimed = true;
            clawdToken.safeTransfer(treasury, job.paymentClawd);
        }

        emit JobAccepted(jobId, msg.sender);
    }

    function declineJob(uint256 jobId) external nonReentrant onlyWorker {
        Job storage job = jobs[jobId];
        require(job.id != 0, "!job");
        require(job.status == JobStatus.OPEN, "!open");

        job.status = JobStatus.DECLINED;

        if (job.paymentClawd > 0) {
            totalLockedClawd -= job.paymentClawd;
            clawdToken.safeTransfer(job.client, job.paymentClawd);
        }

        emit JobDeclined(jobId, job.client);
    }

    function cancelJob(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.id != 0, "!job");
        require(job.client == msg.sender, "!client");
        require(job.status == JobStatus.OPEN, "!open");

        job.status = JobStatus.CANCELLED;

        if (job.paymentClawd > 0) {
            totalLockedClawd -= job.paymentClawd;
            clawdToken.safeTransfer(msg.sender, job.paymentClawd);
        }

        emit JobCancelled(jobId, msg.sender);
    }

    function completeJob(uint256 jobId, string calldata resultCID) external nonReentrant onlyWorker {
        Job storage job = jobs[jobId];
        require(job.id != 0, "!job");
        require(job.status == JobStatus.IN_PROGRESS, "!active");
        require(bytes(resultCID).length > 0, "!result");

        job.status = JobStatus.COMPLETED;
        job.resultCID = resultCID;
        job.completedAt = block.timestamp;

        emit JobCompleted(jobId, msg.sender, resultCID);
    }

    function logWork(uint256 jobId, string calldata note, string calldata stage) external nonReentrant onlyWorker {
        Job storage job = jobs[jobId];
        require(job.id != 0, "!job");
        require(job.status == JobStatus.IN_PROGRESS, "!active");
        require(bytes(note).length > 0 && bytes(note).length <= 500, "!note");

        if (bytes(stage).length > 0) {
            job.currentStage = stage;
        }
        workLogs[jobId].push(WorkLog({ note: note, timestamp: block.timestamp }));
        emit WorkLogged(jobId, msg.sender, note);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function addWorker(address worker) external onlyOwner {
        require(worker != address(0), "!addr");
        for (uint i = 0; i < workers.length; i++) {
            require(workers[i] != worker, "!dup");
        }
        workers.push(worker);
        emit WorkerAdded(worker);
    }

    function removeWorker(address worker) external onlyOwner {
        for (uint i = 0; i < workers.length; i++) {
            if (workers[i] == worker) {
                workers[i] = workers[workers.length - 1];
                workers.pop();
                emit WorkerRemoved(worker);
                return;
            }
        }
        revert("!worker");
    }

    function adminResetJob(uint256 jobId) external onlyOwner nonReentrant {
        Job storage job = jobs[jobId];
        require(job.id != 0, "!job");
        require(job.status == JobStatus.IN_PROGRESS || job.status == JobStatus.COMPLETED, "!active");

        emit JobReassigned(jobId, job.worker);

        job.status = JobStatus.REASSIGNED;
        job.worker = address(0);
        job.startedAt = 0;
        job.currentStage = "";
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "!addr");
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setSwapPath(bytes calldata newPath) external onlyOwner {
        require(newPath.length >= 43, "!path");
        swapPath = newPath;
        emit SwapPathUpdated(newPath);
    }

    function setEthSwapPath(bytes calldata newPath) external onlyOwner {
        require(newPath.length >= 23, "!path");
        ethSwapPath = newPath;
    }

    function withdrawStuckTokens(address token, address to) external onlyOwner nonReentrant {
        require(to != address(0), "!addr");
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "!bal");

        if (token == address(clawdToken)) {
            require(balance > totalLockedClawd, "!surplus");
            IERC20(token).safeTransfer(to, balance - totalLockedClawd);
        } else {
            IERC20(token).safeTransfer(to, balance);
        }
    }

    function withdrawETH(address payable to) external onlyOwner nonReentrant {
        require(to != address(0), "!addr");
        uint256 balance = address(this).balance;
        require(balance > 0, "!bal");
        (bool sent, ) = to.call{value: balance}("");
        require(sent, "!send");
    }

    // ─── View Functions ───────────────────────────────────────────────────────

    function getWorkers() external view returns (address[] memory) {
        return workers;
    }

    function isWorker(address worker) external view returns (bool) {
        for (uint i = 0; i < workers.length; i++) {
            if (workers[i] == worker) return true;
        }
        return false;
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        require(jobs[jobId].id != 0, "!job");
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

    function _validateService(uint256 serviceTypeId) internal view returns (uint256 priceUsd, ServiceType storage st) {
        require(serviceTypeId > 0 && serviceTypeId < nextServiceTypeId, "!svc");
        st = serviceTypes[serviceTypeId];
        priceUsd = st.priceUsd;
        require(priceUsd > 0, "!price");
        require(keccak256(bytes(st.status)) == keccak256("active"), "!active");
    }

    function _swapETHToClawd(uint256 ethAmount, uint256 minClawdOut) internal returns (uint256 clawdReceived) {
        IWETH9(weth).deposit{value: ethAmount}();
        IWETH9(weth).approve(address(uniswapRouter), ethAmount);

        clawdReceived = uniswapRouter.exactInput(
            ISwapRouter02.ExactInputParams({
                path: ethSwapPath,
                recipient: address(this),
                amountIn: ethAmount,
                amountOutMinimum: minClawdOut
            })
        );
    }

    function _createJob(
        address client,
        uint256 serviceTypeId,
        uint256 clawdAmount,
        uint256 priceUsd,
        string calldata description,
        PaymentMethod method,
        uint256 cvAmount
    ) internal {
        uint256 jobId = nextJobId++;
        if (clawdAmount > 0) totalLockedClawd += clawdAmount;

        jobs[jobId] = Job({
            id: jobId,
            client: client,
            serviceTypeId: serviceTypeId,
            paymentClawd: clawdAmount,
            priceUsd: priceUsd,
            description: description,
            status: JobStatus.OPEN,
            createdAt: block.timestamp,
            startedAt: 0,
            completedAt: 0,
            resultCID: "",
            worker: address(0),
            paymentClaimed: false,
            paymentMethod: method,
            cvAmount: cvAmount,
            currentStage: ""
        });

        emit JobPosted(jobId, client, serviceTypeId, clawdAmount, priceUsd, method, cvAmount);
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

    receive() external payable {}
}
