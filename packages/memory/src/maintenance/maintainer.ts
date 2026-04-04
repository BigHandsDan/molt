import type { MaintenanceReport } from './types.js';
import type { BinManager } from '../bin/manager.js';
import type { TierManager } from '../tiers/tier-manager.js';
import type { InvertedIndex } from '../index-engine/keyword-index.js';
import type { MemoryBin } from '../bin/types.js';

export interface MaintainerConfig {
  enableBinMerging: boolean;
}

/**
 * Handles periodic maintenance: TTL expiry, bin merging, tier rebalancing,
 * and keyword re-indexing.
 */
export class Maintainer {
  constructor(
    private binManager: BinManager,
    private tierManager: TierManager,
    private index: InvertedIndex,
    private config: MaintainerConfig = { enableBinMerging: false },
  ) {}

  run(): MaintenanceReport {
    const start = Date.now();
    let expired = 0;
    let demoted = 0;
    let merged = 0;
    let reindexed = 0;

    // Phase 1: Expire TTL bins in tier 3
    expired = this.expireTtlBins();

    // Phase 2: Merge co-accessed warm bins (if enabled)
    if (this.config.enableBinMerging) {
      merged = this.mergeCoAccessedBins();
    }

    // Phase 3: Enforce tier capacities (demote overflow)
    demoted += this.tierManager.enforceCapacity(1);
    demoted += this.tierManager.enforceCapacity(2);

    // Phase 4: Reindex any stale keyword entries
    reindexed = this.reindexStaleEntries();

    return {
      expired,
      demoted,
      merged,
      reindexed,
      duration: Date.now() - start,
    };
  }

  private expireTtlBins(): number {
    const now = Date.now();
    let expired = 0;

    // Check tier 3 bins for TTL
    const tier3Config = this.tierManager.getConfig(3);
    const coldBins = this.binManager.listByTier(3);

    for (const bin of coldBins) {
      const ttl = bin.metadata.ttlMs ?? tier3Config.ttlMs;
      if (ttl && (now - bin.metadata.lastAccessedAt) > ttl) {
        this.binManager.delete(bin.id);
        expired++;
      }
    }

    return expired;
  }

  private mergeCoAccessedBins(): number {
    const warmBins = this.binManager.listByTier(2);
    if (warmBins.length < 2) return 0;

    let merged = 0;
    const mergedIds = new Set<string>();

    // Find bins with overlapping keywords
    for (let i = 0; i < warmBins.length; i++) {
      if (mergedIds.has(warmBins[i].id)) continue;
      for (let j = i + 1; j < warmBins.length; j++) {
        if (mergedIds.has(warmBins[j].id)) continue;

        const overlap = this.keywordOverlap(warmBins[i], warmBins[j]);
        if (overlap >= 0.5) {
          this.mergeBins(warmBins[i], warmBins[j]);
          mergedIds.add(warmBins[j].id);
          merged++;
        }
      }
    }

    return merged;
  }

  private keywordOverlap(a: MemoryBin, b: MemoryBin): number {
    const setA = new Set(a.keywords.map((k) => k.toLowerCase()));
    const setB = new Set(b.keywords.map((k) => k.toLowerCase()));
    let overlap = 0;
    for (const k of setA) {
      if (setB.has(k)) overlap++;
    }
    const total = new Set([...setA, ...setB]).size;
    return total > 0 ? overlap / total : 0;
  }

  private mergeBins(target: MemoryBin, source: MemoryBin): void {
    // Combine content
    target.content = target.content + '\n\n' + source.content;
    // Merge keywords (deduplicate)
    const keywordSet = new Set([...target.keywords, ...source.keywords]);
    target.keywords = Array.from(keywordSet);
    // Update metadata
    target.metadata.sizeBytes = Buffer.byteLength(target.content, 'utf-8');
    target.metadata.accessCount += source.metadata.accessCount;
    target.metadata.relatedBins = Array.from(
      new Set([...target.metadata.relatedBins, ...source.metadata.relatedBins, source.id]),
    );
    target.metadata.version++;

    // Persist: update target bin in store, delete source
    this.binManager.update(target);
    this.binManager.delete(source.id);
    // Re-index target with updated keywords
    this.index.deindex(target.id);
    this.index.index(target);
  }

  private reindexStaleEntries(): number {
    // Verify index entries point to existing bins
    let reindexed = 0;
    const keywords = this.index.allKeywords();
    for (const keyword of keywords) {
      const refs = this.index.lookup([keyword], { maxResults: 1000 });
      for (const ref of refs) {
        const bin = this.binManager.get(ref.binId);
        if (!bin) {
          this.index.deindex(ref.binId);
          reindexed++;
        }
      }
    }
    return reindexed;
  }
}
