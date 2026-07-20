# Molt Roadmap

Molt is an experimental exploration of practical governance layers for autonomous AI agents. This roadmap outlines our vision for the next 2-3 quarters as we move toward a more production-ready and ecosystem-integrated system.

## 🎯 Vision

Enable AI agents to operate safely and interoperably by:
- **Proving identity** — Reverse CAPTCHA for AI verification
- **Enforcing policies** — Cedar-based access control and audit
- **Communicating safely** — Agent interoperability bus with federation
- **Evaluating reliability** — Metrics, regression detection, and gating
- **Managing context** — Efficient multi-tier memory systems

---

## 📅 Q3 2026: Foundation & Integration

### Core Objectives
- [ ] Production hardening of `@molt/mesh` (tracing, error handling, federation stability)
- [ ] Security audit prep & vulnerability disclosure policy
- [ ] Documentation improvements (architecture diagrams, tutorial videos)
- [ ] Integration examples with major agent frameworks

### Specific Work
- **@molt/mesh** — Stabilize federation, add circuit breaker resilience, improve observability
- **@molt/captcha** — Expand SMHL challenge difficulty tiers, add batch verification
- **@molt/permit** — Cedar policy library expansion, audit log export formats
- **Documentation** — Add real-world integration guides (LangGraph, Autogen, CrewAI)
- **Examples** — Build 3-5 concrete agent-to-agent communication scenarios

### Success Metrics
- [ ] Zero critical security findings from pre-audit review
- [ ] 95%+ test coverage maintained
- [ ] First external fork/integration reported
- [ ] Community discussion on agent trust models

---

## 📅 Q4 2026: Ecosystem & Integrations

### Core Objectives
- [ ] Official support for leading agent frameworks
- [ ] MoltDoor integration (reputation, review platform)
- [ ] Publish whitepapers / research materials
- [ ] Grow contributor base

### Specific Work
- **Framework SDKs** — Official adapters for LangGraph, Autogen, CrewAI, others
- **@molt/eval** — Expand metric library, add benchmarking tools
- **@molt/memory** — Optimize for large-scale agent fleets, add persistence layers
- **Marketplace** — Enable service registry and exchange functionality in `@molt/mesh`
- **Community** — Establish governance model for Molt extensions

### Success Metrics
- [ ] 5+ framework integrations published
- [ ] 50+ GitHub stars
- [ ] 10+ external contributors
- [ ] Whitepaper on agent governance published

---

## 📅 Q1 2027: Production & Scale

### Core Objectives
- [ ] Production deployment readiness (security audit completion, SLA docs)
- [ ] Advanced agent federation patterns
- [ ] Enhanced governance tooling
- [ ] Managed services (optional hosting layer)

### Specific Work
- **Security Audit** — Third-party security review complete
- **Performance** — Optimize for 1000+ agent networks
- **Compliance** — Add audit trail export for regulated environments
- **Tooling** — CLI, UI dashboard, monitoring integrations
- **Standards** — Contribute agent governance patterns to industry groups

### Success Metrics
- [ ] Production-ready certification
- [ ] 200+ stars, active community
- [ ] Enterprise adoption pilots
- [ ] Molt ecosystem projects (forks, extensions) at 20+

---

## 🤝 How You Can Help

### Now (Q3)
- **Security Review** — Audit the codebase, suggest hardening
- **Documentation** — Add examples, tutorials, architecture docs
- **Framework Integrations** — Build adapters for your agent framework
- **Real-world Testing** — Use Molt in your agents, report findings

### Upcoming (Q4+)
- **Framework Contributions** — Help integrate official SDKs
- **Research** — Publish on agent trust, governance, interoperability
- **Ecosystem** — Fork, extend, or build on Molt ideas
- **Community** — Help shape governance model for Molt extensions

---

## 💡 Key Themes Across All Quarters

| Theme | Purpose |
|-------|---------|
| **Interoperability** | Make Molt a neutral foundation, not a walled garden |
| **Security First** | Every feature considers trust, audit, and reversibility |
| **Experimentation** | Stay open to forking; let forks lead innovation |
| **Documentation** | Clear examples, architecture docs, and design decisions |
| **Community** | Grow contributors, cite forks, celebrate derivatives |

---

## 📊 Success Criteria (End of Q1 2027)

- ✅ 200+ GitHub stars
- ✅ 20+ ecosystem projects (forks, extensions, integrations)
- ✅ 25+ contributors
- ✅ Security audit completed
- ✅ Official framework integrations (3+)
- ✅ Whitepapers / research published
- ✅ Production deployment playbooks available
- ✅ Agent governance becoming industry conversation

---

## 🗣️ Questions?

- Open an issue on GitHub
- Start a discussion in GitHub Discussions
- Reach out on X (@BigHandsDan)

---

**Last Updated:** July 2026  
**Next Review:** End of Q3 2026
