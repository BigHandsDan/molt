// Main orchestrator
export { MoltEval, type MoltEvalConfig } from './molteval.js';

// Metrics
export type { Metric, MetricResult, MetricCategory, EvalTrace, ToolCall, ReasoningStep, TokenUsage } from './metrics/types.js';
export {
  ToolCallAccuracy,
  ToolCallSequence,
  PolicyAdherence,
  TaskCompletion,
  Latency,
  CostEfficiency,
  SafetyViolation,
  createDefaultMetrics,
} from './metrics/builtin.js';
export { MetricRegistry } from './metrics/registry.js';
export { LatencyAggregator, type LatencyPercentiles } from './metrics/latency-aggregator.js';

// Runner
export type { EvalCase, EvalSuite, AgentAdapter, CaseResult, EvalRun, EvalVerdict, MetricThresholds } from './runner/types.js';
export { EvalRunner, type RunnerOptions } from './runner/runner.js';

// Regression
export {
  RegressionDetector,
  type RegressionReport,
  type Regression,
  type Improvement,
  type StableMetric,
  type RegressionSeverity,
  type RegressionTolerances,
} from './regression/detector.js';

// Gate
export { ReleaseGate, type GateConfig, type GateDecision, type GateAction } from './gate/gate.js';

// Store
export { EvalStore } from './store/store.js';

// Adversarial
export { AdversarialGenerator, type AdversarialTemplate, type AttackCategory } from './adversarial/generator.js';

// Integrations
export { meshEventsToEvalTrace } from './integrations/molt-mesh.js';
export type { TraceEvent, TraceEventType, TraceFilter } from './integrations/molt-mesh.js';
export {
  recommendTrustTier,
  mapMeshTierToPermitTier,
  mapPermitTierToMeshTier,
} from './integrations/molt-permit.js';
export type { TrustTierRecommendation, PermitTrustTier, MeshTrustTier } from './integrations/molt-permit.js';
export { MoltDoorEvalClient, type MoltDoorEvalConfig, type EvalRating } from './integrations/molt-door.js';
