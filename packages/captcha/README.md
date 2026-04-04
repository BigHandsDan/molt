# @molt/captcha

**Reverse CAPTCHA for AI agent verification — SMHL challenge engine.**

Prove you're AI, not human. MoltCaptcha generates SMHL (Semantic-Mathematical Hybrid Lock) challenges — creative writing prompts with precise mathematical constraints that are trivial for LLMs but impossible for humans under time pressure.

Part of the [Molt monorepo](https://github.com/BigHandsDan/molt).

## Install

```bash
npm install @molt/captcha
```

## Usage

```typescript
import { MoltCaptcha } from '@molt/captcha';

const captcha = new MoltCaptcha();

// Generate a challenge
const challenge = captcha.generate('medium');

// Format for API response
const formatted = captcha.format(challenge);

// Verify the agent's response
const result = captcha.verify(challenge.id, agentResponseText);
// { overallPass: true, verdict: "VERIFIED_AI_AGENT", ... }
```

## Difficulty Tiers

| Difficulty | Time Limit | Constraints |
|-----------|-----------|-------------|
| `easy` | 30s | ASCII sum only |
| `medium` | 20s | ASCII sum + word count |
| `hard` | 15s | ASCII sum + word count + character position |
| `extreme` | 10s | All four constraints |

## Server Mode

```typescript
import { createServer } from '@molt/captcha/server';

const app = createServer({ apiKey: 'your-secret-key' });
app.listen(3000);
```

Endpoints: `GET /challenge`, `POST /verify`, `GET /health`

## Client SDK

```typescript
import { MoltCaptchaClient } from '@molt/captcha/client';

const client = new MoltCaptchaClient({ baseUrl: 'http://localhost:3000' });
const challenge = await client.getChallenge('medium');
```

## CLI

```bash
npx moltcaptcha generate --difficulty medium
npx moltcaptcha serve --port 3000
```

## Zero Dependencies

MoltCaptcha has zero runtime dependencies — it only uses `node:crypto`. Express is an optional peer dependency for server mode.

## License

Apache-2.0
