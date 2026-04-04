import { v4 as uuidv4 } from 'uuid';
import { CedarEngine } from './engine/cedar-engine.js';
import { PolicyLoader } from './engine/policy-loader.js';
import { ActionRequest, PolicyDecision, ActionBudget } from './engine/types.js';
import { AuditLogger } from './logging/audit-logger.js';
import { SqliteAuditStore } from './logging/sqlite-store.js';
import { AuditQuery, AuditEntry } from './logging/types.js';
import { BudgetTracker } from './credentials/budget-tracker.js';
import { JitTokenManager, JitToken } from './credentials/jit-tokens.js';
import { MoltDoorClient, MoltDoorConfig } from './integrations/moltdoor.js';
import { MoltCaptchaClient, MoltCaptchaClientConfig, MoltCaptchaChallenge, MoltCaptchaRegistration } from './integrations/moltcaptcha.js';
import { createMcpMiddleware, createToolCallInterceptor, ToolCallInterceptor } from './middleware/mcp-middleware.js';

export interface MoltPermitConfig {
  policies?: string;
  moltdoor?: Partial<MoltDoorConfig>;
  moltcaptcha?: Partial<MoltCaptchaClientConfig>;
  audit?: {
    store: 'sqlite' | 'memory';
    path?: string;
  };
  budgets?: Record<string, ActionBudget>;
  jit?: {
    ttlSeconds?: number;
    singleUse?: boolean;
  };
}

export class MoltPermit {
  private engine: CedarEngine;
  private loader: PolicyLoader;
  private auditLogger: AuditLogger;
  private auditStore: SqliteAuditStore;
  private budgetTracker: BudgetTracker;
  private tokenManager: JitTokenManager;
  private moltdoor: MoltDoorClient;
  private moltcaptcha: MoltCaptchaClient;
  private config: MoltPermitConfig;
  private rollbackRegistry: Map<string, () => Promise<void>> = new Map();

  constructor(config: MoltPermitConfig = {}) {
    this.config = config;

    // Initialize Cedar engine
    this.engine = new CedarEngine();
    this.loader = new PolicyLoader(this.engine);

    // Initialize audit store
    const dbPath = config.audit?.store === 'sqlite' && config.audit.path
      ? config.audit.path
      : ':memory:';
    this.auditStore = new SqliteAuditStore(dbPath);
    this.auditLogger = new AuditLogger(this.auditStore);

    // Reuse the same Database instance to avoid SQLITE_BUSY lock contention
    this.budgetTracker = new BudgetTracker(this.auditStore.getDatabase());

    if (config.budgets) {
      this.budgetTracker.setBudgets(config.budgets);
    }

    // Initialize JIT token manager with shared DB for persistence
    this.tokenManager = new JitTokenManager(this.auditStore.getDatabase());

    // Initialize integrations
    this.moltdoor = new MoltDoorClient(config.moltdoor);
    this.moltcaptcha = new MoltCaptchaClient(
      config.moltcaptcha || config.moltdoor?.baseUrl
    );

    // Load policies if path provided
    if (config.policies) {
      try {
        const fs = require('node:fs');
        const stat = fs.statSync(config.policies);
        if (stat.isDirectory()) {
          this.loader.loadFromDirectory(config.policies);
        } else {
          this.loader.loadFromFile(config.policies);
        }
      } catch {
        // Policy path may not exist yet, that's okay
      }
    }
  }

  // Policy management
  loadPoliciesFromString(policyText: string): void {
    this.loader.loadFromString(policyText);
  }

  loadPoliciesFromFile(filePath: string): void {
    this.loader.loadFromFile(filePath);
  }

  loadPoliciesFromDirectory(dirPath: string): void {
    this.loader.loadFromDirectory(dirPath);
  }

  validatePolicy(policyText: string): { valid: boolean; errors: string[] } {
    return this.engine.validate(policyText);
  }

  clearPolicies(): void {
    this.engine.clearPolicies();
  }

  reloadPolicies(): void {
    this.engine.clearPolicies();
    if (this.config.policies) {
      try {
        const fs = require('node:fs');
        const stat = fs.statSync(this.config.policies);
        if (stat.isDirectory()) {
          this.loader.loadFromDirectory(this.config.policies);
        } else {
          this.loader.loadFromFile(this.config.policies);
        }
      } catch {
        // Policy path may not exist
      }
    }
  }

  getPolicyCount(): number {
    return this.engine.getPolicies().length;
  }

  // Core evaluation
  async evaluate(request: ActionRequest): Promise<PolicyDecision> {
    // Enrich agent info from MoltDoor if available
    const enrichedRequest = await this.enrichRequest(request);

    // Check budget first
    const budgetCheck = this.budgetTracker.check(
      enrichedRequest.agent.id,
      enrichedRequest.action.type,
    );

    if (!budgetCheck.allowed) {
      const decision: PolicyDecision = {
        decision: 'deny',
        reasons: [budgetCheck.reason || 'Budget exhausted'],
        matchedPolicies: [],
        auditId: '',
      };

      const entry = this.auditLogger.log(enrichedRequest, decision);
      decision.auditId = entry.id;
      return decision;
    }

    // Evaluate against Cedar policies
    const result = this.engine.evaluate(enrichedRequest);

    const decision: PolicyDecision = {
      decision: result.decision,
      reasons: result.reasons,
      matchedPolicies: result.matchedPolicies,
      auditId: '',
    };

    // Mint JIT token on allow
    if (result.decision === 'allow') {
      const token = this.tokenManager.mint({
        agentId: enrichedRequest.agent.id,
        allowedActions: [enrichedRequest.action.type],
        resources: [enrichedRequest.action.resource],
        ttlSeconds: this.config.jit?.ttlSeconds ?? 300,
        singleUse: this.config.jit?.singleUse ?? true,
      });

      decision.scopedCredential = {
        token: token.token,
        expiresAt: token.expiresAt,
        scopes: token.allowedActions,
        restrictions: token.restrictions,
      };

      // Record budget usage
      this.budgetTracker.record(enrichedRequest.agent.id, enrichedRequest.action.type);
    }

    // Log to audit
    const entry = this.auditLogger.log(enrichedRequest, decision);
    decision.auditId = entry.id;

    return decision;
  }

  // Audit
  recordOutcome(auditId: string, outcome: AuditEntry['outcome']): void {
    this.auditLogger.recordOutcome(auditId, outcome);
  }

  queryLogs(query: AuditQuery): AuditEntry[] {
    return this.auditLogger.query(query);
  }

  async evaluateWithRollback(
    request: ActionRequest,
    rollbackFn?: () => Promise<void>,
  ): Promise<PolicyDecision> {
    const decision = await this.evaluate(request);

    if (decision.decision === 'allow' && rollbackFn) {
      this.rollbackRegistry.set(decision.auditId, rollbackFn);
      this.auditStore.updateReversible(decision.auditId, true);
    }

    return decision;
  }

  async rollback(auditId: string): Promise<{ success: boolean; error?: string }> {
    const rollbackFn = this.rollbackRegistry.get(auditId);

    if (rollbackFn) {
      try {
        await rollbackFn();
        this.rollbackRegistry.delete(auditId);
        const reverseId = uuidv4();
        this.auditLogger.markRolledBack(auditId, reverseId);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Rollback failed' };
      }
    }

    // No callback registered, just mark the log
    const reverseId = uuidv4();
    this.auditLogger.markRolledBack(auditId, reverseId);
    return { success: true };
  }

  // Budget
  getBudgetUsage(agentId: string): Record<string, { used: number; limit: number }> {
    return this.budgetTracker.getUsage(agentId);
  }

  setBudget(actionType: string, budget: ActionBudget): void {
    this.budgetTracker.setBudget(actionType, budget);
  }

  // JIT tokens
  verifyToken(token: string, action?: string, resource?: string) {
    return this.tokenManager.verify(token, action, resource);
  }

  // MoltDoor
  async getAgentAttributes(agentId: string) {
    return this.moltdoor.resolveAgentAttributes(agentId);
  }

  // MoltCaptcha
  async getChallenge(difficulty?: string): Promise<MoltCaptchaChallenge> {
    return this.moltcaptcha.getChallenge(difficulty);
  }

  async registerAgent(
    challengeId: string,
    solution: string,
    agentInfo: { name: string; description?: string },
  ): Promise<MoltCaptchaRegistration> {
    return this.moltcaptcha.register(challengeId, solution, agentInfo);
  }

  // Transport-agnostic interceptor
  toolCallInterceptor(): ToolCallInterceptor {
    return createToolCallInterceptor({
      evaluate: (req) => this.evaluate(req),
    });
  }

  // Middleware
  mcpMiddleware() {
    return createMcpMiddleware({
      evaluate: (req) => this.evaluate(req),
      verifyToken: async (token) => {
        const result = this.tokenManager.verify(token);
        if (result.valid && result.token) {
          return { agentId: result.token.agentId };
        }
        return null;
      },
    });
  }

  // Cleanup
  close(): void {
    this.auditStore.close();
  }

  private async enrichRequest(request: ActionRequest): Promise<ActionRequest> {
    if (!this.config.moltdoor?.baseUrl) return request;

    try {
      const attrs = await this.moltdoor.resolveAgentAttributes(request.agent.id);
      const tierRank: Record<string, number> = { unverified: 0, moltcaptcha: 1, blockchain: 2, reputation: 3 };
      const currentRank = tierRank[request.agent.verificationTier] ?? 0;
      const moltdoorRank = tierRank[attrs.verificationTier] ?? 0;

      // Use the higher tier
      if (moltdoorRank > currentRank) {
        return {
          ...request,
          agent: {
            ...request.agent,
            verificationTier: attrs.verificationTier,
            reputationScore: attrs.reputationScore ?? request.agent.reputationScore,
          },
        };
      }
      return request;
    } catch {
      // MoltDoor unreachable, keep current tier
      return request;
    }
  }
}

// Re-export types and utilities
export type {
  ActionRequest,
  PolicyDecision,
  ActionBudget,
  ActionContext,
  ActionInfo,
  AgentInfo,
  VerificationTier,
  ScopedCredential,
} from './engine/types.js';
export type { AuditEntry, AuditQuery } from './logging/types.js';
export type { JitToken } from './credentials/jit-tokens.js';
export type { MoltDoorAgentProfile, MoltDoorOnChainData, MoltDoorAgentAttributes } from './integrations/moltdoor.js';
export type { MoltCaptchaChallenge, MoltCaptchaVerification, MoltCaptchaRegistration, MoltCaptchaClientConfig } from './integrations/moltcaptcha.js';
export { CedarEngine } from './engine/cedar-engine.js';
export { PolicyLoader } from './engine/policy-loader.js';
export { AuditLogger } from './logging/audit-logger.js';
export { SqliteAuditStore } from './logging/sqlite-store.js';
export { BudgetTracker } from './credentials/budget-tracker.js';
export { JitTokenManager } from './credentials/jit-tokens.js';
export { MoltDoorClient } from './integrations/moltdoor.js';
export { MoltCaptchaClient } from './integrations/moltcaptcha.js';
export { createMcpMiddleware, createToolCallInterceptor } from './middleware/mcp-middleware.js';
export type { ToolCallInterceptor } from './middleware/mcp-middleware.js';
export { createServer } from './server/standalone.js';
