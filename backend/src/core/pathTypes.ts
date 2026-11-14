/**
 * Types for the learning-path core (core/path.ts, core/adapt.ts). Pure data: no I/O, no clocks, no LLM.
 *
 * Two levels of skill exist. A role has broad weighted SKILLS ("web_frontend"). A learner knows finer TOPICS
 * ("javascript", "react"). `LearningGraph.skill_topics` says which topics make up a role skill and how much each is
 * worth; a role skill with no entry is its own single topic. Learner state is keyed by topic, so what a learner knows
 * carries over when the career goal (the role) changes.
 */

export interface LearnerSkillState {
  /** A topic id (see LearningGraph.topic_names). */
  skill_id: string;
  declared: boolean;
  /** 0..1 from a graded assessment, or null when only declared / unknown. */
  verified_proficiency: number | null;
}

export type StepStatus = "pending" | "active" | "done" | "blocked" | "remedial";
export type StepKind = "core" | "remedial";

export interface PathStep {
  id: string;
  /** The topic this step teaches. */
  skill_id: string;
  /** The role skill whose weight this step serves (null for a remedial step with no role skill). */
  role_skill_id: string | null;
  kind: StepKind;
  resource_ids: string[];
  status: StepStatus;
  order: number;
  reason: string;
  /** This step's share of the role: weight x topic share x (1 - mastery). 0 for remedial steps. */
  gap: number;
  /** Ids of remedial steps that must be finished first. */
  blocked_by: string[];
  /** Passed, but below the strong bar: revisit later. */
  review_later: boolean;
  /** For a remedial step: the prerequisite concept it revisits. */
  concept: string | null;
}

export type PathCreatedFrom = "initial" | "assessment" | "goal_change";

export interface ChangeItem {
  skill_id: string;
  label: string;
  reason: string;
}

export interface StatusChange {
  step_id: string;
  label: string;
  from: StepStatus | null;
  to: StepStatus;
}

export interface PathChange {
  at: string;
  kind: PathCreatedFrom;
  /** Human-readable, built from templates (never from a model). */
  reason: string;
  added: ChangeItem[];
  removed: ChangeItem[];
  reordered: ChangeItem[];
  kept: ChangeItem[];
  status_changes: StatusChange[];
}

export interface LearningPath {
  role_id: string;
  steps: PathStep[];
  version: number;
  created_from: PathCreatedFrom;
  history: PathChange[];
  /** The learner's topic states at the time of the last change (carried across goal changes). */
  states: LearnerSkillState[];
  pace: "normal" | "slow";
}

export type AssessmentSource = "interrogation" | "quiz" | "simulation";

export interface AssessmentResult {
  /** A topic id. */
  skill_id: string;
  /** 0..100 */
  score: number;
  source: AssessmentSource;
  /** Optional concepts the learner missed (used to pick the remedial concept). */
  missing_concepts?: string[];
}

export type ResourceType = "course" | "tutorial" | "exercise";
export type ResourceLevel = "beginner" | "intermediate" | "advanced";

export interface Resource {
  id: string;
  /** The topic this resource teaches. */
  skill_id: string;
  title: string;
  url: string;
  type: ResourceType;
  est_minutes: number;
  level: ResourceLevel;
}

export interface TopicShare {
  topic: string;
  share: number;
}

export interface LearningGraph {
  /** Every topic id -> display name. A topic missing here is unknown and rejected. */
  topic_names: Record<string, string>;
  /** topic -> topics that should be learned first. Must be acyclic. */
  prerequisites: Record<string, string[]>;
  /** role skill id -> its topics (shares sum to 1). */
  skill_topics: Record<string, TopicShare[]>;
  /** Lower-case alternative spellings of a topic ("js" -> "javascript"), for free-text skill entry. */
  aliases?: Record<string, string>;
  /** Curated certification rules (see core/certs.ts). */
  certifications?: CertRule[];
}

/** A certification (by name keywords) and the topics it genuinely covers. Curated; topics must exist in the graph. */
export interface CertRule {
  id: string;
  /** Matched as whole words, case-insensitively, anywhere in the certification name. */
  keywords: string[];
  topics: string[];
}

/** What one certification entered by the learner maps to. `topics` is empty when no rule matches. */
export interface CertMapping {
  cert: string;
  topics: string[];
}

export interface GapTopic {
  topic: string;
  name: string;
  mastery: number;
}

export interface GapRow {
  skill_id: string;
  name: string;
  weight: number;
  /** Weighted mastery of the role skill, 0..1. */
  mastery: number;
  /** weight x (1 - mastery) */
  gap: number;
  /** Topics below the declared bar (no evidence at all). */
  missing_topics: GapTopic[];
  /** Every topic with some mastery has only a self-declared level. */
  unverified: boolean;
}

export interface GapAnalysis {
  gaps: GapRow[];
  strengths: GapRow[];
}

export interface SkillBar {
  skill_id: string;
  name: string;
  weight: number;
  mastery: number;
  unverified: boolean;
}

export interface ProgressSummary {
  percent_complete: number;
  skill_bars: SkillBar[];
  next_step: PathStep | null;
}
