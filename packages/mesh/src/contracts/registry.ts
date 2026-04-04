import Database from 'better-sqlite3';
import { TaskContract } from './schema.js';

interface ContractRow {
  contract_id: string;
  version: string;
  data: string;
}

/** SQLite-backed registry of immutable task contracts, keyed by contractId + version. */
export class ContractRegistry {
  private contracts = new Map<string, Map<string, TaskContract>>();
  private db?: Database.Database;

  constructor(db?: Database.Database) {
    if (db) {
      this.db = db;
      this.initDb();
      this.hydrateFromDb();
    }
  }

  private initDb(): void {
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS contracts (
        contract_id TEXT NOT NULL,
        version TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (contract_id, version)
      );
    `);
  }

  private hydrateFromDb(): void {
    const rows = this.db!.prepare('SELECT * FROM contracts').all() as ContractRow[];
    for (const row of rows) {
      const contract = JSON.parse(row.data) as TaskContract;
      const key = contract.contractId;
      if (!this.contracts.has(key)) {
        this.contracts.set(key, new Map());
      }
      this.contracts.get(key)!.set(contract.version, contract);
    }
  }

  /** Register a new contract. Throws if the same contractId@version already exists. */
  register(contract: TaskContract): void {
    const key = contract.contractId;
    if (!this.contracts.has(key)) {
      this.contracts.set(key, new Map());
    }
    const versions = this.contracts.get(key)!;
    if (versions.has(contract.version)) {
      throw new Error(
        `Contract ${key}@${contract.version} already exists. Contracts are immutable once published.`
      );
    }
    versions.set(contract.version, { ...contract });

    // Write-through to SQLite
    if (this.db) {
      this.db
        .prepare('INSERT OR IGNORE INTO contracts (contract_id, version, data) VALUES (?, ?, ?)')
        .run(contract.contractId, contract.version, JSON.stringify(contract));
    }
  }

  /** Retrieve a contract by ID and optional version. Returns the latest version if version is omitted. */
  get(contractId: string, version?: string): TaskContract | undefined {
    const versions = this.contracts.get(contractId);
    if (!versions) return undefined;
    if (version) return versions.get(version);
    // Return latest version (by insertion order — last registered)
    let latest: TaskContract | undefined;
    for (const c of versions.values()) {
      latest = c;
    }
    return latest;
  }

  /** Return all registered contracts across all versions. */
  getAll(): TaskContract[] {
    const result: TaskContract[] = [];
    for (const versions of this.contracts.values()) {
      for (const c of versions.values()) {
        result.push(c);
      }
    }
    return result;
  }

  /** List all registered versions for a given contract ID. */
  getVersions(contractId: string): string[] {
    const versions = this.contracts.get(contractId);
    if (!versions) return [];
    return Array.from(versions.keys());
  }

  /** Check whether a contract (and optionally a specific version) exists. */
  has(contractId: string, version?: string): boolean {
    const versions = this.contracts.get(contractId);
    if (!versions) return false;
    if (version) return versions.has(version);
    return versions.size > 0;
  }
}
