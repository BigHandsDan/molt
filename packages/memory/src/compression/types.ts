import type { CompressionLevel, Fidelity } from '../bin/types.js';

export interface CompressedResult {
  data: Buffer;
  originalSize: number;
  compressedSize: number;
  ratio: number;
  fidelity: Fidelity;
}

export interface CompressionEngine {
  compress(content: string, level: CompressionLevel, fidelity?: Fidelity): CompressedResult;
  decompress(compressed: Buffer, level: CompressionLevel): string;
  estimateRatio(content: string, level: CompressionLevel): number;
}
