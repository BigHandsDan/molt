export type CompressionLevel = 'none' | 'light' | 'full';
export type BinSourceType = 'conversation' | 'task' | 'learned' | 'injected';
export type Fidelity = 'verbatim' | 'summary' | 'distilled';

export interface BinMetadata {
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  tier: 1 | 2 | 3;
  sizeBytes: number;
  compressedSizeBytes?: number;
  agentId?: string;
  sourceType: BinSourceType;
  relatedBins: string[];
  version: number;
  ttlMs?: number;
  fidelity: Fidelity;
}

export interface MemoryBin {
  id: string;
  keywords: string[];
  content: string;
  compressedContent?: Buffer;
  compressionLevel: CompressionLevel;
  metadata: BinMetadata;
}
