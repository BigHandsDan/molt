import { Metric, MetricCategory } from './types.js';
import { createDefaultMetrics } from './builtin.js';

/** Registry for managing metrics — both built-in and custom. */
export class MetricRegistry {
  private metrics: Map<string, Metric> = new Map();

  constructor(includeDefaults = true) {
    if (includeDefaults) {
      for (const metric of createDefaultMetrics()) {
        this.register(metric);
      }
    }
  }

  /** Register a metric. Overwrites if the name already exists. */
  register(metric: Metric): void {
    this.metrics.set(metric.name, metric);
  }

  /** Unregister a metric by name. */
  unregister(name: string): boolean {
    return this.metrics.delete(name);
  }

  /** Get a metric by name. */
  get(name: string): Metric | undefined {
    return this.metrics.get(name);
  }

  /** Get all registered metrics. */
  getAll(): Metric[] {
    return Array.from(this.metrics.values());
  }

  /** Get metrics by category. */
  getByCategory(category: MetricCategory): Metric[] {
    return this.getAll().filter((m) => m.category === category);
  }

  /** List registered metric names. */
  listNames(): string[] {
    return Array.from(this.metrics.keys());
  }

  /** Number of registered metrics. */
  get size(): number {
    return this.metrics.size;
  }
}
