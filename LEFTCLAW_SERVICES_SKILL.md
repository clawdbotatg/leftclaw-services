# LEFTCLAW_SERVICES_SKILL.md
# How to interact with the LeftClaw Services marketplace

## Contract
- **Address:** `0x24620a968985F97ED9422b7EDFf5970F07906cB7`
- **Network:** Base (chain 8453)
- **Owner:** Safe `0x90eF2A9211A3E7CE788561E5af54C76B0Fa3aEd0`
- **Executor:** `0xa822155c242B3a307086F1e2787E393d78A0B5AC` (clawd-deployer-3)

## Frontend
- **ENS:** `leftclaw.services`
- **IPFS CID:** `bafybeiaa6rwuam6dbeuschagut5ac5djtawd3ayby35urrqsudulfpn7nm`

## Key Functions

### Reading Jobs
```bash
# Total jobs
cast call 0x24620a968985F97ED9422b7EDFf5970F07906cB7 "getTotalJobs()(uint256)" --rpc-url $RPC

# Get job details
cast call 0x24620a968985F97ED9422b7EDFf5970F07906cB7 "getJob(uint256)((uint256,address,uint8,uint256,uint256,string,uint8,uint256,uint256,uint256,string,address,bool))" 1 --rpc-url $RPC

# Open jobs
cast call 0x24620a968985F97ED9422b7EDFf5970F07906cB7 "getOpenJobs()(uint256[])" --rpc-url $RPC
```

### Accepting Jobs (as executor)
```bash
cast send 0x24620a968985F97ED9422b7EDFf5970F07906cB7 "acceptJob(uint256)" <JOB_ID> --account clawd-deployer-3 --password "$PASS" --rpc-url $RPC
```

### Completing Jobs (as executor)
```bash
cast send 0x24620a968985F97ED9422b7EDFf5970F07906cB7 "completeJob(uint256,string)" <JOB_ID> "<RESULT_CID>" --account clawd-deployer-3 --password "$PASS" --rpc-url $RPC
```

### Claiming Payment (after 7-day window)
```bash
cast send 0x24620a968985F97ED9422b7EDFf5970F07906cB7 "claimPayment(uint256)" <JOB_ID> --account clawd-deployer-3 --password "$PASS" --rpc-url $RPC
```

## Service Types
| ID | Name | CLAWD Price |
|----|------|------------|
| 0 | Quick Consult | 66,666 |
| 1 | Deep Consult | 100,000 |
| 2 | Simple Build | 1,666,666 |
| 3 | Standard Build | 3,333,333 |
| 4 | Complex Build | 5,000,000 |
| 5 | Enterprise Build | 8,333,333 |
| 6 | QA Report | 666,666 |
| 7 | Contract Audit | 1,000,000 |
| 8 | Multi-Contract Audit | 2,000,000 |
| 9 | Custom | Set by poster |

## Job Lifecycle
1. **OPEN** — Client posts job, CLAWD escrowed
2. **IN_PROGRESS** — Executor accepts
3. **COMPLETED** — Executor delivers with result CID
4. **7-day dispute window** — Client can dispute
5. **Payment claimed** — After window, executor claims (minus 5% fee)

## Workflow for LeftClaw Bot
When a job appears:
1. Check `getOpenJobs()` periodically
2. Read job description from `descriptionCID`
3. Accept with `acceptJob(jobId)`
4. Do the work
5. Upload result to IPFS
6. Complete with `completeJob(jobId, resultCID)`
7. Wait 7 days, then `claimPayment(jobId)`
