import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MoltPermit } from '../index.js';

const program = new Command();

program
  .name('moltpermit')
  .description('Permissions and policy control plane for autonomous AI agents')
  .version('0.1.0');

program
  .command('test')
  .description('Evaluate a policy against an action request')
  .requiredOption('--policy <path>', 'Path to Cedar policy file or directory')
  .requiredOption('--agent <json>', 'Agent JSON (e.g. \'{"id":"agent-1","verificationTier":"moltcaptcha"}\')')
  .requiredOption('--action <json>', 'Action JSON (e.g. \'{"type":"read","resource":"data"}\')')
  .option('--env <environment>', 'Environment (production|staging|development)', 'development')
  .action(async (opts) => {
    try {
      const agent = JSON.parse(opts.agent);
      const action = JSON.parse(opts.action);

      const policyPath = path.resolve(opts.policy);
      const isDir = fs.statSync(policyPath).isDirectory();

      const permit = new MoltPermit({
        policies: policyPath,
        audit: { store: 'memory' },
      });

      const decision = await permit.evaluate({
        agent: { verificationTier: 'unverified', ...agent },
        action: { parameters: {}, ...action },
        context: {
          timestamp: new Date().toISOString(),
          environment: opts.env,
        },
      });

      console.log(JSON.stringify(decision, null, 2));
      process.exit(decision.decision === 'allow' ? 0 : 1);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(2);
    }
  });

program
  .command('validate')
  .description('Validate Cedar policy files')
  .argument('<path>', 'Path to Cedar policy file or directory')
  .action((policyPath) => {
    try {
      const resolved = path.resolve(policyPath);
      const stat = fs.statSync(resolved);
      const files = stat.isDirectory()
        ? fs.readdirSync(resolved).filter((f) => f.endsWith('.cedar')).map((f) => path.join(resolved, f))
        : [resolved];

      let hasErrors = false;

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8');
        const permit = new MoltPermit({ audit: { store: 'memory' } });
        const result = permit.validatePolicy(content);

        if (result.valid) {
          console.log(`✓ ${path.basename(file)}`);
        } else {
          console.log(`✗ ${path.basename(file)}: ${result.errors.join(', ')}`);
          hasErrors = true;
        }
      }

      process.exit(hasErrors ? 1 : 0);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(2);
    }
  });

program
  .command('logs')
  .description('Query audit logs')
  .option('--db <path>', 'Path to audit database', './moltpermit-audit.db')
  .option('--agent <id>', 'Filter by agent ID')
  .option('--decision <allow|deny>', 'Filter by decision')
  .option('--since <date>', 'Filter entries after this date')
  .option('--limit <n>', 'Max number of entries', '20')
  .action((opts) => {
    try {
      const permit = new MoltPermit({
        audit: { store: 'sqlite', path: opts.db },
      });

      const logs = permit.queryLogs({
        agentId: opts.agent,
        decision: opts.decision,
        since: opts.since,
        limit: parseInt(opts.limit),
      });

      if (logs.length === 0) {
        console.log('No audit log entries found.');
      } else {
        for (const entry of logs) {
          console.log(
            `[${entry.timestamp}] ${entry.decision.decision.toUpperCase()} ` +
            `agent=${entry.actionRequest.agent.id} ` +
            `action=${entry.actionRequest.action.type} ` +
            `resource=${entry.actionRequest.action.resource}`,
          );
        }
      }
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(2);
    }
  });

program
  .command('serve')
  .description('Start the standalone MoltPermit server')
  .option('--port <port>', 'Port to listen on', '3001')
  .option('--host <host>', 'Host to bind to', '0.0.0.0')
  .option('--policies <path>', 'Path to Cedar policy file or directory', './policies')
  .option('--db <path>', 'Path to audit database', './moltpermit-audit.db')
  .option('--api-key <key>', 'API key for server authentication')
  .option('--rate-limit <n>', 'Max requests per minute per IP', '100')
  .action(async (opts) => {
    try {
      const { createServer } = await import('../server/standalone.js');

      const permit = new MoltPermit({
        policies: opts.policies,
        audit: { store: 'sqlite', path: opts.db },
      });

      const policyPath = path.resolve(opts.policies);
      if (fs.existsSync(policyPath)) {
        const stat = fs.statSync(policyPath);
        if (stat.isDirectory()) {
          permit.loadPoliciesFromDirectory(policyPath);
        } else {
          permit.loadPoliciesFromFile(policyPath);
        }
      } else {
        console.warn(`Warning: policies path not found: ${policyPath}`);
      }

      const server = createServer(permit, {
        port: parseInt(opts.port),
        host: opts.host,
        apiKey: opts.apiKey,
        rateLimit: { maxRequests: parseInt(opts.rateLimit) },
      });

      server.start();
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('reload')
  .description('Reload policies on a running MoltPermit server')
  .option('--port <port>', 'Port of the running server', '3001')
  .option('--host <host>', 'Host of the running server', 'http://localhost')
  .option('--api-key <key>', 'API key for server authentication')
  .action(async (opts) => {
    try {
      const url = `${opts.host}:${opts.port}/reload`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (opts.apiKey) {
        headers['X-API-Key'] = opts.apiKey;
      }

      const response = await fetch(url, { method: 'POST', headers });
      const data = await response.json() as Record<string, unknown>;

      if (response.ok) {
        console.log(`Policies reloaded successfully. Policy count: ${data.policyCount}`);
      } else {
        console.error(`Reload failed: ${data.error || 'Unknown error'}`);
        process.exit(1);
      }
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(2);
    }
  });

program.parse();
