import { gzipSync, gunzipSync } from 'node:zlib';
import type { CompressionLevel, Fidelity } from '../bin/types.js';
import type { CompressionEngine, CompressedResult } from './types.js';

/**
 * Two-phase compression engine:
 * - 'light': structural (gzip only, lossless)
 * - 'full': structural + semantic (gzip + content reduction, lossy)
 */
export class Compressor implements CompressionEngine {
  compress(content: string, level: CompressionLevel, fidelity: Fidelity = 'verbatim'): CompressedResult {
    if (level === 'none') {
      const buf = Buffer.from(content, 'utf-8');
      return {
        data: buf,
        originalSize: buf.length,
        compressedSize: buf.length,
        ratio: 1,
        fidelity: 'verbatim',
      };
    }

    const originalSize = Buffer.byteLength(content, 'utf-8');
    let processedContent = content;
    let resultFidelity: Fidelity = 'verbatim';

    if (level === 'full') {
      if (fidelity === 'distilled') {
        processedContent = this.extractFacts(content);
        resultFidelity = 'distilled';
      } else if (fidelity === 'summary') {
        processedContent = this.extractSummary(content);
        resultFidelity = 'summary';
      } else {
        processedContent = this.normalizeContent(content);
        resultFidelity = 'verbatim';
      }
    } else {
      processedContent = this.normalizeContent(content);
    }

    const data = gzipSync(Buffer.from(processedContent, 'utf-8'));
    return {
      data,
      originalSize,
      compressedSize: data.length,
      ratio: data.length / originalSize,
      fidelity: resultFidelity,
    };
  }

  decompress(compressed: Buffer, level: CompressionLevel): string {
    if (level === 'none') {
      return compressed.toString('utf-8');
    }
    return gunzipSync(compressed).toString('utf-8');
  }

  estimateRatio(content: string, level: CompressionLevel): number {
    if (level === 'none') return 1;
    if (level === 'light') return 0.4;
    return 0.15;
  }

  /** Structural normalization: strip extra whitespace, normalize line endings. */
  private normalizeContent(content: string): string {
    return content
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** Extract key sentences (~40% of content). */
  private extractSummary(content: string): string {
    const sentences = this.splitSentences(content);
    if (sentences.length <= 2) return content;

    // Keep ~40% of sentences, prioritizing longer/more informative ones
    const targetCount = Math.max(1, Math.ceil(sentences.length * 0.4));
    const scored = sentences.map((s, i) => ({
      sentence: s,
      score: this.scoreSentence(s, i, sentences.length),
    }));
    scored.sort((a, b) => b.score - a.score);
    const kept = scored.slice(0, targetCount);
    // Restore original order
    kept.sort((a, b) => sentences.indexOf(a.sentence) - sentences.indexOf(b.sentence));
    return kept.map((k) => k.sentence).join(' ');
  }

  /** Extract only factual statements (~15% of content). */
  private extractFacts(content: string): string {
    const sentences = this.splitSentences(content);
    if (sentences.length <= 1) return content;

    const targetCount = Math.max(1, Math.ceil(sentences.length * 0.15));
    const scored = sentences.map((s, i) => ({
      sentence: s,
      score: this.scoreFactual(s, i, sentences.length),
    }));
    scored.sort((a, b) => b.score - a.score);
    const kept = scored.slice(0, targetCount);
    kept.sort((a, b) => sentences.indexOf(a.sentence) - sentences.indexOf(b.sentence));
    return kept.map((k) => k.sentence).join(' ');
  }

  private splitSentences(content: string): string[] {
    return content
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  private scoreSentence(sentence: string, index: number, total: number): number {
    let score = 0;
    // Longer sentences tend to have more information
    score += Math.min(sentence.length / 100, 1) * 0.3;
    // Sentences with numbers/data are informative
    if (/\d+/.test(sentence)) score += 0.2;
    // First and last sentences are often important
    if (index === 0) score += 0.3;
    if (index === total - 1) score += 0.15;
    // Keywords that indicate important content
    if (/\b(result|found|error|decided|because|therefore|must|should|key|critical|important)\b/i.test(sentence)) {
      score += 0.25;
    }
    return score;
  }

  private scoreFactual(sentence: string, index: number, total: number): number {
    let score = 0;
    // Contains data/numbers
    if (/\d+/.test(sentence)) score += 0.4;
    // Contains definitive statements
    if (/\b(is|are|was|were|has|have|had|equals|contains|returns|produces)\b/i.test(sentence)) {
      score += 0.3;
    }
    // Filter out filler
    if (/\b(maybe|perhaps|might|could|I think|I guess|well|hmm|ok|sure)\b/i.test(sentence)) {
      score -= 0.5;
    }
    // First sentence often states the main fact
    if (index === 0) score += 0.2;
    return score;
  }
}
