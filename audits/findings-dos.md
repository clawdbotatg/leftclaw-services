# DoS Audit Findings — LeftClawServices.sol

## [Info-1] Unbounded Loops in View Functions
**Severity**: Info
**Category**: evm-audit-dos
**Location**: `getOpenJobs()`, `getJobsByStatus()`, `getJobsByClient()`

**Description**: These functions loop through all jobs to filter by status or client. As job count grows into thousands, these calls could hit block gas limits if called on-chain. However, they are view functions intended for off-chain RPC calls which are free.

**Proof of Concept**: Deploy contract, create 10,000+ jobs, call `getOpenJobs()` on-chain.

**Recommendation**: Acceptable for v1. For scale, implement event-based indexing off-chain instead of on-chain filtering. Events `JobPosted`, `JobAccepted`, etc. are already emitted — index those.

---

## [Info-2] No Pagination for Job Lists
**Severity**: Info
**Category**: evm-audit-dos
**Location**: All view functions returning job arrays

**Description**: No pagination mechanism for large result sets. If job count grows large, even off-chain calls could be slow.

**Recommendation**: Add `getJobsPaginated(uint256 offset, uint256 limit)` for frontend use. Low priority — current approach works for early-stage usage.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| Info | 2 |

View function loops are the only concern. They're acceptable for off-chain use but should be replaced with event-based indexing at scale.