// Main class
export { MoltMemory } from './memory.js';

// Types
export type {
  MoltMemoryConfig,
  StoreOptions,
  RecallOptions,
  RecallResult,
  MemoryStats,
  ExportedMemory,
  ImportReport,
} from './types.js';

// Bin types
export type {
  MemoryBin,
  BinMetadata,
  CompressionLevel,
  BinSourceType,
  Fidelity,
} from './bin/types.js';

// Tier types
export type { TierConfig, TierStats } from './tiers/types.js';

// Index types
export type {
  KeywordIndex,
  LookupOptions,
  RankedBinRef,
  IndexStats,
} from './index-engine/types.js';

// Compression types
export type { CompressionEngine, CompressedResult } from './compression/types.js';

// Maintenance types
export type { MaintenanceReport } from './maintenance/types.js';

// Internals (for advanced usage)
export { BinManager } from './bin/manager.js';
export { TierManager } from './tiers/tier-manager.js';
export { InvertedIndex } from './index-engine/keyword-index.js';
export { Compressor } from './compression/compressor.js';
export { SqliteMemoryStore } from './store/store.js';
export { Maintainer } from './maintenance/maintainer.js';
