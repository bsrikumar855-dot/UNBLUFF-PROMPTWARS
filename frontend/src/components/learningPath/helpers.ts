import type { AgentName, LearningPathView } from "@/types/learningPath";

export const AGENT_LABEL: Record<AgentName, string> = {
  profiler: "Profiler",
  skill_analyst: "Skill Analyst",
  career_matcher: "Career Matcher",
  curriculum_planner: "Curriculum Planner",
  progress_evaluator: "Progress Evaluator",
  mentor: "Mentor",
};

/** True when the latest assessment came from a simulation (so the UI can say so). */
export function lastAssessmentWasSimulation(view: LearningPathView): boolean {
  const last = [...view.agent_log].reverse().find((e) => e.action === "ingest_assessment");
  return last?.summary.includes("a simulation") ?? false;
}