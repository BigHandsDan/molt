import type { MemoryBin } from '../bin/types.js';

export interface LookupOptions {
  maxResults?: number;
  tierFilter?: (1 | 2 | 3)[];
  recencyBias?: number;
  agentId?: string;
  minRelevance?: number;
}

export interface RankedBinRef {
  binId: string;
  tier: 1 | 2 | 3;
  relevanceScore: number;
  matchedKeywords: string[];
}

export interface IndexStats {
  totalKeywords: number;
  totalEntries: number;
  avgBinsPerKeyword: number;
}

export interface KeywordIndex {
  index(bin: MemoryBin): void;
  deindex(binId: string): void;
  lookup(keywords: string[], options?: LookupOptions): RankedBinRef[];
  allKeywords(): string[];
  stats(): IndexStats;
}
