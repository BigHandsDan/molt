import type { MemoryBin } from '../bin/types.js';
import type { KeywordIndex, LookupOptions, RankedBinRef, IndexStats } from './types.js';
import type { MemoryStore } from '../store/types.js';

interface InMemoryEntry {
  binId: string;
  tier: 1 | 2 | 3;
  weight: number;
  lastAccessedAt: number;
  accessCount: number;
  agentId?: string;
}

/**
 * In-memory inverted index backed by SQLite for persistence.
 * Keywords map to bin references with relevance scoring.
 */
export class InvertedIndex implements KeywordIndex {
  private keywordMap = new Map<string, Map<string, InMemoryEntry>>();
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
    this.loadFromStore();
  }

  index(bin: MemoryBin): void {
    const normalizedKeywords = bin.keywords.map((k) => k.toLowerCase().trim());
    for (const keyword of normalizedKeywords) {
      if (!this.keywordMap.has(keyword)) {
        this.keywordMap.set(keyword, new Map());
      }
      const entry: InMemoryEntry = {
        binId: bin.id,
        tier: bin.metadata.tier,
        weight: 1.0,
        lastAccessedAt: bin.metadata.lastAccessedAt,
        accessCount: bin.metadata.accessCount,
        agentId: bin.metadata.agentId,
      };
      this.keywordMap.get(keyword)!.set(bin.id, entry);
      this.store.saveKeywordIndex(keyword, bin.id, 1.0);
    }
  }

  deindex(binId: string): void {
    for (const [keyword, entries] of this.keywordMap) {
      entries.delete(binId);
      if (entries.size === 0) {
        this.keywordMap.delete(keyword);
      }
    }
    this.store.deleteKeywordIndex(binId);
  }

  /** Update an existing entry's metadata without re-persisting keywords. */
  updateEntry(bin: MemoryBin): void {
    const normalizedKeywords = bin.keywords.map((k) => k.toLowerCase().trim());
    for (const keyword of normalizedKeywords) {
      const entries = this.keywordMap.get(keyword);
      if (entries?.has(bin.id)) {
        entries.get(bin.id)!.tier = bin.metadata.tier;
        entries.get(bin.id)!.lastAccessedAt = bin.metadata.lastAccessedAt;
        entries.get(bin.id)!.accessCount = bin.metadata.accessCount;
      }
    }
  }

  lookup(keywords: string[], options: LookupOptions = {}): RankedBinRef[] {
    const {
      maxResults = 10,
      tierFilter,
      recencyBias = 0.3,
      agentId,
      minRelevance = 0,
    } = options;

    const normalizedKeywords = keywords.map((k) => k.toLowerCase().trim());
    const binScores = new Map<string, { score: number; tier: 1 | 2 | 3; matched: string[] }>();

    for (const keyword of normalizedKeywords) {
      const entries = this.keywordMap.get(keyword);
      if (!entries) continue;

      for (const [binId, entry] of entries) {
        if (tierFilter && !tierFilter.includes(entry.tier)) continue;
        if (agentId && entry.agentId !== agentId) continue;

        if (!binScores.has(binId)) {
          binScores.set(binId, { score: 0, tier: entry.tier, matched: [] });
        }
        const record = binScores.get(binId)!;
        record.matched.push(keyword);

        // Keyword match contributes to relevance
        const keywordScore = entry.weight / normalizedKeywords.length;
        // Recency contributes based on bias
        const now = Date.now();
        const age = now - entry.lastAccessedAt;
        const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
        const recencyScore = Math.max(0, 1 - age / maxAge);
        // Frequency contributes
        const freqScore = Math.min(entry.accessCount / 10, 1) * 0.1;

        record.score += keywordScore * (1 - recencyBias) + recencyScore * recencyBias + freqScore;
      }
    }

    // Normalize scores
    const results: RankedBinRef[] = [];
    for (const [binId, record] of binScores) {
      const normalizedScore = Math.min(record.score, 1);
      if (normalizedScore < minRelevance) continue;
      results.push({
        binId,
        tier: record.tier,
        relevanceScore: normalizedScore,
        matchedKeywords: record.matched,
      });
    }

    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return results.slice(0, maxResults);
  }

  allKeywords(): string[] {
    return Array.from(this.keywordMap.keys());
  }

  stats(): IndexStats {
    let totalEntries = 0;
    for (const entries of this.keywordMap.values()) {
      totalEntries += entries.size;
    }
    const totalKeywords = this.keywordMap.size;
    return {
      totalKeywords,
      totalEntries,
      avgBinsPerKeyword: totalKeywords > 0 ? totalEntries / totalKeywords : 0,
    };
  }

  private loadFromStore(): void {
    const keywords = this.store.getAllKeywords();
    for (const keyword of keywords) {
      const entries = this.store.lookupKeywords(keyword);
      if (!this.keywordMap.has(keyword)) {
        this.keywordMap.set(keyword, new Map());
      }
      for (const entry of entries) {
        const bin = this.store.getBin(entry.binId);
        if (bin) {
          this.keywordMap.get(keyword)!.set(entry.binId, {
            binId: entry.binId,
            tier: bin.metadata.tier,
            weight: entry.weight,
            lastAccessedAt: bin.metadata.lastAccessedAt,
            accessCount: bin.metadata.accessCount,
            agentId: bin.metadata.agentId,
          });
        }
      }
    }
  }
}
