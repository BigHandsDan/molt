import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MoltDoorClient } from '../src/integrations/moltdoor';

// Mock the global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('MoltDoorClient', () => {
  let client: MoltDoorClient;

  beforeEach(() => {
    client = new MoltDoorClient({ baseUrl: 'https://moltdoor.net', cacheSeconds: 300 });
    client.clearCache();
    mockFetch.mockReset();
  });

  describe('getAgentProfile', () => {
    it('should fetch and return agent profile', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'agent-1',
          name: 'Test Agent',
          slug: 'test-agent',
          category: 'testing',
          averageRating: 4.5,
          reviewCount: 10,
          badges: ['MoltCaptcha Verified', 'On-Chain'],
        }),
      });

      const profile = await client.getAgentProfile('agent-1');
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe('Test Agent');
      expect(profile!.averageRating).toBe(4.5);
      expect(profile!.badges).toContain('MoltCaptcha Verified');
    });

    it('should return null on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const profile = await client.getAgentProfile('nonexistent');
      expect(profile).toBeNull();
    });

    it('should return null on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const profile = await client.getAgentProfile('agent-1');
      expect(profile).toBeNull();
    });

    it('should cache responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'agent-1', name: 'Test', badges: [] }),
      });

      await client.getAgentProfile('agent-1');
      await client.getAgentProfile('agent-1');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOnChainData', () => {
    it('should fetch on-chain data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          onchainAgentId: '0x123',
          ownerAddress: '0xabc',
          agentURI: 'https://example.com/agent',
        }),
      });

      const data = await client.getOnChainData('agent-1');
      expect(data).not.toBeNull();
      expect(data!.onchainAgentId).toBe('0x123');
    });

    it('should return null for missing on-chain data', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const data = await client.getOnChainData('agent-1');
      expect(data).toBeNull();
    });
  });

  describe('resolveAgentAttributes', () => {
    it('should return unverified for unknown agents', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const attrs = await client.resolveAgentAttributes('unknown');
      expect(attrs.verificationTier).toBe('unverified');
      expect(attrs.reputationScore).toBe(0);
    });

    it('should map MoltCaptcha badge to moltcaptcha tier', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'agent-1',
          name: 'Test',
          averageRating: 3.0,
          badges: ['MoltCaptcha Verified'],
        }),
      });
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const attrs = await client.resolveAgentAttributes('agent-1');
      expect(attrs.verificationTier).toBe('moltcaptcha');
    });

    it('should map On-Chain badge to blockchain tier', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'agent-1',
          name: 'Test',
          averageRating: 3.0,
          badges: ['On-Chain'],
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ onchainAgentId: '0x123', ownerAddress: '0xabc', agentURI: '' }),
      });

      const attrs = await client.resolveAgentAttributes('agent-1');
      expect(attrs.verificationTier).toBe('blockchain');
      expect(attrs.hasOnChainId).toBe(true);
    });

    it('should map fully verified + high rating to reputation tier', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'agent-1',
          name: 'Top Agent',
          averageRating: 4.5,
          badges: ['MoltCaptcha Verified', 'On-Chain'],
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ onchainAgentId: '0x123', ownerAddress: '0xabc', agentURI: '' }),
      });

      const attrs = await client.resolveAgentAttributes('agent-1');
      expect(attrs.verificationTier).toBe('reputation');
      expect(attrs.reputationScore).toBe(5); // Math.round(4.5)
    });
  });
});
