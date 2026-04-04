import { describe, it, expect } from 'vitest';
import { ContractRegistry } from '../src/contracts/registry.js';
import { validateData } from '../src/contracts/validator.js';
import { TaskContract, TrustTier } from '../src/contracts/schema.js';

function makeContract(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    contractId: 'test-contract',
    version: '1.0.0',
    capability: 'test',
    description: 'Test contract',
    inputSchema: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
    outputSchema: { type: 'object', properties: { result: { type: 'string' } } },
    securityClass: TrustTier.INTERNAL_TRUSTED,
    requiredTools: [],
    timeout: 5000,
    retryPolicy: { maxRetries: 1, backoffMs: 500 },
    approvalRequired: false,
    ...overrides,
  };
}

describe('ContractRegistry', () => {
  it('should register and retrieve a contract', () => {
    const reg = new ContractRegistry();
    const contract = makeContract();
    reg.register(contract);
    const retrieved = reg.get('test-contract', '1.0.0');
    expect(retrieved).toBeDefined();
    expect(retrieved!.contractId).toBe('test-contract');
  });

  it('should retrieve the latest version when version is omitted', () => {
    const reg = new ContractRegistry();
    reg.register(makeContract({ version: '1.0.0' }));
    reg.register(makeContract({ version: '2.0.0' }));
    const latest = reg.get('test-contract');
    expect(latest!.version).toBe('2.0.0');
  });

  it('should prevent duplicate contract versions', () => {
    const reg = new ContractRegistry();
    reg.register(makeContract());
    expect(() => reg.register(makeContract())).toThrow('already exists');
  });

  it('should allow different versions of the same contract', () => {
    const reg = new ContractRegistry();
    reg.register(makeContract({ version: '1.0.0' }));
    reg.register(makeContract({ version: '1.1.0' }));
    expect(reg.getVersions('test-contract')).toEqual(['1.0.0', '1.1.0']);
  });

  it('should return undefined for unknown contracts', () => {
    const reg = new ContractRegistry();
    expect(reg.get('nonexistent')).toBeUndefined();
  });

  it('should list all contracts', () => {
    const reg = new ContractRegistry();
    reg.register(makeContract({ contractId: 'a', version: '1.0.0' }));
    reg.register(makeContract({ contractId: 'b', version: '1.0.0' }));
    expect(reg.getAll()).toHaveLength(2);
  });

  it('should check existence with has()', () => {
    const reg = new ContractRegistry();
    reg.register(makeContract());
    expect(reg.has('test-contract')).toBe(true);
    expect(reg.has('test-contract', '1.0.0')).toBe(true);
    expect(reg.has('test-contract', '9.9.9')).toBe(false);
    expect(reg.has('nonexistent')).toBe(false);
  });

  it('should store immutable copies', () => {
    const reg = new ContractRegistry();
    const contract = makeContract();
    reg.register(contract);
    contract.description = 'modified';
    const retrieved = reg.get('test-contract', '1.0.0');
    expect(retrieved!.description).toBe('Test contract');
  });
});

describe('validateData', () => {
  it('should validate valid data', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };
    const result = validateData(schema, { name: 'test' });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject invalid data', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };
    const result = validateData(schema, { name: 123 });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should reject data missing required fields', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };
    const result = validateData(schema, {});
    expect(result.valid).toBe(false);
  });

  it('should validate nested objects', () => {
    const schema = {
      type: 'object',
      properties: {
        meta: {
          type: 'object',
          properties: { count: { type: 'number' } },
          required: ['count'],
        },
      },
      required: ['meta'],
    };
    expect(validateData(schema, { meta: { count: 5 } }).valid).toBe(true);
    expect(validateData(schema, { meta: { count: 'five' } }).valid).toBe(false);
  });

  it('should validate arrays', () => {
    const schema = { type: 'array', items: { type: 'string' } };
    expect(validateData(schema, ['a', 'b']).valid).toBe(true);
    expect(validateData(schema, ['a', 1]).valid).toBe(false);
  });
});
