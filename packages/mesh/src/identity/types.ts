import { TrustTier } from '../contracts/schema.js';

export { TrustTier };

/** Identity record for an agent registered with MoltMesh. */
export interface AgentIdentity {
  /** Unique identifier for the agent. */
  agentId: string;
  /** Human-readable name. */
  name: string;
  /** What this agent does. */
  description: string;
  /** Security classification determining access level. */
  trustTier: TrustTier;
  /** Optional team identifier for organizational grouping. */
  teamId?: string;
  /** Organization this agent belongs to. */
  orgId?: string;
  /** Namespace within the organization (format: "orgId/teamName"). */
  namespaceId?: string;
  /** List of capabilities this agent can fulfill. */
  capabilities: string[];
  /** Tools this agent is authorized to use. */
  allowedTools: string[];
  /** Arbitrary metadata attached to the agent. */
  metadata: Record<string, unknown>;
  /** ISO 8601 timestamp of when the agent was registered. */
  registeredAt: string;
}
