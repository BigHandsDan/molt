import type { MemoryBin, BinSourceType, Fidelity } from './bin/types.js';
import type { TierConfig, TierStats } from './tiers/types.js';
import type { MaintenanceReport } from './maintenance/types.js';
import type { RecallResult, MemoryStats, StoreOptions, RecallOptions, MoltMemoryConfig, ExportedMemory, ImportReport } from './types.js';
import { SqliteMemoryStore } from './store/store.js';
import { Compressor } from './compression/compressor.js';
import { InvertedIndex } from './index-engine/keyword-index.js';
import { BinManager } from './bin/manager.js';
import { TierManager } from './tiers/tier-manager.js';
import { Maintainer } from './maintenance/maintainer.js';

/** Main entry point — the three-tier memory manager. */
export class MoltMemory {
  private store: SqliteMemoryStore;
  private compressor: Compressor;
  private index: InvertedIndex;
  private binManager: BinManager;
  private tierManager: TierManager;
  private maintainer: Maintainer;
  private config: MoltMemoryConfig;

  constructor(config: MoltMemoryConfig = {}) {
    this.config = config;
    this.store = new SqliteMemoryStore(config.dbPath);
    this.compressor = new Compressor();
    this.index = new InvertedIndex(this.store);
    this.binManager = new BinManager(this.store, this.compressor, this.index);
    this.tierManager = new TierManager(this.binManager, config.tiers);
    this.maintainer = new Maintainer(this.binManager, this.tierManager, this.index, {
      enableBinMerging: config.enableBinMerging ?? false,
    });
  }

  /** Store a new memory bin. Starts in Tier 1 by default. */
  store_bin(content: string, keywords: string[], options: StoreOptions = {}): MemoryBin {
    const bin = this.binManager.create(content, keywords, {
      agentId: options.agentId ?? this.config.agentId,
      sourceType: options.sourceType,
      relatedBins: options.relatedBins,
      fidelity: options.fidelity ?? this.config.defaultFidelity,
      ttlMs: options.ttlMs,
      initialTier: options.initialTier,
    });

    // Enforce capacity after storing
    this.tierManager.enforceCapacity(bin.metadata.tier);

    if (this.config.autoMaintain) {
      this.maintainer.run();
    }

    return bin;
  }

  /** Recall bins by keyword(s). Automatically promotes through tiers. */
  recall(keywords: string[], options: RecallOptions = {}): RecallResult {
    const refs = this.index.lookup(keywords, {
      maxResults: options.maxResults,
      tierFilter: options.tierFilter,
      recencyBias: options.recencyBias,
      agentId: options.agentId,
      minRelevance: options.minRelevance,
    });

    const bins: MemoryBin[] = [];
    const fromTiers = new Map<number, number>();
    let totalDecompressTime = 0;
    let promotions = 0;

    for (const ref of refs) {
      const start = Date.now();
      let bin = this.binManager.access(ref.binId);
      if (!bin) continue;

      const sourceTier = bin.metadata.tier;
      fromTiers.set(sourceTier, (fromTiers.get(sourceTier) ?? 0) + 1);

      if (!options.peekOnly && bin.metadata.tier > 1) {
        // Promote to tier 1
        while (bin && bin.metadata.tier > 1) {
          bin = this.tierManager.promoteBin(bin.id);
        }
        if (bin) promotions++;
      }

      totalDecompressTime += Date.now() - start;
      if (bin) bins.push(bin);
    }

    if (this.config.autoMaintain) {
      this.maintainer.run();
    }

    return {
      bins,
      fromTiers: Array.from(fromTiers.entries()).map(([tier, count]) => ({ tier, count })),
      totalDecompressTime,
      promotions,
    };
  }

  /** Recall a specific bin by ID. */
  recallById(binId: string): MemoryBin | undefined {
    return this.binManager.access(binId);
  }

  /** Manually demote a bin to a lower tier. */
  demote(binId: string): void {
    this.tierManager.demoteBin(binId);
  }

  /** Manually promote a bin to a higher tier. */
  promote(binId: string): void {
    this.tierManager.promoteBin(binId);
  }

  /** Get memory stats across all tiers. */
  stats(): MemoryStats {
    const hot = this.tierManager.tierStats(1);
    const warm = this.tierManager.tierStats(2);
    const cold = this.tierManager.tierStats(3);

    const totalBins = hot.binCount + warm.binCount + cold.binCount;
    const totalSizeBytes = hot.sizeBytes + warm.sizeBytes + cold.sizeBytes;

    const allBins = [
      ...this.binManager.listByTier(1),
      ...this.binManager.listByTier(2),
      ...this.binManager.listByTier(3),
    ];
    const compressedSizeBytes = allBins.reduce(
      (sum, b) => sum + (b.metadata.compressedSizeBytes ?? b.metadata.sizeBytes),
      0,
    );

    const indexStats = this.index.stats();

    // Calculate top keywords
    const keywordCounts = new Map<string, number>();
    for (const bin of allBins) {
      for (const kw of bin.keywords) {
        const normalized = kw.toLowerCase();
        keywordCounts.set(normalized, (keywordCounts.get(normalized) ?? 0) + 1);
      }
    }
    const topKeywords = Array.from(keywordCounts.entries())
      .map(([keyword, binCount]) => ({ keyword, binCount }))
      .sort((a, b) => b.binCount - a.binCount)
      .slice(0, 10);

    return {
      totalBins,
      totalSizeBytes,
      compressedSizeBytes,
      compressionRatio: totalSizeBytes > 0 ? compressedSizeBytes / totalSizeBytes : 1,
      tiers: { hot, warm, cold },
      keywordCount: indexStats.totalKeywords,
      topKeywords,
    };
  }

  /** Get stats for a specific tier. */
  tierStats(tier: 1 | 2 | 3): TierStats {
    return this.tierManager.tierStats(tier);
  }

  /** Flush all bins from Tier 1 (clear working memory). */
  flushWorking(): void {
    const hotBins = this.binManager.listByTier(1);
    for (const bin of hotBins) {
      this.tierManager.demoteBin(bin.id);
    }
  }

  /** Run maintenance: expire TTL bins, merge co-accessed warm bins, rebalance tiers. */
  maintain(): MaintenanceReport {
    return this.maintainer.run();
  }

  /** Export all bins (for backup/migration). */
  export(): ExportedMemory {
    const bins = [
      ...this.binManager.listByTier(1),
      ...this.binManager.listByTier(2),
      ...this.binManager.listByTier(3),
    ];
    return {
      version: 1,
      exportedAt: Date.now(),
      bins: bins.map((b) => ({
        ...b,
        compressedContent: b.compressedContent ? b.compressedContent.toString('base64') : undefined,
      })),
    };
  }

  /** Import bins from export. */
  import(data: ExportedMemory): ImportReport {
    let imported = 0;
    let skipped = 0;

    for (const binData of data.bins) {
      const existing = this.binManager.get(binData.id);
      if (existing) {
        skipped++;
        continue;
      }

      const bin: MemoryBin = {
        ...binData,
        compressedContent: typeof binData.compressedContent === 'string'
          ? Buffer.from(binData.compressedContent, 'base64')
          : binData.compressedContent,
      };

      this.store.saveBin(bin);
      this.index.index(bin);
      imported++;
    }

    return { imported, skipped, total: data.bins.length };
  }

  /** Close the memory store. */
  close(): void {
    this.store.close();
  }
}
