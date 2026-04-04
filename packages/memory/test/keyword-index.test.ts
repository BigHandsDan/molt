import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InvertedIndex } from '../src/index-engine/keyword-index.js';
import { SqliteMemoryStore } from '../src/store/store.js';
import type { MemoryBin } from '../src/bin/types.js';

function makeBin(id: string, keywords: string[], overrides: Partial<MemoryBin['metadata']> = {}): MemoryBin {
  return {
    id,
    keywords,
    content: `Content for ${id}`,
    compressionLevel: 'none',
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
      ...overrides,
    },
  };
}

describe('InvertedIndex', () => {
  let store: SqliteMemoryStore;
  let index: InvertedIndex;

  beforeEach(() => {
    store = new SqliteMemoryStore(':memory:');
    index = new InvertedIndex(store);
  });

  afterEach(() => {
    store.close();
  });

  describe('index', () => {
    it('should index a bin by keywords', () => {
      const bin = makeBin('bin-1', ['test', 'memory']);
      store.saveBin(bin);
      index.index(bin);
      const results = index.lookup(['test']);
      expect(results).toHaveLength(1);
      expect(results[0].binId).toBe('bin-1');
    });

    it('should normalize keywords to lowercase', () => {
      const bin = makeBin('bin-1', ['Test', 'MEMORY']);
      store.saveBin(bin);
      index.index(bin);
      expect(index.lookup(['test'])).toHaveLength(1);
      expect(index.lookup(['memory'])).toHaveLength(1);
    });

    it('should index multiple bins under same keyword', () => {
      const bin1 = makeBin('bin-1', ['test']);
      const bin2 = makeBin('bin-2', ['test']);
      store.saveBin(bin1);
      store.saveBin(bin2);
      index.index(bin1);
      index.index(bin2);
      expect(index.lookup(['test'])).toHaveLength(2);
    });

    it('should handle bins with many keywords', () => {
      const keywords = Array.from({ length: 10 }, (_, i) => `keyword-${i}`);
      const bin = makeBin('bin-1', keywords);
      store.saveBin(bin);
      index.index(bin);
      for (const kw of keywords) {
        expect(index.lookup([kw])).toHaveLength(1);
      }
    });

    it('should trim whitespace from keywords', () => {
      const bin = makeBin('bin-1', ['  test  ', 'memory  ']);
      store.saveBin(bin);
      index.index(bin);
      expect(index.lookup(['test'])).toHaveLength(1);
    });
  });

  describe('deindex', () => {
    it('should remove a bin from the index', () => {
      const bin = makeBin('bin-1', ['test', 'memory']);
      store.saveBin(bin);
      index.index(bin);
      index.deindex('bin-1');
      expect(index.lookup(['test'])).toHaveLength(0);
      expect(index.lookup(['memory'])).toHaveLength(0);
    });

    it('should not affect other bins when deindexing', () => {
      const bin1 = makeBin('bin-1', ['test']);
      const bin2 = makeBin('bin-2', ['test']);
      store.saveBin(bin1);
      store.saveBin(bin2);
      index.index(bin1);
      index.index(bin2);
      index.deindex('bin-1');
      const results = index.lookup(['test']);
      expect(results).toHaveLength(1);
      expect(results[0].binId).toBe('bin-2');
    });

    it('should handle deindexing non-existent bin', () => {
      expect(() => index.deindex('nonexistent')).not.toThrow();
    });

    it('should clean up empty keyword entries', () => {
      const bin = makeBin('bin-1', ['unique-keyword']);
      store.saveBin(bin);
      index.index(bin);
      index.deindex('bin-1');
      expect(index.allKeywords()).not.toContain('unique-keyword');
    });
  });

  describe('lookup', () => {
    it('should return empty for unmatched keywords', () => {
      expect(index.lookup(['nonexistent'])).toEqual([]);
    });

    it('should rank multi-keyword matches higher', () => {
      const bin1 = makeBin('bin-1', ['test']);
      const bin2 = makeBin('bin-2', ['test', 'memory']);
      store.saveBin(bin1);
      store.saveBin(bin2);
      index.index(bin1);
      index.index(bin2);
      const results = index.lookup(['test', 'memory']);
      expect(results[0].binId).toBe('bin-2');
      expect(results[0].matchedKeywords).toContain('test');
      expect(results[0].matchedKeywords).toContain('memory');
    });

    it('should respect maxResults option', () => {
      for (let i = 0; i < 20; i++) {
        const bin = makeBin(`bin-${i}`, ['common']);
        store.saveBin(bin);
        index.index(bin);
      }
      const results = index.lookup(['common'], { maxResults: 5 });
      expect(results).toHaveLength(5);
    });

    it('should filter by tier', () => {
      const bin1 = makeBin('bin-1', ['test'], { tier: 1 });
      const bin2 = makeBin('bin-2', ['test'], { tier: 2 });
      const bin3 = makeBin('bin-3', ['test'], { tier: 3 });
      store.saveBin(bin1);
      store.saveBin(bin2);
      store.saveBin(bin3);
      index.index(bin1);
      index.index(bin2);
      index.index(bin3);
      const results = index.lookup(['test'], { tierFilter: [1, 2] });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.tier !== 3)).toBe(true);
    });

    it('should filter by agentId', () => {
      const bin1 = makeBin('bin-1', ['test'], { agentId: 'agent-a' });
      const bin2 = makeBin('bin-2', ['test'], { agentId: 'agent-b' });
      store.saveBin(bin1);
      store.saveBin(bin2);
      index.index(bin1);
      index.index(bin2);
      const results = index.lookup(['test'], { agentId: 'agent-a' });
      expect(results).toHaveLength(1);
      expect(results[0].binId).toBe('bin-1');
    });

    it('should filter by minRelevance', () => {
      const bin = makeBin('bin-1', ['test']);
      store.saveBin(bin);
      index.index(bin);
      // With a very high minRelevance, should filter out
      const results = index.lookup(['test'], { minRelevance: 0.99 });
      // Result depends on scoring; just verify filtering works
      expect(results.every((r) => r.relevanceScore >= 0.99)).toBe(true);
    });

    it('should sort by relevance score descending', () => {
      const bin1 = makeBin('bin-1', ['test'], { accessCount: 10, lastAccessedAt: Date.now() });
      const bin2 = makeBin('bin-2', ['test', 'memory'], { accessCount: 0, lastAccessedAt: Date.now() - 1000000 });
      store.saveBin(bin1);
      store.saveBin(bin2);
      index.index(bin1);
      index.index(bin2);
      const results = index.lookup(['test', 'memory']);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].relevanceScore).toBeGreaterThanOrEqual(results[i].relevanceScore);
      }
    });

    it('should include matched keywords in results', () => {
      const bin = makeBin('bin-1', ['test', 'memory', 'agent']);
      store.saveBin(bin);
      index.index(bin);
      const results = index.lookup(['test', 'agent']);
      expect(results[0].matchedKeywords).toContain('test');
      expect(results[0].matchedKeywords).toContain('agent');
      expect(results[0].matchedKeywords).not.toContain('memory');
    });

    it('should apply recencyBias', () => {
      const now = Date.now();
      const bin1 = makeBin('old', ['test'], { lastAccessedAt: now - 86400000 * 10 });
      const bin2 = makeBin('new', ['test'], { lastAccessedAt: now });
      store.saveBin(bin1);
      store.saveBin(bin2);
      index.index(bin1);
      index.index(bin2);
      const results = index.lookup(['test'], { recencyBias: 0.9 });
      expect(results[0].binId).toBe('new');
    });
  });

  describe('updateEntry', () => {
    it('should update tier in index without re-persisting', () => {
      const bin = makeBin('bin-1', ['test'], { tier: 1 });
      store.saveBin(bin);
      index.index(bin);

      bin.metadata.tier = 2;
      index.updateEntry(bin);

      const results = index.lookup(['test'], { tierFilter: [2] });
      expect(results).toHaveLength(1);
    });

    it('should update access metadata', () => {
      const bin = makeBin('bin-1', ['test'], { accessCount: 0, lastAccessedAt: 1000 });
      store.saveBin(bin);
      index.index(bin);

      bin.metadata.accessCount = 5;
      bin.metadata.lastAccessedAt = Date.now();
      index.updateEntry(bin);

      // Access count and recency should influence ranking
      const results = index.lookup(['test']);
      expect(results).toHaveLength(1);
    });
  });

  describe('allKeywords', () => {
    it('should return all indexed keywords', () => {
      const bin1 = makeBin('bin-1', ['alpha', 'beta']);
      const bin2 = makeBin('bin-2', ['gamma', 'beta']);
      store.saveBin(bin1);
      store.saveBin(bin2);
      index.index(bin1);
      index.index(bin2);
      const keywords = index.allKeywords();
      expect(keywords).toContain('alpha');
      expect(keywords).toContain('beta');
      expect(keywords).toContain('gamma');
    });

    it('should return empty array when no keywords', () => {
      expect(index.allKeywords()).toEqual([]);
    });
  });

  describe('stats', () => {
    it('should report correct stats', () => {
      const bin1 = makeBin('bin-1', ['alpha', 'beta']);
      const bin2 = makeBin('bin-2', ['beta', 'gamma']);
      store.saveBin(bin1);
      store.saveBin(bin2);
      index.index(bin1);
      index.index(bin2);
      const stats = index.stats();
      expect(stats.totalKeywords).toBe(3);
      expect(stats.totalEntries).toBe(4);
      expect(stats.avgBinsPerKeyword).toBeCloseTo(4 / 3, 1);
    });

    it('should report zero stats when empty', () => {
      const stats = index.stats();
      expect(stats.totalKeywords).toBe(0);
      expect(stats.totalEntries).toBe(0);
      expect(stats.avgBinsPerKeyword).toBe(0);
    });
  });

  describe('persistence', () => {
    it('should reload index from store on construction', () => {
      const bin = makeBin('bin-1', ['persisted']);
      store.saveBin(bin);
      // Manually save keyword index to store
      store.saveKeywordIndex('persisted', 'bin-1', 1.0);

      // Create new index from same store
      const newIndex = new InvertedIndex(store);
      const results = newIndex.lookup(['persisted']);
      expect(results).toHaveLength(1);
    });
  });
});
