import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { TaskContract } from './contracts/schema.js';
import { ContractRegistry } from './contracts/registry.js';
import { AgentIdentity } from './identity/types.js';
import { IdentityRegistry } from './identity/registry.js';
import { PolicyEngine } from './policy/engine.js';
import { PolicyRule, AgentBudget } from './policy/types.js';
import { BudgetTracker, BudgetConfig } from './policy/budget.js';
import { ApprovalManager, ApprovalRequest } from './policy/approval.js';
import { Router } from './router/router.js';
import { TaskEnvelope, TaskResult } from './router/types.js';
import { DeadLetterQueue, DeadLetter } from './router/dead-letter.js';
import {
  CircuitBreakerRegistry,
  CircuitState,
  CircuitBreakerConfig,
} from './router/circuit-breaker.js';
import { MoltMeshAdapter, AdapterConfig } from './adapters/interface.js';
import { EchoAdapter } from './adapters/echo.js';
import { HttpAdapter } from './adapters/http.js';
import { OpenAIAdapter, OpenAIHandler } from './adapters/openai.js';
import { Tracer } from './trace/tracer.js';
import { TraceStore } from './trace/store.js';
import { TraceEvent, TraceFilter } from './trace/types.js';
import { CostAccountant, CostConfig } from './cost/accounting.js';
import { BudgetExceededError, InsufficientBalanceError } from './errors.js';
import { Organization, OrgRegistry } from './federation/organization.js';
import { Namespace, NamespaceQuotas, NamespaceRegistry } from './federation/namespace.js';
import { FederationGrant, GrantRegistry } from './federation/grants.js';
import { GrantUsageTracker } from './federation/grant-usage.js';
import { ApiKeyRegistry } from './gateway/api-keys.js';
import { WebhookRegistry } from './gateway/webhooks.js';
import { WebhookDeliverer, WebhookPayload, HttpFetcher } from './gateway/webhook-delivery.js';
import { RateLimiter } from './gateway/rate-limiter.js';
import { CatalogRegistry, ServiceListing, CatalogSearchFilters } from './exchange/catalog.js';
import {
  BillingEngine,
  BillingConfig,
  CreditAccount,
  CreditTransaction,
} from './exchange/billing.js';
import { SubscriptionRegistry, Subscription, SubscriptionPlan } from './exchange/subscriptions.js';
import { ReviewRegistry, ServiceReview } from './exchange/reviews.js';

/** Configuration options for initializing a MoltMesh instance. */
export interface MoltMeshConfig {
  /** Path to the SQLite database file. Defaults to in-memory (":memory:"). */
  dbPath?: string;
  /** Custom policy rules. If omitted, DEFAULT_RULES are used. */
  policyRules?: PolicyRule[];
  /** Custom OpenAI handler for the OpenAI adapter. Defaults to a mock handler. */
  openAIHandler?: OpenAIHandler;
  /** Token budget configuration for agents. */
  budgetConfig?: BudgetConfig;
  /** Cost accounting configuration with per-model pricing. */
  costConfig?: CostConfig;
  /** Circuit breaker thresholds and timing overrides. */
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
  /** Custom HTTP fetcher for webhook delivery. */
  webhookFetcher?: HttpFetcher;
  /** Billing engine configuration including platform fee percentages. */
  billingConfig?: BillingConfig;
}

/**
 * The central MoltMesh interoperability bus. Provides contract registration,
 * agent management, policy enforcement, task routing, tracing, cost accounting,
 * cross-org federation, and a service exchange with billing.
 *
 * @example
 * ```ts
 * const mesh = new MoltMesh({ dbPath: ':memory:' });
 * mesh.registerContract(contract);
 * mesh.registerAgent(identity, adapterConfig);
 * const result = await mesh.submit(envelope);
 * mesh.close();
 * ```
 */
export class MoltMesh {
  private contractRegistry: ContractRegistry;
  private identityRegistry: IdentityRegistry;
  private policyEngine: PolicyEngine;
  private adapters = new Map<string, MoltMeshAdapter>();
  private agentConfigs = new Map<string, AdapterConfig>();
  private router: Router;
  private traceStore: TraceStore;
  private tracer: Tracer;
  private db: Database.Database;
  private budgetTracker: BudgetTracker;
  private approvalManager: ApprovalManager;
  private deadLetterQueue: DeadLetterQueue;
  private circuitBreakers: CircuitBreakerRegistry;
  private costAccountant: CostAccountant;
  private orgRegistry: OrgRegistry;
  private namespaceRegistry: NamespaceRegistry;
  private grantRegistry: GrantRegistry;
  private grantUsageTracker: GrantUsageTracker;
  private apiKeyRegistry: ApiKeyRegistry;
  private webhookRegistry: WebhookRegistry;
  private webhookDeliverer: WebhookDeliverer;
  private rateLimiter: RateLimiter;
  private catalogRegistry: CatalogRegistry;
  private billingEngine: BillingEngine;
  private subscriptionRegistry: SubscriptionRegistry;
  private reviewRegistry: ReviewRegistry;

  /** Create a new MoltMesh instance, initializing all subsystems. */
  constructor(config: MoltMeshConfig = {}) {
    // Shared SQLite database for all subsystems
    this.db = new Database(config.dbPath || ':memory:');
    this.db.pragma('journal_mode = WAL');

    this.contractRegistry = new ContractRegistry(this.db);
    this.identityRegistry = new IdentityRegistry(this.db, this.agentConfigs);
    this.policyEngine = new PolicyEngine(config.policyRules);
    this.traceStore = new TraceStore(config.dbPath);
    this.tracer = new Tracer(this.traceStore);
    this.budgetTracker = new BudgetTracker(this.db, config.budgetConfig);
    this.approvalManager = new ApprovalManager(this.db);
    this.deadLetterQueue = new DeadLetterQueue(this.db);
    this.circuitBreakers = new CircuitBreakerRegistry(config.circuitBreakerConfig);
    this.costAccountant = new CostAccountant(this.db, config.costConfig);
    this.orgRegistry = new OrgRegistry(this.db);
    this.namespaceRegistry = new NamespaceRegistry(this.db);
    this.grantRegistry = new GrantRegistry(this.db);
    this.grantUsageTracker = new GrantUsageTracker(this.db);
    this.apiKeyRegistry = new ApiKeyRegistry(this.db);
    this.webhookRegistry = new WebhookRegistry(this.db);
    this.webhookDeliverer = new WebhookDeliverer(this.webhookRegistry, config.webhookFetcher);
    this.rateLimiter = new RateLimiter();
    this.catalogRegistry = new CatalogRegistry(this.db);
    this.billingEngine = new BillingEngine(this.db, config.billingConfig);
    this.subscriptionRegistry = new SubscriptionRegistry(this.db);
    this.reviewRegistry = new ReviewRegistry(this.db, this.catalogRegistry);

    // Register default adapters
    const echo = new EchoAdapter();
    const http = new HttpAdapter();
    const openai = new OpenAIAdapter(config.openAIHandler);
    this.adapters.set(echo.protocol, echo);
    this.adapters.set(http.protocol, http);
    this.adapters.set(openai.protocol, openai);

    this.router = new Router({
      contracts: this.contractRegistry,
      identities: this.identityRegistry,
      policy: this.policyEngine,
      adapters: this.adapters,
      agentConfigs: this.agentConfigs,
      circuitBreakers: this.circuitBreakers,
      deadLetterQueue: this.deadLetterQueue,
      grantRegistry: this.grantRegistry,
      grantUsageTracker: this.grantUsageTracker,
    });
  }

  /** Register an immutable task contract. */
  registerContract(contract: TaskContract): void {
    this.contractRegistry.register(contract);
  }

  /** Register an agent with its identity and adapter configuration. */
  registerAgent(identity: AgentIdentity, adapterConfig: AdapterConfig): void {
    this.identityRegistry.register(identity, adapterConfig);
    this.agentConfigs.set(identity.agentId, adapterConfig);
    this.budgetTracker.ensureAgent(identity.agentId);
  }

  /** Register a custom protocol adapter. */
  registerAdapter(adapter: MoltMeshAdapter): void {
    this.adapters.set(adapter.protocol, adapter);
  }

  /** Submit a task envelope for routing, policy evaluation, and dispatch. */
  async submit(envelope: TaskEnvelope): Promise<TaskResult> {
    const traceId = envelope.traceId || this.tracer.createTraceId();
    const tracedEnvelope = { ...envelope, traceId };

    // Trace ingress
    const ingressSpan = this.tracer.span(traceId, 'ingress', {
      contractId: envelope.contractId,
      agentId: envelope.caller.agentId,
      input: envelope.input,
    });

    try {
      // Check budget before routing
      const targetAgentId = this.resolveTargetAgentId(envelope);
      if (targetAgentId) {
        try {
          this.budgetTracker.checkBudget(targetAgentId);
        } catch (err) {
          if (err instanceof BudgetExceededError) {
            this.tracer.span(
              traceId,
              'budget_exceeded',
              {
                contractId: envelope.contractId,
                agentId: targetAgentId,
                error: err.message,
                budgetType: err.budgetType,
              },
              ingressSpan.spanId
            );

            return {
              envelopeId: envelope.envelopeId,
              contractId: envelope.contractId,
              output: null,
              status: 'denied',
              agentId: targetAgentId,
              durationMs: 0,
              error: err.message,
            };
          }
          throw err;
        }
      }

      // Trace namespace resolution
      const callerOrg = envelope.caller.orgId || 'default';
      const callerNs = envelope.caller.namespaceId || 'default/default';
      this.tracer.span(
        traceId,
        'namespace_resolve',
        {
          contractId: envelope.contractId,
          agentId: envelope.caller.agentId,
          sourceOrgId: callerOrg,
          sourceNamespace: callerNs,
        },
        ingressSpan.spanId
      );

      // Route (includes validation, policy check, dispatch)
      const routeStart = Date.now();
      const routeResult = await this.router.route(tracedEnvelope);

      // Trace validation
      this.tracer.span(
        traceId,
        'validate',
        {
          contractId: envelope.contractId,
          error:
            routeResult.validationErrors.length > 0
              ? routeResult.validationErrors.join('; ')
              : undefined,
        },
        ingressSpan.spanId
      );

      // Trace policy
      this.tracer.span(
        traceId,
        'policy',
        {
          contractId: envelope.contractId,
          agentId: routeResult.targetAgent.agentId,
          policyDecision: routeResult.policyDecision,
        },
        ingressSpan.spanId
      );

      // Check approval requirement
      if (routeResult.contract.approvalRequired && routeResult.policyDecision.allowed) {
        const approval = this.approvalManager.createRequest(
          tracedEnvelope,
          routeResult.targetAgent.agentId
        );
        this.tracer.span(
          traceId,
          'pending_approval',
          {
            contractId: envelope.contractId,
            agentId: routeResult.targetAgent.agentId,
            approvalId: approval.approvalId,
          },
          ingressSpan.spanId
        );

        return {
          envelopeId: envelope.envelopeId,
          contractId: envelope.contractId,
          output: { approvalId: approval.approvalId, status: 'pending_approval' },
          status: 'denied',
          agentId: routeResult.targetAgent.agentId,
          durationMs: 0,
        };
      }

      // Trace translate (contract translation)
      const adapterProtocol = this.getAdapterProtocol(routeResult.targetAgent.agentId);
      const transformations: string[] = [];
      if (adapterProtocol === 'http') {
        transformations.push(
          'map contract input to HTTP POST body',
          'map HTTP response to contract output'
        );
      } else if (adapterProtocol === 'openai') {
        transformations.push(
          'map contract capability to system prompt',
          'map contract input to user message',
          'extract token usage from response'
        );
      } else if (adapterProtocol === 'echo') {
        transformations.push('passthrough (echo)');
      }

      this.tracer.span(
        traceId,
        'translate',
        {
          contractId: envelope.contractId,
          agentId: routeResult.targetAgent.agentId,
          adapterProtocol,
          transformations,
        },
        ingressSpan.spanId
      );

      // Trace dispatch
      const dispatchSpan = this.tracer.spanWithDuration(
        traceId,
        'dispatch',
        {
          contractId: envelope.contractId,
          agentId: routeResult.targetAgent.agentId,
          adapterProtocol,
        },
        routeResult.taskResult.durationMs,
        ingressSpan.spanId
      );

      // Record cost if there's token usage
      if (routeResult.taskResult.tokenUsage) {
        const model = this.agentConfigs.get(routeResult.targetAgent.agentId)?.model;
        this.costAccountant.recordStep({
          traceId,
          spanId: dispatchSpan.spanId,
          agentId: routeResult.targetAgent.agentId,
          contractId: envelope.contractId,
          model,
          inputTokens: routeResult.taskResult.tokenUsage.input,
          outputTokens: routeResult.taskResult.tokenUsage.output,
          timestamp: new Date().toISOString(),
        });

        // Update budget tracker
        const totalTokens =
          routeResult.taskResult.tokenUsage.input + routeResult.taskResult.tokenUsage.output;
        this.budgetTracker.recordUsage(routeResult.targetAgent.agentId, totalTokens);
      }

      // Update circuit breaker
      if (routeResult.taskResult.status === 'success') {
        this.circuitBreakers.recordSuccess(routeResult.targetAgent.agentId);
      } else if (
        routeResult.taskResult.status === 'failure' ||
        routeResult.taskResult.status === 'timeout'
      ) {
        this.circuitBreakers.recordFailure(routeResult.targetAgent.agentId);
      }

      // Calculate estimated cost for response trace
      let estimatedCost: number | undefined;
      if (routeResult.taskResult.tokenUsage) {
        const model = this.agentConfigs.get(routeResult.targetAgent.agentId)?.model;
        estimatedCost = this.costAccountant.calculateCost(
          routeResult.taskResult.tokenUsage.input,
          routeResult.taskResult.tokenUsage.output,
          model
        );
      }

      // Track federation grant usage for cross-org dispatches
      const targetOrg = routeResult.targetAgent.orgId || 'default';
      const targetNs = routeResult.targetAgent.namespaceId || 'default/default';
      if (callerOrg !== targetOrg && routeResult.taskResult.status === 'success') {
        const grantCheck = this.grantRegistry.checkGrant(
          targetOrg,
          callerOrg,
          routeResult.contract.capability
        );
        if (grantCheck.valid && grantCheck.grantId) {
          const tokens = routeResult.taskResult.tokenUsage
            ? routeResult.taskResult.tokenUsage.input + routeResult.taskResult.tokenUsage.output
            : 0;
          this.grantUsageTracker.recordUsage(grantCheck.grantId, tokens, estimatedCost || 0);
        }

        // Trace federation check
        this.tracer.span(
          traceId,
          'federation_check',
          {
            contractId: envelope.contractId,
            sourceOrgId: callerOrg,
            targetOrgId: targetOrg,
            grantId: grantCheck.grantId,
            grantValid: grantCheck.valid,
            grantReason: grantCheck.reason,
          },
          ingressSpan.spanId
        );

        // Trace cross-org policy
        this.tracer.span(
          traceId,
          'cross_org_policy',
          {
            contractId: envelope.contractId,
            sourceOrgId: callerOrg,
            targetOrgId: targetOrg,
            sourceNamespace: callerNs,
            targetNamespace: targetNs,
            callerPolicyAllowed: routeResult.policyDecision.allowed,
            targetPolicyAllowed: routeResult.policyDecision.allowed,
            finalDecision: routeResult.policyDecision.allowed,
          },
          ingressSpan.spanId
        );
      }

      // Deliver webhooks for cross-org dispatches
      if (callerOrg !== targetOrg && routeResult.taskResult.status !== 'denied') {
        const eventType =
          routeResult.taskResult.status === 'success' ? 'task.completed' : 'task.failed';
        const webhookPayload: WebhookPayload = {
          eventType,
          timestamp: new Date().toISOString(),
          traceId,
          orgId: callerOrg,
          data: routeResult.taskResult.output,
        };
        // Fire and forget — don't block the response
        this.webhookDeliverer.deliverToOrg(callerOrg, webhookPayload).catch(() => {});
      }

      // Trace response
      this.tracer.spanWithDuration(
        traceId,
        'response',
        {
          contractId: envelope.contractId,
          agentId: routeResult.targetAgent.agentId,
          output: routeResult.taskResult.output,
          tokenUsage: routeResult.taskResult.tokenUsage,
          estimatedCost,
          error:
            routeResult.outputValidationErrors.length > 0
              ? `Output validation: ${routeResult.outputValidationErrors.join('; ')}`
              : routeResult.taskResult.error,
        },
        Date.now() - routeStart,
        ingressSpan.spanId
      );

      return routeResult.taskResult;
    } catch (err) {
      // Trace error
      this.tracer.span(
        traceId,
        'error',
        {
          contractId: envelope.contractId,
          agentId: envelope.caller.agentId,
          error: (err as Error).message,
        },
        ingressSpan.spanId
      );

      return {
        envelopeId: envelope.envelopeId,
        contractId: envelope.contractId,
        output: null,
        status: 'failure',
        agentId: envelope.caller.agentId,
        durationMs: 0,
        error: (err as Error).message,
      };
    }
  }

  /** Create a new task envelope with a generated ID and trace ID. */
  createEnvelope(
    contractId: string,
    version: string,
    input: unknown,
    caller: AgentIdentity,
    options: { target?: string; parentSpanId?: string; metadata?: Record<string, unknown> } = {}
  ): TaskEnvelope {
    return {
      envelopeId: uuidv4(),
      contractId,
      version,
      input,
      caller,
      target: options.target,
      traceId: this.tracer.createTraceId(),
      parentSpanId: options.parentSpanId,
      metadata: options.metadata || {},
    };
  }

  /** Approve a pending approval request. */
  approve(approvalId: string): ApprovalRequest | undefined {
    return this.approvalManager.approve(approvalId);
  }

  /** Deny a pending approval request with an optional reason. */
  deny(approvalId: string, reason?: string): ApprovalRequest | undefined {
    return this.approvalManager.deny(approvalId, reason);
  }

  /** Get all pending approval requests. */
  getPendingApprovals(): ApprovalRequest[] {
    return this.approvalManager.getPending();
  }

  /** Retrieve an approval request by ID. */
  getApproval(approvalId: string): ApprovalRequest | undefined {
    return this.approvalManager.getRequest(approvalId);
  }

  /** Get dead letters, optionally including resolved ones. */
  getDeadLetters(includeResolved = false): DeadLetter[] {
    return this.deadLetterQueue.getAll(includeResolved);
  }

  /** Mark a dead letter as resolved. */
  resolveDeadLetter(id: string): boolean {
    return this.deadLetterQueue.resolve(id);
  }

  /** Get circuit breaker states for all tracked agents. */
  getCircuitStates(): Record<string, CircuitState> {
    return this.circuitBreakers.getAllStates();
  }

  /** Get the circuit breaker state for a specific agent. */
  getCircuitState(agentId: string): CircuitState {
    return this.circuitBreakers.getState(agentId);
  }

  /** Reset a circuit breaker to closed state. */
  resetCircuit(agentId: string): void {
    this.circuitBreakers.reset(agentId);
  }

  /** Get the aggregated cost summary for a trace. */
  getTraceCost(traceId: string) {
    return this.costAccountant.getTraceCost(traceId);
  }

  /** Get the aggregated spend summary for an agent. */
  getAgentSpend(agentId: string) {
    return this.costAccountant.getAgentSpend(agentId);
  }

  /** Get spend summaries for all agents. */
  getAllAgentSpend() {
    return this.costAccountant.getAllAgentSpend();
  }

  /** Get the current token budget for an agent. */
  getAgentBudget(agentId: string): AgentBudget | undefined {
    return this.budgetTracker.getBudget(agentId);
  }

  /** Override the hourly and daily token budget limits for an agent. */
  setAgentBudgetLimits(agentId: string, maxPerHour: number, maxPerDay: number): void {
    this.budgetTracker.setLimits(agentId, maxPerHour, maxPerDay);
  }

  /** Return all agent budgets. */
  getAllBudgets(): AgentBudget[] {
    return this.budgetTracker.getAllBudgets();
  }

  /** Register a new organization in the federation. */
  registerOrg(org: Organization): void {
    this.orgRegistry.registerOrg(org);
  }

  /** Retrieve an organization by ID. */
  getOrg(orgId: string): Organization | undefined {
    return this.orgRegistry.getOrg(orgId);
  }

  /** List all registered organizations. */
  listOrgs(): Organization[] {
    return this.orgRegistry.listOrgs();
  }

  /** Update an organization's name, tier, or metadata. */
  updateOrg(
    orgId: string,
    updates: Partial<Pick<Organization, 'name' | 'tier' | 'metadata'>>
  ): Organization | undefined {
    return this.orgRegistry.updateOrg(orgId, updates);
  }

  /** Create a new namespace within an organization. */
  createNamespace(ns: Namespace): void {
    this.namespaceRegistry.createNamespace(ns);
  }

  /** Retrieve a namespace by ID. */
  getNamespace(namespaceId: string): Namespace | undefined {
    return this.namespaceRegistry.getNamespace(namespaceId);
  }

  /** List all namespaces for an organization. */
  listNamespaces(orgId: string): Namespace[] {
    return this.namespaceRegistry.listNamespaces(orgId);
  }

  /** Update resource quotas for a namespace. */
  updateNamespaceQuotas(
    namespaceId: string,
    quotas: Partial<NamespaceQuotas>
  ): Namespace | undefined {
    return this.namespaceRegistry.updateQuotas(namespaceId, quotas);
  }

  /** Create a federation grant from one organization to another. */
  createGrant(grant: FederationGrant): void {
    this.grantRegistry.createGrant(grant);
  }

  /** Retrieve a federation grant by ID. */
  getGrant(grantId: string): FederationGrant | undefined {
    return this.grantRegistry.getGrant(grantId);
  }

  /** List all grants involving an organization. */
  listGrants(orgId: string): FederationGrant[] {
    return this.grantRegistry.listGrants(orgId);
  }

  /** Suspend an active federation grant. */
  suspendGrant(grantId: string): FederationGrant | undefined {
    return this.grantRegistry.suspendGrant(grantId);
  }

  /** Permanently revoke a federation grant. */
  revokeGrant(grantId: string): FederationGrant | undefined {
    return this.grantRegistry.revokeGrant(grantId);
  }

  /** Get usage data for a federation grant on a specific date. */
  getGrantUsage(grantId: string, date?: string) {
    return this.grantUsageTracker.getUsage(grantId, date);
  }

  /** Get the underlying organization registry. */
  getOrgRegistry(): OrgRegistry {
    return this.orgRegistry;
  }

  /** Get the underlying namespace registry. */
  getNamespaceRegistry(): NamespaceRegistry {
    return this.namespaceRegistry;
  }

  /** Get the underlying grant registry. */
  getGrantRegistry(): GrantRegistry {
    return this.grantRegistry;
  }

  /** Create a new API key for an organization. */
  createApiKey(orgId: string, scopes?: string[], rateLimit?: number, expiresAt?: string) {
    return this.apiKeyRegistry.createKey(orgId, scopes, rateLimit, expiresAt);
  }

  /** Validate a raw API key and return the key record if valid. */
  validateApiKey(rawKey: string) {
    return this.apiKeyRegistry.validateKey(rawKey);
  }

  /** Revoke an API key. */
  revokeApiKey(keyId: string) {
    return this.apiKeyRegistry.revokeKey(keyId);
  }

  /** List all API keys for an organization. */
  listApiKeys(orgId: string) {
    return this.apiKeyRegistry.listKeys(orgId);
  }

  /** Get the underlying API key registry. */
  getApiKeyRegistry(): ApiKeyRegistry {
    return this.apiKeyRegistry;
  }

  /** Get the underlying rate limiter. */
  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  /** Register a webhook for an organization. */
  registerWebhook(orgId: string, url: string, events?: string[]) {
    return this.webhookRegistry.register(orgId, url, events);
  }

  /** Get all webhooks for an organization. */
  getWebhooks(orgId: string) {
    return this.webhookRegistry.getWebhooks(orgId);
  }

  /** Delete a webhook registration. */
  deleteWebhook(webhookId: string) {
    return this.webhookRegistry.deleteWebhook(webhookId);
  }

  /** Get the underlying webhook registry. */
  getWebhookRegistry(): WebhookRegistry {
    return this.webhookRegistry;
  }

  /** Get the underlying webhook deliverer. */
  getWebhookDeliverer(): WebhookDeliverer {
    return this.webhookDeliverer;
  }

  /** Publish a service listing to the exchange catalog. */
  publishService(listing: ServiceListing): ServiceListing {
    return this.catalogRegistry.publish(listing);
  }

  /** Search the service catalog with optional filters. */
  searchCatalog(query: string, filters?: CatalogSearchFilters): ServiceListing[] {
    return this.catalogRegistry.search(query, filters);
  }

  /** Retrieve a service listing by ID. */
  getService(listingId: string): ServiceListing | undefined {
    return this.catalogRegistry.get(listingId);
  }

  /** Get all service listings for an organization. */
  getCatalogByOrg(orgId: string): ServiceListing[] {
    return this.catalogRegistry.getByOrg(orgId);
  }

  /** Get the underlying catalog registry. */
  getCatalogRegistry(): CatalogRegistry {
    return this.catalogRegistry;
  }

  /** Create a credit account for an organization. */
  createCreditAccount(orgId: string, initialBalance?: number): CreditAccount {
    return this.billingEngine.createAccount(orgId, initialBalance);
  }

  /** Add credits to an organization's account. */
  addCredits(orgId: string, amount: number, reason: string): CreditTransaction {
    return this.billingEngine.addCredits(orgId, amount, reason);
  }

  /** Get the current credit balance for an organization. */
  getBalance(orgId: string): number {
    return this.billingEngine.getBalance(orgId);
  }

  /** Get transaction history for an organization. */
  getTransactions(orgId: string) {
    return this.billingEngine.getTransactions(orgId);
  }

  /** Get earnings summary for a service provider organization. */
  getEarnings(orgId: string) {
    return this.billingEngine.getEarnings(orgId);
  }

  /** Get spending summary for a buyer organization. */
  getSpend(orgId: string) {
    return this.billingEngine.getSpend(orgId);
  }

  /** Get the underlying billing engine. */
  getBillingEngine(): BillingEngine {
    return this.billingEngine;
  }

  /** Subscribe a buyer organization to a service listing, charging the first period and creating a federation grant. */
  subscribe(buyerOrgId: string, listingId: string, plan: SubscriptionPlan): Subscription {
    const listing = this.catalogRegistry.get(listingId);
    if (!listing) throw new Error(`Listing ${listingId} not found`);

    const creditsPerPeriod =
      listing.pricing.subscriptionRate ?? listing.pricing.perRequestCost ?? 0;
    const requestsIncluded = listing.pricing.freeQuota ?? 100;
    const overageRate = listing.pricing.perRequestCost ?? 1;

    // Charge the buyer for the first period
    const buyerBalance = this.billingEngine.getBalance(buyerOrgId);
    if (buyerBalance < creditsPerPeriod) {
      throw new InsufficientBalanceError(buyerOrgId, buyerBalance, creditsPerPeriod);
    }

    // Use a transaction for atomicity
    const subscribeTxn = this.db.transaction(() => {
      // Charge first period
      if (creditsPerPeriod > 0) {
        this.billingEngine.chargeForUsage(
          `sub-${uuidv4()}`,
          buyerOrgId,
          listing.orgId,
          creditsPerPeriod,
          listingId
        );
      }

      // Create subscription
      const sub = this.subscriptionRegistry.create(
        buyerOrgId,
        listingId,
        listing.orgId,
        plan,
        creditsPerPeriod,
        requestsIncluded,
        overageRate
      );

      // Auto-grant: create federation grant from seller to buyer
      const grantId = `sub-grant-${sub.subscriptionId}`;
      const planDays: Record<SubscriptionPlan, number> = { daily: 1, weekly: 7, monthly: 30 };
      const maxTokens = planDays[plan] * 100000;

      this.grantRegistry.createGrant({
        grantId,
        fromOrgId: listing.orgId,
        toOrgId: buyerOrgId,
        contractIds: listing.contractIds,
        capabilities: listing.capabilities,
        maxTokensPerDay: maxTokens,
        maxCostPerDay: creditsPerPeriod,
        conditions: {
          requireApproval: false,
          allowedTools: [],
          blockedTools: [],
          maxConcurrent: 10,
        },
        status: 'active',
        createdAt: new Date().toISOString(),
      });

      this.subscriptionRegistry.setGrantId(sub.subscriptionId, grantId);
      return { ...sub, grantId };
    });

    return subscribeTxn();
  }

  /** Cancel a subscription, either immediately or at the end of the current period. */
  cancelSubscription(subscriptionId: string, immediate?: boolean): Subscription | undefined {
    return this.subscriptionRegistry.cancel(subscriptionId, immediate);
  }

  /** Get all subscriptions for a buyer organization. */
  getSubscriptions(buyerOrgId: string): Subscription[] {
    return this.subscriptionRegistry.getByBuyer(buyerOrgId);
  }

  /** Get the underlying subscription registry. */
  getSubscriptionRegistry(): SubscriptionRegistry {
    return this.subscriptionRegistry;
  }

  /** Submit a review for a service listing. */
  submitReview(review: Omit<ServiceReview, 'reviewId' | 'createdAt' | 'response'>): ServiceReview {
    return this.reviewRegistry.create(review);
  }

  /** Get all reviews for a service listing. */
  getReviews(listingId: string): ServiceReview[] {
    return this.reviewRegistry.getByListing(listingId);
  }

  /** Add a provider response to a review. */
  respondToReview(reviewId: string, body: string): ServiceReview | undefined {
    return this.reviewRegistry.addResponse(reviewId, body);
  }

  /** Get the underlying review registry. */
  getReviewRegistry(): ReviewRegistry {
    return this.reviewRegistry;
  }

  /** Retrieve all trace events for a given trace ID. */
  getTrace(traceId: string): TraceEvent[] {
    return this.tracer.getTrace(traceId);
  }

  /** Query trace events using a filter. */
  getTraces(filter: TraceFilter): TraceEvent[] {
    return this.tracer.getTraces(filter);
  }

  /** Get summaries of recent traces. */
  getRecentTraces(limit?: number) {
    return this.tracer.getRecentTraces(limit);
  }

  /** Get all registered contracts. */
  getContracts(): TaskContract[] {
    return this.contractRegistry.getAll();
  }

  /** Get all registered agent identities. */
  getAgents(): AgentIdentity[] {
    return this.identityRegistry.getAll();
  }

  /** Get the underlying contract registry. */
  getContractRegistry(): ContractRegistry {
    return this.contractRegistry;
  }

  /** Get the underlying identity registry. */
  getIdentityRegistry(): IdentityRegistry {
    return this.identityRegistry;
  }

  /** Get the underlying policy engine. */
  getPolicyEngine(): PolicyEngine {
    return this.policyEngine;
  }

  /** Close the MoltMesh instance, releasing database connections. */
  close(): void {
    this.traceStore.close();
    try {
      this.db.close();
    } catch {
      // db may already be closed if same path as traceStore
    }
  }

  private getAdapterProtocol(agentId: string): string | undefined {
    const config = this.agentConfigs.get(agentId);
    if (!config) return undefined;
    const protocol = config.metadata?.protocol as string | undefined;
    if (protocol) return protocol;
    if (config.model) return 'openai';
    if (config.endpoint) return 'http';
    return 'echo';
  }

  private resolveTargetAgentId(envelope: TaskEnvelope): string | undefined {
    if (envelope.target) return envelope.target;
    const contract = this.contractRegistry.get(envelope.contractId, envelope.version);
    if (!contract) return undefined;
    const agents = this.identityRegistry.findByCapability(contract.capability);
    return agents[0]?.agentId;
  }
}
