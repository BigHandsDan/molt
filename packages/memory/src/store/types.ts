import type { MemoryBin } from '../bin/types.js';

export interface MemoryStoreOptions {
  dbPath?: string;
}

export interface BinRow {
  id: string;
  keywords: string;
  content: string | null;
  compressed_content: Buffer | null;
  compression_level: string;
  fidelity: string;
  tier: number;
  agent_id: string | null;
  source_type: string;
  related_bins: string;
  version: number;
  size_bytes: number;
  compressed_size_bytes: number | null;
  access_count: number;
  ttl_ms: number | null;
  created_at: number;
  last_accessed_at: number;
}

export interface KeywordRow {
  keyword: string;
  bin_id: string;
  relevance_weight: number;
}

export interface MemoryStore {
  saveBin(bin: MemoryBin): void;
  getBin(id: string): MemoryBin | undefined;
  deleteBin(id: string): boolean;
  updateBin(bin: MemoryBin): void;
  listBins(tier?: 1 | 2 | 3): MemoryBin[];
  countBins(tier?: 1 | 2 | 3): number;
  saveKeywordIndex(keyword: string, binId: string, weight: number): void;
  deleteKeywordIndex(binId: string): void;
  lookupKeywords(keyword: string): Array<{ binId: string; weight: number }>;
  getAllKeywords(): string[];
  close(): void;
}
