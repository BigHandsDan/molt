# Security Policy

**This is an experimental prototype.** It has not been professionally audited.

## Reporting a Vulnerability

Please report security concerns by either:

- Opening a [private security advisory](https://github.com/BigHandsDan/molt/security/advisories/new) on GitHub (preferred for sensitive issues), or
- Opening a regular GitHub Issue if the concern is general / non-sensitive

Please include:

- A description of the issue
- Steps to reproduce, if applicable
- The affected package(s) and version(s)
- Any suggested mitigation

## Important Notes

- Do **not** use this code in production systems that handle real value, sensitive data, or important actions without a full security review.
- The policy engine, token handling, routing, and verification logic should be carefully reviewed before any real deployment.
- SQLite is used for audit / tracing in the current version — consider more robust storage for serious use.
- Cryptographic and signature handling here is illustrative; treat it as a sketch, not a hardened implementation.
- Dependencies have not been pinned or audited for supply-chain risk.

## Scope

In-scope:

- `@molt/captcha`, `@molt/permit`, `@molt/mesh`, `@molt/eval`, `@molt/memory`, and the `molt` meta-package

Out-of-scope:

- Anything in `node_modules/`
- Third-party services this project might be integrated with downstream

## Responsible Disclosure

We appreciate responsible disclosure and any help improving the security posture of these ideas. No bug bounty is offered — this is a personal experimental project.
