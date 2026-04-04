import * as fs from 'node:fs';
import * as path from 'node:path';
import { CedarEngine } from './cedar-engine.js';

export class PolicyLoader {
  private engine: CedarEngine;

  constructor(engine: CedarEngine) {
    this.engine = engine;
  }

  loadFromString(policyText: string): void {
    this.engine.addPolicies(policyText);
  }

  loadFromFile(filePath: string): void {
    const resolved = path.resolve(filePath);
    const content = fs.readFileSync(resolved, 'utf-8');
    this.engine.addPolicies(content);
  }

  loadFromDirectory(dirPath: string): void {
    const resolved = path.resolve(dirPath);
    const files = fs.readdirSync(resolved);
    for (const file of files) {
      if (file.endsWith('.cedar')) {
        const filePath = path.join(resolved, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        this.engine.addPolicies(content);
      }
    }
  }

  validate(policyText: string): { valid: boolean; errors: string[] } {
    return this.engine.validate(policyText);
  }
}
