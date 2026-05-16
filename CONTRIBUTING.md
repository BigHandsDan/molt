# Contributing to Molt

Thanks for your interest. This is an experimental project exploring governance ideas for AI agents — so contributions, forks, and even "I took an idea and ran somewhere completely different" stories are all welcome.

## Ways to Help

- Fork any package and build on it
- Improve documentation or add real-world examples
- Suggest integrations with real agent frameworks (OpenClaw, Moltbot, LangGraph, Autogen, CrewAI, etc.)
- Open issues with ideas, feedback, or questions
- Security review / audit suggestions are especially valuable

## Development

```bash
npm install
npm run build
npm test
```

Work on individual packages with workspace flags:

```bash
npm test -w packages/captcha
npm run build -w packages/mesh
```

Also useful:

```bash
npm run typecheck
npm run lint
npm run clean
```

## Pull Requests

- Small, focused PRs are great.
- Describe what you changed and why.
- Add or update tests when changing behavior.
- Run `npm test` and `npm run typecheck` before submitting.

## Reporting Bugs / Ideas

Open a GitHub Issue. Include:

- What you were trying to do
- What happened vs. what you expected
- A minimal reproduction if you have one

## Questions?

Open an issue or reach out on X.

This project uses the Apache-2.0 license — fork and build freely.
