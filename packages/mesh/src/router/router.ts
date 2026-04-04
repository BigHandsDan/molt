import { TaskEnvelope, TaskResult } from './types.js';
import { TaskContract } from '../contracts/schema.js';
import { ContractRegistry } from '../contracts/registry.js';
import { validateData } from '../contracts/validator.js';
import { IdentityRegistry } from '../identity/registry.js';
import { AgentIdentity } from '../identity/types.js';
import { PolicyEngine } from '../policy/engine.js';
import { PolicyContext, PolicyDecision } from '../policy/types.js';
import { Dispatcher } from './dispatcher.js';
import { MoltMeshAdapter, AdapterConfig } from '../adapters/interface.js';
import { CircuitBreakerRegistry } from './circuit-breaker.js';
import { DeadLetterQueue, DeadLetterAttempt } from './dead-letter.js';
import { CircuitOpenError, RoutingError } from '../errors.js';
import { GrantRegistry } from '../federation/grants.js';
import { GrantUsageTracker } from '../federation/grant-usage.js';

/** Dependencies injected into the Router for contract resolution, policy, and dispatch. */
export interface RouterDeps {
  contracts: ContractRegistry;
  identities: IdentityRegistry;
  policy: PolicyEngine;
  adapters: Map<string, MoltMeshAdapter>;
  agentConfigs: Map<string, AdapterConfig>;
  circuitBreakers?: CircuitBreakerRegistry;
  deadLetterQueue?: DeadLetterQueue;
  grantRegistry?: GrantRegistry;
  grantUsageTracker?: GrantUsageTracker;
}

/** Full result of routing a task, including the dispatch result, policy decision, and validation errors. */
export interface RouteResult {
  taskResult: TaskResult;
  policyDecision: PolicyDecision;
  targetAgent: AgentIdentity;
  contract: TaskContract;
  validationErrors: string[];
  outputValidationErrors: string[];
}

/**
 * Core routing engine that validates input, evaluates policy, resolves adapters,
 * dispatches tasks with retries, and handles fallbacks and dead-lettering.
 *
 * @example
 * ```ts
 * const router = new Router({ contracts, identities, policy, adapters, agentConfigs });
 * const result = await router.route(envelope);
 * ```
 */
export class Router {
  private deps: RouterDeps;
  private dispatcher = new Dispatcher();

  constructor(deps: RouterDeps) {
    this.deps = deps;
  }

  /** Route a task envelope through validation, policy, dispatch, and output validation. */
  async route(envelope: TaskEnvelope): Promise<RouteResult> {
    // 1. Resolve contract
    const contract = this.deps.contracts.get(envelope.contractId, envelope.version);
    if (!contract) {
      throw new RoutingError(
        `Contract not found: ${envelope.contractId}@${envelope.version}`,
        envelope.contractId
      );
    }

    // 2. Validate input against contract schema
    const inputValidation = validateData(contract.inputSchema, envelope.input);
    if (!inputValidation.valid) {
      const denied = this.makeDeniedResult(envelope, 'input-validator', inputValidation.errors);
      return {
        taskResult: denied,
        policyDecision: {
          allowed: false,
          ruleId: 'input-validation',
          reason: `Input validation failed: ${inputValidation.errors.join('; ')}`,
          conditions: [],
          timestamp: new Date().toISOString(),
        },
        targetAgent: envelope.caller,
        contract,
        validationErrors: inputValidation.errors,
        outputValidationErrors: [],
      };
    }

    // 3. Find target agent
    const targetAgent = this.findTargetAgent(envelope, contract);
    if (!targetAgent) {
      throw new RoutingError(
        `No agent found for contract ${envelope.contractId} (capability: ${contract.capability})`,
        envelope.contractId
      );
    }

    // 3b. Namespace isolation check
    const callerNamespace = envelope.caller.namespaceId || 'default/default';
    const targetNamespace = targetAgent.namespaceId || 'default/default';
    const callerOrg = envelope.caller.orgId || 'default';
    const targetOrg = targetAgent.orgId || 'default';

    if (callerNamespace !== targetNamespace && callerOrg !== targetOrg) {
      // Cross-org request — check federation grant
      if (this.deps.grantRegistry) {
        const grantCheck = this.deps.grantRegistry.checkGrant(
          targetOrg,
          callerOrg,
          contract.capability
        );
        if (!grantCheck.valid) {
          return {
            taskResult: {
              envelopeId: envelope.envelopeId,
              contractId: envelope.contractId,
              output: null,
              status: 'denied',
              agentId: targetAgent.agentId,
              durationMs: 0,
              error: `NAMESPACE_ISOLATION: ${grantCheck.reason || 'Cross-namespace request denied — no federation grant'}`,
            },
            policyDecision: {
              allowed: false,
              ruleId: 'namespace-isolation',
              reason: grantCheck.reason || 'Cross-namespace request denied — no federation grant',
              conditions: [
                `callerNamespace: ${callerNamespace}`,
                `targetNamespace: ${targetNamespace}`,
              ],
              timestamp: new Date().toISOString(),
            },
            targetAgent,
            contract,
            validationErrors: [],
            outputValidationErrors: [],
          };
        }

        // Check grant quota
        if (this.deps.grantUsageTracker && grantCheck.grantId) {
          const grant = this.deps.grantRegistry.getGrant(grantCheck.grantId);
          if (grant) {
            const quotaCheck = this.deps.grantUsageTracker.checkQuota(
              grantCheck.grantId,
              grant.maxTokensPerDay,
              grant.maxCostPerDay
            );
            if (!quotaCheck.withinBudget) {
              return {
                taskResult: {
                  envelopeId: envelope.envelopeId,
                  contractId: envelope.contractId,
                  output: null,
                  status: 'denied',
                  agentId: targetAgent.agentId,
                  durationMs: 0,
                  error: `GRANT_QUOTA_EXCEEDED: ${quotaCheck.reason}`,
                },
                policyDecision: {
                  allowed: false,
                  ruleId: 'grant-quota',
                  reason: quotaCheck.reason || 'Grant quota exceeded',
                  conditions: [`grantId: ${grantCheck.grantId}`],
                  timestamp: new Date().toISOString(),
                },
                targetAgent,
                contract,
                validationErrors: [],
                outputValidationErrors: [],
              };
            }
          }
        }
      } else {
        // No grant registry — deny cross-org by default
        return {
          taskResult: {
            envelopeId: envelope.envelopeId,
            contractId: envelope.contractId,
            output: null,
            status: 'denied',
            agentId: targetAgent.agentId,
            durationMs: 0,
            error:
              'NAMESPACE_ISOLATION: Cross-namespace request denied — federation not configured',
          },
          policyDecision: {
            allowed: false,
            ruleId: 'namespace-isolation',
            reason: 'Cross-namespace request denied — federation not configured',
            conditions: [
              `callerNamespace: ${callerNamespace}`,
              `targetNamespace: ${targetNamespace}`,
            ],
            timestamp: new Date().toISOString(),
          },
          targetAgent,
          contract,
          validationErrors: [],
          outputValidationErrors: [],
        };
      }
    }

    // 3c. Check circuit breaker
    if (this.deps.circuitBreakers) {
      try {
        this.deps.circuitBreakers.checkCircuit(targetAgent.agentId);
      } catch (err) {
        if (err instanceof CircuitOpenError) {
          return {
            taskResult: {
              envelopeId: envelope.envelopeId,
              contractId: envelope.contractId,
              output: null,
              status: 'failure',
              agentId: targetAgent.agentId,
              durationMs: 0,
              error: err.message,
            },
            policyDecision: {
              allowed: true,
              ruleId: 'circuit-breaker',
              reason: `Circuit breaker open for agent ${targetAgent.agentId}`,
              conditions: [],
              timestamp: new Date().toISOString(),
            },
            targetAgent,
            contract,
            validationErrors: [],
            outputValidationErrors: [],
          };
        }
        throw err;
      }
    }

    // 4. Evaluate policy
    const policyContext: PolicyContext = {
      agentTrustTier: targetAgent.trustTier,
      capability: contract.capability,
      requiredTools: contract.requiredTools,
      agentAllowedTools: targetAgent.allowedTools,
      approvalRequired: contract.approvalRequired,
      agentCapabilities: targetAgent.capabilities,
    };

    const policyDecision = this.deps.policy.evaluate(policyContext);

    if (!policyDecision.allowed) {
      return {
        taskResult: {
          envelopeId: envelope.envelopeId,
          contractId: envelope.contractId,
          output: null,
          status: 'denied',
          agentId: targetAgent.agentId,
          durationMs: 0,
          error: `Policy denied: ${policyDecision.reason}`,
        },
        policyDecision,
        targetAgent,
        contract,
        validationErrors: [],
        outputValidationErrors: [],
      };
    }

    // 5. Get adapter and config
    const config = this.deps.agentConfigs.get(targetAgent.agentId);
    if (!config) {
      throw new RoutingError(
        `No adapter config for agent ${targetAgent.agentId}`,
        envelope.contractId
      );
    }

    const adapter = this.findAdapter(config);
    if (!adapter) {
      throw new RoutingError(
        `No adapter found for agent ${targetAgent.agentId}`,
        envelope.contractId
      );
    }

    // 6. Dispatch with retries
    const attempts: DeadLetterAttempt[] = [];
    let taskResult = await this.dispatcher.dispatchWithRetry(
      envelope,
      adapter,
      config,
      contract.timeout,
      contract.retryPolicy.maxRetries,
      contract.retryPolicy.backoffMs,
      attempts
    );

    // 7. Handle fallback
    if (taskResult.status !== 'success' && contract.fallbackContract) {
      const fallbackResult = await this.handleFallback(envelope, contract.fallbackContract);
      if (fallbackResult) {
        taskResult = fallbackResult.taskResult;
      }
    }

    // 8. Dead-letter if all retries and fallback failed
    if (
      taskResult.status !== 'success' &&
      taskResult.status !== 'denied' &&
      this.deps.deadLetterQueue
    ) {
      if (
        !contract.fallbackContract ||
        taskResult.status === 'failure' ||
        taskResult.status === 'timeout'
      ) {
        this.deps.deadLetterQueue.add(
          envelope,
          attempts,
          taskResult.error || `Task failed with status: ${taskResult.status}`
        );
      }
    }

    // 9. Validate output
    let outputValidationErrors: string[] = [];
    if (taskResult.status === 'success' && taskResult.output !== null) {
      const outputValidation = validateData(contract.outputSchema, taskResult.output);
      outputValidationErrors = outputValidation.errors;
    }

    return {
      taskResult,
      policyDecision,
      targetAgent,
      contract,
      validationErrors: [],
      outputValidationErrors,
    };
  }

  private findTargetAgent(
    envelope: TaskEnvelope,
    contract: TaskContract
  ): AgentIdentity | undefined {
    if (envelope.target) {
      return this.deps.identities.get(envelope.target);
    }
    // Capability-based routing: find first agent with matching capability
    const agents = this.deps.identities.findByCapability(contract.capability);
    return agents[0];
  }

  private findAdapter(config: AdapterConfig): MoltMeshAdapter | undefined {
    // Look up by metadata.protocol, or try common protocols
    const protocol = config.metadata?.protocol as string | undefined;
    if (protocol && this.deps.adapters.has(protocol)) {
      return this.deps.adapters.get(protocol);
    }
    // Infer from config
    if (config.model) return this.deps.adapters.get('openai');
    if (config.endpoint) return this.deps.adapters.get('http');
    return this.deps.adapters.get('echo');
  }

  private async handleFallback(
    envelope: TaskEnvelope,
    fallbackContractId: string
  ): Promise<RouteResult | null> {
    const fallbackContract = this.deps.contracts.get(fallbackContractId);
    if (!fallbackContract) return null;

    const fallbackEnvelope: TaskEnvelope = {
      ...envelope,
      contractId: fallbackContractId,
      version: fallbackContract.version,
    };

    try {
      return await this.route(fallbackEnvelope);
    } catch {
      return null;
    }
  }

  private makeDeniedResult(envelope: TaskEnvelope, agentId: string, errors: string[]): TaskResult {
    return {
      envelopeId: envelope.envelopeId,
      contractId: envelope.contractId,
      output: null,
      status: 'failure',
      agentId,
      durationMs: 0,
      error: `Validation failed: ${errors.join('; ')}`,
    };
  }
}
