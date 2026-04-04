import Database from 'better-sqlite3';

/** Pricing configuration mapping model names to per-1k-token costs. */
export interface CostConfig {
  models: Record<
    string,
    {
      inputCostPer1k: number;
      outputCostPer1k: number;
    }
  >;
  defaultInputCostPer1k: number;
  defaultOutputCostPer1k: number;
}

/** Default cost configuration with pricing for common OpenAI and Claude models. */
export const DEFAULT_COST_CONFIG: CostConfig = {
  models: {
    'gpt-4': { inputCostPer1k: 0.03, outputCostPer1k: 0.06 },
    'gpt-4-turbo': { inputCostPer1k: 0.01, outputCostPer1k: 0.03 },
    'gpt-3.5-turbo': { inputCostPer1k: 0.0005, outputCostPer1k: 0.0015 },
    'claude-3-opus': { inputCostPer1k: 0.015, outputCostPer1k: 0.075 },
    'claude-3-sonnet': { inputCostPer1k: 0.003, outputCostPer1k: 0.015 },
  },
  defaultInputCostPer1k: 0.01,
  defaultOutputCostPer1k: 0.03,
};

/** Cost record for a single dispatch step within a trace. */
export interface StepCost {
  traceId: string;
  spanId: string;
  agentId: string;
  contractId: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  timestamp: string;
}

/** Aggregated cost summary for an entire trace. */
export interface TraceCostSummary {
  traceId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  steps: StepCost[];
}

/** Aggregated spend summary for a single agent across all traces. */
export interface AgentSpendSummary {
  agentId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  invocationCount: number;
  avgTokensPerInvocation: number;
}

/** SQLite-backed cost tracker that records per-step token usage and calculates estimated costs. */
export class CostAccountant {
  private db: Database.Database;
  private config: CostConfig;

  constructor(db: Database.Database, config?: CostConfig) {
    this.db = db;
    this.config = config || DEFAULT_COST_CONFIG;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cost_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id TEXT NOT NULL,
        span_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        contract_id TEXT NOT NULL,
        model TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost REAL NOT NULL DEFAULT 0,
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cost_trace ON cost_records(trace_id);
      CREATE INDEX IF NOT EXISTS idx_cost_agent ON cost_records(agent_id);
      CREATE INDEX IF NOT EXISTS idx_cost_timestamp ON cost_records(timestamp);
    `);
  }

  /**
   * Calculate the estimated cost for a given number of tokens.
   * @param inputTokens - Number of input tokens consumed.
   * @param outputTokens - Number of output tokens generated.
   * @param model - Optional model name for model-specific pricing.
   * @returns Estimated cost in dollars.
   */
  calculateCost(inputTokens: number, outputTokens: number, model?: string): number {
    const pricing = model ? this.config.models[model] : undefined;
    const inputRate = pricing?.inputCostPer1k ?? this.config.defaultInputCostPer1k;
    const outputRate = pricing?.outputCostPer1k ?? this.config.defaultOutputCostPer1k;
    return (inputTokens / 1000) * inputRate + (outputTokens / 1000) * outputRate;
  }

  /** Record a cost step for a dispatch, calculating and persisting the estimated cost. */
  recordStep(step: Omit<StepCost, 'estimatedCost'>): StepCost {
    const estimatedCost = this.calculateCost(step.inputTokens, step.outputTokens, step.model);
    this.db
      .prepare(
        `INSERT INTO cost_records (trace_id, span_id, agent_id, contract_id, model, input_tokens, output_tokens, estimated_cost, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        step.traceId,
        step.spanId,
        step.agentId,
        step.contractId,
        step.model || null,
        step.inputTokens,
        step.outputTokens,
        estimatedCost,
        step.timestamp
      );
    return { ...step, estimatedCost };
  }

  /** Get the aggregated cost summary for a trace. */
  getTraceCost(traceId: string): TraceCostSummary {
    const rows = this.db
      .prepare('SELECT * FROM cost_records WHERE trace_id = ? ORDER BY timestamp ASC')
      .all(traceId) as CostRow[];

    const steps = rows.map((r) => this.rowToStep(r));
    return {
      traceId,
      totalInputTokens: steps.reduce((s, r) => s + r.inputTokens, 0),
      totalOutputTokens: steps.reduce((s, r) => s + r.outputTokens, 0),
      totalCost: steps.reduce((s, r) => s + r.estimatedCost, 0),
      steps,
    };
  }

  /** Get the aggregated spend summary for an agent. */
  getAgentSpend(agentId: string): AgentSpendSummary {
    const rows = this.db
      .prepare('SELECT * FROM cost_records WHERE agent_id = ? ORDER BY timestamp ASC')
      .all(agentId) as CostRow[];

    const steps = rows.map((r) => this.rowToStep(r));
    const totalInputTokens = steps.reduce((s, r) => s + r.inputTokens, 0);
    const totalOutputTokens = steps.reduce((s, r) => s + r.outputTokens, 0);
    const totalCost = steps.reduce((s, r) => s + r.estimatedCost, 0);
    const invocationCount = steps.length;

    return {
      agentId,
      totalInputTokens,
      totalOutputTokens,
      totalCost,
      invocationCount,
      avgTokensPerInvocation:
        invocationCount > 0 ? (totalInputTokens + totalOutputTokens) / invocationCount : 0,
    };
  }

  /** Get spend summaries for all agents. */
  getAllAgentSpend(): AgentSpendSummary[] {
    const rows = this.db
      .prepare(
        `SELECT agent_id, SUM(input_tokens) as total_input, SUM(output_tokens) as total_output,
              SUM(estimated_cost) as total_cost, COUNT(*) as invocations
       FROM cost_records GROUP BY agent_id`
      )
      .all() as AgentSpendRow[];

    return rows.map((r) => ({
      agentId: r.agent_id,
      totalInputTokens: r.total_input,
      totalOutputTokens: r.total_output,
      totalCost: r.total_cost,
      invocationCount: r.invocations,
      avgTokensPerInvocation:
        r.invocations > 0 ? (r.total_input + r.total_output) / r.invocations : 0,
    }));
  }

  private rowToStep(row: CostRow): StepCost {
    return {
      traceId: row.trace_id,
      spanId: row.span_id,
      agentId: row.agent_id,
      contractId: row.contract_id,
      model: row.model || undefined,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      estimatedCost: row.estimated_cost,
      timestamp: row.timestamp,
    };
  }
}

interface CostRow {
  id: number;
  trace_id: string;
  span_id: string;
  agent_id: string;
  contract_id: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
  timestamp: string;
}

interface AgentSpendRow {
  agent_id: string;
  total_input: number;
  total_output: number;
  total_cost: number;
  invocations: number;
}
