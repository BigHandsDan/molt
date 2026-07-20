# Molt Labels Guide

This file documents the recommended labels for the Molt repository. Since GitHub's REST API doesn't support automatic label creation, use this guide to manually add labels via the GitHub UI.

## How to Add Labels

1. Go to **[BigHandsDan/molt → Settings → Labels](https://github.com/BigHandsDan/molt/labels)**
2. Click **"New label"**
3. Fill in **Name**, **Color**, and **Description**
4. Click **"Create label"**

---

## 📋 Recommended Labels

### Priority & Type (Essential)

| Name | Color | Description |
|------|-------|-------------|
| `good first issue` | `#0e8a16` | Perfect for newcomers to start contributing |
| `help wanted` | `#0052cc` | Community contributions welcome |
| `bug` | `#d73a49` | Bug report or fix needed |
| `enhancement` | `#a371f7` | Feature request or improvement |
| `documentation` | `#0075ca` | Documentation improvements or additions |

---

### Package Labels (5-Package Monorepo)

| Name | Color | Description |
|------|-------|-------------|
| `@molt/captcha` | `#ff6600` | Reverse CAPTCHA AI verification module |
| `@molt/permit` | `#ffcc00` | Cedar-based policy engine & audit |
| `@molt/mesh` | `#00cc00` | Agent interoperability bus & federation |
| `@molt/eval` | `#0066ff` | Evaluation engine & metrics |
| `@molt/memory` | `#9933ff` | Three-tier memory system |

---

### Status & Process Labels

| Name | Color | Description |
|------|-------|-------------|
| `security` | `#b60205` | Security-related issues or fixes |
| `breaking change` | `#ee0701` | API breaking change requires migration |
| `in progress` | `#fbca04` | Currently being worked on |
| `blocked` | `#cccccc` | Blocked by other work or dependencies |
| `wontfix` | `#ffffff` | Will not be fixed (intentional) |

---

### Quality & Testing

| Name | Color | Description |
|------|-------|-------------|
| `tests` | `#1d76db` | Testing or test coverage related |
| `performance` | `#ff7619` | Performance optimization or monitoring |
| `refactor` | `#cccccc` | Code refactoring without behavior change |

---

## 🎯 Quick Start (Minimum Set)

Start with these 8 labels for immediate impact on contributors:

1. ✅ `good first issue` — **#0e8a16**
2. ✅ `help wanted` — **#0052cc**
3. ✅ `bug` — **#d73a49**
4. ✅ `enhancement` — **#a371f7**
5. ✅ `documentation` — **#0075ca**
6. ✅ `@molt/mesh` — **#00cc00** (most active package)
7. ✅ `security` — **#b60205**
8. ✅ `breaking change` — **#ee0701**

---

## 💡 Label Usage Strategy

### For Issue Triage
1. **Always add a type** — `bug`, `enhancement`, or `documentation`
2. **Add a package** — `@molt/captcha`, `@molt/permit`, etc. (or `none` if monorepo-wide)
3. **Mark priority** — `good first issue` for newcomer-friendly issues
4. **Add status** — `in progress`, `blocked`, or leave unset for "open"

### For PRs
1. **Link to issue** — Use "Fixes #123" or "Related to #456"
2. **PR template** — Already guides this (see `.github/pull_request_template.md`)
3. **Automatic labels** — GitHub will suggest labels based on branch names or PR description

### Example Issue Labels
```
Issue: "MoltCaptcha doesn't handle edge case X"
Labels: bug, @molt/captcha, good first issue (if newcomer-friendly)

Issue: "Add HTTP adapter for MoltMesh"
Labels: enhancement, @molt/mesh, help wanted

Issue: "Document Cedar policy format"
Labels: documentation, @molt/permit
```

---

## 🔄 Maintaining Labels

- **Review quarterly** — During roadmap check-ins (see `ROADMAP.md`)
- **Archive unused labels** — Delete labels with 0 uses after 3 months
- **Standardize naming** — Keep package labels with `@` prefix for easy filtering
- **Color consistency** — Use similar colors for related categories

---

## 📊 Label Dashboard

Once labels are created, you can:
- **Filter issues** by label: `https://github.com/BigHandsDan/molt/issues?labels=good+first+issue`
- **View label stats** — Go to **Settings → Labels** to see usage counts
- **Auto-label PRs** — Use GitHub Actions if desired (not yet set up)

---

## Related Files

- **[CONTRIBUTING.md](CONTRIBUTING.md)** — Contribution guidelines
- **[ROADMAP.md](ROADMAP.md)** — Project roadmap
- **.github/pull_request_template.md** — PR template
- **.github/ISSUE_TEMPLATE/** — Issue templates

---

**Last Updated:** July 2026
