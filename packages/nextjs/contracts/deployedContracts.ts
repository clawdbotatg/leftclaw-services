import { GenericContractsDeclaration } from "~~/utils/scaffold-eth/contract";

const deployedContracts = {
  8453: {
    LeftClawServices: {
      address: "0x5CEa089366cc1de99762Bd22c72b63fa29Cd7df4",
      abi: [
        {
                "type": "constructor",
                "inputs": [
                        {
                                "name": "_clawdToken",
                                "type": "address",
                                "internalType": "address"
                        },
                        {
                                "name": "_usdcToken",
                                "type": "address",
                                "internalType": "address"
                        },
                        {
                                "name": "_uniswapRouter",
                                "type": "address",
                                "internalType": "address"
                        },
                        {
                                "name": "_weth",
                                "type": "address",
                                "internalType": "address"
                        }
                ],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "DEAD_ADDRESS",
                "inputs": [],
                "outputs": [
                        {
                                "name": "",
                                "type": "address",
                                "internalType": "address"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "DISPUTE_TIMEOUT",
                "inputs": [],
                "outputs": [
                        {
                                "name": "",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "DISPUTE_WINDOW",
                "inputs": [],
                "outputs": [
                        {
                                "name": "",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "MAX_FEE_BPS",
                "inputs": [],
                "outputs": [
                        {
                                "name": "",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "acceptJob",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "accumulatedFees",
                "inputs": [],
                "outputs": [
                        {
                                "name": "",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "addWorker",
                "inputs": [
                        {
                                "name": "worker",
                                "type": "address",
                                "internalType": "address"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "burnConsultation",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "gistUrl",
                                "type": "string",
                                "internalType": "string"
                        },
                        {
                                "name": "recommendedBuildType",
                                "type": "uint8",
                                "internalType": "enum LeftClawServices.ServiceType"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "cancelJob",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "claimPayment",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "clawdToken",
                "inputs": [],
                "outputs": [
                        {
                                "name": "",
                                "type": "address",
                                "internalType": "contract IERC20"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "completeJob",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "resultCID",
                                "type": "string",
                                "internalType": "string"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "disputeJob",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "getJob",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "outputs": [
                        {
                                "name": "",
                                "type": "tuple",
                                "internalType": "struct LeftClawServices.Job",
                                "components": [
                                        {
                                                "name": "id",
                                                "type": "uint256",
                                                "internalType": "uint256"
                                        },
                                        {
                                                "name": "client",
                                                "type": "address",
                                                "internalType": "address"
                                        },
                                        {
                                                "name": "serviceType",
                                                "type": "uint8",
                                                "internalType": "enum LeftClawServices.ServiceType"
                                        },
                                        {
                                                "name": "paymentClawd",
                                                "type": "uint256",
                                                "internalType": "uint256"
                                        },
                                        {
                                                "name": "priceUsd",
                                                "type": "uint256",
                                                "internalType": "uint256"
                                        },
                                        {
                                                "name": "descriptionCID",
                                                "type": "string",
                                                "internalType": "string"
                                        },
                                        {
                                                "name": "status",
                                                "type": "uint8",
                                                "internalType": "enum LeftClawServices.JobStatus"
                                        },
                                        {
                                                "name": "createdAt",
                                                "type": "uint256",
                                                "internalType": "uint256"
                                        },
                                        {
                                                "name": "startedAt",
                                                "type": "uint256",
                                                "internalType": "uint256"
                                        },
                                        {
                                                "name": "completedAt",
                                                "type": "uint256",
                                                "internalType": "uint256"
                                        },
                                        {
                                                "name": "resultCID",
                                                "type": "string",
                                                "internalType": "string"
                                        },
                                        {
                                                "name": "worker",
                                                "type": "address",
                                                "internalType": "address"
                                        },
                                        {
                                                "name": "paymentClaimed",
                                                "type": "bool",
                                                "internalType": "bool"
                                        },
                                        {
                                                "name": "feeSnapshot",
                                                "type": "uint256",
                                                "internalType": "uint256"
                                        },
                                        {
                                                "name": "disputedAt",
                                                "type": "uint256",
                                                "internalType": "uint256"
                                        },
                                        {
                                                "name": "paymentMethod",
                                                "type": "uint8",
                                                "internalType": "enum LeftClawServices.PaymentMethod"
                                        },
                                        {
                                                "name": "cvAmount",
                                                "type": "uint256",
                                                "internalType": "uint256"
                                        }
                                ]
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "getJobsByClient",
                "inputs": [
                        {
                                "name": "client",
                                "type": "address",
                                "internalType": "address"
                        }
                ],
                "outputs": [
                        {
                                "name": "",
                                "type": "uint256[]",
                                "internalType": "uint256[]"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "getJobsByStatus",
                "inputs": [
                        {
                                "name": "status",
                                "type": "uint8",
                                "internalType": "enum LeftClawServices.JobStatus"
                        }
                ],
                "outputs": [
                        {
                                "name": "",
                                "type": "uint256[]",
                                "internalType": "uint256[]"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "getOpenJobs",
                "inputs": [],
                "outputs": [
                        {
                                "name": "",
                                "type": "uint256[]",
                                "internalType": "uint256[]"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "getTotalJobs",
                "inputs": [],
                "outputs": [
                        {
                                "name": "",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "getWorkLogs",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "outputs": [
                        {
                                "name": "",
                                "type": "tuple[]",
                                "internalType": "struct LeftClawServices.WorkLog[]",
                                "components": [
                                        {
                                                "name": "note",
                                                "type": "string",
                                                "internalType": "string"
                                        },
                                        {
                                                "name": "timestamp",
                                                "type": "uint256",
                                                "internalType": "uint256"
                                        }
                                ]
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "isWorker",
                "inputs": [
                        {
                                "name": "",
                                "type": "address",
                                "internalType": "address"
                        }
                ],
                "outputs": [
                        {
                                "name": "",
                                "type": "bool",
                                "internalType": "bool"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "jobs",
                "inputs": [
                        {
                                "name": "",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "outputs": [
                        {
                                "name": "id",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "client",
                                "type": "address",
                                "internalType": "address"
                        },
                        {
                                "name": "serviceType",
                                "type": "uint8",
                                "internalType": "enum LeftClawServices.ServiceType"
                        },
                        {
                                "name": "paymentClawd",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "priceUsd",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "descriptionCID",
                                "type": "string",
                                "internalType": "string"
                        },
                        {
                                "name": "status",
                                "type": "uint8",
                                "internalType": "enum LeftClawServices.JobStatus"
                        },
                        {
                                "name": "createdAt",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "startedAt",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "completedAt",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "resultCID",
                                "type": "string",
                                "internalType": "string"
                        },
                        {
                                "name": "worker",
                                "type": "address",
                                "internalType": "address"
                        },
                        {
                                "name": "paymentClaimed",
                                "type": "bool",
                                "internalType": "bool"
                        },
                        {
                                "name": "feeSnapshot",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "disputedAt",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "paymentMethod",
                                "type": "uint8",
                                "internalType": "enum LeftClawServices.PaymentMethod"
                        },
                        {
                                "name": "cvAmount",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "logWork",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "note",
                                "type": "string",
                                "internalType": "string"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "nextJobId",
                "inputs": [],
                "outputs": [
                        {
                                "name": "",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "owner",
                "inputs": [],
                "outputs": [
                        {
                                "name": "",
                                "type": "address",
                                "internalType": "address"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "postJob",
                "inputs": [
                        {
                                "name": "serviceType",
                                "type": "uint8",
                                "internalType": "enum LeftClawServices.ServiceType"
                        },
                        {
                                "name": "clawdAmount",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "descriptionCID",
                                "type": "string",
                                "internalType": "string"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "postJobCustom",
                "inputs": [
                        {
                                "name": "clawdAmount",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "customPriceUsd",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "descriptionCID",
                                "type": "string",
                                "internalType": "string"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "postJobCustomCV",
                "inputs": [
                        {
                                "name": "cvAmount",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "customPriceUsd",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "descriptionCID",
                                "type": "string",
                                "internalType": "string"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "postJobCustomETH",
                "inputs": [
                        {
                                "name": "customPriceUsd",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "descriptionCID",
                                "type": "string",
                                "internalType": "string"
                        }
                ],
                "outputs": [],
                "stateMutability": "payable"
        },
        {
                "type": "function",
                "name": "postJobCustomUsdc",
                "inputs": [
                        {
                                "name": "usdcAmount",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "descriptionCID",
                                "type": "string",
                                "internalType": "string"
                        },
                        {
                                "name": "minClawdOut",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "postJobWithCV",
                "inputs": [
                        {
                                "name": "serviceType",
                                "type": "uint8",
                                "internalType": "enum LeftClawServices.ServiceType"
                        },
                        {
                                "name": "cvAmount",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "descriptionCID",
                                "type": "string",
                                "internalType": "string"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "postJobWithETH",
                "inputs": [
                        {
                                "name": "serviceType",
                                "type": "uint8",
                                "internalType": "enum LeftClawServices.ServiceType"
                        },
                        {
                                "name": "descriptionCID",
                                "type": "string",
                                "internalType": "string"
                        }
                ],
                "outputs": [],
                "stateMutability": "payable"
        },
        {
                "type": "function",
                "name": "postJobWithUsdc",
                "inputs": [
                        {
                                "name": "serviceType",
                                "type": "uint8",
                                "internalType": "enum LeftClawServices.ServiceType"
                        },
                        {
                                "name": "descriptionCID",
                                "type": "string",
                                "internalType": "string"
                        },
                        {
                                "name": "minClawdOut",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "protocolFeeBps",
                "inputs": [],
                "outputs": [
                        {
                                "name": "",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "rejectJob",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "removeWorker",
                "inputs": [
                        {
                                "name": "worker",
                                "type": "address",
                                "internalType": "address"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "renounceOwnership",
                "inputs": [],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "resolveDispute",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "refundClient",
                                "type": "bool",
                                "internalType": "bool"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "servicePriceUsd",
                "inputs": [
                        {
                                "name": "",
                                "type": "uint8",
                                "internalType": "enum LeftClawServices.ServiceType"
                        }
                ],
                "outputs": [
                        {
                                "name": "",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "setProtocolFee",
                "inputs": [
                        {
                                "name": "feeBps",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "setSwapPath",
                "inputs": [
                        {
                                "name": "newPath",
                                "type": "bytes",
                                "internalType": "bytes"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "swapPath",
                "inputs": [],
                "outputs": [
                        {
                                "name": "",
                                "type": "bytes",
                                "internalType": "bytes"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "totalLockedClawd",
                "inputs": [],
                "outputs": [
                        {
                                "name": "",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "transferOwnership",
                "inputs": [
                        {
                                "name": "newOwner",
                                "type": "address",
                                "internalType": "address"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "uniswapRouter",
                "inputs": [],
                "outputs": [
                        {
                                "name": "",
                                "type": "address",
                                "internalType": "contract ISwapRouter"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "updatePrice",
                "inputs": [
                        {
                                "name": "serviceType",
                                "type": "uint8",
                                "internalType": "enum LeftClawServices.ServiceType"
                        },
                        {
                                "name": "priceUsd",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "usdcToken",
                "inputs": [],
                "outputs": [
                        {
                                "name": "",
                                "type": "address",
                                "internalType": "contract IERC20"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "weth",
                "inputs": [],
                "outputs": [
                        {
                                "name": "",
                                "type": "address",
                                "internalType": "address"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "function",
                "name": "withdrawETH",
                "inputs": [
                        {
                                "name": "to",
                                "type": "address",
                                "internalType": "address payable"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "withdrawProtocolFees",
                "inputs": [
                        {
                                "name": "to",
                                "type": "address",
                                "internalType": "address"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "withdrawStuckTokens",
                "inputs": [
                        {
                                "name": "token",
                                "type": "address",
                                "internalType": "address"
                        },
                        {
                                "name": "to",
                                "type": "address",
                                "internalType": "address"
                        }
                ],
                "outputs": [],
                "stateMutability": "nonpayable"
        },
        {
                "type": "function",
                "name": "workLogs",
                "inputs": [
                        {
                                "name": "",
                                "type": "uint256",
                                "internalType": "uint256"
                        },
                        {
                                "name": "",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "outputs": [
                        {
                                "name": "note",
                                "type": "string",
                                "internalType": "string"
                        },
                        {
                                "name": "timestamp",
                                "type": "uint256",
                                "internalType": "uint256"
                        }
                ],
                "stateMutability": "view"
        },
        {
                "type": "event",
                "name": "ConsultationComplete",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "indexed": true,
                                "internalType": "uint256"
                        },
                        {
                                "name": "client",
                                "type": "address",
                                "indexed": true,
                                "internalType": "address"
                        },
                        {
                                "name": "gistUrl",
                                "type": "string",
                                "indexed": false,
                                "internalType": "string"
                        },
                        {
                                "name": "recommendedBuildType",
                                "type": "uint8",
                                "indexed": false,
                                "internalType": "enum LeftClawServices.ServiceType"
                        }
                ],
                "anonymous": false
        },
        {
                "type": "event",
                "name": "DisputeResolved",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "indexed": true,
                                "internalType": "uint256"
                        },
                        {
                                "name": "refundedClient",
                                "type": "bool",
                                "indexed": false,
                                "internalType": "bool"
                        }
                ],
                "anonymous": false
        },
        {
                "type": "event",
                "name": "FeesWithdrawn",
                "inputs": [
                        {
                                "name": "to",
                                "type": "address",
                                "indexed": true,
                                "internalType": "address"
                        },
                        {
                                "name": "amount",
                                "type": "uint256",
                                "indexed": false,
                                "internalType": "uint256"
                        }
                ],
                "anonymous": false
        },
        {
                "type": "event",
                "name": "JobAccepted",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "indexed": true,
                                "internalType": "uint256"
                        },
                        {
                                "name": "worker",
                                "type": "address",
                                "indexed": true,
                                "internalType": "address"
                        }
                ],
                "anonymous": false
        },
        {
                "type": "event",
                "name": "JobCancelled",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "indexed": true,
                                "internalType": "uint256"
                        },
                        {
                                "name": "client",
                                "type": "address",
                                "indexed": true,
                                "internalType": "address"
                        }
                ],
                "anonymous": false
        },
        {
                "type": "event",
                "name": "JobCompleted",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "indexed": true,
                                "internalType": "uint256"
                        },
                        {
                                "name": "worker",
                                "type": "address",
                                "indexed": true,
                                "internalType": "address"
                        },
                        {
                                "name": "resultCID",
                                "type": "string",
                                "indexed": false,
                                "internalType": "string"
                        }
                ],
                "anonymous": false
        },
        {
                "type": "event",
                "name": "JobDisputed",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "indexed": true,
                                "internalType": "uint256"
                        },
                        {
                                "name": "client",
                                "type": "address",
                                "indexed": true,
                                "internalType": "address"
                        }
                ],
                "anonymous": false
        },
        {
                "type": "event",
                "name": "JobPosted",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "indexed": true,
                                "internalType": "uint256"
                        },
                        {
                                "name": "client",
                                "type": "address",
                                "indexed": true,
                                "internalType": "address"
                        },
                        {
                                "name": "serviceType",
                                "type": "uint8",
                                "indexed": false,
                                "internalType": "enum LeftClawServices.ServiceType"
                        },
                        {
                                "name": "paymentClawd",
                                "type": "uint256",
                                "indexed": false,
                                "internalType": "uint256"
                        },
                        {
                                "name": "priceUsd",
                                "type": "uint256",
                                "indexed": false,
                                "internalType": "uint256"
                        },
                        {
                                "name": "descriptionCID",
                                "type": "string",
                                "indexed": false,
                                "internalType": "string"
                        },
                        {
                                "name": "paymentMethod",
                                "type": "uint8",
                                "indexed": false,
                                "internalType": "enum LeftClawServices.PaymentMethod"
                        },
                        {
                                "name": "cvAmount",
                                "type": "uint256",
                                "indexed": false,
                                "internalType": "uint256"
                        }
                ],
                "anonymous": false
        },
        {
                "type": "event",
                "name": "JobRejected",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "indexed": true,
                                "internalType": "uint256"
                        },
                        {
                                "name": "client",
                                "type": "address",
                                "indexed": true,
                                "internalType": "address"
                        }
                ],
                "anonymous": false
        },
        {
                "type": "event",
                "name": "OwnershipTransferred",
                "inputs": [
                        {
                                "name": "previousOwner",
                                "type": "address",
                                "indexed": true,
                                "internalType": "address"
                        },
                        {
                                "name": "newOwner",
                                "type": "address",
                                "indexed": true,
                                "internalType": "address"
                        }
                ],
                "anonymous": false
        },
        {
                "type": "event",
                "name": "PaymentClaimed",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "indexed": true,
                                "internalType": "uint256"
                        },
                        {
                                "name": "worker",
                                "type": "address",
                                "indexed": true,
                                "internalType": "address"
                        },
                        {
                                "name": "amount",
                                "type": "uint256",
                                "indexed": false,
                                "internalType": "uint256"
                        }
                ],
                "anonymous": false
        },
        {
                "type": "event",
                "name": "PriceUpdated",
                "inputs": [
                        {
                                "name": "serviceType",
                                "type": "uint8",
                                "indexed": true,
                                "internalType": "enum LeftClawServices.ServiceType"
                        },
                        {
                                "name": "newPriceUsd",
                                "type": "uint256",
                                "indexed": false,
                                "internalType": "uint256"
                        }
                ],
                "anonymous": false
        },
        {
                "type": "event",
                "name": "ProtocolFeeUpdated",
                "inputs": [
                        {
                                "name": "newFeeBps",
                                "type": "uint256",
                                "indexed": false,
                                "internalType": "uint256"
                        }
                ],
                "anonymous": false
        },
        {
                "type": "event",
                "name": "SwapPathUpdated",
                "inputs": [
                        {
                                "name": "newPath",
                                "type": "bytes",
                                "indexed": false,
                                "internalType": "bytes"
                        }
                ],
                "anonymous": false
        },
        {
                "type": "event",
                "name": "WorkLogged",
                "inputs": [
                        {
                                "name": "jobId",
                                "type": "uint256",
                                "indexed": true,
                                "internalType": "uint256"
                        },
                        {
                                "name": "worker",
                                "type": "address",
                                "indexed": true,
                                "internalType": "address"
                        },
                        {
                                "name": "note",
                                "type": "string",
                                "indexed": false,
                                "internalType": "string"
                        }
                ],
                "anonymous": false
        },
        {
                "type": "event",
                "name": "WorkerAdded",
                "inputs": [
                        {
                                "name": "worker",
                                "type": "address",
                                "indexed": true,
                                "internalType": "address"
                        }
                ],
                "anonymous": false
        },
        {
                "type": "event",
                "name": "WorkerRemoved",
                "inputs": [
                        {
                                "name": "worker",
                                "type": "address",
                                "indexed": true,
                                "internalType": "address"
                        }
                ],
                "anonymous": false
        },
        {
                "type": "error",
                "name": "OwnableInvalidOwner",
                "inputs": [
                        {
                                "name": "owner",
                                "type": "address",
                                "internalType": "address"
                        }
                ]
        },
        {
                "type": "error",
                "name": "OwnableUnauthorizedAccount",
                "inputs": [
                        {
                                "name": "account",
                                "type": "address",
                                "internalType": "address"
                        }
                ]
        },
        {
                "type": "error",
                "name": "ReentrancyGuardReentrantCall",
                "inputs": []
        },
        {
                "type": "error",
                "name": "SafeERC20FailedOperation",
                "inputs": [
                        {
                                "name": "token",
                                "type": "address",
                                "internalType": "address"
                        }
                ]
        }
],
    },
  },
} as const;

export default deployedContracts satisfies GenericContractsDeclaration;
