import { TrustTier } from '../contracts/schema.js';
import { PolicyRule } from './types.js';

/** Default policy rules applied when no custom rules are provided. Covers trust-tier access, tool restrictions, and budget limits. */
export const DEFAULT_RULES: PolicyRule[] = [
  // Highest priority: deny blocked tools
  {
    ruleId: 'default-blocked-tools-deny',
    effect: 'deny',
    priority: 200,
    conditions: {
      toolsBlocked: [],
    },
    description: 'Deny if agent uses blocked tools',
  },
  // External partners: block dangerous tools
  {
    ruleId: 'default-external-partner-block-tools',
    effect: 'deny',
    priority: 190,
    conditions: {
      trustTierIn: [TrustTier.EXTERNAL_PARTNER],
      toolsBlocked: ['code_exec', 'file_write'],
    },
    description: 'External partners cannot use code_exec or file_write tools',
  },
  // Public vendors: only allow read_only tool
  {
    ruleId: 'default-public-vendor-tool-restrict',
    effect: 'deny',
    priority: 185,
    conditions: {
      trustTierIn: [TrustTier.PUBLIC_VENDOR],
      toolsAllowed: ['read_only'],
    },
    description: 'Public vendors can only use read_only tools',
  },
  // Budget limits by trust tier
  {
    ruleId: 'default-budget-trusted',
    effect: 'deny',
    priority: 180,
    conditions: {
      trustTierIn: [TrustTier.INTERNAL_TRUSTED],
      maxTokenBudget: 100000,
    },
    description: 'Internal trusted agents: 100k token budget per request',
  },
  {
    ruleId: 'default-budget-restricted',
    effect: 'deny',
    priority: 179,
    conditions: {
      trustTierIn: [TrustTier.INTERNAL_RESTRICTED],
      maxTokenBudget: 10000,
    },
    description: 'Internal restricted agents: 10k token budget per request',
  },
  {
    ruleId: 'default-budget-external',
    effect: 'deny',
    priority: 178,
    conditions: {
      trustTierIn: [TrustTier.EXTERNAL_PARTNER],
      maxTokenBudget: 1000,
    },
    description: 'External partner agents: 1k token budget',
  },
  {
    ruleId: 'default-budget-public',
    effect: 'deny',
    priority: 177,
    conditions: {
      trustTierIn: [TrustTier.PUBLIC_VENDOR],
      maxTokenBudget: 100,
    },
    description: 'Public vendor agents: 100 token budget',
  },
  // Core access rules
  {
    ruleId: 'default-internal-trusted-allow',
    effect: 'allow',
    priority: 100,
    conditions: {
      trustTierIn: [TrustTier.INTERNAL_TRUSTED],
    },
    description: 'Internal trusted agents can invoke any contract',
  },
  {
    ruleId: 'default-internal-restricted-approval',
    effect: 'deny',
    priority: 90,
    conditions: {
      trustTierIn: [TrustTier.INTERNAL_RESTRICTED],
      requireApproval: true,
    },
    description: 'Internal restricted agents need approval for contracts requiring approval',
  },
  {
    ruleId: 'default-internal-restricted-allow',
    effect: 'allow',
    priority: 80,
    conditions: {
      trustTierIn: [TrustTier.INTERNAL_RESTRICTED],
    },
    description: 'Internal restricted agents can invoke contracts not requiring approval',
  },
  {
    ruleId: 'default-external-partner-allow',
    effect: 'allow',
    priority: 70,
    conditions: {
      trustTierIn: [TrustTier.EXTERNAL_PARTNER],
    },
    description: 'External partners can invoke contracts published to their capabilities',
  },
  {
    ruleId: 'default-public-vendor-deny',
    effect: 'deny',
    priority: 60,
    conditions: {
      trustTierIn: [TrustTier.PUBLIC_VENDOR],
    },
    description: 'Public vendors are denied by default unless allowlisted',
  },
];
