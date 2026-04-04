/**
 * MoltMesh — A neutral agent interoperability bus.
 *
 * Provides shared contracts (JSON Schema validated), adapter-based translation
 * (Echo, HTTP, OpenAI protocols), policy enforcement (rules, budgets, approvals),
 * circuit breakers, dead-letter queues, end-to-end tracing with cost accounting,
 * cross-org federation with namespaces and grants, and an inter-org service exchange
 * with catalog, credit billing, subscriptions, and reviews.
 *
 * @packageDocumentation
 */

// Core bus
export { MoltMesh, MoltMeshConfig } from './bus.js';

// Errors
export {
  MoltMeshError,
  ContractValidationError,
  PolicyDeniedError,
  RoutingError,
  AdapterError,
  TimeoutError,
  BudgetExceededError,
  CircuitOpenError,
  InsufficientBalanceError,
} from './errors.js';

// Contracts
export { TaskContract, TrustTier, RetryPolicy, ContractVisibility } from './contracts/schema.js';
export { ContractRegistry } from './contracts/registry.js';
export { validateData, ValidationResult } from './contracts/validator.js';

// Identity
export { AgentIdentity } from './identity/types.js';
export { IdentityRegistry } from './identity/registry.js';
export {
  meetsMinimumTrust,
  getTrustLevel,
  isInternal,
  isExternal,
  TRUST_TIER_LEVELS,
} from './identity/trust.js';

// Policy
export {
  PolicyRule,
  PolicyDecision,
  PolicyContext,
  PolicyConditions,
  AgentBudget,
  CrossOrgPolicyResult,
} from './policy/types.js';
export { PolicyEngine } from './policy/engine.js';
export { DEFAULT_RULES } from './policy/defaults.js';
export { BudgetTracker, BudgetConfig } from './policy/budget.js';
export { ApprovalManager, ApprovalRequest, ApprovalStatus } from './policy/approval.js';

// Router
export { TaskEnvelope, TaskResult, RouteConfig } from './router/types.js';
export { Router, RouterDeps, RouteResult } from './router/router.js';
export { Dispatcher } from './router/dispatcher.js';
export { DeadLetterQueue, DeadLetter, DeadLetterAttempt } from './router/dead-letter.js';
export {
  CircuitBreakerRegistry,
  CircuitState,
  CircuitBreakerConfig,
} from './router/circuit-breaker.js';

// Adapters
export { MoltMeshAdapter, AdapterConfig } from './adapters/interface.js';
export { EchoAdapter } from './adapters/echo.js';
export { HttpAdapter } from './adapters/http.js';
export { OpenAIAdapter, OpenAIHandler } from './adapters/openai.js';

// Trace
export { TraceEvent, TraceEventType, TraceFilter } from './trace/types.js';
export { TraceStore } from './trace/store.js';
export { Tracer } from './trace/tracer.js';

// Cost
export {
  CostAccountant,
  CostConfig,
  DEFAULT_COST_CONFIG,
  StepCost,
  TraceCostSummary,
  AgentSpendSummary,
} from './cost/accounting.js';

// Federation
export { Organization, OrgTier, OrgRegistry } from './federation/organization.js';
export {
  Namespace,
  NamespaceQuotas,
  NamespaceRegistry,
  DEFAULT_NAMESPACE_QUOTAS,
} from './federation/namespace.js';
export {
  FederationGrant,
  GrantConditions,
  GrantStatus,
  GrantRegistry,
} from './federation/grants.js';
export { GrantUsage, GrantUsageTracker } from './federation/grant-usage.js';

// Gateway
export { OrgApiKey, ApiKeyRegistry } from './gateway/api-keys.js';
export { RateLimiter, RateLimitResult } from './gateway/rate-limiter.js';
export { createAuthMiddleware } from './gateway/auth.js';
export { createGatewayRouter, GatewayDeps } from './gateway/router.js';
export { WebhookRegistration, WebhookStatus, WebhookRegistry } from './gateway/webhooks.js';
export {
  WebhookDeliverer,
  WebhookDelivererOptions,
  WebhookPayload,
  DeliveryAttempt,
  HttpFetcher,
} from './gateway/webhook-delivery.js';

// Exchange — Catalog & Discovery
export {
  ServiceCategory,
  ServicePricing,
  ServiceSLA,
  ServiceStatus,
  ServiceListing,
  CatalogSearchFilters,
  CatalogSearchSort,
  CatalogRegistry,
} from './exchange/catalog.js';

// Exchange — Credits & Billing
export {
  CreditAccount,
  CreditTransaction,
  TransactionType,
  ReferenceType,
  TokenUsage,
  EarningsSummary,
  SpendSummary,
  TransactionQueryOptions,
  DateRange,
  BillingConfig,
  BillingEngine,
} from './exchange/billing.js';

// Exchange — Router
export { createExchangeRouter, ExchangeRouterDeps } from './exchange/exchange-router.js';

// Exchange — Subscriptions
export {
  Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
  SubscriptionRegistry,
} from './exchange/subscriptions.js';

// Exchange — Reviews
export { ServiceReview, ReviewResponse, ReviewRegistry } from './exchange/reviews.js';

// Discovery — Tool Discovery & Capability Registration
export {
  AgentCapability,
  CapabilityQuery,
  CapabilityStatus,
  CapabilityPerformance,
} from './discovery/types.js';
export { CapabilityRegistry } from './discovery/registry.js';
