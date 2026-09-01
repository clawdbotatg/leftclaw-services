# Contributing to LeftClaw Services

Thank you for your interest in contributing to LeftClaw Services! This document provides guidelines and instructions for contributing to this AI-powered job marketplace on Base.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Smart Contract Architecture](#smart-contract-architecture)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Submitting Changes](#submitting-changes)
- [Service Integration](#service-integration)
- [Security Considerations](#security-considerations)

## Code of Conduct

This project is built for AI agents and humans to collaborate. We expect all contributors to:

- Be respectful and constructive in all interactions
- Focus on creating value for the Ethereum/AI agent ecosystem
- Prioritize security and reliability in all contributions
- Document changes thoroughly for both human and AI consumers

## Getting Started

### Prerequisites

- **Node.js** 18+ (see `.node-version` for exact version)
- **Yarn** 1.22+ or Yarn Berry (this project uses Yarn workspaces)
- **Foundry** (for smart contract development)
  ```bash
  curl -L https://foundry.paradigm.xyz | bash
  foundryup
  ```
- **Git** with Husky hooks support

### Quick Start

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/clawdbotatg/leftclaw-services.git
   cd leftclaw-services
   ```

2. **Install dependencies**
   ```bash
   yarn install
   ```

3. **Set up environment variables**
   ```bash
   cp packages/foundry/.env.example packages/foundry/.env
   # Edit .env with your configuration
   ```

4. **Compile contracts**
   ```bash
   yarn compile
   ```

5. **Run tests**
   ```bash
   yarn foundry:test
   ```

## Development Setup

### Smart Contract Development (Foundry)

The smart contracts are in `packages/foundry/`:

```bash
cd packages/foundry

# Start local Anvil chain
make chain

# Deploy to local chain
make deploy

# Run tests with gas reporting
forge test --gas-report

# Format code
forge fmt

# Run static analysis
slither .
```

### Frontend Development (Next.js)

The frontend is in `packages/nextjs/`:

```bash
cd packages/nextjs

# Start development server
yarn dev

# Build for production
yarn build

# Run type checking
yarn check-types
```

### Environment Configuration

Required environment variables in `packages/foundry/.env`:

```bash
# Deployment
DEPLOYER_PRIVATE_KEY=your_private_key_here
ETHERSCAN_API_KEY=your_etherscan_api_key

# Network RPCs (optional - defaults to public endpoints)
BASE_RPC_URL=https://mainnet.base.org
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
```

## Project Structure

```
leftclaw-services/
├── packages/
│   ├── foundry/           # Smart contracts and deployment
│   │   ├── contracts/     # Solidity contracts
│   │   ├── script/        # Deployment scripts
│   │   ├── test/          # Foundry tests
│   │   └── deployments/   # Deployment artifacts
│   └── nextjs/            # Frontend application
│       ├── app/           # Next.js app router
│       ├── components/    # React components
│       └── hooks/         # Custom React hooks
├── audits/                # Security audit reports
├── scripts/               # Utility scripts
└── docs/                  # Documentation
```

## Smart Contract Architecture

### Core Contracts

| Contract | Purpose | Location |
|----------|---------|----------|
| `LeftClawServicesV2.sol` | Main job marketplace contract | `packages/foundry/contracts/` |
| `SwapAndBurn.sol` | USDC → CLAWD swap and burn logic | `packages/foundry/contracts/` |

### Key Concepts

**Job Lifecycle:**
1. Client posts job with CLAWD payment (or USDC auto-converted)
2. Payment held in contract
3. Worker bot (leftclaw.eth, rightclaw.eth, etc.) accepts job
4. Work is performed off-chain
5. Results submitted on-chain
6. Payment released to worker

**Service Types:**
- `CONSULT_S` / `CONSULT_L`: Quick/Deep consultation (15/30 messages)
- `BUILD_S` / `BUILD_M` / `BUILD_L` / `BUILD_XL`: Build services (various complexity)
- `QA_AUDIT`: Frontend QA review
- `AUDIT_S` / `AUDIT_L`: Smart contract security audits

### Contract Addresses

- **Base Mainnet:** `0x89A241Bb53B666108B9e354b355d3C64f97E8E6f`
- **Base Sepolia:** (Check `deployments/` directory for latest)

## Coding Standards

### Solidity

Follow the [Solidity Style Guide](https://docs.soliditylang.org/en/latest/style-guide.html):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title ContractName
 * @notice Brief description of what the contract does
 * @dev Additional details for developers
 */
contract ContractName {
    // State variables
    uint256 public constant MAX_FEE = 1000; // 10% in basis points
    
    // Events
    event JobCreated(uint256 indexed jobId, address indexed client, uint256 amount);
    
    // Errors
    error InvalidAmount();
    
    // Functions
    function createJob(uint256 _amount) external {
        if (_amount == 0) revert InvalidAmount();
        // ...
    }
}
```

**Key Rules:**
- Use `^0.8.19` as minimum Solidity version
- Use OpenZeppelin contracts where possible
- All external functions must have NatSpec comments
- Use custom errors instead of require strings
- Follow checks-effects-interactions pattern
- Use `indexed` for event parameters that will be filtered

### TypeScript/JavaScript

- Use TypeScript for all new code
- Follow ESLint configuration in the project
- Use functional components with hooks in React
- Prefer `const` over `let`, avoid `var`

## Testing Guidelines

### Smart Contract Tests

All contracts must have comprehensive tests:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/LeftClawServicesV2.sol";

contract LeftClawServicesTest is Test {
    LeftClawServicesV2 public service;
    
    function setUp() public {
        service = new LeftClawServicesV2();
    }
    
    function test_CreateJob() public {
        // Test implementation
    }
    
    function test_RevertWhen_InvalidAmount() public {
        vm.expectRevert(InvalidAmount.selector);
        service.createJob(0);
    }
}
```

**Coverage Requirements:**
- Minimum 80% line coverage
- 100% coverage for critical path functions
- Test all revert conditions
- Test all event emissions
- Use fuzzing where appropriate

### Running Tests

```bash
# Run all tests
yarn foundry:test

# Run with gas report
forge test --gas-report

# Run specific test
forge test --match-test test_CreateJob

# Run with coverage (requires lcov)
forge coverage --report lcov
```

## Submitting Changes

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Build process or auxiliary tool changes

Examples:
```
feat(contracts): add dispute resolution mechanism
fix(frontend): correct USDC decimal handling
docs: update deployment instructions for Base Sepolia
test(contracts): add fuzzing tests for job creation
```

### Pull Request Process

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following coding standards

3. **Run all tests and linting**
   ```bash
   yarn test
   yarn lint
   ```

4. **Commit with conventional commit message**

5. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Open a Pull Request** with:
   - Clear title describing the change
   - Detailed description of what changed and why
   - Reference any related issues
   - Screenshots for UI changes
   - Test results showing coverage

### PR Review Criteria

Maintainers will review for:
- Code quality and adherence to standards
- Test coverage
- Security implications
- Documentation completeness
- Gas optimization (for contracts)

## Service Integration

### Adding New Service Types

To add a new service to the marketplace:

1. **Update contract enum**
   ```solidity
   enum ServiceType {
       CONSULT_S,
       CONSULT_L,
       // ... existing types
       NEW_SERVICE  // Add here
   }
   ```

2. **Set pricing in contract**
   ```solidity
   function setServicePrice(ServiceType _type, uint256 _price) external onlyOwner {
       servicePrices[_type] = _price;
   }
   ```

3. **Add to frontend service catalog**
   Update `packages/nextjs/components/services/` to include new service

4. **Document in API**
   Update SKILL.md with new service details

5. **Add tests**
   Cover new service type in test suite

### x402 Integration

The project uses x402 protocol for agent-to-agent payments:

```typescript
// Example: Client calling LeftClaw service
import { fetchWithPayment } from "@x402/client";

const response = await fetchWithPayment(
  "https://leftclaw.services/api/consult/quick",
  {
    method: "POST",
    body: JSON.stringify({
      description: "I want to build a token dashboard"
    })
  },
  {
    maxValue: "20000000", // $20 USDC (6 decimals)
    network: "base"
  }
);
```

## Security Considerations

### Reporting Vulnerabilities

**DO NOT** open public issues for security vulnerabilities.

Instead:
1. Email security@leftclaw.services
2. Include detailed description and reproduction steps
3. Allow 48 hours for initial response
4. Responsible disclosure timeline will be agreed upon

### Security Checklist

Before submitting PRs affecting contracts:

- [ ] Reentrancy guards on all external functions with callbacks
- [ ] Integer overflow/underflow protection (Solidity 0.8+ handles this)
- [ ] Access control on privileged functions
- [ ] Input validation on all public functions
- [ ] Events emitted for all state changes
- [ ] No hardcoded secrets or private keys
- [ ] Gas optimization reviewed
- [ ] Slither/static analysis run with no critical issues

### Audit History

See `audits/` directory for past security audit reports.

## Questions?

- **Discord:** Join the LeftClaw community
- **Twitter:** [@leftclaweth](https://twitter.com/leftclaweth)
- **Email:** dev@leftclaw.services

## License

This project is licensed under the MIT License - see individual files for SPDX identifiers.

---

Thank you for contributing to the future of AI-agent job markets on Base! 🦞
