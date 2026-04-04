import { randomUUID } from 'node:crypto';
import type { MemoryBin, BinSourceType, Fidelity, CompressionLevel } from './types.js';
import type { MemoryStore } from '../store/types.js';
import type { Compressor } from '../compression/compressor.js';
import type { InvertedIndex } from '../index-engine/keyword-index.js';

export interface CreateBinOptions {
  agentId?: string;
  sourceType?: BinSourceType;
  relatedBins?: string[];
  fidelity?: Fidelity;
  ttlMs?: number;
  initialTier?: 1 | 2 | 3;
}

/**
 * Manages CRUD operations on memory bins, including promotion and demotion
 * through tiers with appropriate compression/decompression.
 */
export class BinManager {
  constructor(
    private store: MemoryStore,
    private compressor: Compressor,
    private index: InvertedIndex,
  ) {}

  create(content: string, keywords: string[], options: CreateBinOptions = {}): MemoryBin {
    const now = Date.now();
    const tier = options.initialTier ?? 1;
    const fidelity = options.fidelity ?? 'verbatim';
    const compressionLevel = this.tierToCompression(tier);

    let compressedContent: Buffer | undefined;
    let compressedSizeBytes: number | undefined;
    let storedContent = content;

    if (compressionLevel !== 'none') {
      const result = this.compressor.compress(content, compressionLevel, fidelity);
      compressedContent = result.data;
      compressedSizeBytes = result.compressedSize;
      if (compressionLevel === 'full') {
        // For full compression, we store the semantic-reduced content
        storedContent = this.compressor.decompress(result.data, compressionLevel);
      }
    }

    const bin: MemoryBin = {
      id: randomUUID(),
      keywords,
      content: storedContent,
      compressedContent,
      compressionLevel,
      metadata: {
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        tier,
        sizeBytes: Buffer.byteLength(content, 'utf-8'),
        compressedSizeBytes,
        agentId: options.agentId,
        sourceType: options.sourceType ?? 'conversation',
        relatedBins: options.relatedBins ?? [],
        version: 1,
        ttlMs: options.ttlMs,
        fidelity,
      },
    };

    this.store.saveBin(bin);
    this.index.index(bin);
    return bin;
  }

  get(id: string): MemoryBin | undefined {
    return this.store.getBin(id);
  }

  access(id: string): MemoryBin | undefined {
    const bin = this.store.getBin(id);
    if (!bin) return undefined;

    bin.metadata.lastAccessedAt = Date.now();
    bin.metadata.accessCount++;
    this.store.updateBin(bin);
    this.index.updateEntry(bin);
    return bin;
  }

  update(bin: MemoryBin): void {
    this.store.updateBin(bin);
    this.index.updateEntry(bin);
  }

  delete(id: string): boolean {
    this.index.deindex(id);
    return this.store.deleteBin(id);
  }

  promote(id: string): MemoryBin | undefined {
    const bin = this.store.getBin(id);
    if (!bin) return undefined;
    if (bin.metadata.tier === 1) return bin;

    const newTier = (bin.metadata.tier - 1) as 1 | 2 | 3;
    return this.moveTier(bin, newTier);
  }

  demote(id: string): MemoryBin | undefined {
    const bin = this.store.getBin(id);
    if (!bin) return undefined;
    if (bin.metadata.tier === 3) return bin;

    const newTier = (bin.metadata.tier + 1) as 1 | 2 | 3;
    return this.moveTier(bin, newTier);
  }

  listByTier(tier: 1 | 2 | 3): MemoryBin[] {
    return this.store.listBins(tier);
  }

  countByTier(tier: 1 | 2 | 3): number {
    return this.store.countBins(tier);
  }

  private moveTier(bin: MemoryBin, newTier: 1 | 2 | 3): MemoryBin {
    const newLevel = this.tierToCompression(newTier);
    const oldLevel = bin.compressionLevel;

    // Decompress if moving to a higher tier
    if (newTier < bin.metadata.tier && bin.compressedContent && oldLevel !== 'none') {
      bin.content = this.compressor.decompress(bin.compressedContent, oldLevel);
    }

    // Compress if moving to a lower tier
    if (newTier > bin.metadata.tier && newLevel !== 'none') {
      const result = this.compressor.compress(bin.content, newLevel, bin.metadata.fidelity);
      bin.compressedContent = result.data;
      bin.metadata.compressedSizeBytes = result.compressedSize;
    }

    // Clear compressed content for tier 1
    if (newTier === 1) {
      bin.compressedContent = undefined;
      bin.metadata.compressedSizeBytes = undefined;
    }

    bin.compressionLevel = newLevel;
    bin.metadata.tier = newTier;
    bin.metadata.version++;
    this.store.updateBin(bin);
    this.index.updateEntry(bin);
    return bin;
  }

  private tierToCompression(tier: 1 | 2 | 3): CompressionLevel {
    switch (tier) {
      case 1: return 'none';
      case 2: return 'light';
      case 3: return 'full';
    }
  }
}
