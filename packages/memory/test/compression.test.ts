import { describe, it, expect } from 'vitest';
import { Compressor } from '../src/compression/compressor.js';

describe('Compressor', () => {
  const compressor = new Compressor();

  describe('compress — none level', () => {
    it('should return raw buffer for none compression', () => {
      const result = compressor.compress('hello world', 'none');
      expect(result.data.toString('utf-8')).toBe('hello world');
      expect(result.ratio).toBe(1);
      expect(result.fidelity).toBe('verbatim');
    });

    it('should report correct sizes for none compression', () => {
      const content = 'test content here';
      const result = compressor.compress(content, 'none');
      expect(result.originalSize).toBe(Buffer.byteLength(content));
      expect(result.compressedSize).toBe(result.originalSize);
    });

    it('should handle empty string', () => {
      const result = compressor.compress('', 'none');
      expect(result.data.toString('utf-8')).toBe('');
      expect(result.compressedSize).toBe(0);
    });

    it('should handle unicode content', () => {
      const content = 'Hello 世界 🌍';
      const result = compressor.compress(content, 'none');
      expect(result.data.toString('utf-8')).toBe(content);
    });
  });

  describe('compress — light level (gzip)', () => {
    it('should produce gzipped output', () => {
      const content = 'a'.repeat(1000);
      const result = compressor.compress(content, 'light');
      expect(result.compressedSize).toBeLessThan(result.originalSize);
      expect(result.fidelity).toBe('verbatim');
    });

    it('should normalize whitespace before gzip', () => {
      const content = 'hello   \n\n\n\nworld  \n';
      const result = compressor.compress(content, 'light');
      const decompressed = compressor.decompress(result.data, 'light');
      expect(decompressed).toBe('hello\n\nworld');
    });

    it('should achieve good compression on repetitive content', () => {
      const content = 'the quick brown fox '.repeat(100);
      const result = compressor.compress(content, 'light');
      expect(result.ratio).toBeLessThan(0.2);
    });

    it('should handle large content', () => {
      const content = 'x'.repeat(100000);
      const result = compressor.compress(content, 'light');
      expect(result.compressedSize).toBeLessThan(1000);
    });
  });

  describe('compress — full level (gzip + semantic)', () => {
    it('should apply summary fidelity', () => {
      const sentences = Array.from({ length: 20 }, (_, i) =>
        `Sentence number ${i} contains important information about the result.`
      ).join(' ');
      const result = compressor.compress(sentences, 'full', 'summary');
      expect(result.fidelity).toBe('summary');
      const decompressed = compressor.decompress(result.data, 'full');
      expect(decompressed.length).toBeLessThan(sentences.length);
    });

    it('should apply distilled fidelity', () => {
      const sentences = Array.from({ length: 20 }, (_, i) =>
        `The system has ${i * 10} active users. Maybe this is not important.`
      ).join(' ');
      const result = compressor.compress(sentences, 'full', 'distilled');
      expect(result.fidelity).toBe('distilled');
      const decompressed = compressor.decompress(result.data, 'full');
      expect(decompressed.length).toBeLessThan(sentences.length);
    });

    it('should keep verbatim fidelity when specified', () => {
      const content = 'Short content here.';
      const result = compressor.compress(content, 'full', 'verbatim');
      expect(result.fidelity).toBe('verbatim');
    });

    it('should default to verbatim when no fidelity specified for full', () => {
      const content = 'Some content to compress.';
      const result = compressor.compress(content, 'full');
      expect(result.fidelity).toBe('verbatim');
    });

    it('summary should keep ~40% of sentences', () => {
      const sentences = Array.from({ length: 10 }, (_, i) =>
        `This is sentence ${i} with some data.`
      ).join(' ');
      const result = compressor.compress(sentences, 'full', 'summary');
      const decompressed = compressor.decompress(result.data, 'full');
      const outputSentences = decompressed.split(/(?<=[.!?])\s+/).filter(s => s.length > 0);
      expect(outputSentences.length).toBeLessThanOrEqual(5);
      expect(outputSentences.length).toBeGreaterThanOrEqual(1);
    });

    it('distilled should keep ~15% of sentences', () => {
      const sentences = Array.from({ length: 20 }, (_, i) =>
        `The count is ${i * 5}. Well, I think maybe this is fine.`
      ).join(' ');
      const result = compressor.compress(sentences, 'full', 'distilled');
      const decompressed = compressor.decompress(result.data, 'full');
      const outputSentences = decompressed.split(/(?<=[.!?])\s+/).filter(s => s.length > 0);
      expect(outputSentences.length).toBeLessThanOrEqual(10);
      expect(outputSentences.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('decompress', () => {
    it('should round-trip none compression', () => {
      const content = 'hello world';
      const compressed = compressor.compress(content, 'none');
      expect(compressor.decompress(compressed.data, 'none')).toBe(content);
    });

    it('should round-trip light compression', () => {
      const content = 'The quick brown fox jumps over the lazy dog.';
      const compressed = compressor.compress(content, 'light');
      expect(compressor.decompress(compressed.data, 'light')).toBe(content.trim());
    });

    it('should round-trip full compression with verbatim', () => {
      const content = 'Important fact here.';
      const compressed = compressor.compress(content, 'full', 'verbatim');
      const decompressed = compressor.decompress(compressed.data, 'full');
      expect(decompressed).toBe(content);
    });

    it('should handle binary-like content', () => {
      const content = String.fromCharCode(...Array.from({ length: 256 }, (_, i) => i % 128));
      const compressed = compressor.compress(content, 'light');
      const decompressed = compressor.decompress(compressed.data, 'light');
      expect(decompressed.length).toBeGreaterThan(0);
    });
  });

  describe('estimateRatio', () => {
    it('should return 1 for none', () => {
      expect(compressor.estimateRatio('test', 'none')).toBe(1);
    });

    it('should return ~0.4 for light', () => {
      expect(compressor.estimateRatio('test', 'light')).toBeCloseTo(0.4, 1);
    });

    it('should return ~0.15 for full', () => {
      expect(compressor.estimateRatio('test', 'full')).toBeCloseTo(0.15, 1);
    });
  });

  describe('edge cases', () => {
    it('should handle single sentence for summary', () => {
      const result = compressor.compress('Just one sentence.', 'full', 'summary');
      const decompressed = compressor.decompress(result.data, 'full');
      expect(decompressed).toBe('Just one sentence.');
    });

    it('should handle single sentence for distilled', () => {
      const result = compressor.compress('Just one sentence.', 'full', 'distilled');
      const decompressed = compressor.decompress(result.data, 'full');
      expect(decompressed).toBe('Just one sentence.');
    });

    it('should prioritize sentences with numbers in factual extraction', () => {
      const content = 'Hello there. The system processed 1500 requests. I think maybe it works. The latency was 42ms.';
      const result = compressor.compress(content, 'full', 'distilled');
      const decompressed = compressor.decompress(result.data, 'full');
      expect(decompressed).toMatch(/\d+/);
    });
  });
});
