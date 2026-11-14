import { resolveTopic, topicName, topicsOf, type AssessmentResult, type AssessmentSource, type LearnerSkillState, type LearningGraph } from "../core/path.js";
import type { InterviewEvidence } from "../placement/evidence.js";
import type { RoleRegistry } from "../services/roles.js";
import type { Agent } from "./types.js";

export type SkillAnalystInput =
  | { kind: "verify_existing"; declared: LearnerSkillState[] }
  | { kind: "ingest"; skill: string; score: number; source: AssessmentSource; missing_concepts?: string[] };

export type SkillAnalystOutput =
  | { kind: "verify_existing"; states: LearnerSkillState[]; verified_from_interviews: number; demonstration_ignored: boolean }
  | { kind: "ingest"; result: AssessmentResult | null; error: string | null };

/**
 * Turns interrogation results the student already earned into verified proficiency per topic. Results graded by the
 * built-in mock model are demonstrations, not assessments, and are NEVER used as verified evidence. A role skill's
 * verified proficiency is credited to each of its topics. Grading itself stays in the existing interrogation flow.
 */
export function verifiedFromInterviews(interview: InterviewEvidence | null, graph: LearningGraph, roles: RoleRegistry): Map<string, number> {
  const out = new Map<string, number>();
  if (!interview || interview.demonstration || interview.readFailed) return out;
  for (const s of interview.skills) {
    if (s.state !== "ready" && s.state !== "needs_work") continue;
    const skill = roles.get(s.role_id)?.skills.find((k) => k.id === s.skill_id);
    if (!skill) continue;
    for (const t of topicsOf(skill, graph)) out.set(t.topic, Math.max(out.get(t.topic) ?? 0, s.proficiency));
  }
  return out;
}

export const skillAnalystAgent: Agent<SkillAnalystInput, SkillAnalystOutput> = {
  name: "skill_analyst",
  async run(input, ctx) {
    if (input.kind === "ingest") {
      const topic = resolveTopic(input.skill, ctx.graph);
      if (!topic) {
        return {
          output: { kind: "ingest", result: null, error: `"${input.skill}" is not a skill this platform can assess yet.` },
          handoff: "nothing: unknown skill",
          log: [{ agent: "skill_analyst", action: "ingest_assessment", summary: `Rejected "${input.skill}": not a known skill.`, decided_by: "deterministic", inputs_ref: `assessment (${input.source})`, outputs_ref: "none" }],
        };
      }
      const result: AssessmentResult = { skill_id: topic, score: input.score, source: input.source, ...(input.missing_concepts ? { missing_concepts: input.missing_concepts } : {}) };
      return {
        output: { kind: "ingest", result, error: null },
        handoff: `${topicName(topic, ctx.graph)}: ${input.score}%${input.source === "simulation" ? " (simulation)" : ""}`,
        log: [{ agent: "skill_analyst", action: "ingest_assessment", summary: `Recorded ${input.score}% on ${topicName(topic, ctx.graph)} from ${input.source === "simulation" ? "a simulation" : input.source}.`, decided_by: "deterministic", inputs_ref: `assessment (${input.source})`, outputs_ref: "assessment result" }],
      };
    }

    const interview = await ctx.interview();
    const verified = verifiedFromInterviews(interview, ctx.graph, ctx.roles);
    const byTopic = new Map(input.declared.map((s) => [s.skill_id, { ...s }]));
    for (const [t, p] of verified) byTopic.set(t, { skill_id: t, declared: byTopic.get(t)?.declared ?? false, verified_proficiency: p });
    const states = [...byTopic.values()].sort((a, b) => a.skill_id.localeCompare(b.skill_id));
    const demo = interview?.demonstration === true && interview.skills.length > 0;
    return {
      output: { kind: "verify_existing", states, verified_from_interviews: verified.size, demonstration_ignored: demo },
      handoff: `${states.length} skill state(s), ${verified.size} verified`,
      log: [
        {
          agent: "skill_analyst",
          action: "read_verified_evidence",
          summary: demo
            ? "Interview results exist but were graded by the built-in demo model, so none are counted as verified."
            : verified.size > 0
              ? `Credited ${verified.size} topic(s) with verified proficiency from your interrogation results.`
              : "No verified interrogation results yet; every skill stays at its declared level (capped at 40%).",
          decided_by: "deterministic",
          inputs_ref: "interrogation results",
          outputs_ref: "skill states",
        },
      ],
    };
  },
};
