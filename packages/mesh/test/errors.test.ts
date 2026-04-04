import { describe, it, expect } from 'vitest';
import {
  MoltMeshError,
  ContractValidationError,
  PolicyDeniedError,
  RoutingError,
  AdapterError,
  TimeoutError,
  BudgetExceededError,
  CircuitOpenError,
} from '../src/errors.js';

describe('Error Classes', () => {
  it('MoltMeshError should be an instance of Error', () => {
    const err = new MoltMeshError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MoltMeshError);
    expect(err.name).toBe('MoltMeshError');
    expect(err.message).toBe('test');
  });

  it('ContractValidationError should include contract details', () => {
    const err = new ContractValidationError('my-contract', ['field missing', 'type mismatch']);
    expect(err).toBeInstanceOf(MoltMeshError);
    expect(err.name).toBe('ContractValidationError');
    expect(err.contractId).toBe('my-contract');
    expect(err.validationErrors).toEqual(['field missing', 'type mismatch']);
    expect(err.message).toContain('my-contract');
  });

  it('PolicyDeniedError should include rule and agent info', () => {
    const err = new PolicyDeniedError('rule-1', 'Agent not authorized', 'agent-1');
    expect(err).toBeInstanceOf(MoltMeshError);
    expect(err.name).toBe('PolicyDeniedError');
    expect(err.ruleId).toBe('rule-1');
    expect(err.agentId).toBe('agent-1');
    expect(err.message).toContain('Agent not authorized');
  });

  it('RoutingError should include contract ID', () => {
    const err = new RoutingError('No agent found', 'research');
    expect(err).toBeInstanceOf(MoltMeshError);
    expect(err.name).toBe('RoutingError');
    expect(err.contractId).toBe('research');
  });

  it('AdapterError should include adapter details', () => {
    const err = new AdapterError('Connection refused', 'http-adapter', 'http');
    expect(err).toBeInstanceOf(MoltMeshError);
    expect(err.name).toBe('AdapterError');
    expect(err.adapterId).toBe('http-adapter');
    expect(err.protocol).toBe('http');
  });

  it('TimeoutError should include envelope and timeout', () => {
    const err = new TimeoutError('env-123', 5000);
    expect(err).toBeInstanceOf(MoltMeshError);
    expect(err.name).toBe('TimeoutError');
    expect(err.envelopeId).toBe('env-123');
    expect(err.timeoutMs).toBe(5000);
    expect(err.message).toContain('5000ms');
  });

  it('BudgetExceededError should include budget details', () => {
    const err = new BudgetExceededError('agent-1', 'hourly', 60000, 50000);
    expect(err).toBeInstanceOf(MoltMeshError);
    expect(err.name).toBe('BudgetExceededError');
    expect(err.agentId).toBe('agent-1');
    expect(err.budgetType).toBe('hourly');
    expect(err.usage).toBe(60000);
    expect(err.limit).toBe(50000);
  });

  it('CircuitOpenError should include agent ID', () => {
    const err = new CircuitOpenError('agent-1');
    expect(err).toBeInstanceOf(MoltMeshError);
    expect(err.name).toBe('CircuitOpenError');
    expect(err.agentId).toBe('agent-1');
    expect(err.message).toContain('agent-1');
  });

  it('all error classes should have proper stack traces', () => {
    const errors = [
      new MoltMeshError('test'),
      new ContractValidationError('c', []),
      new PolicyDeniedError('r', 'msg', 'a'),
      new RoutingError('msg', 'c'),
      new AdapterError('msg', 'a', 'p'),
      new TimeoutError('e', 1000),
      new BudgetExceededError('a', 'hourly', 1, 0),
      new CircuitOpenError('a'),
    ];
    for (const err of errors) {
      expect(err.stack).toBeDefined();
      expect(err.stack!.length).toBeGreaterThan(0);
    }
  });
});
