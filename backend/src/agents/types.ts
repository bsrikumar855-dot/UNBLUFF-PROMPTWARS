import type { AssessmentSource, LearnerSkillState, LearningGraph, Resource } from "../core/pathTypes.js";
import type { InterviewEvidence } from "../placement/evidence.js";
import type { RoleRegistry } from "../services/roles.js";

export type AgentName = "profiler" | "skill_analyst" | "career_matcher" | "curriculum_planner" | "progress_evaluator" | "mentor";
export type EventType = "PROFILE_SUBMITTED" | "ASSESSMENT_SUBMITTED" | "GOAL_CHANGED";
export type DecidedBy = "deterministic" | "llm";

/** One line of the Agent Activity log. A handoff is a separate entry whose `to` names the receiving agent. */
export interface AgentLogEntry {
  id: string;
  at: string;
  kind: "action" | "handoff";
  agent: AgentName;
  /** For a handoff: the agent receiving the work. */
  to: AgentName | null;
  action: string;
  summary: string;
  decided_by: DecidedBy;
  inputs_ref: string;
  outputs_ref: string;
}

export type AgentLogDraft = Omit<AgentLogEntry, "id" | "at" | "kind" | "to">;

export interface AgentResult<O> {
  output: O;
  log: AgentLogDraft[];
  /** What this agent hands to the next one, for the handoff line. */
  handoff: string;
}

export interface LearnerProject {
  name: string;
  description: string;
  skills: string[];
}

/** What the learner tells us. Free text is resolved to topics by the Profiler; anything it cannot resolve is reported back. */
export interface LearnerProfile {
  skills: string[];
  certifications: string[];
  projects: LearnerProject[];
  career_interests: string[];
}

export type MentorSource = "ai" | "template";

export interface MentorNote {
  message: string;
  source: MentorSource;
  at: string;
}

/** The only things the MentorAgent may talk about. The model never receives anything else, and never decides any of it. */
export interface MentorFacts {
  event: EventType;
  role_name: string;
  match_percent: number;
  percent_complete: number;
  pace: "normal" | "slow";
  change_reason: string;
  top_gaps: string[];
  next_step: { label: string; resources: { title: string; url: string }[] } | null;
  remedial: string | null;
}

export interface AgentContext {
  now: Date;
  uid: string;
  roles: RoleRegistry;
  graph: LearningGraph;
  resources: readonly Resource[];
  /** Verified interview results for this learner (existing interrogation flow). Null when unavailable. */
  interview: () => Promise<InterviewEvidence | null>;
  /** Language layer: returns a coaching message from the facts, or null to use the template. Never called in mock mode. */
  coach: ((facts: MentorFacts) => Promise<string | null>) | null;
}

export interface Agent<I, O> {
  readonly name: AgentName;
  run(input: I, ctx: AgentContext): Promise<AgentResult<O>>;
}

export type { AssessmentSource, LearnerSkillState };
