import { computeGaps, roleMatch, type GapAnalysis, type LearnerSkillState } from "../core/path.js";
import type { Role } from "../types.js";
import type { Agent } from "./types.js";

export interface CareerMatcherInput {
  role: Role;
  states: LearnerSkillState[];
}
export interface RoleRank {
  role_id: string;
  name: string;
  match_percent: number;
}
export interface CareerMatcherOutput {
  match_percent: number;
  /** Every role, best match first (ties by role id). The UI shows the top alternatives. */
  ranking: RoleRank[];
  analysis: GapAnalysis;
}

/** Scores the target role and every other role by weighted effective mastery. Wraps the core match and gap functions. */
export const careerMatcherAgent: Agent<CareerMatcherInput, CareerMatcherOutput> = {
  name: "career_matcher",
  async run({ role, states }, ctx) {
    const ranking: RoleRank[] = ctx.roles
      .list()
      .map((s) => ({ role_id: s.id, name: s.name, match_percent: roleMatch(ctx.roles.get(s.id)!, states, ctx.graph) }))
      .sort((a, b) => b.match_percent - a.match_percent || a.role_id.localeCompare(b.role_id));
    const analysis = computeGaps(role, states, ctx.graph);
    const match = ranking.find((r) => r.role_id === role.id)!.match_percent;
    const needs = analysis.gaps.filter((g) => g.missing_topics.length > 0).length;
    return {
      output: { match_percent: match, ranking, analysis },
      handoff: `${needs} role skill(s) with gaps`,
      log: [
        {
          agent: "career_matcher",
          action: "match_roles",
          summary: `${role.name} match is ${match}% (unverified skills count at most 40%). Best fit overall: ${ranking[0]!.name} at ${ranking[0]!.match_percent}%. ${needs} gap area(s) for ${role.name}.`,
          decided_by: "deterministic",
          inputs_ref: "skill states",
          outputs_ref: "role ranking and gaps",
        },
      ],
    };
  },
};
