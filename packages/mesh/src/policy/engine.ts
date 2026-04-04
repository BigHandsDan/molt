import { PolicyRule, PolicyDecision, PolicyContext, CrossOrgPolicyResult } from './types.js';
import { DEFAULT_RULES } from './defaults.js';

/**
 * Evaluates policy rules against request context to produce allow/deny decisions.
 * Rules are matched by priority (highest first); the first matching rule wins.
 *
 * @example
 * ```ts
 * const engine = new PolicyEngine();
 * engine.addRule({ ruleId: 'allow-internal', effect: 'allow', priority: 100,
 *   conditions: { trustTierIn: [TrustTier.INTERNAL_TRUSTED] },
 *   description: 'Allow all internal trusted agents' });
 * const decision = engine.evaluate(context);
 * ```
 */
export class PolicyEngine {
  private rules: PolicyRule[];

  constructor(rules?: PolicyRule[]) {
    this.rules = rules || [...DEFAULT_RULES];
  }

  /** Add a policy rule. Rules are re-sorted by priority after insertion. */
  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  /** Return a copy of all policy rules, sorted by priority (descending). */
  getRules(): PolicyRule[] {
    return [...this.rules];
  }

  /** Evaluate a request context against all rules and return an allow/deny decision. */
  evaluate(context: PolicyContext): PolicyDecision {
    const sorted = [...this.rules].sort((a, b) => b.priority - a.priority);
    const checkedConditions: string[] = [];

    for (const rule of sorted) {
      const match = this.matchesRule(rule, context, checkedConditions);
      if (match) {
        return {
          allowed: rule.effect === 'allow',
          ruleId: rule.ruleId,
          reason: rule.description,
          conditions: [...checkedConditions],
          timestamp: new Date().toISOString(),
        };
      }
    }

    // Default deny if no rules match
    return {
      allowed: false,
      ruleId: 'default-implicit-deny',
      reason: 'No matching policy rule found — implicit deny',
      conditions: checkedConditions,
      timestamp: new Date().toISOString(),
    };
  }

  /** Evaluate a cross-org request by checking caller policy, target policy, and federation grant. */
  evaluateCrossOrg(
    callerContext: PolicyContext,
    targetContext: PolicyContext,
    grantCheck: { valid: boolean; grantId?: string; reason?: string }
  ): CrossOrgPolicyResult {
    const callerPolicy = this.evaluate(callerContext);
    const targetPolicy = this.evaluate(targetContext);

    // Denied if ANY check fails
    const allPassed = callerPolicy.allowed && targetPolicy.allowed && grantCheck.valid;

    let reason: string;
    if (!grantCheck.valid) {
      reason = `Federation grant check failed: ${grantCheck.reason}`;
    } else if (!callerPolicy.allowed) {
      reason = `Caller org policy denied: ${callerPolicy.reason}`;
    } else if (!targetPolicy.allowed) {
      reason = `Target org policy denied: ${targetPolicy.reason}`;
    } else {
      reason = 'Cross-org request approved — all policies passed';
    }

    const finalDecision: PolicyDecision = {
      allowed: allPassed,
      ruleId: allPassed ? 'cross-org-approved' : 'cross-org-denied',
      reason,
      conditions: [
        `callerPolicy: ${callerPolicy.allowed ? 'allow' : 'deny'}`,
        `targetPolicy: ${targetPolicy.allowed ? 'allow' : 'deny'}`,
        `grant: ${grantCheck.valid ? 'valid' : 'invalid'}`,
      ],
      timestamp: new Date().toISOString(),
    };

    return { callerPolicy, targetPolicy, grantCheck, finalDecision };
  }

  private matchesRule(rule: PolicyRule, context: PolicyContext, conditions: string[]): boolean {
    const c = rule.conditions;
    let hasConditions = false;

    // Check trust tier
    if (c.trustTierIn && c.trustTierIn.length > 0) {
      hasConditions = true;
      conditions.push(`trustTier in [${c.trustTierIn.join(', ')}]`);
      if (!c.trustTierIn.includes(context.agentTrustTier)) {
        return false;
      }
    }

    // Check capability
    if (c.capabilityIn && c.capabilityIn.length > 0) {
      hasConditions = true;
      conditions.push(`capability in [${c.capabilityIn.join(', ')}]`);
      if (!c.capabilityIn.includes(context.capability)) {
        return false;
      }
    }

    // Check toolsAllowed — if specified, required tools must be a subset
    if (c.toolsAllowed && c.toolsAllowed.length > 0 && context.requiredTools.length > 0) {
      hasConditions = true;
      conditions.push(`tools allowed: [${c.toolsAllowed.join(', ')}]`);
      const disallowed = context.requiredTools.filter((t) => !c.toolsAllowed!.includes(t));
      if (disallowed.length > 0) {
        // Tools not in the allowed list — deny rules match, allow rules don't
        return rule.effect === 'deny';
      }
      if (rule.effect === 'deny') return false;
    }

    // Check blocked tools — only relevant when there are actually blocked tools
    if (c.toolsBlocked && c.toolsBlocked.length > 0) {
      hasConditions = true;
      conditions.push(`tools not in [${c.toolsBlocked.join(', ')}]`);
      const blocked = context.requiredTools.some((t) => c.toolsBlocked!.includes(t));
      if (blocked) {
        // Tools are blocked — deny rules match, allow rules don't
        return rule.effect === 'deny';
      }
      // Tools not blocked — this rule doesn't apply for deny, passes for allow
      if (rule.effect === 'deny') return false;
    }

    // Check token budget — only applies when both rule and context have budget info
    if (c.maxTokenBudget !== undefined) {
      hasConditions = true;
      conditions.push(`tokenBudget <= ${c.maxTokenBudget}`);
      if (context.tokenBudget === undefined) {
        // No budget info in context — this condition cannot be evaluated
        // For deny rules: don't deny without evidence of excess
        // For allow rules: budget condition is not met
        if (rule.effect === 'deny') return false;
        return false;
      }
      if (context.tokenBudget > c.maxTokenBudget) {
        return rule.effect === 'deny';
      }
      if (rule.effect === 'deny') return false;
    }

    // Check approval required
    if (c.requireApproval !== undefined) {
      hasConditions = true;
      conditions.push(`approvalRequired = ${c.requireApproval}`);
      if (context.approvalRequired !== c.requireApproval) {
        return false;
      }
    }

    // Check time window
    if (c.timeWindowStart && c.timeWindowEnd) {
      hasConditions = true;
      const now = new Date();
      const currentHour = now.getUTCHours();
      const currentMinute = now.getUTCMinutes();
      const currentTime = currentHour * 60 + currentMinute;

      const [startH, startM] = c.timeWindowStart.split(':').map(Number);
      const [endH, endM] = c.timeWindowEnd.split(':').map(Number);
      const startTime = startH * 60 + (startM || 0);
      const endTime = endH * 60 + (endM || 0);

      conditions.push(`timeWindow ${c.timeWindowStart}-${c.timeWindowEnd} UTC`);

      const inWindow =
        startTime <= endTime
          ? currentTime >= startTime && currentTime < endTime
          : currentTime >= startTime || currentTime < endTime;

      if (!inWindow) {
        return rule.effect === 'deny';
      }
      if (rule.effect === 'deny') return false;
    }

    // A rule with no applicable conditions doesn't match
    if (!hasConditions) return false;

    return true;
  }
}
