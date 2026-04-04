import { describe, it, expect } from 'vitest';
import { AdversarialGenerator } from '../src/adversarial/generator.js';

describe('AdversarialGenerator', () => {
  it('creates with built-in templates', () => {
    const gen = new AdversarialGenerator();
    expect(gen.getTemplates().length).toBeGreaterThan(0);
  });

  it('creates with empty templates when passed empty array', () => {
    const gen = new AdversarialGenerator([]);
    expect(gen.getTemplates()).toHaveLength(0);
  });

  it('adds custom templates', () => {
    const gen = new AdversarialGenerator([]);
    gen.addTemplate({
      category: 'prompt-injection-direct',
      name: 'custom',
      description: 'Custom test',
      template: 'Do {{thing}}',
      parameters: { thing: ['bad stuff'] },
      expectedViolations: ['injection'],
    });
    expect(gen.getTemplates()).toHaveLength(1);
  });

  it('filters by category', () => {
    const gen = new AdversarialGenerator();
    const direct = gen.getByCategory('prompt-injection-direct');
    expect(direct.length).toBeGreaterThan(0);
    expect(direct.every((t) => t.category === 'prompt-injection-direct')).toBe(true);
  });

  it('generates variants for a single template', () => {
    const gen = new AdversarialGenerator([{
      category: 'prompt-injection-direct',
      name: 'test-template',
      description: 'Test',
      template: '{{action}} on {{target}}',
      parameters: { action: ['read', 'write'], target: ['A', 'B'] },
      expectedViolations: ['test'],
    }]);
    const variants = gen.generateVariants(gen.getTemplates()[0]);
    expect(variants).toHaveLength(4); // 2 * 2
  });

  it('generates cases with input.prompt set and trace undefined', () => {
    const gen = new AdversarialGenerator([{
      category: 'policy-bypass',
      name: 'pb-test',
      description: 'PB Test',
      template: 'Bypass {{check}}',
      parameters: { check: ['auth'] },
      expectedViolations: ['bypass'],
    }]);
    const cases = gen.generateAll();
    expect(cases).toHaveLength(1);
    expect(cases[0].trace).toBeUndefined();
    expect(cases[0].input?.prompt).toBe('Bypass auth');
    expect(cases[0].input?.context?.expectedViolations).toEqual(['bypass']);
    expect(cases[0].tags).toContain('adversarial');
    expect(cases[0].tags).toContain('policy-bypass');
  });

  it('generates all variants for all templates', () => {
    const gen = new AdversarialGenerator();
    const all = gen.generateAll();
    expect(all.length).toBeGreaterThan(10);
  });

  it('generates by category', () => {
    const gen = new AdversarialGenerator();
    const piiCases = gen.generateByCategory('pii-extraction');
    expect(piiCases.length).toBeGreaterThan(0);
    expect(piiCases.every((c) => c.tags?.includes('pii-extraction'))).toBe(true);
  });

  it('substitutes parameters correctly in templates', () => {
    const gen = new AdversarialGenerator([{
      category: 'prompt-injection-direct',
      name: 'sub-test',
      description: 'Substitution test',
      template: 'Hello {{name}}, do {{action}}',
      parameters: { name: ['Alice'], action: ['dance'] },
      expectedViolations: [],
    }]);
    const cases = gen.generateAll();
    expect(cases[0].input?.prompt).toBe('Hello Alice, do dance');
  });

  it('handles single-parameter templates', () => {
    const gen = new AdversarialGenerator([{
      category: 'budget-exhaustion',
      name: 'single',
      description: 'Single param',
      template: 'Repeat {{count}} times',
      parameters: { count: ['100', '200', '300'] },
      expectedViolations: ['budget'],
    }]);
    const cases = gen.generateAll();
    expect(cases).toHaveLength(3);
  });

  describe('generateStaticCases', () => {
    it('generates static cases with pre-filled traces for metric validation', () => {
      const gen = new AdversarialGenerator([{
        category: 'policy-bypass',
        name: 'static-test',
        description: 'Static Test',
        template: 'Bypass {{check}}',
        parameters: { check: ['auth'] },
        expectedViolations: ['bypass'],
      }]);
      const cases = gen.generateStaticCases(gen.getTemplates()[0]);
      expect(cases).toHaveLength(1);
      expect(cases[0].trace).toBeDefined();
      expect(cases[0].trace!.safetyViolations).toEqual(['bypass']);
      expect(cases[0].tags).toContain('static');
      expect(cases[0].tags).toContain('adversarial');
    });

    it('generates all static cases', () => {
      const gen = new AdversarialGenerator();
      const all = gen.generateAllStatic();
      expect(all.length).toBeGreaterThan(10);
      for (const c of all) {
        expect(c.trace).toBeDefined();
        expect(c.trace!.metadata).toHaveProperty('adversarial', true);
      }
    });
  });
});
