import type { Role, RoleSkill } from "../types.js";
import type {
  GapAnalysis,
  GapRow,
  LearnerSkillState,
  LearningGraph,
  LearningPath,
  PathChange,
  PathStep,
  ProgressSummary,
  Resource,
  TopicShare,
} from "./pathTypes.js";

export type * from "./pathTypes.js";
export { skillsFromCertifications } from "./certs.js";

/** A role skill with at least this much gap (weight x unmastered share) gets steps. */
export const GAP_THRESHOLD = 0.1;
/** A declared-but-unverified topic never counts for more than this. */
export const DECLARED_MASTERY = 0.4;
export const MAX_RESOURCES_PER_STEP = 3;
const EPS = 1e-9;

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Verified proficiency when present; otherwise declared counts as 0.4 and nothing as 0. Unverified claims never exceed 0.4. */
export function effectiveMastery(state: LearnerSkillState): number {
  if (state.verified_proficiency !== null) return Math.min(1, Math.max(0, state.verified_proficiency));
  return state.declared ? DECLARED_MASTERY : 0;
}

export function assertKnownTopic(topic: string, graph: LearningGraph): void {
  if (!Object.prototype.hasOwnProperty.call(graph.topic_names, topic)) throw new Error(`Unknown skill id: ${topic}`);
}

/** Validates states (known topics, 0..1 proficiency, no duplicates) and returns a sorted copy. */
export function normalizeStates(states: readonly LearnerSkillState[], graph: LearningGraph): LearnerSkillState[] {
  const seen = new Set<string>();
  for (const s of states) {
    assertKnownTopic(s.skill_id, graph);
    if (seen.has(s.skill_id)) throw new Error(`Duplicate skill state: ${s.skill_id}`);
    seen.add(s.skill_id);
    if (s.verified_proficiency !== null && !(s.verified_proficiency >= 0 && s.verified_proficiency <= 1)) {
      throw new Error(`verified_proficiency out of range for ${s.skill_id}`);
    }
  }
  return states.map((s) => ({ ...s })).sort((a, b) => a.skill_id.localeCompare(b.skill_id));
}

export function topicsOf(skill: RoleSkill, graph: LearningGraph): TopicShare[] {
  return graph.skill_topics[skill.id] ?? [{ topic: skill.id, share: 1 }];
}

export function topicName(topic: string, graph: LearningGraph): string {
  return graph.topic_names[topic] ?? topic;
}

const normalizeName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9.+#\s]/g, " ").replace(/\s+/g, " ").trim();

/** Maps a free-text skill ("JS", "Node.js", "PostgreSQL") to a known topic id, or null. Exact id, alias or display-name match only. */
export function resolveTopic(text: string, graph: LearningGraph): string | null {
  const key = normalizeName(text);
  if (key === "") return null;
  const alias = graph.aliases && Object.prototype.hasOwnProperty.call(graph.aliases, key) ? graph.aliases[key] : undefined;
  if (alias !== undefined) return alias;
  const id = key.replace(/ /g, "_");
  if (Object.prototype.hasOwnProperty.call(graph.topic_names, id)) return id;
  return Object.entries(graph.topic_names).find(([, name]) => normalizeName(name) === key)?.[0] ?? null;
}

function masteryMap(states: readonly LearnerSkillState[]): Map<string, number> {
  return new Map(states.map((s) => [s.skill_id, effectiveMastery(s)]));
}

function skillMastery(skill: RoleSkill, m: Map<string, number>, graph: LearningGraph): number {
  return topicsOf(skill, graph).reduce((acc, t) => acc + t.share * (m.get(t.topic) ?? 0), 0);
}

/** Per required skill: gap = weight x (1 - mastery). Sorted by gap desc, ties by skill id. Strengths are skills under the threshold. */
export function computeGaps(role: Role, states: readonly LearnerSkillState[], graph: LearningGraph, threshold: number = GAP_THRESHOLD): GapAnalysis {
  const clean = normalizeStates(states, graph);
  const m = masteryMap(clean);
  const byTopic = new Map(clean.map((s) => [s.skill_id, s]));
  const rows: GapRow[] = role.skills.map((skill) => {
    const topics = topicsOf(skill, graph);
    const mastery = skillMastery(skill, m, graph);
    const present = topics.filter((t) => (m.get(t.topic) ?? 0) > 0);
    return {
      skill_id: skill.id,
      name: skill.name,
      weight: skill.weight,
      mastery: round3(mastery),
      gap: round3(skill.weight * (1 - mastery)),
      missing_topics: topics
        .filter((t) => (m.get(t.topic) ?? 0) < DECLARED_MASTERY - EPS)
        .sort((a, b) => b.share - a.share || a.topic.localeCompare(b.topic))
        .map((t) => ({ topic: t.topic, name: topicName(t.topic, graph), mastery: round3(m.get(t.topic) ?? 0) })),
      unverified: present.length > 0 && present.every((t) => byTopic.get(t.topic)?.verified_proficiency === null),
    };
  });
  const gaps = rows.filter((r) => r.gap > EPS).sort((a, b) => b.gap - a.gap || a.skill_id.localeCompare(b.skill_id));
  const strengths = rows.filter((r) => r.gap < threshold - EPS).sort((a, b) => b.mastery - a.mastery || a.skill_id.localeCompare(b.skill_id));
  return { gaps, strengths };
}

/** One tutorial/course and one exercise first, then fill by id, at most 3. Beginner material first when `beginnerFirst`. */
export function selectResources(topic: string, resources: readonly Resource[], beginnerFirst = false): string[] {
  const rank = { beginner: 0, intermediate: 1, advanced: 2 } as const;
  const pool = resources
    .filter((r) => r.skill_id === topic)
    .sort((a, b) => (beginnerFirst ? rank[a.level] - rank[b.level] : 0) || a.id.localeCompare(b.id));
  const learn = pool.find((r) => r.type !== "exercise");
  const practise = pool.find((r) => r.type === "exercise");
  const chosen = [learn, practise].filter((r): r is Resource => r !== undefined);
  for (const r of pool) if (chosen.length < MAX_RESOURCES_PER_STEP && !chosen.includes(r)) chosen.push(r);
  return chosen.map((r) => r.id);
}

/** Orders steps so a topic follows its prerequisites; ties by gap desc, then topic id. Cyclic leftovers are appended by the same tie rule. */
export function orderTopologically(steps: readonly PathStep[], graph: LearningGraph): PathStep[] {
  const topics = new Set(steps.map((s) => s.skill_id));
  const waiting = new Map(steps.map((s) => [s.id, new Set((graph.prerequisites[s.skill_id] ?? []).filter((p) => topics.has(p) && p !== s.skill_id))]));
  const cmp = (a: PathStep, b: PathStep): number => b.gap - a.gap || a.skill_id.localeCompare(b.skill_id) || a.id.localeCompare(b.id);
  const out: PathStep[] = [];
  const left = new Set(steps.map((s) => s.id));
  while (left.size > 0) {
    const ready = steps.filter((s) => left.has(s.id) && waiting.get(s.id)!.size === 0).sort(cmp);
    const next = ready[0] ?? steps.filter((s) => left.has(s.id)).sort(cmp)[0]!;
    out.push(next);
    left.delete(next.id);
    for (const [id, w] of waiting) if (left.has(id)) w.delete(next.skill_id);
  }
  return out;
}

function stepReason(skill: RoleSkill, role: Role, topic: string, mastery: number, graph: LearningGraph): string {
  const what = topicName(topic, graph);
  const need = `${what} is required by ${role.name} (${pct(skill.weight)} of the role)`;
  if (mastery <= EPS) return `${need}, never practiced`;
  return `${need}, only ${pct(mastery)} shown so far`;
}

/** Renumbers orders 1..n and recomputes blocked / remedial / active from the blockers. Does not reorder. */
export function normalizeSteps(steps: readonly PathStep[]): PathStep[] {
  const sorted = steps.map((s) => ({ ...s, blocked_by: [...s.blocked_by] })).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const doneIds = new Set(sorted.filter((s) => s.status === "done").map((s) => s.id));
  let activeTaken = false;
  return sorted.map((s, i) => {
    const step = { ...s, order: i + 1, blocked_by: s.blocked_by.filter((id) => !doneIds.has(id)) };
    if (step.status === "done") return step;
    if (step.blocked_by.length > 0) return { ...step, status: "blocked" as const };
    if (step.kind === "remedial") return { ...step, status: "remedial" as const };
    if (!activeTaken) {
      activeTaken = true;
      return { ...step, status: "active" as const };
    }
    return { ...step, status: "pending" as const };
  });
}

/** The initial path: steps only for role skills with gap >= threshold, one per missing topic, in prerequisite order. Deterministic. */
export function buildPath(
  role: Role,
  states: readonly LearnerSkillState[],
  resources: readonly Resource[],
  graph: LearningGraph,
  now: Date,
  threshold: number = GAP_THRESHOLD,
): LearningPath {
  const clean = normalizeStates(states, graph);
  const m = masteryMap(clean);
  const seen = new Set<string>();
  const raw: PathStep[] = [];
  for (const skill of role.skills) {
    const skillGap = skill.weight * (1 - skillMastery(skill, m, graph));
    if (skillGap < threshold - EPS) continue;
    for (const t of topicsOf(skill, graph)) {
      const mastery = m.get(t.topic) ?? 0;
      if (mastery >= DECLARED_MASTERY - EPS || seen.has(t.topic)) continue;
      seen.add(t.topic);
      raw.push({
        id: `step-${t.topic}`,
        skill_id: t.topic,
        role_skill_id: skill.id,
        kind: "core",
        resource_ids: selectResources(t.topic, resources),
        status: "pending",
        order: 0,
        reason: stepReason(skill, role, t.topic, mastery, graph),
        gap: round3(skill.weight * t.share * (1 - mastery)),
        blocked_by: [],
        review_later: false,
        concept: null,
      });
    }
  }
  const steps = normalizeSteps(orderTopologically(raw, graph).map((s, i) => ({ ...s, order: i + 1 })));
  const change: PathChange = {
    at: now.toISOString(),
    kind: "initial",
    reason: steps.length === 0 ? `No gaps found for ${role.name}: every required skill is at or above the bar.` : `Built a ${steps.length}-step path for ${role.name} from ${steps.length} missing topic(s), in prerequisite order.`,
    added: steps.map((s) => ({ skill_id: s.skill_id, label: topicName(s.skill_id, graph), reason: s.reason })),
    removed: [],
    reordered: [],
    kept: [],
    status_changes: [],
  };
  return { role_id: role.id, steps, version: 1, created_from: "initial", history: [change], states: clean, pace: "normal" };
}

/** Percent complete weighted by step gap, per-skill mastery bars, and the next best step. */
export function progressSummary(path: LearningPath, states: readonly LearnerSkillState[], role: Role, graph: LearningGraph): ProgressSummary {
  const clean = normalizeStates(states, graph);
  const m = masteryMap(clean);
  const byTopic = new Map(clean.map((s) => [s.skill_id, s]));
  const core = path.steps.filter((s) => s.kind === "core");
  const total = core.reduce((a, s) => a + s.gap, 0);
  const done = core.filter((s) => s.status === "done").reduce((a, s) => a + s.gap, 0);
  const next = path.steps.find((s) => s.status === "remedial") ?? path.steps.find((s) => s.status === "active") ?? null;
  return {
    percent_complete: total <= EPS ? 100 : Math.round((100 * done) / total),
    skill_bars: role.skills.map((skill) => {
      const present = topicsOf(skill, graph).filter((t) => (m.get(t.topic) ?? 0) > 0);
      return {
        skill_id: skill.id,
        name: skill.name,
        weight: skill.weight,
        mastery: round3(skillMastery(skill, m, graph)),
        unverified: present.length > 0 && present.every((t) => byTopic.get(t.topic)?.verified_proficiency === null),
      };
    }),
    next_step: next,
  };
}

/** Role-match percentage from effective mastery: 100 x sum(weight x mastery). Used by the career matcher. */
export function roleMatch(role: Role, states: readonly LearnerSkillState[], graph: LearningGraph): number {
  const m = masteryMap(normalizeStates(states, graph));
  return Math.round(100 * role.skills.reduce((acc, s) => acc + s.weight * skillMastery(s, m, graph), 0));
}
