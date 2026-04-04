import Database from 'better-sqlite3';
import { AgentIdentity } from './types.js';
import { AdapterConfig } from '../adapters/interface.js';

interface AgentRow {
  agent_id: string;
  data: string;
}

interface AdapterRow {
  agent_id: string;
  data: string;
}

/** SQLite-backed registry of agent identities and their adapter configurations. */
export class IdentityRegistry {
  private agents = new Map<string, AgentIdentity>();
  private db?: Database.Database;
  private adapterConfigs?: Map<string, AdapterConfig>;

  constructor(db?: Database.Database, adapterConfigs?: Map<string, AdapterConfig>) {
    if (db) {
      this.db = db;
      this.adapterConfigs = adapterConfigs;
      this.initDb();
      this.hydrateFromDb();
    }
  }

  private initDb(): void {
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_adapters (
        agent_id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
    `);
  }

  private hydrateFromDb(): void {
    const agentRows = this.db!.prepare('SELECT * FROM agents').all() as AgentRow[];
    for (const row of agentRows) {
      const agent = JSON.parse(row.data) as AgentIdentity;
      this.agents.set(agent.agentId, agent);
    }

    if (this.adapterConfigs) {
      const adapterRows = this.db!.prepare('SELECT * FROM agent_adapters').all() as AdapterRow[];
      for (const row of adapterRows) {
        const config = JSON.parse(row.data) as AdapterConfig;
        this.adapterConfigs.set(config.agentId, config);
      }
    }
  }

  /** Register a new agent identity. Throws if the agent ID is already registered. */
  register(identity: AgentIdentity, adapterConfig?: AdapterConfig): void {
    if (this.agents.has(identity.agentId)) {
      throw new Error(`Agent ${identity.agentId} is already registered.`);
    }
    this.agents.set(identity.agentId, { ...identity });

    // Write-through to SQLite
    if (this.db) {
      this.db
        .prepare('INSERT OR IGNORE INTO agents (agent_id, data) VALUES (?, ?)')
        .run(identity.agentId, JSON.stringify(identity));

      if (adapterConfig) {
        this.db
          .prepare('INSERT OR IGNORE INTO agent_adapters (agent_id, data) VALUES (?, ?)')
          .run(identity.agentId, JSON.stringify(adapterConfig));
      }
    }

    // Update shared adapter configs
    if (adapterConfig && this.adapterConfigs) {
      this.adapterConfigs.set(identity.agentId, adapterConfig);
    }
  }

  /** Retrieve an agent identity by its ID. */
  get(agentId: string): AgentIdentity | undefined {
    return this.agents.get(agentId);
  }

  /** Return all registered agent identities. */
  getAll(): AgentIdentity[] {
    return Array.from(this.agents.values());
  }

  /** Find all agents that declare a given capability. */
  findByCapability(capability: string): AgentIdentity[] {
    return this.getAll().filter((a) => a.capabilities.includes(capability));
  }

  /** Check whether an agent is registered. */
  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /** Remove an agent and its adapter config from the registry. */
  remove(agentId: string): boolean {
    if (this.db) {
      this.db.prepare('DELETE FROM agents WHERE agent_id = ?').run(agentId);
      this.db.prepare('DELETE FROM agent_adapters WHERE agent_id = ?').run(agentId);
    }
    return this.agents.delete(agentId);
  }
}
