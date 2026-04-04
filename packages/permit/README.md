# @molt/permit

**Permissions and policy control plane for autonomous AI agents.**

MoltPermit sits between AI agents and tool-calling endpoints (MCP servers, APIs, etc.) to enforce scoped, auditable, and reversible actions based on Cedar policies and agent trust tiers.

Part of the [Molt monorepo](https://github.com/BigHandsDan/molt).

## Install

```bash
npm install @molt/permit
```

## Usage

```typescript
import { MoltPermit } from '@molt/permit';

const permit = new MoltPermit({
  policies: './policies/default.cedar',
  audit: { store: 'sqlite', path: './audit.db' },
});

const decision = await permit.evaluate({
  agent: { id: 'agent-123', verificationTier: 'moltcaptcha' },
  action: { type: 'read', resource: 'invoices', parameters: {} },
  context: { timestamp: new Date().toISOString(), environment: 'production' },
});

console.log(decision.decision); // 'allow' or 'deny'
```

## Features

- **Cedar Policy Engine** — Flexible permit/forbid rules with conditions
- **Trust Tiers** — Unverified, MoltCaptcha, Blockchain, Reputation-Backed
- **Audit Logging** — SQLite-backed audit trail with full request/response context
- **Action Budgets** — Per-agent rate limiting (lifetime, hourly, daily)
- **JIT Tokens** — Short-lived scoped credentials for sandboxed execution
- **Actionable Rollbacks** — Register rollback callbacks, execute them by audit ID
- **MCP Middleware** — Express middleware for protecting MCP tool endpoints
- **Transport-Agnostic Interceptor** — Works with any tool-calling protocol

## Trust Tiers

| Tier | Requirements | Access Level |
|------|-------------|-------------|
| Unverified | None | Read-only, rate-limited |
| MoltCaptcha | Passed SMHL challenge | Scoped API access |
| Blockchain | ERC-8004 identity | Broader scopes |
| Reputation-Backed | All above + rating >= 4.0 | Full operation |

## CLI

```bash
npx moltpermit test --policy ./policies/default.cedar
npx moltpermit serve --port 3100
npx moltpermit logs --last 50
```

## License

Apache-2.0
