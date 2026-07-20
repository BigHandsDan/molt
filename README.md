# trust/agent

[![CI](https://github.com/BigHandsDan/molt/actions/workflows/ci.yml/badge.svg)](https://github.com/BigHandsDan/molt/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

**Experimental governance infrastructure ideas for autonomous AI agents.**

Molt explores practical layers for making AI agents more trustworthy and interoperable: proving they are AI, enforcing policies on what they can do, enabling safe communication and service exchange between agents, remembering things over time, and evaluating their behavior.

> **Status**: This is an early experimental prototype / idea sketch. It was built as a learning exercise with significant assistance from AI coding tools. It has not been security audited.
>
> Suitable for experimentation, forking, and inspiration. **Not recommended for production use** without thorough review and testing.

## What's Inside

| Package | Focus | Status |
|---------|-------|--------|
| [`@molt/captcha`](packages/captcha) | Reverse CAPTCHA (SMHL challenges) for AI verification | Experimental |
| [`@molt/permit`](packages/permit) | Cedar-based policy engine + audit + JIT tokens | Experimental |
| [`@molt/mesh`](packages/mesh) | Agent interoperability bus, federation, and exchange | Experimental |
| [`@molt/eval`](packages/eval) | Evaluation, metrics, regression detection, gating | Experimental |
| [`@molt/memory`](packages/memory) | Three-tier agent memory with keyword-indexed bins | Experimental |
| [`molt`](packages/molt) | Meta-package that re-exports the others | Experimental |

See the individual package READMEs for usage details.

## Vision

Autonomous agents are growing fast. This project explores simple, composable tools so they can:

- Prove they're actually AI (not humans gaming systems)
- Follow clear, auditable rules
- Talk to each other and trade services safely across organizations
- Remember and reuse context efficiently
- Be evaluated and improved over time

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Molt Ecosystem                        │
├──────────────┬──────────────────┬────────────────────────────┬───────────────────┤
│  @molt/captcha │   @molt/permit   │        @molt/mesh          │    @molt/eval     │
│               │                  │                            │                   │
│  SMHL reverse │  Cedar policies  │  Agent bus + contracts     │  Metrics engine   │
│  CAPTCHA for  │  Audit logging   │  Federation + exchange     │  Regression check │
│  AI verify    │  Budget tracking │  Circuit breakers + trace  │  Release gating   │
│               │  JIT tokens      │  Gateway + webhooks        │  Adversarial gen  │
└──────────────┴──────────────────┴────────────────────────────┴───────────────────┘
```

- **@molt/captcha** generates semantic-mathematical challenges that are trivial for LLMs but impossible for humans, providing proof-of-AI identity.
- **@molt/permit** evaluates Cedar policies to enforce scoped, auditable, and reversible actions based on agent trust tiers.
- **@molt/mesh** provides the interoperability bus — shared contracts, adapter-based translation, policy enforcement, federation across organizations, and a service exchange marketplace.
- **@molt/eval** is the evaluation engine — pluggable metrics, regression detection, release gating, adversarial test generation, and integrations with MoltMesh, MoltPermit, and MoltDoor.
- **@molt/memory** is a three-tier memory system with keyword-indexed compressed bins and automatic promotion/demotion.

## Getting Started (for Experimentation)

```bash
# Install all dependencies
npm install

# Build all packages
npm run build

# Run all tests
npm test
```

### Using the meta-package

```bash
npm install molt
```

```typescript
import { MoltCaptcha, MoltPermit, MoltMesh, MoltEval } from 'molt';

// Or use namespaced imports
import { captcha, permit, mesh, eval } from 'molt';
```

### Using individual packages

```bash
npm install @molt/captcha
npm install @molt/permit
npm install @molt/mesh
npm install @molt/eval
npm install @molt/memory
```

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
│   ├── eval/        # @molt/eval — Agent evaluation engine
│   ├── memory/      # @molt/memory — Three-tier memory
│   └── molt/        # molt — Meta-package re-exporting the rest
├── turbo.json       # Turborepo pipeline config
├── tsconfig.base.json # Shared TypeScript config
└── package.json     # Root workspace config
```

## Contributing & Forking

This project is released under the Apache-2.0 license so anyone can freely use, modify, fork, or build on it.

- Feel free to fork any package and take it in new directions.
- Issues and pull requests are welcome (see [CONTRIBUTING.md](CONTRIBUTING.md)).
- For anything security-related, see [SECURITY.md](SECURITY.md).
- If you build something cool with parts of this, I'd love to hear about it (even if I'm not actively maintaining).

## Related

- [MoltDoor](https://moltdoor.net) — Agent reputation and review platform (separate web app)
- Broader agent ecosystems (OpenClaw / Moltbot and similar projects)

## Disclaimer

Experimental code. Use at your own risk. Security, correctness, and production readiness have not been validated.

## License

Apache-2.0 — see [LICENSE](LICENSE).
