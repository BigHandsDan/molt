import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  NamespaceRegistry,
  Namespace,
  NamespaceQuotas,
  DEFAULT_NAMESPACE_QUOTAS,
} from '../src/federation/namespace.js';

function makeNamespace(overrides: Partial<Namespace> = {}): Namespace {
  return {
    namespaceId: 'acme-corp/engineering',
    orgId: 'acme-corp',
    name: 'engineering',
    quotas: { ...DEFAULT_NAMESPACE_QUOTAS },
    metadata: {},
    ...overrides,
  };
}

describe('NamespaceRegistry', () => {
  let db: Database.Database;
  let registry: NamespaceRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    registry = new NamespaceRegistry(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should create a namespace', () => {
    registry.createNamespace(makeNamespace());
    const ns = registry.getNamespace('acme-corp/engineering');
    expect(ns).toBeDefined();
    expect(ns!.orgId).toBe('acme-corp');
    expect(ns!.name).toBe('engineering');
  });

  it('should reject duplicate namespace creation', () => {
    registry.createNamespace(makeNamespace());
    expect(() => registry.createNamespace(makeNamespace())).toThrow('already exists');
  });

  it('should require orgId/teamName format', () => {
    expect(() => registry.createNamespace(makeNamespace({ namespaceId: 'invalid' }))).toThrow(
      'format'
    );
  });

  it('should return undefined for unknown namespaceId', () => {
    const ns = registry.getNamespace('nonexistent/ns');
    expect(ns).toBeUndefined();
  });

  it('should list namespaces by orgId', () => {
    registry.createNamespace(
      makeNamespace({ namespaceId: 'acme/eng', name: 'eng', orgId: 'acme' })
    );
    registry.createNamespace(
      makeNamespace({ namespaceId: 'acme/sales', name: 'sales', orgId: 'acme' })
    );
    registry.createNamespace(
      makeNamespace({ namespaceId: 'widget/dev', name: 'dev', orgId: 'widget' })
    );

    const acmeNs = registry.listNamespaces('acme');
    expect(acmeNs).toHaveLength(2);

    const widgetNs = registry.listNamespaces('widget');
    expect(widgetNs).toHaveLength(1);
  });

  it('should support hierarchical namespaces', () => {
    registry.createNamespace(
      makeNamespace({ namespaceId: 'acme/eng', name: 'eng', orgId: 'acme' })
    );
    registry.createNamespace(
      makeNamespace({
        namespaceId: 'acme/eng-frontend',
        name: 'eng-frontend',
        orgId: 'acme',
        parentNamespace: 'acme/eng',
      })
    );

    const child = registry.getNamespace('acme/eng-frontend');
    expect(child).toBeDefined();
    expect(child!.parentNamespace).toBe('acme/eng');
  });

  it('should store default quotas', () => {
    registry.createNamespace(makeNamespace());
    const ns = registry.getNamespace('acme-corp/engineering');
    expect(ns!.quotas).toEqual(DEFAULT_NAMESPACE_QUOTAS);
  });

  it('should update quotas partially', () => {
    registry.createNamespace(makeNamespace());
    const updated = registry.updateQuotas('acme-corp/engineering', { maxAgents: 50 });
    expect(updated).toBeDefined();
    expect(updated!.quotas.maxAgents).toBe(50);
    expect(updated!.quotas.maxTokensPerDay).toBe(DEFAULT_NAMESPACE_QUOTAS.maxTokensPerDay);
  });

  it('should update multiple quota fields', () => {
    registry.createNamespace(makeNamespace());
    const updated = registry.updateQuotas('acme-corp/engineering', {
      maxAgents: 200,
      maxCostPerDay: 500,
    });
    expect(updated!.quotas.maxAgents).toBe(200);
    expect(updated!.quotas.maxCostPerDay).toBe(500);
    expect(updated!.quotas.maxContractsPerHour).toBe(DEFAULT_NAMESPACE_QUOTAS.maxContractsPerHour);
  });

  it('should return undefined when updating nonexistent namespace', () => {
    const updated = registry.updateQuotas('nonexistent/ns', { maxAgents: 10 });
    expect(updated).toBeUndefined();
  });

  it('should store and retrieve metadata', () => {
    registry.createNamespace(makeNamespace({ metadata: { env: 'production', team: 'platform' } }));
    const ns = registry.getNamespace('acme-corp/engineering');
    expect(ns!.metadata).toEqual({ env: 'production', team: 'platform' });
  });

  it('should return empty list for org with no namespaces', () => {
    const list = registry.listNamespaces('nonexistent');
    expect(list).toEqual([]);
  });

  it('should store custom quotas', () => {
    const customQuotas: NamespaceQuotas = {
      maxAgents: 10,
      maxContractsPerHour: 50,
      maxTokensPerDay: 10000,
      maxCostPerDay: 5,
    };
    registry.createNamespace(makeNamespace({ quotas: customQuotas }));
    const ns = registry.getNamespace('acme-corp/engineering');
    expect(ns!.quotas).toEqual(customQuotas);
  });
});
