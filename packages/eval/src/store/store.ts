import Database from 'better-sqlite3';
import { EvalRun, CaseResult } from '../runner/types.js';
import { MetricResult } from '../metrics/types.js';
import { RegressionReport } from '../regression/detector.js';
import { GateDecision } from '../gate/gate.js';

/** SQLite-backed store for eval runs, results, and decisions. */
export class EvalStore {
  private db: Database.Database;

  constructor(dbPath = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS eval_runs (
        id TEXT PRIMARY KEY,
        suite_id TEXT NOT NULL,
        suite_name TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        verdict TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        aggregate_scores TEXT NOT NULL,
        metadata TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS case_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES eval_runs(id),
        case_id TEXT NOT NULL,
        case_name TEXT NOT NULL,
        passed INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        error TEXT,
        UNIQUE(run_id, case_id)
      );

      CREATE TABLE IF NOT EXISTS metric_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES eval_runs(id),
        case_id TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        score REAL NOT NULL,
        passed INTEGER NOT NULL,
        threshold REAL NOT NULL,
        explanation TEXT NOT NULL,
        evidence TEXT NOT NULL,
        UNIQUE(run_id, case_id, metric_name)
      );

      CREATE TABLE IF NOT EXISTS regression_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        baseline_run_id TEXT NOT NULL,
        current_run_id TEXT NOT NULL,
        overall_status TEXT NOT NULL,
        report_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS gate_decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES eval_runs(id),
        action TEXT NOT NULL,
        reasons TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_case_results_run ON case_results(run_id);
      CREATE INDEX IF NOT EXISTS idx_metric_scores_run ON metric_scores(run_id);
      CREATE INDEX IF NOT EXISTS idx_eval_runs_suite ON eval_runs(suite_id);
      CREATE INDEX IF NOT EXISTS idx_eval_runs_timestamp ON eval_runs(timestamp);
    `);
  }

  /** Save a complete eval run with all case results and metric scores. */
  saveRun(run: EvalRun): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO eval_runs (id, suite_id, suite_name, timestamp, verdict, duration_ms, aggregate_scores, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(run.id, run.suiteId, run.suiteName, run.timestamp, run.verdict, run.durationMs, JSON.stringify(run.aggregateScores), JSON.stringify(run.metadata));

      const caseStmt = this.db.prepare(`
        INSERT INTO case_results (run_id, case_id, case_name, passed, duration_ms, error)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const metricStmt = this.db.prepare(`
        INSERT INTO metric_scores (run_id, case_id, metric_name, score, passed, threshold, explanation, evidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const cr of run.caseResults) {
        caseStmt.run(run.id, cr.caseId, cr.caseName, cr.passed ? 1 : 0, cr.durationMs, cr.error ?? null);
        for (const [metricName, mr] of Object.entries(cr.metricResults)) {
          metricStmt.run(run.id, cr.caseId, metricName, mr.score, mr.passed ? 1 : 0, mr.threshold, mr.explanation, JSON.stringify(mr.evidence));
        }
      }
    });
    tx();
  }

  /** Retrieve an eval run by ID. */
  getRun(runId: string): EvalRun | null {
    const row = this.db.prepare('SELECT * FROM eval_runs WHERE id = ?').get(runId) as {
      id: string; suite_id: string; suite_name: string; timestamp: number; verdict: string;
      duration_ms: number; aggregate_scores: string; metadata: string;
    } | undefined;

    if (!row) return null;

    const caseRows = this.db.prepare('SELECT * FROM case_results WHERE run_id = ?').all(runId) as Array<{
      case_id: string; case_name: string; passed: number; duration_ms: number; error: string | null;
    }>;

    const metricRows = this.db.prepare('SELECT * FROM metric_scores WHERE run_id = ?').all(runId) as Array<{
      case_id: string; metric_name: string; score: number; passed: number; threshold: number;
      explanation: string; evidence: string;
    }>;

    const metricsByCase = new Map<string, Record<string, MetricResult>>();
    for (const mr of metricRows) {
      if (!metricsByCase.has(mr.case_id)) metricsByCase.set(mr.case_id, {});
      metricsByCase.get(mr.case_id)![mr.metric_name] = {
        score: mr.score,
        passed: mr.passed === 1,
        threshold: mr.threshold,
        explanation: mr.explanation,
        evidence: JSON.parse(mr.evidence),
      };
    }

    const caseResults: CaseResult[] = caseRows.map((cr) => ({
      caseId: cr.case_id,
      caseName: cr.case_name,
      passed: cr.passed === 1,
      durationMs: cr.duration_ms,
      error: cr.error ?? undefined,
      metricResults: metricsByCase.get(cr.case_id) ?? {},
    }));

    return {
      id: row.id,
      suiteId: row.suite_id,
      suiteName: row.suite_name,
      timestamp: row.timestamp,
      verdict: row.verdict as EvalRun['verdict'],
      durationMs: row.duration_ms,
      aggregateScores: JSON.parse(row.aggregate_scores),
      metadata: JSON.parse(row.metadata),
      caseResults,
    };
  }

  /** List eval runs, optionally filtered by suite. */
  listRuns(suiteId?: string, limit = 50): Array<{ id: string; suiteName: string; verdict: string; timestamp: number }> {
    const query = suiteId
      ? this.db.prepare('SELECT id, suite_name, verdict, timestamp FROM eval_runs WHERE suite_id = ? ORDER BY timestamp DESC LIMIT ?')
      : this.db.prepare('SELECT id, suite_name, verdict, timestamp FROM eval_runs ORDER BY timestamp DESC LIMIT ?');
    const rows = (suiteId ? query.all(suiteId, limit) : query.all(limit)) as Array<{
      id: string; suite_name: string; verdict: string; timestamp: number;
    }>;
    return rows.map((r) => ({ id: r.id, suiteName: r.suite_name, verdict: r.verdict, timestamp: r.timestamp }));
  }

  /** Delete an eval run and its associated data. */
  deleteRun(runId: string): boolean {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM metric_scores WHERE run_id = ?').run(runId);
      this.db.prepare('DELETE FROM case_results WHERE run_id = ?').run(runId);
      this.db.prepare('DELETE FROM gate_decisions WHERE run_id = ?').run(runId);
      const result = this.db.prepare('DELETE FROM eval_runs WHERE id = ?').run(runId);
      return result.changes > 0;
    });
    return tx();
  }

  /** Save a regression report. */
  saveRegressionReport(report: RegressionReport): void {
    this.db.prepare(`
      INSERT INTO regression_reports (baseline_run_id, current_run_id, overall_status, report_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(report.baselineRunId, report.currentRunId, report.overallStatus, JSON.stringify(report), Date.now());
  }

  /** Get regression reports for a run. */
  getRegressionReports(runId: string): RegressionReport[] {
    const rows = this.db.prepare(
      'SELECT report_json FROM regression_reports WHERE current_run_id = ? ORDER BY created_at DESC',
    ).all(runId) as Array<{ report_json: string }>;
    return rows.map((r) => JSON.parse(r.report_json));
  }

  /** Save a gate decision. */
  saveGateDecision(decision: GateDecision): void {
    this.db.prepare(`
      INSERT INTO gate_decisions (run_id, action, reasons, timestamp)
      VALUES (?, ?, ?, ?)
    `).run(decision.runId, decision.action, JSON.stringify(decision.reasons), decision.timestamp);
  }

  /** Get gate decisions for a run. */
  getGateDecisions(runId: string): GateDecision[] {
    const rows = this.db.prepare(
      'SELECT run_id, action, reasons, timestamp FROM gate_decisions WHERE run_id = ? ORDER BY timestamp DESC',
    ).all(runId) as Array<{ run_id: string; action: string; reasons: string; timestamp: number }>;
    return rows.map((r) => ({
      runId: r.run_id,
      action: r.action as GateDecision['action'],
      reasons: JSON.parse(r.reasons),
      timestamp: r.timestamp,
    }));
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}
