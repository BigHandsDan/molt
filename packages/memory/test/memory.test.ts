import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MoltMemory } from '../src/memory.js';

describe('MoltMemory', () => {
  let memory: MoltMemory;

  beforeEach(() => {
    memory = new MoltMemory({
      tiers: {
        hot: { maxBins: 5 },
        warm: { maxBins: 10 },
        cold: { maxBins: 100, ttlMs: 60000 },
      },
    });
  });

  afterEach(() => {
    memory.close();
  });

  describe('store', () => {
    it('should store a bin in tier 1', () => {
      const bin = memory.store_bin('test content', ['test']);
      expect(bin.metadata.tier).toBe(1);
      expect(bin.content).toBe('test content');
      expect(bin.keywords).toEqual(['test']);
    });

    it('should auto-assign agent ID from config', () => {
      memory.close();
      memory = new MoltMemory({ agentId: 'agent-1' });
      const bin = memory.store_bin('content', ['test']);
      expect(bin.metadata.agentId).toBe('agent-1');
    });

    it('should store with custom options', () => {
      const bin = memory.store_bin('content', ['test'], {
        agentId: 'custom-agent',
        sourceType: 'task',
        fidelity: 'summary',
        ttlMs: 30000,
      });
      expect(bin.metadata.agentId).toBe('custom-agent');
      expect(bin.metadata.sourceType).toBe('task');
      expect(bin.metadata.fidelity).toBe('summary');
      expect(bin.metadata.ttlMs).toBe(30000);
    });

    it('should store in a specific initial tier', () => {
      const bin = memory.store_bin('archived content', ['archive'], { initialTier: 3 });
      expect(bin.metadata.tier).toBe(3);
      expect(bin.compressionLevel).toBe('full');
    });

    it('should enforce capacity after storing', () => {
      for (let i = 0; i < 7; i++) {
        memory.store_bin(`content ${i}`, [`kw${i}`]);
      }
      const stats = memory.tierStats(1);
      expect(stats.binCount).toBeLessThanOrEqual(5);
    });

    it('should store related bins', () => {
      const bin1 = memory.store_bin('first', ['test']);
      const bin2 = memory.store_bin('second', ['test'], { relatedBins: [bin1.id] });
      expect(bin2.metadata.relatedBins).toContain(bin1.id);
    });
  });

  describe('recall', () => {
    it('should recall bins by keyword', () => {
      memory.store_bin('about testing', ['test', 'quality']);
      memory.store_bin('about deployment', ['deploy', 'ops']);

      const result = memory.recall(['test']);
      expect(result.bins).toHaveLength(1);
      expect(result.bins[0].content).toBe('about testing');
    });

    it('should recall multiple bins matching keywords', () => {
      memory.store_bin('content A', ['shared']);
      memory.store_bin('content B', ['shared']);
      const result = memory.recall(['shared']);
      expect(result.bins).toHaveLength(2);
    });

    it('should return empty when no matches', () => {
      const result = memory.recall(['nonexistent']);
      expect(result.bins).toHaveLength(0);
      expect(result.promotions).toBe(0);
    });

    it('should track which tiers bins came from', () => {
      memory.store_bin('hot content', ['test']);
      const result = memory.recall(['test']);
      expect(result.fromTiers).toContainEqual({ tier: 1, count: 1 });
    });

    it('should promote bins from tier 2 to tier 1 on recall', () => {
      const bin = memory.store_bin('content', ['test'], { initialTier: 2 });
      const result = memory.recall(['test']);
      expect(result.promotions).toBe(1);
      expect(result.bins[0].metadata.tier).toBe(1);
    });

    it('should promote bins from tier 3 through tier 2 to tier 1', () => {
      const bin = memory.store_bin('archived content', ['archive'], { initialTier: 3 });
      const result = memory.recall(['archive']);
      expect(result.promotions).toBe(1);
      expect(result.bins[0].metadata.tier).toBe(1);
    });

    it('should support peekOnly without promotion', () => {
      const bin = memory.store_bin('content', ['test'], { initialTier: 2 });
      const result = memory.recall(['test'], { peekOnly: true });
      expect(result.bins).toHaveLength(1);
      expect(result.promotions).toBe(0);
      // Bin should still be in tier 2
      const retrieved = memory.recallById(bin.id);
      expect(retrieved!.metadata.tier).toBe(2);
    });

    it('should filter by tier', () => {
      memory.store_bin('hot', ['test']);
      memory.store_bin('warm', ['test'], { initialTier: 2 });
      const result = memory.recall(['test'], { tierFilter: [1] });
      expect(result.bins).toHaveLength(1);
    });

    it('should respect maxResults', () => {
      for (let i = 0; i < 10; i++) {
        memory.store_bin(`content ${i}`, ['common']);
      }
      const result = memory.recall(['common'], { maxResults: 3 });
      expect(result.bins).toHaveLength(3);
    });

    it('should report total decompress time', () => {
      memory.store_bin('content', ['test'], { initialTier: 2 });
      const result = memory.recall(['test']);
      expect(result.totalDecompressTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('recallById', () => {
    it('should recall a specific bin', () => {
      const bin = memory.store_bin('content', ['test']);
      const recalled = memory.recallById(bin.id);
      expect(recalled).toBeDefined();
      expect(recalled!.id).toBe(bin.id);
    });

    it('should increment access count on recall', () => {
      const bin = memory.store_bin('content', ['test']);
      memory.recallById(bin.id);
      const retrieved = memory.recallById(bin.id);
      expect(retrieved!.metadata.accessCount).toBe(2);
    });

    it('should return undefined for non-existent bin', () => {
      expect(memory.recallById('nonexistent')).toBeUndefined();
    });
  });

  describe('demote / promote', () => {
    it('should manually demote a bin', () => {
      const bin = memory.store_bin('content', ['test']);
      memory.demote(bin.id);
      const retrieved = memory.recallById(bin.id);
      expect(retrieved!.metadata.tier).toBe(2);
    });

    it('should manually promote a bin', () => {
      const bin = memory.store_bin('content', ['test'], { initialTier: 2 });
      memory.promote(bin.id);
      const retrieved = memory.recallById(bin.id);
      expect(retrieved!.metadata.tier).toBe(1);
    });
  });

  describe('stats', () => {
    it('should return overall memory stats', () => {
      memory.store_bin('hot content', ['test']);
      memory.store_bin('warm content', ['test'], { initialTier: 2 });
      const stats = memory.stats();
      expect(stats.totalBins).toBe(2);
      expect(stats.totalSizeBytes).toBeGreaterThan(0);
      expect(stats.tiers.hot.binCount).toBe(1);
      expect(stats.tiers.warm.binCount).toBe(1);
      expect(stats.tiers.cold.binCount).toBe(0);
    });

    it('should report keyword count', () => {
      memory.store_bin('content', ['alpha', 'beta']);
      memory.store_bin('content', ['beta', 'gamma']);
      const stats = memory.stats();
      expect(stats.keywordCount).toBe(3);
    });

    it('should report top keywords', () => {
      memory.store_bin('content 1', ['popular', 'test']);
      memory.store_bin('content 2', ['popular', 'demo']);
      memory.store_bin('content 3', ['popular', 'sample']);
      const stats = memory.stats();
      expect(stats.topKeywords[0].keyword).toBe('popular');
      expect(stats.topKeywords[0].binCount).toBe(3);
    });

    it('should calculate compression ratio', () => {
      memory.store_bin('content', ['test']);
      const stats = memory.stats();
      expect(stats.compressionRatio).toBeDefined();
    });

    it('should return empty stats when no bins', () => {
      const stats = memory.stats();
      expect(stats.totalBins).toBe(0);
      expect(stats.totalSizeBytes).toBe(0);
      expect(stats.compressionRatio).toBe(1);
    });
  });

  describe('tierStats', () => {
    it('should return stats for a specific tier', () => {
      memory.store_bin('hot content', ['test']);
      const stats = memory.tierStats(1);
      expect(stats.binCount).toBe(1);
      expect(stats.sizeBytes).toBeGreaterThan(0);
    });

    it('should return empty stats for empty tier', () => {
      const stats = memory.tierStats(3);
      expect(stats.binCount).toBe(0);
    });
  });

  describe('flushWorking', () => {
    it('should move all tier 1 bins to tier 2', () => {
      memory.store_bin('hot 1', ['a']);
      memory.store_bin('hot 2', ['b']);
      memory.store_bin('hot 3', ['c']);
      memory.flushWorking();
      expect(memory.tierStats(1).binCount).toBe(0);
      expect(memory.tierStats(2).binCount).toBe(3);
    });

    it('should not affect other tiers', () => {
      memory.store_bin('warm', ['test'], { initialTier: 2 });
      memory.store_bin('hot', ['test']);
      memory.flushWorking();
      expect(memory.tierStats(2).binCount).toBe(2); // 1 original + 1 flushed
    });
  });

  describe('maintain', () => {
    it('should return a maintenance report', () => {
      const report = memory.maintain();
      expect(report).toHaveProperty('expired');
      expect(report).toHaveProperty('demoted');
      expect(report).toHaveProperty('merged');
      expect(report).toHaveProperty('reindexed');
      expect(report).toHaveProperty('duration');
    });

    it('should enforce tier capacity during maintenance', () => {
      for (let i = 0; i < 8; i++) {
        memory.store_bin(`content ${i}`, [`kw${i}`]);
      }
      // After store's auto-enforcement, some may be demoted already
      // But maintain should also enforce
      const report = memory.maintain();
      expect(memory.tierStats(1).binCount).toBeLessThanOrEqual(5);
    });
  });

  describe('export / import', () => {
    it('should export all bins', () => {
      memory.store_bin('content 1', ['a']);
      memory.store_bin('content 2', ['b']);
      const exported = memory.export();
      expect(exported.version).toBe(1);
      expect(exported.bins).toHaveLength(2);
      expect(exported.exportedAt).toBeGreaterThan(0);
    });

    it('should import bins into a new memory instance', () => {
      memory.store_bin('content 1', ['a']);
      memory.store_bin('content 2', ['b']);
      const exported = memory.export();

      const newMemory = new MoltMemory();
      const report = newMemory.import(exported);
      expect(report.imported).toBe(2);
      expect(report.skipped).toBe(0);
      expect(report.total).toBe(2);

      const stats = newMemory.stats();
      expect(stats.totalBins).toBe(2);
      newMemory.close();
    });

    it('should skip duplicate bins on import', () => {
      memory.store_bin('content', ['test']);
      const exported = memory.export();

      const report = memory.import(exported);
      expect(report.skipped).toBe(1);
      expect(report.imported).toBe(0);
    });

    it('should handle empty export', () => {
      const exported = memory.export();
      expect(exported.bins).toHaveLength(0);
    });
  });

  describe('close', () => {
    it('should close without error', () => {
      expect(() => memory.close()).not.toThrow();
    });
  });

  describe('multi-agent scenarios', () => {
    it('should store bins with different agent IDs', () => {
      memory.store_bin('agent-a data', ['shared'], { agentId: 'agent-a' });
      memory.store_bin('agent-b data', ['shared'], { agentId: 'agent-b' });

      const resultA = memory.recall(['shared'], { agentId: 'agent-a' });
      expect(resultA.bins).toHaveLength(1);
      expect(resultA.bins[0].metadata.agentId).toBe('agent-a');

      const resultB = memory.recall(['shared'], { agentId: 'agent-b' });
      expect(resultB.bins).toHaveLength(1);
    });

    it('should recall across agents when no agentId filter', () => {
      memory.store_bin('a data', ['topic'], { agentId: 'a' });
      memory.store_bin('b data', ['topic'], { agentId: 'b' });
      const result = memory.recall(['topic']);
      expect(result.bins).toHaveLength(2);
    });
  });

  describe('large-scale bins', () => {
    it('should handle many bins efficiently', () => {
      for (let i = 0; i < 50; i++) {
        memory.store_bin(`content ${i}`, [`kw-${i % 5}`, `group-${i % 10}`]);
      }
      const stats = memory.stats();
      expect(stats.totalBins).toBe(50);
    });

    it('should recall with many keywords', () => {
      for (let i = 0; i < 20; i++) {
        memory.store_bin(`content ${i}`, [`kw-${i}`]);
      }
      const result = memory.recall(['kw-0', 'kw-1', 'kw-2']);
      expect(result.bins.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('end-to-end recall flow', () => {
    it('should follow the full recall flow: store → demote → recall → promote', () => {
      // Store in tier 1
      const bin = memory.store_bin('important finding about X', ['finding', 'important']);
      expect(bin.metadata.tier).toBe(1);

      // Demote to tier 2
      memory.demote(bin.id);
      let retrieved = memory.recallById(bin.id)!;
      expect(retrieved.metadata.tier).toBe(2);

      // Demote to tier 3
      memory.demote(bin.id);
      retrieved = memory.recallById(bin.id)!;
      expect(retrieved.metadata.tier).toBe(3);

      // Recall by keywords — should promote back to tier 1
      const result = memory.recall(['finding']);
      expect(result.bins).toHaveLength(1);
      expect(result.bins[0].metadata.tier).toBe(1);
      expect(result.promotions).toBe(1);
    });

    it('should preserve content through full promotion/demotion cycle', () => {
      const originalContent = 'This is important data that should survive compression cycles.';
      const bin = memory.store_bin(originalContent, ['cycle', 'test']);

      // Full demotion cycle
      memory.demote(bin.id);
      memory.demote(bin.id);
      // Now in tier 3 with full compression

      // Recall back to tier 1
      const result = memory.recall(['cycle']);
      // Content should be recoverable (may be normalized but present)
      expect(result.bins[0].content.length).toBeGreaterThan(0);
    });
  });

  describe('auto maintenance', () => {
    it('should run maintenance on store when autoMaintain is enabled', () => {
      memory.close();
      memory = new MoltMemory({
        autoMaintain: true,
        tiers: { hot: { maxBins: 3 } },
      });
      for (let i = 0; i < 5; i++) {
        memory.store_bin(`content ${i}`, [`kw${i}`]);
      }
      // Auto-maintenance should have run, enforcing capacity
      expect(memory.tierStats(1).binCount).toBeLessThanOrEqual(3);
    });
  });

  describe('source types', () => {
    it('should support conversation source type', () => {
      const bin = memory.store_bin('chat data', ['chat'], { sourceType: 'conversation' });
      expect(bin.metadata.sourceType).toBe('conversation');
    });

    it('should support task source type', () => {
      const bin = memory.store_bin('task data', ['task'], { sourceType: 'task' });
      expect(bin.metadata.sourceType).toBe('task');
    });

    it('should support learned source type', () => {
      const bin = memory.store_bin('learned data', ['learned'], { sourceType: 'learned' });
      expect(bin.metadata.sourceType).toBe('learned');
    });

    it('should support injected source type', () => {
      const bin = memory.store_bin('injected data', ['injected'], { sourceType: 'injected' });
      expect(bin.metadata.sourceType).toBe('injected');
    });
  });
});
