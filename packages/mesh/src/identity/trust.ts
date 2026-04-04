import { TrustTier } from './types.js';

/** Numeric trust levels for each tier, higher values indicate more trust. */
export const TRUST_TIER_LEVELS: Record<TrustTier, number> = {
  [TrustTier.INTERNAL_TRUSTED]: 4,
  [TrustTier.INTERNAL_RESTRICTED]: 3,
  [TrustTier.EXTERNAL_PARTNER]: 2,
  [TrustTier.PUBLIC_VENDOR]: 1,
};

/**
 * Check whether an agent's trust tier meets or exceeds a required minimum.
 * @param agentTier - The agent's trust tier.
 * @param requiredTier - The minimum trust tier required.
 * @returns True if the agent meets the minimum trust requirement.
 */
export function meetsMinimumTrust(agentTier: TrustTier, requiredTier: TrustTier): boolean {
  return TRUST_TIER_LEVELS[agentTier] >= TRUST_TIER_LEVELS[requiredTier];
}

/**
 * Get the numeric trust level for a tier.
 * @param tier - The trust tier to look up.
 * @returns Numeric level (4 = highest, 1 = lowest).
 */
export function getTrustLevel(tier: TrustTier): number {
  return TRUST_TIER_LEVELS[tier];
}

/**
 * Check whether a trust tier is internal (trusted or restricted).
 * @param tier - The trust tier to check.
 */
export function isInternal(tier: TrustTier): boolean {
  return tier === TrustTier.INTERNAL_TRUSTED || tier === TrustTier.INTERNAL_RESTRICTED;
}

/**
 * Check whether a trust tier is external (partner or public vendor).
 * @param tier - The trust tier to check.
 */
export function isExternal(tier: TrustTier): boolean {
  return tier === TrustTier.EXTERNAL_PARTNER || tier === TrustTier.PUBLIC_VENDOR;
}
