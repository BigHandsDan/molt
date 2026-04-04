import type { MemoryBin, BinSourceType, Fidelity } from './bin/types.js';
import type { TierConfig, TierStats } from './tiers/types.js';

export interface MoltMemoryConfig {
  dbPath?: string;
  tiers?: {
    hot?: Partial<TierConfig>;
    warm?: Partial<TierConfig>;
    cold?: Partial<TierConfig>;
  };
  defaultFidelity?: Fidelity;
  agentId?: string;
  autoMaintain?: boolean;
  enableBinMerging?: boolean;
}

export interface StoreOptions {
  agentId?: string;
  sourceType?: BinSourceType;
  relatedBins?: string[];
  fidelity?: Fidelity;
  ttlMs?: number;
  initialTier?: 1 | 2 | 3;
}

export interface RecallOptions {
  maxResults?: number;
  tierFilter?: (1 | 2 | 3)[];
  recencyBias?: number;
  agentId?: string;
  peekOnly?: boolean;
  minRelevance?: number;
}

export interface RecallResult {
  bins: MemoryBin[];
  fromTiers: { tier: number; count: number }[];
  totalDecompressTime: number;
  promotions: number;
}

export interface MemoryStats {
  totalBins: number;
  totalSizeBytes: number;
  compressedSizeBytes: number;
  compressionRatio: number;
  tiers: {
    hot: TierStats;
    warm: TierStats;
    cold: TierStats;
  };
  keywordCount: number;
  topKeywords: { keyword: string; binCount: number }[];
}

export interface ExportedMemory {
  version: number;
  exportedAt: number;
  bins: any[];
}

export interface ImportReport {
  imported: number;
  skipped: number;
  total: number;
}
