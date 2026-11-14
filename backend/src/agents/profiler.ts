import { skillsFromCertifications } from "../core/certs.js";
import { resolveTopic, topicName, type CertMapping, type LearnerSkillState } from "../core/path.js";
import type { Agent, LearnerProfile } from "./types.js";

export interface ProfilerInput {
  profile: LearnerProfile;
}
export interface ProfilerOutput {
  /** Declared topics only (self-reported, so never verified here). */
  states: LearnerSkillState[];
  /** Names the learner typed that did not match any known topic, so the UI can say so instead of silently dropping them. */
  unrecognized: string[];
  /** What each certification maps to; `topics` is empty for a certification no rule covers. */
  certification_skills: CertMapping[];
}

const clean = (xs: readonly string[]): string[] => [...new Set(xs.map((s) => s.trim()).filter(Boolean))];

/**
 * Normalizes what the learner entered. Skills they list, the skills of their projects and the topics their
 * certifications cover (by curated rules) all count as DECLARED evidence (capped at 40% until verified).
 * A certification no rule matches is kept on the profile and adds no skill.
 */
export const profilerAgent: Agent<ProfilerInput, ProfilerOutput> = {
  name: "profiler",
  async run({ profile }, ctx) {
    const typed = clean([...profile.skills, ...profile.projects.flatMap((p) => p.skills)]);
    const topics = new Set<string>();
    const unrecognized: string[] = [];
    for (const name of typed) {
      const topic = resolveTopic(name, ctx.graph);
      if (topic) topics.add(topic);
      else unrecognized.push(name);
    }
    const certs = skillsFromCertifications(profile.certifications, ctx.graph.certifications ?? []);
    for (const t of certs.topics) topics.add(t);
    const states = [...topics].sort().map((skill_id) => ({ skill_id, declared: true, verified_proficiency: null }));
    const mapped = certs.mappings.filter((m) => m.topics.length > 0);
    const certNote =
      certs.mappings.length === 0
        ? ""
        : mapped.length > 0
          ? `; ${mapped.length} of ${certs.mappings.length} certification(s) mapped to ${[...new Set(mapped.flatMap((m) => m.topics))].map((t) => topicName(t, ctx.graph)).join(", ")}${mapped.length < certs.mappings.length ? ` (${certs.mappings.length - mapped.length} mapped to no skill)` : ""}`
          : `; none of ${certs.mappings.length} certification(s) mapped to a skill`;
    return {
      output: { states, unrecognized, certification_skills: certs.mappings },
      handoff: `${states.length} declared skill(s)`,
      log: [
        {
          agent: "profiler",
          action: "normalize_profile",
          summary: `Matched ${states.length} declared skill(s) from ${typed.length} entered${profile.projects.length > 0 ? ` (including ${profile.projects.length} project(s))` : ""}${certNote}${unrecognized.length > 0 ? `; could not match: ${unrecognized.join(", ")}` : ""}.`,
          decided_by: "deterministic",
          inputs_ref: "learner profile",
          outputs_ref: "declared skill states",
        },
      ],
    };
  },
};
