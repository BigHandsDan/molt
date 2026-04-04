import { Command } from 'commander';
import { MoltEval } from '../molteval.js';
import { AdversarialGenerator } from '../adversarial/generator.js';

const program = new Command();

program
  .name('molteval')
  .description('MoltEval — Agent evaluation engine CLI')
  .version('0.1.0');

program
  .command('run')
  .description('Run an evaluation suite from a JSON file')
  .argument('<suite-file>', 'Path to eval suite JSON file')
  .option('-d, --db <path>', 'SQLite database path', ':memory:')
  .option('-t, --timeout <ms>', 'Timeout per case in milliseconds', '30000')
  .action(async (suiteFile: string, opts: { db: string; timeout: string }) => {
    try {
      const fs = await import('node:fs');
      const suite = JSON.parse(fs.readFileSync(suiteFile, 'utf-8'));
      const molteval = new MoltEval({ dbPath: opts.db, timeoutMs: parseInt(opts.timeout, 10) });
      const run = await molteval.run(suite);

      console.log(`\nEval Run: ${run.id}`);
      console.log(`Suite: ${run.suiteName}`);
      console.log(`Verdict: ${run.verdict.toUpperCase()}`);
      console.log(`Duration: ${run.durationMs}ms`);
      console.log(`Cases: ${run.caseResults.length} (${run.caseResults.filter((c) => c.passed).length} passed)`);
      console.log('\nAggregate Scores:');
      for (const [metric, score] of Object.entries(run.aggregateScores)) {
        console.log(`  ${metric}: ${score.toFixed(3)}`);
      }

      molteval.close();
      process.exit(run.verdict === 'fail' ? 1 : 0);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('compare')
  .description('Compare two eval runs for regressions')
  .argument('<baseline-id>', 'Baseline run ID')
  .argument('<current-id>', 'Current run ID')
  .option('-d, --db <path>', 'SQLite database path', ':memory:')
  .action((baselineId: string, currentId: string, opts: { db: string }) => {
    try {
      const molteval = new MoltEval({ dbPath: opts.db });
      const report = molteval.compareRuns(baselineId, currentId);

      if (!report) {
        console.error('One or both runs not found.');
        process.exit(1);
        return;
      }

      console.log(`\nRegression Report`);
      console.log(`Baseline: ${report.baselineRunId}`);
      console.log(`Current:  ${report.currentRunId}`);
      console.log(`Status:   ${report.overallStatus}`);

      if (report.regressions.length > 0) {
        console.log('\nRegressions:');
        for (const r of report.regressions) {
          console.log(`  [${r.severity}] ${r.metricName}: ${r.baselineScore.toFixed(3)} → ${r.currentScore.toFixed(3)} (${r.delta.toFixed(3)})`);
        }
      }

      if (report.improvements.length > 0) {
        console.log('\nImprovements:');
        for (const i of report.improvements) {
          console.log(`  ${i.metricName}: ${i.baselineScore.toFixed(3)} → ${i.currentScore.toFixed(3)} (+${i.delta.toFixed(3)})`);
        }
      }

      molteval.close();
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('gate')
  .description('Evaluate a release gate for an eval run')
  .argument('<run-id>', 'Eval run ID')
  .option('-d, --db <path>', 'SQLite database path', ':memory:')
  .option('--safety', 'Block on safety violations', false)
  .action((runId: string, opts: { db: string; safety: boolean }) => {
    try {
      const molteval = new MoltEval({ dbPath: opts.db });
      const decision = molteval.gate(runId, { blockOnSafetyViolation: opts.safety });

      if (!decision) {
        console.error('Run not found.');
        process.exit(1);
        return;
      }

      console.log(`\nGate Decision: ${decision.action.toUpperCase()}`);
      console.log('Reasons:');
      for (const reason of decision.reasons) {
        console.log(`  - ${reason}`);
      }

      molteval.close();
      process.exit(decision.action === 'rollback' ? 2 : decision.action === 'hold' ? 1 : 0);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('report')
  .description('Display a summary report for an eval run')
  .argument('<run-id>', 'Eval run ID')
  .option('-d, --db <path>', 'SQLite database path', ':memory:')
  .action((runId: string, opts: { db: string }) => {
    try {
      const molteval = new MoltEval({ dbPath: opts.db });
      const run = molteval.getRun(runId);

      if (!run) {
        console.error('Run not found.');
        process.exit(1);
        return;
      }

      console.log(`\n═══ Eval Report: ${run.suiteName} ═══`);
      console.log(`Run ID:   ${run.id}`);
      console.log(`Verdict:  ${run.verdict.toUpperCase()}`);
      console.log(`Duration: ${run.durationMs}ms`);
      console.log(`Date:     ${new Date(run.timestamp).toISOString()}`);

      console.log('\n── Aggregate Scores ──');
      for (const [metric, score] of Object.entries(run.aggregateScores)) {
        const bar = '█'.repeat(Math.round(score * 20)) + '░'.repeat(20 - Math.round(score * 20));
        console.log(`  ${metric.padEnd(25)} ${bar} ${(score * 100).toFixed(1)}%`);
      }

      console.log('\n── Case Results ──');
      for (const cr of run.caseResults) {
        const status = cr.passed ? '✓' : '✗';
        console.log(`  ${status} ${cr.caseName} (${cr.durationMs}ms)${cr.error ? ' ERROR: ' + cr.error : ''}`);
      }

      molteval.close();
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('generate-adversarial')
  .description('Generate adversarial test cases')
  .option('-c, --category <category>', 'Filter by attack category')
  .option('-o, --output <file>', 'Output file path (JSON)')
  .action((opts: { category?: string; output?: string }) => {
    try {
      const generator = new AdversarialGenerator();
      const cases = opts.category
        ? generator.generateByCategory(opts.category as Parameters<typeof generator.generateByCategory>[0])
        : generator.generateAll();

      const output = JSON.stringify(cases, null, 2);

      if (opts.output) {
        const fs = require('node:fs');
        fs.writeFileSync(opts.output, output);
        console.log(`Generated ${cases.length} adversarial cases → ${opts.output}`);
      } else {
        console.log(output);
      }
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();
