import { adaptOnAssessment } from "../core/adapt.js";
import { progressSummary, topicName, type AssessmentResult, type LearningPath, type PathChange, type ProgressSummary } from "../core/path.js";
import type { Role } from "../types.js";
import type { Agent } from "./types.js";

export interface EvaluatorInput {
  path: LearningPath;
  result: AssessmentResult;
  role: Role;
}
export interface EvaluatorOutput {
  path: LearningPath;
  change: PathChange;
  summary: ProgressSummary;
  /** True when the result sent the learner to a remedial step (so the Curriculum Planner re-checks the plan). */
  remedial_added: boolean;
}

/** Ingests a graded result, updates mastery and the roadmap with the core adaptation rules, and reports progress. */
export const progressEvaluatorAgent: Agent<EvaluatorInput, EvaluatorOutput> = {
  name: "progress_evaluator",
  async run({ path, result, role }, ctx) {
    const out = adaptOnAssessment(path, result, role, ctx.resources, ctx.graph, ctx.now);
    const summary = progressSummary(out.path, out.path.states, role, ctx.graph);
    const remedial_added = out.change.added.length > 0;
    return {
      output: { path: out.path, change: out.change, summary, remedial_added },
      handoff: remedial_added ? "1 remedial step added, dependent steps paused" : `progress ${summary.percent_complete}%`,
      log: [
        {
          agent: "progress_evaluator",
          action: "evaluate_assessment",
          summary: `${out.change.reason} Progress is now ${summary.percent_complete}%. (${topicName(result.skill_id, ctx.graph)}, ${result.source === "simulation" ? "simulated" : result.source})`,
          decided_by: "deterministic",
          inputs_ref: "assessment result and roadmap",
          outputs_ref: "updated roadmap and progress",
        },
      ],
    };
  },
};
