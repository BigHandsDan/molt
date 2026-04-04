import Database from 'better-sqlite3';
import type { MemoryBin, CompressionLevel, BinSourceType, Fidelity } from '../bin/types.js';
import type { MemoryStore, BinRow, KeywordRow } from './types.js';

/** SQLite-backed persistent store for memory bins and keyword index. */
export class SqliteMemoryStore implements MemoryStore {
  private db: Database.Database;

  constructor(dbPath = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_bins (
        id TEXT PRIMARY KEY,
        keywords TEXT NOT NULL,
        content TEXT,
        compressed_content BLOB,
        compression_level TEXT NOT NULL,
        fidelity TEXT NOT NULL,
        tier INTEGER NOT NULL,
        agent_id TEXT,
        source_type TEXT NOT NULL,
        related_bins TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        size_bytes INTEGER NOT NULL,
        compressed_size_bytes INTEGER,
        access_count INTEGER NOT NULL DEFAULT 0,
        ttl_ms INTEGER,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS keyword_index (
        keyword TEXT NOT NULL,
        bin_id TEXT NOT NULL REFERENCES memory_bins(id),
        relevance_weight REAL NOT NULL DEFAULT 1.0,
        PRIMARY KEY (keyword, bin_id)
      );

      CREATE INDEX IF NOT EXISTS idx_bins_tier ON memory_bins(tier);
      CREATE INDEX IF NOT EXISTS idx_bins_agent ON memory_bins(agent_id);
      CREATE INDEX IF NOT EXISTS idx_bins_accessed ON memory_bins(last_accessed_at);
      CREATE INDEX IF NOT EXISTS idx_bins_access_count ON memory_bins(access_count);
      CREATE INDEX IF NOT EXISTS idx_keyword_lookup ON keyword_index(keyword);
    `);
  }

  saveBin(bin: MemoryBin): void {
    this.db.prepare(`
      INSERT INTO memory_bins (id, keywords, content, compressed_content, compression_level, fidelity, tier,
        agent_id, source_type, related_bins, version, size_bytes, compressed_size_bytes, access_count, ttl_ms,
        created_at, last_accessed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      bin.id,
      JSON.stringify(bin.keywords),
      bin.content,
      bin.compressedContent ?? null,
      bin.compressionLevel,
      bin.metadata.fidelity,
      bin.metadata.tier,
      bin.metadata.agentId ?? null,
      bin.metadata.sourceType,
      JSON.stringify(bin.metadata.relatedBins),
      bin.metadata.version,
      bin.metadata.sizeBytes,
      bin.metadata.compressedSizeBytes ?? null,
      bin.metadata.accessCount,
      bin.metadata.ttlMs ?? null,
      bin.metadata.createdAt,
      bin.metadata.lastAccessedAt,
    );
  }

  getBin(id: string): MemoryBin | undefined {
    const row = this.db.prepare('SELECT * FROM memory_bins WHERE id = ?').get(id) as BinRow | undefined;
    if (!row) return undefined;
    return this.rowToBin(row);
  }

  deleteBin(id: string): boolean {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM keyword_index WHERE bin_id = ?').run(id);
      const result = this.db.prepare('DELETE FROM memory_bins WHERE id = ?').run(id);
      return result.changes > 0;
    });
    return tx();
  }

  updateBin(bin: MemoryBin): void {
    this.db.prepare(`
      UPDATE memory_bins SET
        keywords = ?, content = ?, compressed_content = ?, compression_level = ?, fidelity = ?,
        tier = ?, agent_id = ?, source_type = ?, related_bins = ?, version = ?,
        size_bytes = ?, compressed_size_bytes = ?, access_count = ?, ttl_ms = ?,
        created_at = ?, last_accessed_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(bin.keywords),
      bin.content,
      bin.compressedContent ?? null,
      bin.compressionLevel,
      bin.metadata.fidelity,
      bin.metadata.tier,
      bin.metadata.agentId ?? null,
      bin.metadata.sourceType,
      JSON.stringify(bin.metadata.relatedBins),
      bin.metadata.version,
      bin.metadata.sizeBytes,
      bin.metadata.compressedSizeBytes ?? null,
      bin.metadata.accessCount,
      bin.metadata.ttlMs ?? null,
      bin.metadata.createdAt,
      bin.metadata.lastAccessedAt,
      bin.id,
    );
  }

  listBins(tier?: 1 | 2 | 3): MemoryBin[] {
    const query = tier != null
      ? this.db.prepare('SELECT * FROM memory_bins WHERE tier = ? ORDER BY last_accessed_at DESC')
      : this.db.prepare('SELECT * FROM memory_bins ORDER BY last_accessed_at DESC');
    const rows = (tier != null ? query.all(tier) : query.all()) as BinRow[];
    return rows.map((r) => this.rowToBin(r));
  }

  countBins(tier?: 1 | 2 | 3): number {
    if (tier != null) {
      const row = this.db.prepare('SELECT COUNT(*) as count FROM memory_bins WHERE tier = ?').get(tier) as { count: number };
      return row.count;
    }
    const row = this.db.prepare('SELECT COUNT(*) as count FROM memory_bins').get() as { count: number };
    return row.count;
  }

  saveKeywordIndex(keyword: string, binId: string, weight: number): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO keyword_index (keyword, bin_id, relevance_weight)
      VALUES (?, ?, ?)
    `).run(keyword, binId, weight);
  }

  deleteKeywordIndex(binId: string): void {
    this.db.prepare('DELETE FROM keyword_index WHERE bin_id = ?').run(binId);
  }

  lookupKeywords(keyword: string): Array<{ binId: string; weight: number }> {
    const rows = this.db.prepare(
      'SELECT bin_id, relevance_weight FROM keyword_index WHERE keyword = ?',
    ).all(keyword) as Array<{ bin_id: string; relevance_weight: number }>;
    return rows.map((r) => ({ binId: r.bin_id, weight: r.relevance_weight }));
  }

  getAllKeywords(): string[] {
    const rows = this.db.prepare('SELECT DISTINCT keyword FROM keyword_index').all() as Array<{ keyword: string }>;
    return rows.map((r) => r.keyword);
  }

  close(): void {
    this.db.close();
  }

  private rowToBin(row: BinRow): MemoryBin {
    return {
      id: row.id,
      keywords: JSON.parse(row.keywords),
      content: row.content ?? '',
      compressedContent: row.compressed_content ?? undefined,
      compressionLevel: row.compression_level as CompressionLevel,
      metadata: {
        createdAt: row.created_at,
        lastAccessedAt: row.last_accessed_at,
        accessCount: row.access_count,
        tier: row.tier as 1 | 2 | 3,
        sizeBytes: row.size_bytes,
        compressedSizeBytes: row.compressed_size_bytes ?? undefined,
        agentId: row.agent_id ?? undefined,
        sourceType: row.source_type as BinSourceType,
        relatedBins: JSON.parse(row.related_bins || '[]'),
        version: row.version,
        ttlMs: row.ttl_ms ?? undefined,
        fidelity: row.fidelity as Fidelity,
      },
    };
  }
}
