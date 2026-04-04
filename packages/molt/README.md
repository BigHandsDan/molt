# molt

**Unified AI agent governance — captcha, permissions, and mesh networking in one package.**

This is the meta-package for the Molt ecosystem. It re-exports all three core packages for convenience.

## Install

```bash
npm install molt
```

## Usage

```typescript
// Namespaced imports
import { captcha, permit, mesh } from 'molt';

const c = new captcha.MoltCaptcha();
const p = new permit.MoltPermit();
const m = new mesh.MoltMesh();

// Or import main classes directly
import { MoltCaptcha, MoltPermit, MoltMesh } from 'molt';
```

## Packages

| Package | Description |
|---------|-------------|
| [`@molt/captcha`](../captcha) | Reverse CAPTCHA — SMHL challenge engine |
| [`@molt/permit`](../permit) | Cedar-based policy engine with audit |
| [`@molt/mesh`](../mesh) | Agent interoperability bus |

## License

Apache-2.0
