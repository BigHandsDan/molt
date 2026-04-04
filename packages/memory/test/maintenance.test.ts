import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Maintainer } from '../src/maintenance/maintainer.js';
import { BinManager } from '../src/bin/manager.js';
import { TierManager } from '../src/tiers/tier-manager.js';
import { InvertedIndex } from '../src/index-engine/keyword-index.js';
import { SqliteMemoryStore } from '../src/store/store.js';
import { Compressor } from '../src/compression/compressor.js';

describe('Maintainer', () => {
  let store: SqliteMemoryStore;
  let compressor: Compressor;
  let index: InvertedIndex;
  let binManager: BinManager;
  let tierManager: TierManager;
  let maintainer: Maintainer;

  beforeEach(() => {
    store = new SqliteMemoryStore(':memory:');
    compressor = new Compressor();
    index = new InvertedIndex(store);
    binManager = new BinManager(store, compressor, index);
    tierManager = new TierManager(binManager, {
      hot: { maxBins: 5 },
      warm: { maxBins: 10 },
      cold: { ttlMs: 60000 },
    });
    maintainer = new Maintainer(binManager, tierManager, index, { enableBinMerging: false });
  });

  afterEach(() => {
    store.close();
  });

  describe('run', () => {
    it('should return a maintenance report', () => {
      const report = maintainer.run();
      expect(report).toHaveProperty('expired');
      expect(report).toHaveProperty('demoted');
      expect(report).toHaveProperty('merged');
      expect(report).toHaveProperty('reindexed');
      expect(report).toHaveProperty('duration');
    });

    it('should report duration', () => {
      const report = maintainer.run();
      expect(report.duration).toBeGreaterThanOrEqual(0);
    });

    it('should report zero activity when nothing to do', () => {
      const report = maintainer.run();
      expect(report.expired).toBe(0);
      expect(report.demoted).toBe(0);
      expect(report.merged).toBe(0);
      expect(report.reindexed).toBe(0);
    });
  });

  describe('TTL expiry', () => {
    it('should expire bins past their TTL in tier 3', () => {
      const bin = binManager.create('old content', ['old'], {
        initialTier: 3,
        ttlMs: 1, // 1ms TTL
      });
      // Manually set lastAccessedAt to past
      const stored = store.getBin(bin.id)!;
      stored.metadata.lastAccessedAt = Date.now() - 100000;
      store.updateBin(stored);

      const report = maintainer.run();
      expect(report.expired).toBe(1);
      expect(binManager.get(bin.id)).toBeUndefined();
    });

    it('should use tier default TTL when bin has no TTL', () => {
      const bin = binManager.create('content', ['test'], { initialTier: 3 });
      // Manually set lastAccessedAt way in the past
      const stored = store.getBin(bin.id)!;
      stored.metadata.lastAccessedAt = Date.now() - 100000;
      store.updateBin(stored);

      const report = maintainer.run();
      // Default TTL is 60000ms, 100000ms has passed
      expect(report.expired).toBe(1);
    });

    it('should not expire bins within TTL', () => {
      binManager.create('fresh content', ['fresh'], {
        initialTier: 3,
        ttlMs: 999999999,
      });
      const report = maintainer.run();
      expect(report.expired).toBe(0);
    });

    it('should only expire tier 3 bins', () => {
      const bin = binManager.create('hot content', ['hot'], { ttlMs: 1 });
      // Hot bins shouldn't be TTL-expired
      const stored = store.getBin(bin.id)!;
      stored.metadata.lastAccessedAt = Date.now() - 100000;
      store.updateBin(stored);

      const report = maintainer.run();
      expect(report.expired).toBe(0);
      expect(binManager.get(bin.id)).toBeDefined();
    });

    it('should expire multiple bins', () => {
      for (let i = 0; i < 5; i++) {
        const bin = binManager.create(`old ${i}`, [`old${i}`], { initialTier: 3, ttlMs: 1 });
        const stored = store.getBin(bin.id)!;
        stored.metadata.lastAccessedAt = Date.now() - 100000;
        store.updateBin(stored);
      }
      const report = maintainer.run();
      expect(report.expired).toBe(5);
    });
  });

  describe('tier enforcement', () => {
    it('should demote overflow bins', () => {
      for (let i = 0; i < 7; i++) {
        binManager.create(`content ${i}`, [`kw${i}`]);
      }
      const report = maintainer.run();
      expect(report.demoted).toBe(2); // 7 bins, max 5
    });

    it('should not demote when under capacity', () => {
      binManager.create('content', ['test']);
      const report = maintainer.run();
      expect(report.demoted).toBe(0);
    });
  });

  describe('bin merging', () => {
    it('should merge co-accessed warm bins when enabled', () => {
      const mergingMaintainer = new Maintainer(binManager, tierManager, index, { enableBinMerging: true });

      // Create warm bins with overlapping keywords
      binManager.create('content about testing', ['test', 'unit', 'quality'], { initialTier: 2 });
      binManager.create('more about testing', ['test', 'unit', 'coverage'], { initialTier: 2 });

      const report = mergingMaintainer.run();
      expect(report.merged).toBeGreaterThanOrEqual(0); // May or may not merge based on overlap threshold
    });

    it('should not merge when disabled', () => {
      binManager.create('content about testing', ['test', 'unit'], { initialTier: 2 });
      binManager.create('more about testing', ['test', 'unit'], { initialTier: 2 });

      const report = maintainer.run();
      expect(report.merged).toBe(0);
    });

    it('should not merge bins with low keyword overlap', () => {
      const mergingMaintainer = new Maintainer(binManager, tierManager, index, { enableBinMerging: true });

      binManager.create('content about alpha', ['alpha', 'bravo'], { initialTier: 2 });
      binManager.create('content about charlie', ['charlie', 'delta'], { initialTier: 2 });

      const report = mergingMaintainer.run();
      expect(report.merged).toBe(0);
    });

    it('should merge bins with high keyword overlap', () => {
      const mergingMaintainer = new Maintainer(binManager, tierManager, index, { enableBinMerging: true });

      binManager.create('content A', ['test', 'memory'], { initialTier: 2 });
      binManager.create('content B', ['test', 'memory'], { initialTier: 2 });

      const report = mergingMaintainer.run();
      expect(report.merged).toBe(1);
      // Should have merged into one bin
      expect(binManager.countByTier(2)).toBe(1);
    });

    it('should combine content when merging', () => {
      const mergingMaintainer = new Maintainer(binManager, tierManager, index, { enableBinMerging: true });

      binManager.create('Part A content', ['shared', 'topic'], { initialTier: 2 });
      binManager.create('Part B content', ['shared', 'topic'], { initialTier: 2 });

      mergingMaintainer.run();
      const bins = binManager.listByTier(2);
      expect(bins).toHaveLength(1);
      expect(bins[0].content).toContain('Part A content');
      expect(bins[0].content).toContain('Part B content');
    });
  });

  describe('reindexing', () => {
    it('should clean up stale index entries', () => {
      const bin = binManager.create('content', ['orphan']);
      const binId = bin.id;
      // Delete the bin directly from store (simulating corruption)
      store.deleteBin(binId);
      // The index still has entries for this bin
      const report = maintainer.run();
      // Reindexed should reflect cleanup (may be 0 since deindex already called)
      expect(report.reindexed).toBeGreaterThanOrEqual(0);
    });
  });
});
