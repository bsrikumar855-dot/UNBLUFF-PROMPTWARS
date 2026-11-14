/** SkillForge learning path: mirrors the "SkillForge learning path" section of CONTRACT.md. */

export type StepStatus = "pending" | "active" | "done" | "blocked" | "remedial";
export type AgentName = "profiler" | "skill_analyst" | "career_matcher" | "curriculum_planner" | "progress_evaluator" | "mentor";

export interface LearnerProject {
  name: string;
  description: string;
  skills: string[];
}

export interface LearnerProfile {
  skills: string[];
  certifications: string[];
  projects: LearnerProject[];
  career_interests: string[];
}

export interface CreateLearningPathRequest {
  role_id: string;
  skills?: string[];
  certifications?: string[];
  projects?: { name: string; description?: string; skills?: string[] }[];
  career_interests?: string[];
}

export type LearningAssessmentRequest =
  | { source: "simulation"; skill: string; score: number; missing_concepts?: string[] }
  | { source: "interrogation"; skill: string };

export interface LearnerSkillState {
  skill_id: string;
  declared: boolean;
  verified_proficiency: number | null;
}

export interface PathStep {
  id: string;
  skill_id: string;
  role_skill_id: string | null;
  kind: "core" | "remedial";
  resource_ids: string[];
  status: StepStatus;
  order: number;
  reason: string;
  gap: number;
  blocked_by: string[];
  review_later: boolean;
  concept: string | null;
}

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
  kind: "initial" | "assessment" | "goal_change";
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
  created_from: "initial" | "assessment" | "goal_change";
  history: PathChange[];
  states: LearnerSkillState[];
  pace: "normal" | "slow";
}

export interface LearningResource {
  id: string;
  skill_id: string;
  title: string;
  url: string;
  type: "course" | "tutorial" | "exercise";
  est_minutes: number;
  level: "beginner" | "intermediate" | "advanced";
}

export interface GapRow {
  skill_id: string;
  name: string;
  weight: number;
  mastery: number;
  gap: number;
  missing_topics: { topic: string; name: string; mastery: number }[];
  unverified: boolean;
}

export interface AgentLogEntry {
  id: string;
  at: string;
  kind: "action" | "handoff";
  agent: AgentName;
  to: AgentName | null;
  action: string;
  summary: string;
  decided_by: "deterministic" | "llm";
  inputs_ref: string;
  outputs_ref: string;
}

export interface LearningPathView {
  id: string;
  role: { id: string; name: string };
  created_at: string;
  updated_at: string;
  profile: LearnerProfile;
  unrecognized_skills: string[];
  /** Per certification entered: the topics it counts for (as declared skills, never verified). Empty `topics` means no skills mapped. */
  certification_skills: { cert: string; topics: string[] }[];
  career_match: { role_id: string; percent: number; alternatives: { role_id: string; name: string; match_percent: number }[] };
  analysis: { gaps: GapRow[]; strengths: GapRow[] };
  path: LearningPath;
  upcoming: { step_id: string; label: string; status: string; resources: { title: string; url: string; type: string; est_minutes: number }[] }[];
  progress: {
    percent_complete: number;
    skill_bars: { skill_id: string; name: string; weight: number; mastery: number; unverified: boolean }[];
    next_step: PathStep | null;
  };
  mentor: { message: string; source: "ai" | "template"; at: string };
  last_change: PathChange;
  resources: Record<string, LearningResource>;
  topic_names: Record<string, string>;
  agent_log: AgentLogEntry[];
  has_simulation: boolean;
}

export interface LearningPathSummary {
  id: string;
  role: { id: string; name: string };
  updated_at: string;
  percent_complete: number;
}
