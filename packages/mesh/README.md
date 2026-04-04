# @molt/mesh

**Neutral agent interoperability bus and control plane.**

MoltMesh lets heterogeneous agent systems communicate through shared contracts, adapter-based translation, policy enforcement, and end-to-end tracing. It is not another agent network — it is the governance and mediation layer that sits between existing agent frameworks.

Part of the [Molt monorepo](https://github.com/BigHandsDan/molt).

## Install

```bash
npm install @molt/mesh
```

## Usage

```typescript
import { MoltMesh } from '@molt/mesh';

const mesh = new MoltMesh();

// Register a contract
mesh.registerContract({
  id: 'summarize-v1',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  outputSchema: { type: 'object', properties: { summary: { type: 'string' } } },
});

// Register an agent
mesh.registerAgent({ id: 'summarizer-1', capabilities: ['summarize-v1'] });

// Route a task
const result = await mesh.routeTask({
  contractId: 'summarize-v1',
  input: { text: 'Long document...' },
  callerId: 'orchestrator',
});
```

## Features

### Core Bus
- Contract registry with JSON Schema validation and versioning
- Agent identity with four trust tiers
- Policy engine with configurable allow/deny rules
- Router with capability-based resolution, retry, and fallback
- Three adapters: Echo, HTTP, OpenAI-compatible
- SQLite-backed trace store with cost accounting

### Federation
- Organization registry with membership management
- Namespace isolation with quota enforcement
- Cross-org grants with usage tracking and conditions
- Gateway with API keys, rate limiting, and auth middleware

### Exchange
- Service catalog with search and filtering
- Credit-based billing engine
- Subscription management
- Review and rating system

## Demos

```bash
# Run the 7-scenario flagship demo
npm run demo:full

# Federation scenarios
npm run demo:federation

# Exchange marketplace scenarios
npm run demo:exchange

# Operator console (web UI)
npm run demo:server
```

## Tests

467 tests across 28 test files covering contracts, identity, policy, routing, adapters, tracing, cost accounting, federation, gateway, and exchange.

## License

Apache-2.0
