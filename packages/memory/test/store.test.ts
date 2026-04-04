import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteMemoryStore } from '../src/store/store.js';
import type { MemoryBin } from '../src/bin/types.js';

function makeBin(overrides: Partial<MemoryBin> = {}): MemoryBin {
  return {
    id: overrides.id ?? 'bin-1',
    keywords: overrides.keywords ?? ['test', 'memory'],
    content: overrides.content ?? 'Test memory content',
    compressedContent: overrides.compressedContent,
    compressionLevel: overrides.compressionLevel ?? 'none',
    metadata: {
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
      tier: 1,
      sizeBytes: 100,
      sourceType: 'conversation',
      relatedBins: [],
      version: 1,
      fidelity: 'verbatim',
      ...overrides.metadata,
    },
  };
}

describe('SqliteMemoryStore', () => {
  let store: SqliteMemoryStore;

  beforeEach(() => {
    store = new SqliteMemoryStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  describe('saveBin / getBin', () => {
    it('should save and retrieve a bin', () => {
      const bin = makeBin();
      store.saveBin(bin);
      const retrieved = store.getBin('bin-1');
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('bin-1');
      expect(retrieved!.keywords).toEqual(['test', 'memory']);
      expect(retrieved!.content).toBe('Test memory content');
    });

    it('should return undefined for non-existent bin', () => {
      expect(store.getBin('nonexistent')).toBeUndefined();
    });

    it('should store bin metadata correctly', () => {
      const bin = makeBin({
        metadata: {
          createdAt: 1000,
          lastAccessedAt: 2000,
          accessCount: 5,
          tier: 2,
          sizeBytes: 200,
          compressedSizeBytes: 100,
          agentId: 'agent-1',
          sourceType: 'task',
          relatedBins: ['bin-2', 'bin-3'],
          version: 3,
          ttlMs: 60000,
          fidelity: 'summary',
        },
      });
      store.saveBin(bin);
      const retrieved = store.getBin('bin-1')!;
      expect(retrieved.metadata.createdAt).toBe(1000);
      expect(retrieved.metadata.lastAccessedAt).toBe(2000);
      expect(retrieved.metadata.accessCount).toBe(5);
      expect(retrieved.metadata.tier).toBe(2);
      expect(retrieved.metadata.sizeBytes).toBe(200);
      expect(retrieved.metadata.compressedSizeBytes).toBe(100);
      expect(retrieved.metadata.agentId).toBe('agent-1');
      expect(retrieved.metadata.sourceType).toBe('task');
      expect(retrieved.metadata.relatedBins).toEqual(['bin-2', 'bin-3']);
      expect(retrieved.metadata.version).toBe(3);
      expect(retrieved.metadata.ttlMs).toBe(60000);
      expect(retrieved.metadata.fidelity).toBe('summary');
    });

    it('should store compressed content as Buffer', () => {
      const compressed = Buffer.from('compressed data');
      const bin = makeBin({ compressedContent: compressed, compressionLevel: 'light' });
      store.saveBin(bin);
      const retrieved = store.getBin('bin-1')!;
      expect(Buffer.isBuffer(retrieved.compressedContent)).toBe(true);
      expect(retrieved.compressedContent!.toString()).toBe('compressed data');
    });

    it('should handle null optional fields', () => {
      const bin = makeBin();
      store.saveBin(bin);
      const retrieved = store.getBin('bin-1')!;
      expect(retrieved.metadata.agentId).toBeUndefined();
      expect(retrieved.metadata.ttlMs).toBeUndefined();
      expect(retrieved.metadata.compressedSizeBytes).toBeUndefined();
    });

    it('should store multiple bins', () => {
      store.saveBin(makeBin({ id: 'bin-1' }));
      store.saveBin(makeBin({ id: 'bin-2' }));
      store.saveBin(makeBin({ id: 'bin-3' }));
      expect(store.getBin('bin-1')).toBeDefined();
      expect(store.getBin('bin-2')).toBeDefined();
      expect(store.getBin('bin-3')).toBeDefined();
    });
  });

  describe('deleteBin', () => {
    it('should delete an existing bin', () => {
      store.saveBin(makeBin());
      expect(store.deleteBin('bin-1')).toBe(true);
      expect(store.getBin('bin-1')).toBeUndefined();
    });

    it('should return false for non-existent bin', () => {
      expect(store.deleteBin('nonexistent')).toBe(false);
    });

    it('should also delete keyword index entries', () => {
      const bin = makeBin();
      store.saveBin(bin);
      store.saveKeywordIndex('test', 'bin-1', 1.0);
      store.deleteBin('bin-1');
      expect(store.lookupKeywords('test')).toEqual([]);
    });
  });

  describe('updateBin', () => {
    it('should update bin fields', () => {
      store.saveBin(makeBin());
      const bin = store.getBin('bin-1')!;
      bin.content = 'Updated content';
      bin.metadata.accessCount = 10;
      bin.metadata.tier = 2;
      store.updateBin(bin);
      const updated = store.getBin('bin-1')!;
      expect(updated.content).toBe('Updated content');
      expect(updated.metadata.accessCount).toBe(10);
      expect(updated.metadata.tier).toBe(2);
    });

    it('should update compression level', () => {
      store.saveBin(makeBin());
      const bin = store.getBin('bin-1')!;
      bin.compressionLevel = 'light';
      bin.compressedContent = Buffer.from('compressed');
      bin.metadata.compressedSizeBytes = 10;
      store.updateBin(bin);
      const updated = store.getBin('bin-1')!;
      expect(updated.compressionLevel).toBe('light');
      expect(updated.compressedContent!.toString()).toBe('compressed');
    });
  });

  describe('listBins', () => {
    it('should list all bins', () => {
      store.saveBin(makeBin({ id: 'bin-1' }));
      store.saveBin(makeBin({ id: 'bin-2' }));
      const bins = store.listBins();
      expect(bins).toHaveLength(2);
    });

    it('should filter by tier', () => {
      store.saveBin(makeBin({ id: 'bin-1', metadata: { tier: 1, createdAt: Date.now(), lastAccessedAt: Date.now(), accessCount: 0, sizeBytes: 100, sourceType: 'conversation', relatedBins: [], version: 1, fidelity: 'verbatim' } }));
      store.saveBin(makeBin({ id: 'bin-2', metadata: { tier: 2, createdAt: Date.now(), lastAccessedAt: Date.now(), accessCount: 0, sizeBytes: 100, sourceType: 'conversation', relatedBins: [], version: 1, fidelity: 'verbatim' } }));
      store.saveBin(makeBin({ id: 'bin-3', metadata: { tier: 1, createdAt: Date.now(), lastAccessedAt: Date.now(), accessCount: 0, sizeBytes: 100, sourceType: 'conversation', relatedBins: [], version: 1, fidelity: 'verbatim' } }));
      const tier1 = store.listBins(1);
      expect(tier1).toHaveLength(2);
      const tier2 = store.listBins(2);
      expect(tier2).toHaveLength(1);
    });

    it('should return empty array when no bins', () => {
      expect(store.listBins()).toEqual([]);
      expect(store.listBins(1)).toEqual([]);
    });

    it('should order by last_accessed_at descending', () => {
      store.saveBin(makeBin({ id: 'old', metadata: { tier: 1, createdAt: 1000, lastAccessedAt: 1000, accessCount: 0, sizeBytes: 100, sourceType: 'conversation', relatedBins: [], version: 1, fidelity: 'verbatim' } }));
      store.saveBin(makeBin({ id: 'new', metadata: { tier: 1, createdAt: 2000, lastAccessedAt: 2000, accessCount: 0, sizeBytes: 100, sourceType: 'conversation', relatedBins: [], version: 1, fidelity: 'verbatim' } }));
      const bins = store.listBins(1);
      expect(bins[0].id).toBe('new');
      expect(bins[1].id).toBe('old');
    });
  });

  describe('countBins', () => {
    it('should count all bins', () => {
      store.saveBin(makeBin({ id: 'bin-1' }));
      store.saveBin(makeBin({ id: 'bin-2' }));
      expect(store.countBins()).toBe(2);
    });

    it('should count by tier', () => {
      store.saveBin(makeBin({ id: 'bin-1', metadata: { tier: 1, createdAt: Date.now(), lastAccessedAt: Date.now(), accessCount: 0, sizeBytes: 100, sourceType: 'conversation', relatedBins: [], version: 1, fidelity: 'verbatim' } }));
      store.saveBin(makeBin({ id: 'bin-2', metadata: { tier: 2, createdAt: Date.now(), lastAccessedAt: Date.now(), accessCount: 0, sizeBytes: 100, sourceType: 'conversation', relatedBins: [], version: 1, fidelity: 'verbatim' } }));
      expect(store.countBins(1)).toBe(1);
      expect(store.countBins(2)).toBe(1);
      expect(store.countBins(3)).toBe(0);
    });

    it('should return 0 when empty', () => {
      expect(store.countBins()).toBe(0);
    });
  });

  describe('keyword index operations', () => {
    it('should save and lookup keyword entries', () => {
      store.saveBin(makeBin({ id: 'bin-1' }));
      store.saveKeywordIndex('test', 'bin-1', 1.0);
      const results = store.lookupKeywords('test');
      expect(results).toEqual([{ binId: 'bin-1', weight: 1.0 }]);
    });

    it('should lookup multiple bins for a keyword', () => {
      store.saveBin(makeBin({ id: 'bin-1' }));
      store.saveBin(makeBin({ id: 'bin-2' }));
      store.saveKeywordIndex('test', 'bin-1', 1.0);
      store.saveKeywordIndex('test', 'bin-2', 0.8);
      const results = store.lookupKeywords('test');
      expect(results).toHaveLength(2);
    });

    it('should delete keyword entries for a bin', () => {
      store.saveBin(makeBin({ id: 'bin-1' }));
      store.saveKeywordIndex('test', 'bin-1', 1.0);
      store.saveKeywordIndex('memory', 'bin-1', 1.0);
      store.deleteKeywordIndex('bin-1');
      expect(store.lookupKeywords('test')).toEqual([]);
      expect(store.lookupKeywords('memory')).toEqual([]);
    });

    it('should get all keywords', () => {
      store.saveBin(makeBin({ id: 'bin-1' }));
      store.saveBin(makeBin({ id: 'bin-2' }));
      store.saveKeywordIndex('test', 'bin-1', 1.0);
      store.saveKeywordIndex('memory', 'bin-1', 1.0);
      store.saveKeywordIndex('agent', 'bin-2', 1.0);
      const keywords = store.getAllKeywords();
      expect(keywords).toHaveLength(3);
      expect(keywords).toContain('test');
      expect(keywords).toContain('memory');
      expect(keywords).toContain('agent');
    });

    it('should replace weight on duplicate keyword-bin pair', () => {
      store.saveBin(makeBin({ id: 'bin-1' }));
      store.saveKeywordIndex('test', 'bin-1', 1.0);
      store.saveKeywordIndex('test', 'bin-1', 0.5);
      const results = store.lookupKeywords('test');
      expect(results).toHaveLength(1);
      expect(results[0].weight).toBe(0.5);
    });
  });

  describe('persistence', () => {
    it('should handle close gracefully', () => {
      store.saveBin(makeBin());
      store.close();
      // Re-creating should work (new connection)
      store = new SqliteMemoryStore(':memory:');
    });
  });
});
