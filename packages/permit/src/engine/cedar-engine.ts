import { ActionRequest } from './types.js';

export interface CedarEvalResult {
  decision: 'allow' | 'deny';
  matchedPolicies: string[];
  reasons: string[];
}

export interface ConditionGroup {
  // All alternatives in this group are ORed together
  // The group itself is ANDed with other groups
  alternatives: ParsedCondition[];
}

export interface ParsedPolicy {
  id: string;
  effect: 'permit' | 'forbid';
  principalType?: string;
  principalId?: string;
  actionType?: string;
  resourceType?: string;
  resourceId?: string;
  conditions: ConditionGroup[];
  raw: string;
}

export interface ParsedCondition {
  field: string;
  operator: string;
  value: string | number | boolean;
}

export class CedarEngine {
  private policies: ParsedPolicy[] = [];

  loadPolicies(policyText: string): void {
    this.policies = parseCedarPolicies(policyText);
  }

  addPolicies(policyText: string): void {
    this.policies.push(...parseCedarPolicies(policyText));
  }

  clearPolicies(): void {
    this.policies = [];
  }

  getPolicies(): ParsedPolicy[] {
    return [...this.policies];
  }

  evaluate(request: ActionRequest): CedarEvalResult {
    const permits: ParsedPolicy[] = [];
    const forbids: ParsedPolicy[] = [];

    for (const policy of this.policies) {
      if (matchesPolicy(policy, request)) {
        if (policy.effect === 'permit') {
          permits.push(policy);
        } else {
          forbids.push(policy);
        }
      }
    }

    // Cedar semantics: if any forbid matches, deny. Otherwise, must have at least one permit.
    if (forbids.length > 0) {
      return {
        decision: 'deny',
        matchedPolicies: forbids.map((p) => p.id),
        reasons: forbids.map((p) => `Denied by policy: ${p.id}`),
      };
    }

    if (permits.length > 0) {
      return {
        decision: 'allow',
        matchedPolicies: permits.map((p) => p.id),
        reasons: permits.map((p) => `Allowed by policy: ${p.id}`),
      };
    }

    return {
      decision: 'deny',
      matchedPolicies: [],
      reasons: ['No matching permit policy found (default deny)'],
    };
  }

  validate(policyText: string): { valid: boolean; errors: string[] } {
    try {
      const policies = parseCedarPolicies(policyText);
      if (policies.length === 0) {
        return { valid: false, errors: ['No policies found in input'] };
      }
      return { valid: true, errors: [] };
    } catch (err) {
      return {
        valid: false,
        errors: [err instanceof Error ? err.message : String(err)],
      };
    }
  }
}

function matchesPolicy(policy: ParsedPolicy, request: ActionRequest): boolean {
  // Check principal (agent) match
  if (policy.principalId && policy.principalId !== request.agent.id) {
    return false;
  }

  // Check action match
  if (policy.actionType) {
    const actionType = normalizeActionType(policy.actionType);
    const requestAction = normalizeActionType(request.action.type);
    if (actionType !== requestAction) {
      return false;
    }
  }

  // Check resource match
  if (policy.resourceId && policy.resourceId !== request.action.resource) {
    return false;
  }

  // Check when conditions: each ConditionGroup must have at least one matching alternative
  for (const group of policy.conditions) {
    const groupPasses = group.alternatives.some((cond) => evaluateCondition(cond, request));
    if (!groupPasses) {
      return false;
    }
  }

  return true;
}

function normalizeActionType(action: string): string {
  // Strip namespace prefixes like MoltPermit::Action::"read" → read
  const match = action.match(/::"([^"]+)"$/);
  if (match) return match[1];

  // Strip quotes
  return action.replace(/"/g, '');
}

function evaluateCondition(condition: ParsedCondition, request: ActionRequest): boolean {
  const value = resolveField(condition.field, request);

  switch (condition.operator) {
    case '==':
      return value === condition.value;
    case '!=':
      return value !== condition.value;
    case '>=':
      return typeof value === 'number' && typeof condition.value === 'number' && value >= condition.value;
    case '<=':
      return typeof value === 'number' && typeof condition.value === 'number' && value <= condition.value;
    case '>':
      return typeof value === 'number' && typeof condition.value === 'number' && value > condition.value;
    case '<':
      return typeof value === 'number' && typeof condition.value === 'number' && value < condition.value;
    default:
      return false;
  }
}

function resolveField(field: string, request: ActionRequest): unknown {
  // principal.X maps to agent fields
  if (field.startsWith('principal.')) {
    const attr = field.slice('principal.'.length);
    return (request.agent as unknown as Record<string, unknown>)[attr];
  }

  // resource.X maps to action parameters or resource-level attrs
  if (field.startsWith('resource.')) {
    const attr = field.slice('resource.'.length);
    return (request.action.parameters as Record<string, unknown>)[attr];
  }

  // context.X maps to context
  if (field.startsWith('context.')) {
    const attr = field.slice('context.'.length);
    return (request.context as unknown as Record<string, unknown>)[attr];
  }

  return undefined;
}

export function parseCedarPolicies(text: string): ParsedPolicy[] {
  const policies: ParsedPolicy[] = [];
  // Remove single-line comments
  const cleaned = text.replace(/\/\/.*$/gm, '').trim();

  // Split into policy blocks by finding permit( or forbid( at top level
  const policyRegex = /(permit|forbid)\s*\(([\s\S]*?)\)\s*(when\s*\{([\s\S]*?)\})?\s*;/g;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = policyRegex.exec(cleaned)) !== null) {
    const effect = match[1] as 'permit' | 'forbid';
    const head = match[2].trim();
    const whenBlock = match[4]?.trim() || '';

    const policy: ParsedPolicy = {
      id: `policy_${idx++}`,
      effect,
      conditions: [],
      raw: match[0],
    };

    // Parse head: principal, action, resource clauses
    const lines = head.split(',').map((l) => l.trim());
    for (const line of lines) {
      if (line.startsWith('principal')) {
        const eqMatch = line.match(/principal\s*==\s*(.+)/);
        if (eqMatch) {
          policy.principalId = eqMatch[1].trim().replace(/"/g, '');
        }
        const isMatch = line.match(/principal\s+is\s+(\w+)/);
        if (isMatch) {
          policy.principalType = isMatch[1];
        }
      } else if (line.startsWith('action')) {
        const eqMatch = line.match(/action\s*==\s*(.+)/);
        if (eqMatch) {
          policy.actionType = eqMatch[1].trim();
        }
      } else if (line.startsWith('resource')) {
        const eqMatch = line.match(/resource\s*==\s*(.+)/);
        if (eqMatch) {
          policy.resourceId = eqMatch[1].trim().replace(/"/g, '');
        }
      }
    }

    // Parse when conditions
    if (whenBlock) {
      const conditions = parseWhenBlock(whenBlock);
      policy.conditions = conditions;
    }

    policies.push(policy);
  }

  return policies;
}

function parseWhenBlock(block: string): ConditionGroup[] {
  const groups: ConditionGroup[] = [];

  // Split on && (top-level AND groups)
  const andParts = splitOnLogicalAnd(block);

  for (const andPart of andParts) {
    const trimmed = andPart.trim();
    if (!trimmed) continue;

    // Split each AND group on || to get OR alternatives
    const orParts = splitOnLogicalOr(trimmed);
    const alternatives: ParsedCondition[] = [];

    for (const orPart of orParts) {
      const orTrimmed = orPart.trim();
      if (!orTrimmed) continue;

      // Match patterns like: principal.verificationTier == "reputation"
      const condMatch = orTrimmed.match(
        /^([a-zA-Z_.]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/
      );
      if (condMatch) {
        alternatives.push({
          field: condMatch[1],
          operator: condMatch[2],
          value: parseValue(condMatch[3].trim()),
        });
      }
    }

    if (alternatives.length > 0) {
      groups.push({ alternatives });
    }
  }

  return groups;
}

function splitOnLogicalAnd(block: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;

  for (let i = 0; i < block.length; i++) {
    const ch = block[i];
    if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || ch === '}') depth--;

    if (depth === 0 && block[i] === '&' && block[i + 1] === '&') {
      parts.push(current);
      current = '';
      i++; // skip second &
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    parts.push(current);
  }

  return parts;
}

function splitOnLogicalOr(block: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;

  for (let i = 0; i < block.length; i++) {
    const ch = block[i];
    if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || ch === '}') depth--;

    if (depth === 0 && block[i] === '|' && block[i + 1] === '|') {
      parts.push(current);
      current = '';
      i++; // skip second |
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    parts.push(current);
  }

  return parts;
}

function parseValue(raw: string): string | number | boolean {
  // String literal
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }

  // Boolean
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Number
  const num = Number(raw);
  if (!isNaN(num)) return num;

  return raw;
}
