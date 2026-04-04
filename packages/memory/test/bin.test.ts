import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BinManager } from '../src/bin/manager.js';
import { SqliteMemoryStore } from '../src/store/store.js';
import { Compressor } from '../src/compression/compressor.js';
import { InvertedIndex } from '../src/index-engine/keyword-index.js';

describe('BinManager', () => {
  let store: SqliteMemoryStore;
  let compressor: Compressor;
  let index: InvertedIndex;
  let manager: BinManager;

  beforeEach(() => {
    store = new SqliteMemoryStore(':memory:');
    compressor = new Compressor();
    index = new InvertedIndex(store);
    manager = new BinManager(store, compressor, index);
  });

  afterEach(() => {
    store.close();
  });

  describe('create', () => {
    it('should create a bin with a UUID', () => {
      const bin = manager.create('test content', ['test']);
      expect(bin.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('should store content verbatim in tier 1', () => {
      const bin = manager.create('test content', ['test']);
      expect(bin.content).toBe('test content');
      expect(bin.compressionLevel).toBe('none');
      expect(bin.metadata.tier).toBe(1);
    });

    it('should set default metadata', () => {
      const bin = manager.create('test content', ['test']);
      expect(bin.metadata.accessCount).toBe(0);
      expect(bin.metadata.version).toBe(1);
      expect(bin.metadata.sourceType).toBe('conversation');
      expect(bin.metadata.fidelity).toBe('verbatim');
      expect(bin.metadata.relatedBins).toEqual([]);
    });

    it('should set timestamps', () => {
      const before = Date.now();
      const bin = manager.create('test content', ['test']);
      const after = Date.now();
      expect(bin.metadata.createdAt).toBeGreaterThanOrEqual(before);
      expect(bin.metadata.createdAt).toBeLessThanOrEqual(after);
      expect(bin.metadata.lastAccessedAt).toBe(bin.metadata.createdAt);
    });

    it('should accept custom options', () => {
      const bin = manager.create('test', ['test'], {
        agentId: 'agent-1',
        sourceType: 'task',
        relatedBins: ['bin-x'],
        fidelity: 'summary',
        ttlMs: 60000,
      });
      expect(bin.metadata.agentId).toBe('agent-1');
      expect(bin.metadata.sourceType).toBe('task');
      expect(bin.metadata.relatedBins).toEqual(['bin-x']);
      expect(bin.metadata.fidelity).toBe('summary');
      expect(bin.metadata.ttlMs).toBe(60000);
    });

    it('should calculate size in bytes', () => {
      const content = 'Hello 世界';
      const bin = manager.create(content, ['test']);
      expect(bin.metadata.sizeBytes).toBe(Buffer.byteLength(content, 'utf-8'));
    });

    it('should index the bin by keywords', () => {
      manager.create('test content', ['alpha', 'beta']);
      const results = index.lookup(['alpha']);
      expect(results).toHaveLength(1);
    });

    it('should persist in the store', () => {
      const bin = manager.create('test content', ['test']);
      const retrieved = store.getBin(bin.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.content).toBe('test content');
    });

    it('should create in tier 2 with light compression', () => {
      const bin = manager.create('test content here for compression', ['test'], { initialTier: 2 });
      expect(bin.metadata.tier).toBe(2);
      expect(bin.compressionLevel).toBe('light');
      expect(bin.compressedContent).toBeDefined();
    });

    it('should create in tier 3 with full compression', () => {
      const bin = manager.create('test content here for full compression', ['test'], { initialTier: 3 });
      expect(bin.metadata.tier).toBe(3);
      expect(bin.compressionLevel).toBe('full');
      expect(bin.compressedContent).toBeDefined();
    });

    it('should handle empty keywords array', () => {
      const bin = manager.create('content', []);
      expect(bin.keywords).toEqual([]);
    });

    it('should handle very long content', () => {
      const content = 'x'.repeat(100000);
      const bin = manager.create(content, ['large']);
      expect(bin.metadata.sizeBytes).toBe(100000);
    });
  });

  describe('get', () => {
    it('should retrieve an existing bin', () => {
      const bin = manager.create('test', ['test']);
      const retrieved = manager.get(bin.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(bin.id);
    });

    it('should return undefined for missing bin', () => {
      expect(manager.get('nonexistent')).toBeUndefined();
    });
  });

  describe('access', () => {
    it('should increment access count', () => {
      const bin = manager.create('test', ['test']);
      const accessed = manager.access(bin.id);
      expect(accessed!.metadata.accessCount).toBe(1);
    });

    it('should update lastAccessedAt', () => {
      const bin = manager.create('test', ['test']);
      const originalTime = bin.metadata.lastAccessedAt;
      // Small delay to ensure time difference
      const accessed = manager.access(bin.id);
      expect(accessed!.metadata.lastAccessedAt).toBeGreaterThanOrEqual(originalTime);
    });

    it('should return undefined for missing bin', () => {
      expect(manager.access('nonexistent')).toBeUndefined();
    });

    it('should persist access updates', () => {
      const bin = manager.create('test', ['test']);
      manager.access(bin.id);
      manager.access(bin.id);
      const retrieved = store.getBin(bin.id)!;
      expect(retrieved.metadata.accessCount).toBe(2);
    });

    it('should accumulate access counts', () => {
      const bin = manager.create('test', ['test']);
      for (let i = 0; i < 5; i++) {
        manager.access(bin.id);
      }
      expect(manager.get(bin.id)!.metadata.accessCount).toBe(5);
    });
  });

  describe('delete', () => {
    it('should delete a bin', () => {
      const bin = manager.create('test', ['test']);
      expect(manager.delete(bin.id)).toBe(true);
      expect(manager.get(bin.id)).toBeUndefined();
    });

    it('should deindex on delete', () => {
      const bin = manager.create('test', ['keyword1']);
      manager.delete(bin.id);
      expect(index.lookup(['keyword1'])).toHaveLength(0);
    });

    it('should return false for missing bin', () => {
      expect(manager.delete('nonexistent')).toBe(false);
    });
  });

  describe('promote', () => {
    it('should promote from tier 2 to tier 1', () => {
      const bin = manager.create('content for promotion', ['test'], { initialTier: 2 });
      const promoted = manager.promote(bin.id);
      expect(promoted!.metadata.tier).toBe(1);
      expect(promoted!.compressionLevel).toBe('none');
    });

    it('should promote from tier 3 to tier 2', () => {
      const bin = manager.create('content for promotion', ['test'], { initialTier: 3 });
      const promoted = manager.promote(bin.id);
      expect(promoted!.metadata.tier).toBe(2);
      expect(promoted!.compressionLevel).toBe('light');
    });

    it('should not promote beyond tier 1', () => {
      const bin = manager.create('content', ['test']);
      const promoted = manager.promote(bin.id);
      expect(promoted!.metadata.tier).toBe(1);
    });

    it('should decompress on promotion', () => {
      const bin = manager.create('content to compress and decompress', ['test'], { initialTier: 2 });
      expect(bin.compressedContent).toBeDefined();
      const promoted = manager.promote(bin.id);
      expect(promoted!.content).toBeTruthy();
      expect(promoted!.compressionLevel).toBe('none');
    });

    it('should increment version on promotion', () => {
      const bin = manager.create('content', ['test'], { initialTier: 2 });
      const promoted = manager.promote(bin.id);
      expect(promoted!.metadata.version).toBe(bin.metadata.version + 1);
    });

    it('should return undefined for missing bin', () => {
      expect(manager.promote('nonexistent')).toBeUndefined();
    });
  });

  describe('demote', () => {
    it('should demote from tier 1 to tier 2', () => {
      const bin = manager.create('content', ['test']);
      const demoted = manager.demote(bin.id);
      expect(demoted!.metadata.tier).toBe(2);
      expect(demoted!.compressionLevel).toBe('light');
      expect(demoted!.compressedContent).toBeDefined();
    });

    it('should demote from tier 2 to tier 3', () => {
      const bin = manager.create('content for demo', ['test'], { initialTier: 2 });
      const demoted = manager.demote(bin.id);
      expect(demoted!.metadata.tier).toBe(3);
      expect(demoted!.compressionLevel).toBe('full');
    });

    it('should not demote beyond tier 3', () => {
      const bin = manager.create('content', ['test'], { initialTier: 3 });
      const demoted = manager.demote(bin.id);
      expect(demoted!.metadata.tier).toBe(3);
    });

    it('should compress on demotion', () => {
      const bin = manager.create('content to compress', ['test']);
      const demoted = manager.demote(bin.id);
      expect(demoted!.compressedContent).toBeDefined();
      expect(demoted!.metadata.compressedSizeBytes).toBeDefined();
    });

    it('should increment version on demotion', () => {
      const bin = manager.create('content', ['test']);
      const demoted = manager.demote(bin.id);
      expect(demoted!.metadata.version).toBe(bin.metadata.version + 1);
    });
  });

  describe('listByTier / countByTier', () => {
    it('should list bins by tier', () => {
      manager.create('a', ['test']);
      manager.create('b', ['test']);
      expect(manager.listByTier(1)).toHaveLength(2);
      expect(manager.listByTier(2)).toHaveLength(0);
    });

    it('should count bins by tier', () => {
      manager.create('a', ['test']);
      manager.create('b', ['test']);
      manager.create('c', ['test'], { initialTier: 2 });
      expect(manager.countByTier(1)).toBe(2);
      expect(manager.countByTier(2)).toBe(1);
      expect(manager.countByTier(3)).toBe(0);
    });
  });
});
