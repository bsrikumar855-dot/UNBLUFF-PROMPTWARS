import { adaptOnGoalChange } from "../core/adapt.js";
import { buildPath, topicName, type LearnerSkillState, type LearningGraph, type LearningPath, type PathChange, type Resource } from "../core/path.js";
import type { Role } from "../types.js";
import type { Agent } from "./types.js";

export type PlannerInput =
  | { kind: "build"; role: Role; states: LearnerSkillState[] }
  | { kind: "goal_change"; path: LearningPath; role: Role }
  | { kind: "review"; path: LearningPath };

export interface UpcomingStep {
  step_id: string;
  label: string;
  status: string;
  resources: { title: string; url: string; type: string; est_minutes: number }[];
}
export type PlannerOutput = { path: LearningPath; change: PathChange | null; upcoming: UpcomingStep[] };

export function upcomingSteps(path: LearningPath, graph: LearningGraph, resources: readonly Resource[], limit = 4): UpcomingStep[] {
  const byId = new Map(resources.map((r) => [r.id, r]));
  return path.steps
    .filter((s) => s.status !== "done")
    .slice(0, limit)
    .map((s) => ({
      step_id: s.id,
      label: s.kind === "remedial" ? `Revisit: ${s.concept}` : topicName(s.skill_id, graph),
      status: s.status,
      resources: s.resource_ids.flatMap((id) => {
        const r = byId.get(id);
        return r ? [{ title: r.title, url: r.url, type: r.type, est_minutes: r.est_minutes }] : [];
      }),
    }));
}

/** The learner's next best step: an open remedial step first, then the active one. Same rule as the progress summary. */
function nextBest(path: LearningPath, graph: LearningGraph): string {
  const s = path.steps.find((x) => x.status === "remedial") ?? path.steps.find((x) => x.status === "active");
  return s ? (s.kind === "remedial" ? `Revisit: ${s.concept}` : topicName(s.skill_id, graph)) : "none";
}

/** Builds and re-plans the roadmap with the core functions, and attaches curated resources. Never picks anything by model. */
export const curriculumPlannerAgent: Agent<PlannerInput, PlannerOutput> = {
  name: "curriculum_planner",
  async run(input, ctx) {
    let path: LearningPath;
    let change: PathChange | null = null;
    let summary: string;
    if (input.kind === "build") {
      path = buildPath(input.role, input.states, ctx.resources, ctx.graph, ctx.now);
      summary = `Built a ${path.steps.length}-step roadmap for ${input.role.name}, in prerequisite order, with curated resources for each step.`;
    } else if (input.kind === "goal_change") {
      const out = adaptOnGoalChange(input.path, input.role, ctx.resources, ctx.graph, ctx.now);
      path = out.path;
      change = out.change;
      summary = change.reason;
    } else {
      path = input.path;
      const open = path.steps.filter((s) => s.status === "remedial").length;
      const paused = path.steps.filter((s) => s.status === "blocked").length;
      summary = `Checked the re-plan: ${open} remedial step(s) first, ${paused} step(s) paused until they are done.`;
    }
    const upcoming = upcomingSteps(path, ctx.graph, ctx.resources);
    return {
      output: { path, change, upcoming },
      handoff: `${path.steps.filter((s) => s.status !== "done").length} open step(s), next: ${nextBest(path, ctx.graph)}`,
      log: [{ agent: "curriculum_planner", action: input.kind === "build" ? "build_roadmap" : input.kind === "goal_change" ? "rebuild_roadmap" : "review_replan", summary, decided_by: "deterministic", inputs_ref: input.kind === "build" ? "skill states and role" : "current roadmap", outputs_ref: "roadmap" }],
    };
  },
};
