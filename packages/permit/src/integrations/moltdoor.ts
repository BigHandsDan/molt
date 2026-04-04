import { VerificationTier } from '../engine/types.js';

export interface MoltDoorConfig {
  baseUrl: string;
  cacheSeconds: number;
}

export interface MoltDoorAgentProfile {
  id: string;
  name: string;
  slug: string;
  category: string;
  averageRating: number;
  reviewCount: number;
  badges: string[];
  description?: string;
}

export interface MoltDoorOnChainData {
  onchainAgentId: string;
  ownerAddress: string;
  agentURI: string;
  registrationFile?: string;
}

export interface MoltDoorAgentAttributes {
  verificationTier: VerificationTier;
  reputationScore: number;
  hasOnChainId: boolean;
  badges: string[];
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class MoltDoorClient {
  private config: MoltDoorConfig;
  private cache: Map<string, CacheEntry<unknown>> = new Map();

  constructor(config: Partial<MoltDoorConfig> = {}) {
    this.config = {
      baseUrl: config.baseUrl || 'https://moltdoor.net',
      cacheSeconds: config.cacheSeconds ?? 300,
    };
  }

  async getAgentProfile(agentId: string): Promise<MoltDoorAgentProfile | null> {
    const cacheKey = `profile:${agentId}`;
    const cached = this.getFromCache<MoltDoorAgentProfile>(cacheKey);
    if (cached) return cached;

    try {
      const response = await fetch(`${this.config.baseUrl}/api/agents/${agentId}`);
      if (!response.ok) return null;

      const data = (await response.json()) as MoltDoorAgentProfile;
      this.setCache(cacheKey, data);
      return data;
    } catch {
      return null;
    }
  }

  async getOnChainData(agentId: string): Promise<MoltDoorOnChainData | null> {
    const cacheKey = `onchain:${agentId}`;
    const cached = this.getFromCache<MoltDoorOnChainData>(cacheKey);
    if (cached) return cached;

    try {
      const response = await fetch(`${this.config.baseUrl}/api/agents/${agentId}/onchain`);
      if (!response.ok) return null;

      const data = (await response.json()) as MoltDoorOnChainData;
      this.setCache(cacheKey, data);
      return data;
    } catch {
      return null;
    }
  }

  async resolveAgentAttributes(agentId: string): Promise<MoltDoorAgentAttributes> {
    const [profile, onchain] = await Promise.all([
      this.getAgentProfile(agentId),
      this.getOnChainData(agentId),
    ]);

    if (!profile) {
      return {
        verificationTier: 'unverified',
        reputationScore: 0,
        hasOnChainId: false,
        badges: [],
      };
    }

    const badges = profile.badges || [];
    const hasCaptcha = badges.some((b) => b.toLowerCase().includes('moltcaptcha'));
    const hasOnChain = !!onchain || badges.some((b) => b.toLowerCase().includes('on-chain'));
    const rating = profile.averageRating || 0;

    let verificationTier: VerificationTier = 'unverified';
    if (hasCaptcha && hasOnChain && rating >= 4.0) {
      verificationTier = 'reputation';
    } else if (hasOnChain) {
      verificationTier = 'blockchain';
    } else if (hasCaptcha) {
      verificationTier = 'moltcaptcha';
    }

    return {
      verificationTier,
      reputationScore: Math.round(rating),
      hasOnChainId: hasOnChain,
      badges,
    };
  }

  clearCache(): void {
    this.cache.clear();
  }

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.config.cacheSeconds * 1000,
    });
  }
}
