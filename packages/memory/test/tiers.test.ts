import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TierManager } from '../src/tiers/tier-manager.js';
import { BinManager } from '../src/bin/manager.js';
import { SqliteMemoryStore } from '../src/store/store.js';
import { Compressor } from '../src/compression/compressor.js';
import { InvertedIndex } from '../src/index-engine/keyword-index.js';

describe('TierManager', () => {
  let store: SqliteMemoryStore;
  let compressor: Compressor;
  let index: InvertedIndex;
  let binManager: BinManager;
  let tierManager: TierManager;

  beforeEach(() => {
    store = new SqliteMemoryStore(':memory:');
    compressor = new Compressor();
    index = new InvertedIndex(store);
    binManager = new BinManager(store, compressor, index);
    tierManager = new TierManager(binManager, {
      hot: { maxBins: 3 },
      warm: { maxBins: 5 },
      cold: { maxBins: 100 },
    });
  });

  afterEach(() => {
    store.close();
  });

  describe('getConfig', () => {
    it('should return config for tier 1', () => {
      const config = tierManager.getConfig(1);
      expect(config.tier).toBe(1);
      expect(config.maxBins).toBe(3);
      expect(config.evictionPolicy).toBe('lru');
    });

    it('should return config for tier 2', () => {
      const config = tierManager.getConfig(2);
      expect(config.tier).toBe(2);
      expect(config.maxBins).toBe(5);
      expect(config.evictionPolicy).toBe('lfu');
    });

    it('should return config for tier 3', () => {
      const config = tierManager.getConfig(3);
      expect(config.tier).toBe(3);
      expect(config.maxBins).toBe(100);
    });

    it('should use defaults when no config provided', () => {
      const defaultTM = new TierManager(binManager);
      expect(defaultTM.getConfig(1).maxBins).toBe(10);
      expect(defaultTM.getConfig(2).maxBins).toBe(100);
    });
  });

  describe('enforceCapacity', () => {
    it('should evict LRU bins from tier 1 when over capacity', () => {
      // Fill tier 1 beyond capacity (maxBins=3)
      for (let i = 0; i < 5; i++) {
        binManager.create(`content ${i}`, [`kw${i}`]);
      }
      const evicted = tierManager.enforceCapacity(1);
      expect(evicted).toBe(2);
      expect(binManager.countByTier(1)).toBe(3);
    });

    it('should demote evicted tier 1 bins to tier 2', () => {
      for (let i = 0; i < 4; i++) {
        binManager.create(`content ${i}`, [`kw${i}`]);
      }
      tierManager.enforceCapacity(1);
      expect(binManager.countByTier(2)).toBeGreaterThan(0);
    });

    it('should evict LFU bins from tier 2 when over capacity', () => {
      // Create bins directly in tier 2
      for (let i = 0; i < 7; i++) {
        binManager.create(`content ${i}`, [`kw${i}`], { initialTier: 2 });
      }
      const evicted = tierManager.enforceCapacity(2);
      expect(evicted).toBe(2);
      expect(binManager.countByTier(2)).toBe(5);
    });

    it('should return 0 when under capacity', () => {
      binManager.create('content', ['test']);
      const evicted = tierManager.enforceCapacity(1);
      expect(evicted).toBe(0);
    });

    it('should evict the least recently used bin', () => {
      // Create bins with different access times
      const bin1 = binManager.create('old content', ['old']);
      const bin2 = binManager.create('new content', ['new']);
      const bin3 = binManager.create('newest content', ['newest']);
      const bin4 = binManager.create('extra content', ['extra']);

      // Access bins 2, 3, 4 to make them recently used; bin1 remains oldest
      binManager.access(bin2.id);
      binManager.access(bin3.id);
      binManager.access(bin4.id);

      tierManager.enforceCapacity(1);
      // bin1 should be evicted (least recently used)
      expect(binManager.countByTier(1)).toBe(3);
      expect(binManager.get(bin1.id)?.metadata.tier).toBe(2);
    });

    it('should handle tier 3 eviction by deletion', () => {
      const tm = new TierManager(binManager, {
        cold: { maxBins: 2 },
      });
      for (let i = 0; i < 4; i++) {
        binManager.create(`cold ${i}`, [`ck${i}`], { initialTier: 3 });
      }
      const evicted = tm.enforceCapacity(3);
      expect(evicted).toBe(2);
      expect(binManager.countByTier(3)).toBe(2);
    });
  });

  describe('promoteBin', () => {
    it('should promote a bin to a higher tier', () => {
      const bin = binManager.create('content', ['test'], { initialTier: 2 });
      const promoted = tierManager.promoteBin(bin.id);
      expect(promoted!.metadata.tier).toBe(1);
    });

    it('should enforce capacity after promotion', () => {
      // Fill tier 1 to capacity
      for (let i = 0; i < 3; i++) {
        binManager.create(`hot ${i}`, [`h${i}`]);
      }
      // Create a tier 2 bin and promote it
      const warm = binManager.create('warm content', ['warm'], { initialTier: 2 });
      tierManager.promoteBin(warm.id);

      // Tier 1 should still be at capacity (one evicted)
      expect(binManager.countByTier(1)).toBeLessThanOrEqual(3);
    });

    it('should return undefined for missing bin', () => {
      expect(tierManager.promoteBin('nonexistent')).toBeUndefined();
    });
  });

  describe('demoteBin', () => {
    it('should demote a bin to a lower tier', () => {
      const bin = binManager.create('content', ['test']);
      const demoted = tierManager.demoteBin(bin.id);
      expect(demoted!.metadata.tier).toBe(2);
    });

    it('should return undefined for missing bin', () => {
      expect(tierManager.demoteBin('nonexistent')).toBeUndefined();
    });
  });

  describe('tierStats', () => {
    it('should return stats for an empty tier', () => {
      const stats = tierManager.tierStats(1);
      expect(stats.binCount).toBe(0);
      expect(stats.sizeBytes).toBe(0);
      expect(stats.avgAccessCount).toBe(0);
      expect(stats.capacityUsed).toBe(0);
    });

    it('should return correct bin count', () => {
      binManager.create('a', ['x']);
      binManager.create('b', ['y']);
      const stats = tierManager.tierStats(1);
      expect(stats.binCount).toBe(2);
    });

    it('should calculate size in bytes', () => {
      binManager.create('hello', ['test']);
      const stats = tierManager.tierStats(1);
      expect(stats.sizeBytes).toBeGreaterThan(0);
    });

    it('should calculate average access count', () => {
      const bin1 = binManager.create('a', ['x']);
      const bin2 = binManager.create('b', ['y']);
      binManager.access(bin1.id);
      binManager.access(bin1.id);
      binManager.access(bin2.id);
      const stats = tierManager.tierStats(1);
      expect(stats.avgAccessCount).toBe(1.5);
    });

    it('should track oldest and newest bins', () => {
      binManager.create('a', ['x']);
      binManager.create('b', ['y']);
      const stats = tierManager.tierStats(1);
      expect(stats.oldestBin).toBeLessThanOrEqual(stats.newestBin);
    });

    it('should calculate capacity used', () => {
      binManager.create('a', ['x']);
      binManager.create('b', ['y']);
      const stats = tierManager.tierStats(1);
      expect(stats.capacityUsed).toBeCloseTo(2 / 3, 1);
    });

    it('should return 0 capacity for unlimited tier', () => {
      const tm = new TierManager(binManager, {
        cold: { maxBins: Infinity },
      });
      binManager.create('a', ['x'], { initialTier: 3 });
      const stats = tm.tierStats(3);
      expect(stats.capacityUsed).toBe(0);
    });
  });

  describe('isAtCapacity', () => {
    it('should return false when under capacity', () => {
      binManager.create('a', ['x']);
      expect(tierManager.isAtCapacity(1)).toBe(false);
    });

    it('should return true when at capacity', () => {
      for (let i = 0; i < 3; i++) {
        binManager.create(`content ${i}`, [`kw${i}`]);
      }
      expect(tierManager.isAtCapacity(1)).toBe(true);
    });

    it('should return true when over capacity', () => {
      for (let i = 0; i < 5; i++) {
        binManager.create(`content ${i}`, [`kw${i}`]);
      }
      expect(tierManager.isAtCapacity(1)).toBe(true);
    });
  });

  describe('cross-tier flow', () => {
    it('should flow bins from tier 1 to tier 2 to tier 3', () => {
      // Fill tier 1 beyond capacity
      const bins = [];
      for (let i = 0; i < 5; i++) {
        bins.push(binManager.create(`content ${i}`, [`kw${i}`]));
      }
      tierManager.enforceCapacity(1);
      expect(binManager.countByTier(1)).toBe(3);
      expect(binManager.countByTier(2)).toBe(2);
    });

    it('should cascade evictions through tiers', () => {
      // Fill all tiers
      for (let i = 0; i < 3; i++) {
        binManager.create(`hot ${i}`, [`h${i}`]);
      }
      for (let i = 0; i < 5; i++) {
        binManager.create(`warm ${i}`, [`w${i}`], { initialTier: 2 });
      }
      // Add one more to tier 1 - should cascade
      binManager.create('overflow', ['overflow']);
      tierManager.enforceCapacity(1);
      // After enforcement, tier 1 should be at capacity
      expect(binManager.countByTier(1)).toBeLessThanOrEqual(3);
    });
  });

  describe('LFU eviction in tier 2', () => {
    it('should evict least frequently used bin', () => {
      const bins = [];
      for (let i = 0; i < 6; i++) {
        bins.push(binManager.create(`warm ${i}`, [`w${i}`], { initialTier: 2 }));
      }
      // Access some bins more than others
      for (let i = 0; i < 5; i++) {
        binManager.access(bins[0].id);
      }
      for (let i = 0; i < 3; i++) {
        binManager.access(bins[1].id);
      }
      // bins[2..5] have 0 accesses - should be evicted first
      tierManager.enforceCapacity(2);
      expect(binManager.countByTier(2)).toBe(5);
      // The frequently accessed bins should still be in tier 2
      expect(binManager.get(bins[0].id)?.metadata.tier).toBe(2);
      expect(binManager.get(bins[1].id)?.metadata.tier).toBe(2);
    });
  });
});
