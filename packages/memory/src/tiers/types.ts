import type { CompressionLevel } from '../bin/types.js';

export interface TierConfig {
  tier: 1 | 2 | 3;
  maxBins: number;
  maxSizeBytes: number;
  evictionPolicy: 'lru' | 'lfu' | 'hybrid';
  compressionLevel: CompressionLevel;
  ttlMs?: number;
}

export interface TierStats {
  binCount: number;
  sizeBytes: number;
  avgAccessCount: number;
  oldestBin: number;
  newestBin: number;
  capacityUsed: number;
}
