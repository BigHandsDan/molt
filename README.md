# Molt

[![CI](https://github.com/BigHandsDan/molt/actions/workflows/ci.yml/badge.svg)](https://github.com/BigHandsDan/molt/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

**Governance infrastructure for autonomous AI agents.**

Molt is a monorepo containing three packages that form a complete governance stack for AI agent systems: identity verification, policy enforcement, and inter-agent communication.

## Packages

| Package | Description | Version | Tests |
|---------|-------------|---------|-------|
| [`@molt/captcha`](packages/captcha) | Reverse CAPTCHA — SMHL challenge engine for AI verification | 1.0.0 | 51 |
| [`@molt/permit`](packages/permit) | Cedar-based policy engine with SQLite audit and JIT tokens | 0.1.0 | 71 |
| [`@molt/mesh`](packages/mesh) | Agent interoperability bus with federation and exchange | 0.1.0 | 467 |
| [`molt`](packages/molt) | Meta-package that re-exports all three | 0.1.0 | — |

**Total: 589 tests**

## Quick Start

```bash
# Install all dependencies
npm install

# Build all packages
npm run build

# Run all tests (589 tests across 3 packages)
npm test
```

### Using the meta-package

```bash
npm install molt
```

```typescript
import { MoltCaptcha, MoltPermit, MoltMesh } from 'molt';

// Or use namespaced imports
import { captcha, permit, mesh } from 'molt';
```

### Using individual packages

```bash
npm install @molt/captcha
npm install @molt/permit
npm install @molt/mesh
```

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Molt Ecosystem                        │
├──────────────┬──────────────────┬────────────────────────────┤
│  @molt/captcha │   @molt/permit   │        @molt/mesh          │
│               │                  │                            │
│  SMHL reverse │  Cedar policies  │  Agent bus + contracts     │
│  CAPTCHA for  │  Audit logging   │  Federation + exchange     │
│  AI verify    │  Budget tracking │  Circuit breakers + trace  │
│               │  JIT tokens      │  Gateway + webhooks        │
└──────────────┴──────────────────┴────────────────────────────┘
```

- **@molt/captcha** generates semantic-mathematical challenges that are trivial for LLMs but impossible for humans, providing proof-of-AI identity.
- **@molt/permit** evaluates Cedar policies to enforce scoped, auditable, and reversible actions based on agent trust tiers.
- **@molt/mesh** provides the interoperability bus — shared contracts, adapter-based translation, policy enforcement, federation across organizations, and a service exchange marketplace.

## Development

This monorepo uses [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces) and [Turborepo](https://turbo.build/) for orchestration.

```bash
# Build all packages (with dependency ordering)
npm run build

# Run all tests
npm test

# Type-check all packages
npm run typecheck

# Lint all packages
npm run lint

# Clean all build artifacts
npm run clean
```

### Working on a single package

```bash
# Run tests for just captcha
npm test -w packages/captcha

# Build just mesh
npm run build -w packages/mesh
```

## Project Structure

```
molt/
├── packages/
│   ├── captcha/     # @molt/captcha — AI verification
│   ├── permit/      # @molt/permit — Policy enforcement
│   ├── mesh/        # @molt/mesh — Agent interoperability bus
│   └── molt/        # molt — Meta-package re-exporting all three
├── turbo.json       # Turborepo pipeline config
├── tsconfig.base.json # Shared TypeScript config
└── package.json     # Root workspace config
```

## Related

- [MoltDoor](https://moltdoor.net) — Agent reputation and review platform (separate web app)

## License

Apache-2.0
