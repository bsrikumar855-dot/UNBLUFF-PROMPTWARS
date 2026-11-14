import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runEvent, type LearnerState } from "../agents/orchestrator.js";
import { upcomingSteps, type UpcomingStep } from "../agents/curriculumPlanner.js";
import type { RoleRank } from "../agents/careerMatcher.js";
import { verifiedFromInterviews } from "../agents/skillAnalyst.js";
import type { AgentContext, AgentLogEntry, LearnerProfile, MentorFacts, MentorNote } from "../agents/types.js";
import { computeGaps, progressSummary, resolveTopic, roleMatch, type CertMapping, type GapAnalysis, type LearningPath, type PathChange, type ProgressSummary, type Resource } from "../core/path.js";
import { ApiError } from "../errors.js";
import type { Logger } from "../logger.js";
import { formatIssues } from "../middleware/validate.js";
import type { InterviewEvidence } from "../placement/evidence.js";
import type { RoleRegistry } from "../services/roles.js";
import type { Role } from "../types.js";
import type { LearningData } from "./data.js";
import type { LearningPathRecord, LearningPathStore } from "./store.js";

export const MAX_PATHS_PER_STUDENT = 20;

const text = (max: number) => z.string().trim().min(1).max(max);
export const CreateBody = z.strictObject({
  role_id: z.string().regex(/^[a-z0-9_]+$/).max(60),
  skills: z.array(text(60)).max(30).default([]),
  certifications: z.array(text(100)).max(20).default([]),
  projects: z.array(z.strictObject({ name: text(80), description: z.string().trim().max(300).default(""), skills: z.array(text(60)).max(20).default([]) })).max(10).default([]),
  career_interests: z.array(text(60)).max(10).default([]),
});
export const AssessmentBody = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("simulation"), skill: text(60), score: z.number().int().min(0).max(100), missing_concepts: z.array(text(80)).max(5).optional() }),
  z.strictObject({ source: z.literal("interrogation"), skill: text(60) }),
]);
export const GoalBody = z.strictObject({ role_id: z.string().regex(/^[a-z0-9_]+$/).max(60) });

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new ApiError("BAD_REQUEST", formatIssues(r.error));
  return r.data;
}

export interface LearningPathView {
  id: string;
  role: { id: string; name: string };
  created_at: string;
  updated_at: string;
  profile: LearnerProfile;
  unrecognized_skills: string[];
  /** Per certification entered: the topics it counts for (as declared skills, never verified). Empty `topics` means no skills mapped. */
  certification_skills: CertMapping[];
  career_match: { role_id: string; percent: number; alternatives: RoleRank[] };
  analysis: GapAnalysis;
  path: LearningPath;
  upcoming: UpcomingStep[];
  progress: ProgressSummary;
  mentor: MentorNote;
  /** The most recent change to the roadmap (the initial build, an assessment or a goal change), with its reasons. */
  last_change: PathChange;
  /** Only the resources the roadmap refers to. */
  resources: Record<string, Resource>;
  topic_names: Record<string, string>;
  agent_log: AgentLogEntry[];
  /** True when every result so far came from a simulation or declared skills only; the UI labels simulations. */
  has_simulation: boolean;
}

export interface LearningPathSummary {
  id: string;
  role: { id: string; name: string };
  updated_at: string;
  percent_complete: number;
}

export interface LearningPathDeps {
  store: LearningPathStore;
  roles: RoleRegistry;
  data: LearningData;
  logger: Logger;
  /** Verified interrogation results for a student (the existing flow). */
  interview?: (uid: string) => Promise<InterviewEvidence | null>;
  /** Phrases the facts with the AI model. Set only when a real model is configured; absent in mock mode. */
  coach?: (uid: string, facts: MentorFacts) => Promise<string | null>;
  now?: () => Date;
}

export class LearningPathService {
  private readonly now: () => Date;
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: LearningPathDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  private ctx(uid: string): AgentContext {
    const { deps } = this;
    return {
      now: this.now(),
      uid,
      roles: deps.roles,
      graph: deps.data.graph,
      resources: deps.data.resources,
      interview: async () => {
        try {
          return (await deps.interview?.(uid)) ?? null;
        } catch (err) {
          deps.logger.warn({ err: (err as Error).message }, "learning path: interrogation results could not be read");
          return null;
        }
      },
      coach: deps.coach ? (facts) => deps.coach!(uid, facts) : null,
    };
  }

  private role(id: string): Role {
    const role = this.deps.roles.get(id);
    if (!role) throw new ApiError("ROLE_NOT_FOUND", `Role ${id} not found`);
    return role;
  }

  private async load(uid: string, id: string): Promise<LearningPathRecord> {
    const rec = await this.deps.store.get(id);
    if (!rec || rec.owner_uid !== uid) throw new ApiError("NOT_FOUND", "Learning path not found");
    return rec;
  }

  /** One write at a time per path, so two quick requests cannot overwrite each other. */
  private serialize<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(id) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.chains.set(id, next);
    void next.finally(() => {
      if (this.chains.get(id) === next) this.chains.delete(id);
    }).catch(() => undefined);
    return next;
  }

  view(rec: LearningPathRecord): LearningPathView {
    const { graph, resources } = this.deps.data;
    const role = this.role(rec.role_id);
    const ranking = this.deps.roles
      .list()
      .map((s) => ({ role_id: s.id, name: s.name, match_percent: roleMatch(this.deps.roles.get(s.id)!, rec.path.states, graph) }))
      .sort((a, b) => b.match_percent - a.match_percent || a.role_id.localeCompare(b.role_id));
    const used = new Set(rec.path.steps.flatMap((s) => s.resource_ids));
    return {
      id: rec.id,
      role: { id: role.id, name: role.name },
      created_at: rec.created_at,
      updated_at: rec.updated_at,
      profile: rec.profile,
      unrecognized_skills: rec.unrecognized_skills,
      certification_skills: rec.certification_skills ?? rec.profile.certifications.map((cert) => ({ cert, topics: [] })),
      career_match: { role_id: role.id, percent: ranking.find((r) => r.role_id === role.id)!.match_percent, alternatives: ranking.filter((r) => r.role_id !== role.id).slice(0, 3) },
      analysis: computeGaps(role, rec.path.states, graph),
      path: rec.path,
      upcoming: upcomingSteps(rec.path, graph, resources),
      progress: progressSummary(rec.path, rec.path.states, role, graph),
      mentor: rec.mentor,
      last_change: rec.path.history[rec.path.history.length - 1]!,
      resources: Object.fromEntries(resources.filter((r) => used.has(r.id)).map((r) => [r.id, r])),
      topic_names: graph.topic_names,
      agent_log: rec.agent_log,
      has_simulation: rec.agent_log.some((e) => e.action === "ingest_assessment" && e.summary.includes("a simulation")),
    };
  }

  async create(uid: string, raw: unknown): Promise<LearningPathView> {
    const body = parse(CreateBody, raw);
    const role = this.role(body.role_id);
    const owned = await this.deps.store.listByOwner(uid);
    if (owned.length >= MAX_PATHS_PER_STUDENT) throw new ApiError("BAD_REQUEST", `You have ${owned.length} learning paths, the most you can keep. Start from an existing one.`);
    const profile: LearnerProfile = { skills: body.skills, certifications: body.certifications, projects: body.projects, career_interests: body.career_interests };
    const out = await runEvent({ type: "PROFILE_SUBMITTED", profile, role }, { profile, role, path: null, states: [] }, this.ctx(uid), 1);
    const now = this.now().toISOString();
    const rec: LearningPathRecord = { id: `lp_${randomUUID()}`, owner_uid: uid, role_id: role.id, profile, path: out.path, agent_log: out.log, mentor: out.mentor, unrecognized_skills: out.unrecognized, certification_skills: out.certification_skills, created_at: now, updated_at: now };
    await this.deps.store.put(rec);
    this.deps.logger.info({ event: "learning_path.created" }, "learning path created");
    return this.view(rec);
  }

  async list(uid: string): Promise<{ paths: LearningPathSummary[] }> {
    const owned = (await this.deps.store.listByOwner(uid)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return {
      paths: owned.map((r) => {
        const role = this.role(r.role_id);
        return { id: r.id, role: { id: role.id, name: role.name }, updated_at: r.updated_at, percent_complete: progressSummary(r.path, r.path.states, role, this.deps.data.graph).percent_complete };
      }),
    };
  }

  async get(uid: string, id: string): Promise<LearningPathView> {
    return this.view(await this.load(uid, id));
  }

  async agentLog(uid: string, id: string): Promise<{ entries: AgentLogEntry[] }> {
    return { entries: (await this.load(uid, id)).agent_log };
  }

  async assess(uid: string, id: string, raw: unknown): Promise<LearningPathView> {
    const body = parse(AssessmentBody, raw);
    return this.serialize(id, async () => {
      const rec = await this.load(uid, id);
      let score: number;
      if (body.source === "simulation") {
        score = body.score;
      } else {
        // The score of a real result is read on the server from the student's own graded interrogations; the client cannot supply it.
        const topic = resolveTopic(body.skill, this.deps.data.graph);
        const interview = this.deps.interview ? await this.deps.interview(uid).catch(() => null) : null;
        const verified = topic ? verifiedFromInterviews(interview, this.deps.data.graph, this.deps.roles).get(topic) : undefined;
        if (verified === undefined) throw new ApiError("BAD_REQUEST", `No verified interrogation result for "${body.skill}" yet. Complete an interrogation on that skill first (results graded by the built-in demo model do not count).`);
        score = Math.round(verified * 100);
      }
      const role = this.role(rec.role_id);
      const prior: LearnerState = { profile: rec.profile, role, path: rec.path, states: rec.path.states };
      const out = await runEvent({ type: "ASSESSMENT_SUBMITTED", skill: body.skill, score, source: body.source, ...(body.source === "simulation" && body.missing_concepts ? { missing_concepts: body.missing_concepts } : {}) }, prior, this.ctx(uid), rec.agent_log.length + 1);
      const next: LearningPathRecord = { ...rec, path: out.path, mentor: out.mentor, agent_log: [...rec.agent_log, ...out.log], updated_at: this.now().toISOString() };
      await this.deps.store.put(next);
      return this.view(next);
    });
  }

  async changeGoal(uid: string, id: string, raw: unknown): Promise<LearningPathView> {
    const body = parse(GoalBody, raw);
    const newRole = this.role(body.role_id);
    return this.serialize(id, async () => {
      const rec = await this.load(uid, id);
      const prior: LearnerState = { profile: rec.profile, role: this.role(rec.role_id), path: rec.path, states: rec.path.states };
      const out = await runEvent({ type: "GOAL_CHANGED", role: newRole }, prior, this.ctx(uid), rec.agent_log.length + 1);
      const next: LearningPathRecord = { ...rec, role_id: newRole.id, path: out.path, mentor: out.mentor, agent_log: [...rec.agent_log, ...out.log], updated_at: this.now().toISOString() };
      await this.deps.store.put(next);
      return this.view(next);
    });
  }

  /** Account export. */
  async exportAll(uid: string): Promise<LearningPathRecord[]> {
    return this.deps.store.listByOwner(uid);
  }

  /** Account deletion. Returns how many paths were removed. */
  async deleteAll(uid: string): Promise<number> {
    const owned = await this.deps.store.listByOwner(uid);
    for (const r of owned) await this.deps.store.delete(r.id);
    return owned.length;
  }
}
