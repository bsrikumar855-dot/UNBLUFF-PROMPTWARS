import { ApiError } from "../errors.js";
import { computeGaps, progressSummary, roleMatch, topicName, type CertMapping, type AssessmentSource, type GapAnalysis, type LearnerSkillState, type LearningPath, type PathChange, type ProgressSummary } from "../core/path.js";
import type { Role } from "../types.js";
import { careerMatcherAgent, type RoleRank } from "./careerMatcher.js";
import { curriculumPlannerAgent, type UpcomingStep } from "./curriculumPlanner.js";
import { mentorAgent } from "./mentorAgent.js";
import { profilerAgent } from "./profiler.js";
import { progressEvaluatorAgent } from "./progressEvaluator.js";
import { skillAnalystAgent } from "./skillAnalyst.js";
import type { AgentContext, AgentLogEntry, AgentName, AgentResult, EventType, LearnerProfile, MentorFacts, MentorNote } from "./types.js";

export type LearningEvent =
  | { type: "PROFILE_SUBMITTED"; profile: LearnerProfile; role: Role }
  | { type: "ASSESSMENT_SUBMITTED"; skill: string; score: number; source: AssessmentSource; missing_concepts?: string[] }
  | { type: "GOAL_CHANGED"; role: Role };

export interface RouteStep {
  agent: AgentName;
  /** Run only when the previous agents reported this. Part of the fixed table, not a decision by a model. */
  only_if?: "remedial_added";
}

/**
 * Who handles each event, in order. A fixed table: routing is a pure function of the event type, never chosen by a model.
 */
export const ROUTES: Readonly<Record<EventType, readonly RouteStep[]>> = {
  PROFILE_SUBMITTED: [{ agent: "profiler" }, { agent: "skill_analyst" }, { agent: "career_matcher" }, { agent: "curriculum_planner" }, { agent: "mentor" }],
  ASSESSMENT_SUBMITTED: [{ agent: "skill_analyst" }, { agent: "progress_evaluator" }, { agent: "curriculum_planner", only_if: "remedial_added" }, { agent: "mentor" }],
  GOAL_CHANGED: [{ agent: "profiler" }, { agent: "career_matcher" }, { agent: "curriculum_planner" }, { agent: "mentor" }],
};

export const AGENT_LABEL: Readonly<Record<AgentName, string>> = {
  profiler: "Profiler",
  skill_analyst: "Skill Analyst",
  career_matcher: "Career Matcher",
  curriculum_planner: "Curriculum Planner",
  progress_evaluator: "Progress Evaluator",
  mentor: "Mentor",
};

export function route(type: EventType): readonly RouteStep[] {
  return ROUTES[type];
}

/** What exists before the event. */
export interface LearnerState {
  profile: LearnerProfile;
  role: Role;
  path: LearningPath | null;
  states: LearnerSkillState[];
}

export interface EventOutcome {
  profile: LearnerProfile;
  role: Role;
  path: LearningPath;
  change: PathChange | null;
  mentor: MentorNote;
  match_percent: number;
  ranking: RoleRank[];
  analysis: GapAnalysis;
  progress: ProgressSummary;
  upcoming: UpcomingStep[];
  unrecognized: string[];
  /** Only set by a new profile; a goal change or assessment keeps what was stored. */
  certification_skills: CertMapping[];
  log: AgentLogEntry[];
}

export function buildFacts(event: EventType, role: Role, path: LearningPath, change: PathChange | null, ctx: AgentContext): MentorFacts {
  const gaps = computeGaps(role, path.states, ctx.graph).gaps;
  const progress = progressSummary(path, path.states, role, ctx.graph);
  const upcoming = path.steps.filter((s) => s.status !== "done");
  const next = upcoming.find((s) => s.status === "remedial") ?? upcoming.find((s) => s.status === "active") ?? null;
  const byId = new Map(ctx.resources.map((r) => [r.id, r]));
  const open = path.steps.find((s) => s.status === "remedial");
  return {
    event,
    role_name: role.name,
    match_percent: roleMatch(role, path.states, ctx.graph),
    percent_complete: progress.percent_complete,
    pace: path.pace,
    change_reason: (change ?? path.history[path.history.length - 1]!).reason,
    top_gaps: gaps.flatMap((g) => g.missing_topics.map((t) => t.name)).slice(0, 3),
    next_step: next
      ? { label: next.kind === "remedial" ? `Revisit: ${next.concept}` : topicName(next.skill_id, ctx.graph), resources: next.resource_ids.flatMap((id) => (byId.has(id) ? [{ title: byId.get(id)!.title, url: byId.get(id)!.url }] : [])) }
      : null,
    remedial: open?.concept ?? null,
  };
}

interface Executed {
  agent: AgentName;
  result: AgentResult<unknown>;
}

/**
 * Runs one learning event through its fixed route and returns the new state plus the Agent Activity log, including a
 * handoff line between each pair of agents that ran. `logSeed` continues the id sequence of the stored log.
 */
export async function runEvent(event: LearningEvent, prior: LearnerState, ctx: AgentContext, logSeed: number): Promise<EventOutcome> {
  const executed: Executed[] = [];
  let profile = prior.profile;
  let role = prior.role;
  let states = prior.states;
  let path = prior.path;
  let change: PathChange | null = null;
  let unrecognized: string[] = [];
  let certificationSkills: CertMapping[] = [];
  let ranking: RoleRank[] = [];
  let analysis: GapAnalysis | null = null;
  let upcoming: UpcomingStep[] = [];
  let remedialAdded = false;
  let note: MentorNote | null = null;
  let result: { skill_id: string; score: number; source: AssessmentSource; missing_concepts?: string[] } | null = null;

  if (event.type === "PROFILE_SUBMITTED") {
    profile = event.profile;
    role = event.role;
  } else if (event.type === "GOAL_CHANGED") {
    role = event.role;
  }

  for (const step of route(event.type)) {
    if (step.only_if === "remedial_added" && !remedialAdded) continue;
    switch (step.agent) {
      case "profiler": {
        const r = await profilerAgent.run({ profile }, ctx);
        // A goal change reuses the learner's existing states (what they know carries over); only a new profile resets them.
        if (event.type === "PROFILE_SUBMITTED") {
          states = r.output.states;
          unrecognized = r.output.unrecognized;
          certificationSkills = r.output.certification_skills;
        }
        executed.push({ agent: "profiler", result: event.type === "GOAL_CHANGED" ? { ...r, log: [{ ...r.log[0]!, action: "reuse_profile", summary: `Reused the learner's ${states.length} known skill state(s) for the new goal; nothing was re-entered.` }], handoff: `${states.length} skill state(s) carried over` } : r });
        break;
      }
      case "skill_analyst": {
        if (event.type === "ASSESSMENT_SUBMITTED") {
          const r = await skillAnalystAgent.run({ kind: "ingest", skill: event.skill, score: event.score, source: event.source, missing_concepts: event.missing_concepts }, ctx);
          if (r.output.kind === "ingest") {
            if (!r.output.result) throw new ApiError("BAD_REQUEST", r.output.error ?? "Unknown skill");
            result = r.output.result;
          }
          executed.push({ agent: "skill_analyst", result: r });
        } else {
          const r = await skillAnalystAgent.run({ kind: "verify_existing", declared: states }, ctx);
          if (r.output.kind === "verify_existing") states = r.output.states;
          executed.push({ agent: "skill_analyst", result: r });
        }
        break;
      }
      case "career_matcher": {
        const r = await careerMatcherAgent.run({ role, states }, ctx);
        ranking = r.output.ranking;
        analysis = r.output.analysis;
        executed.push({ agent: "career_matcher", result: r });
        break;
      }
      case "curriculum_planner": {
        if (event.type === "PROFILE_SUBMITTED") {
          const r = await curriculumPlannerAgent.run({ kind: "build", role, states }, ctx);
          path = r.output.path;
          upcoming = r.output.upcoming;
          executed.push({ agent: "curriculum_planner", result: r });
        } else if (event.type === "GOAL_CHANGED") {
          if (!path) throw new ApiError("BAD_REQUEST", "There is no roadmap to change yet.");
          const r = await curriculumPlannerAgent.run({ kind: "goal_change", path: { ...path, states }, role }, ctx);
          path = r.output.path;
          change = r.output.change;
          upcoming = r.output.upcoming;
          states = path.states;
          executed.push({ agent: "curriculum_planner", result: r });
        } else {
          const r = await curriculumPlannerAgent.run({ kind: "review", path: path! }, ctx);
          upcoming = r.output.upcoming;
          executed.push({ agent: "curriculum_planner", result: r });
        }
        break;
      }
      case "progress_evaluator": {
        if (!path || !result) throw new ApiError("BAD_REQUEST", "There is no roadmap to assess against yet.");
        let r;
        try {
          r = await progressEvaluatorAgent.run({ path, result, role }, ctx);
        } catch (err) {
          throw new ApiError("BAD_REQUEST", (err as Error).message);
        }
        path = r.output.path;
        change = r.output.change;
        states = path.states;
        remedialAdded = r.output.remedial_added;
        executed.push({ agent: "progress_evaluator", result: r });
        break;
      }
      case "mentor": {
        const facts = buildFacts(event.type, role, path!, change, ctx);
        const r = await mentorAgent.run({ facts, now: ctx.now }, ctx);
        note = r.output.note;
        executed.push({ agent: "mentor", result: r });
        break;
      }
    }
  }

  const finalPath = path!;
  const finalAnalysis = analysis ?? computeGaps(role, finalPath.states, ctx.graph);
  const log: AgentLogEntry[] = [];
  let n = logSeed;
  const at = ctx.now.toISOString();
  executed.forEach((e, i) => {
    for (const d of e.result.log) log.push({ id: `log-${n++}`, at, kind: "action", to: null, ...d });
    const next = executed[i + 1];
    if (next) {
      log.push({ id: `log-${n++}`, at, kind: "handoff", agent: e.agent, to: next.agent, action: "handoff", summary: `${AGENT_LABEL[e.agent]} → ${AGENT_LABEL[next.agent]}: ${e.result.handoff}`, decided_by: "deterministic", inputs_ref: e.agent, outputs_ref: next.agent });
    }
  });

  return {
    profile,
    role,
    path: finalPath,
    change,
    mentor: note!,
    match_percent: roleMatch(role, finalPath.states, ctx.graph),
    ranking: ranking.length > 0 ? ranking : rankRoles(finalPath.states, ctx),
    analysis: finalAnalysis,
    progress: progressSummary(finalPath, finalPath.states, role, ctx.graph),
    upcoming: upcoming.length > 0 ? upcoming : finalPath.steps.filter((s) => s.status !== "done").slice(0, 4).map((s) => ({ step_id: s.id, label: s.kind === "remedial" ? `Revisit: ${s.concept}` : topicName(s.skill_id, ctx.graph), status: s.status, resources: [] })),
    unrecognized,
    certification_skills: certificationSkills,
    log,
  };
}

function rankRoles(states: readonly LearnerSkillState[], ctx: AgentContext): RoleRank[] {
  return ctx.roles
    .list()
    .map((s) => ({ role_id: s.id, name: s.name, match_percent: roleMatch(ctx.roles.get(s.id)!, states, ctx.graph) }))
    .sort((a, b) => b.match_percent - a.match_percent || a.role_id.localeCompare(b.role_id));
}
