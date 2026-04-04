import type { TierConfig, TierStats } from './types.js';
import type { BinManager } from '../bin/manager.js';
import type { MemoryBin } from '../bin/types.js';

const DEFAULT_TIER_CONFIGS: Record<1 | 2 | 3, TierConfig> = {
  1: { tier: 1, maxBins: 10, maxSizeBytes: 1024 * 1024, evictionPolicy: 'lru', compressionLevel: 'none' },
  2: { tier: 2, maxBins: 100, maxSizeBytes: 10 * 1024 * 1024, evictionPolicy: 'lfu', compressionLevel: 'light' },
  3: { tier: 3, maxBins: Infinity, maxSizeBytes: Infinity, evictionPolicy: 'lru', compressionLevel: 'full', ttlMs: 30 * 24 * 60 * 60 * 1000 },
};

/**
 * Manages tier capacity, enforces eviction policies, and handles
 * automatic promotion/demotion based on access patterns.
 */
export class TierManager {
  private configs: Record<1 | 2 | 3, TierConfig>;

  constructor(
    private binManager: BinManager,
    configs?: { hot?: Partial<TierConfig>; warm?: Partial<TierConfig>; cold?: Partial<TierConfig> },
  ) {
    this.configs = {
      1: { ...DEFAULT_TIER_CONFIGS[1], ...configs?.hot, tier: 1 },
      2: { ...DEFAULT_TIER_CONFIGS[2], ...configs?.warm, tier: 2 },
      3: { ...DEFAULT_TIER_CONFIGS[3], ...configs?.cold, tier: 3 },
    };
  }

  getConfig(tier: 1 | 2 | 3): TierConfig {
    return this.configs[tier];
  }

  /** Enforce capacity limits on a tier by evicting bins to the next tier. */
  enforceCapacity(tier: 1 | 2 | 3): number {
    const config = this.configs[tier];
    let evicted = 0;

    while (this.binManager.countByTier(tier) > config.maxBins) {
      const victim = this.selectVictim(tier);
      if (!victim) break;

      if (tier < 3) {
        this.binManager.demote(victim.id);
      } else {
        this.binManager.delete(victim.id);
      }
      evicted++;
    }

    return evicted;
  }

  /** Promote a bin upward through tiers and enforce capacity. */
  promoteBin(binId: string): MemoryBin | undefined {
    const promoted = this.binManager.promote(binId);
    if (promoted) {
      this.enforceCapacity(promoted.metadata.tier);
    }
    return promoted;
  }

  /** Demote a bin downward through tiers. */
  demoteBin(binId: string): MemoryBin | undefined {
    return this.binManager.demote(binId);
  }

  /** Get stats for a specific tier. */
  tierStats(tier: 1 | 2 | 3): TierStats {
    const bins = this.binManager.listByTier(tier);
    const config = this.configs[tier];

    if (bins.length === 0) {
      return {
        binCount: 0,
        sizeBytes: 0,
        avgAccessCount: 0,
        oldestBin: 0,
        newestBin: 0,
        capacityUsed: 0,
      };
    }

    const totalSize = bins.reduce((sum, b) => sum + b.metadata.sizeBytes, 0);
    const totalAccess = bins.reduce((sum, b) => sum + b.metadata.accessCount, 0);
    const oldest = Math.min(...bins.map((b) => b.metadata.createdAt));
    const newest = Math.max(...bins.map((b) => b.metadata.createdAt));

    return {
      binCount: bins.length,
      sizeBytes: totalSize,
      avgAccessCount: totalAccess / bins.length,
      oldestBin: oldest,
      newestBin: newest,
      capacityUsed: config.maxBins === Infinity ? 0 : bins.length / config.maxBins,
    };
  }

  /** Check if a tier is at capacity. */
  isAtCapacity(tier: 1 | 2 | 3): boolean {
    return this.binManager.countByTier(tier) >= this.configs[tier].maxBins;
  }

  private selectVictim(tier: 1 | 2 | 3): MemoryBin | undefined {
    const bins = this.binManager.listByTier(tier);
    if (bins.length === 0) return undefined;

    const policy = this.configs[tier].evictionPolicy;

    switch (policy) {
      case 'lru':
        // Evict least recently used
        return bins.reduce((oldest, b) =>
          b.metadata.lastAccessedAt < oldest.metadata.lastAccessedAt ? b : oldest,
        );
      case 'lfu':
        // Evict least frequently used
        return bins.reduce((least, b) =>
          b.metadata.accessCount < least.metadata.accessCount ? b : least,
        );
      case 'hybrid': {
        // Combined score: lower = more evictable
        const now = Date.now();
        return bins.reduce((worst, b) => {
          const bScore = b.metadata.accessCount * 0.5 + (1 - (now - b.metadata.lastAccessedAt) / (30 * 24 * 60 * 60 * 1000)) * 0.5;
          const wScore = worst.metadata.accessCount * 0.5 + (1 - (now - worst.metadata.lastAccessedAt) / (30 * 24 * 60 * 60 * 1000)) * 0.5;
          return bScore < wScore ? b : worst;
        });
      }
    }
  }
}
