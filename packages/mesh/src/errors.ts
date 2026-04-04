/** Base error class for all MoltMesh errors. */
export class MoltMeshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoltMeshError';
  }
}

/** Thrown when task input or output fails JSON Schema validation against a contract. */
export class ContractValidationError extends MoltMeshError {
  public readonly contractId: string;
  public readonly validationErrors: string[];

  constructor(contractId: string, errors: string[]) {
    super(`Contract validation failed for ${contractId}: ${errors.join('; ')}`);
    this.name = 'ContractValidationError';
    this.contractId = contractId;
    this.validationErrors = errors;
  }
}

/** Thrown when a policy rule denies a task dispatch. */
export class PolicyDeniedError extends MoltMeshError {
  public readonly ruleId: string;
  public readonly agentId: string;

  constructor(ruleId: string, reason: string, agentId: string) {
    super(`Policy denied: ${reason}`);
    this.name = 'PolicyDeniedError';
    this.ruleId = ruleId;
    this.agentId = agentId;
  }
}

/** Thrown when routing fails — contract not found, no matching agent, or missing adapter config. */
export class RoutingError extends MoltMeshError {
  public readonly contractId: string;

  constructor(message: string, contractId: string) {
    super(message);
    this.name = 'RoutingError';
    this.contractId = contractId;
  }
}

/** Thrown when an adapter encounters an error during dispatch or health check. */
export class AdapterError extends MoltMeshError {
  public readonly adapterId: string;
  public readonly protocol: string;

  constructor(message: string, adapterId: string, protocol: string) {
    super(message);
    this.name = 'AdapterError';
    this.adapterId = adapterId;
    this.protocol = protocol;
  }
}

/** Thrown when a dispatched task exceeds its configured timeout. */
export class TimeoutError extends MoltMeshError {
  public readonly envelopeId: string;
  public readonly timeoutMs: number;

  constructor(envelopeId: string, timeoutMs: number) {
    super(`Dispatch timed out after ${timeoutMs}ms for envelope ${envelopeId}`);
    this.name = 'TimeoutError';
    this.envelopeId = envelopeId;
    this.timeoutMs = timeoutMs;
  }
}

/** Thrown when an agent's hourly or daily token budget has been exhausted. */
export class BudgetExceededError extends MoltMeshError {
  public readonly agentId: string;
  public readonly budgetType: 'hourly' | 'daily';
  public readonly usage: number;
  public readonly limit: number;

  constructor(agentId: string, budgetType: 'hourly' | 'daily', usage: number, limit: number) {
    super(
      `Budget exceeded for agent ${agentId}: ${budgetType} usage ${usage} exceeds limit ${limit}`
    );
    this.name = 'BudgetExceededError';
    this.agentId = agentId;
    this.budgetType = budgetType;
    this.usage = usage;
    this.limit = limit;
  }
}

/** Thrown when a dispatch is attempted against an agent whose circuit breaker is open. */
export class CircuitOpenError extends MoltMeshError {
  public readonly agentId: string;

  constructor(agentId: string) {
    super(`Circuit breaker is open for agent ${agentId} — agent is temporarily unavailable`);
    this.name = 'CircuitOpenError';
    this.agentId = agentId;
  }
}

/** Thrown when an organization lacks sufficient credit balance for a billing operation. */
export class InsufficientBalanceError extends MoltMeshError {
  public readonly orgId: string;
  public readonly balance: number;
  public readonly required: number;

  constructor(orgId: string, balance: number, required: number) {
    super(`Insufficient balance for org ${orgId}: has ${balance} credits, needs ${required}`);
    this.name = 'InsufficientBalanceError';
    this.orgId = orgId;
    this.balance = balance;
    this.required = required;
  }
}
