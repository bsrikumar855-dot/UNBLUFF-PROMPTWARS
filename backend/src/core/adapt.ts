import type { Role } from "../types.js";
import {
  DECLARED_MASTERY,
  assertKnownTopic,
  buildPath,
  normalizeSteps,
  normalizeStates,
  selectResources,
  topicName,
  topicsOf,
  type AssessmentResult,
  type ChangeItem,
  type LearnerSkillState,
  type LearningGraph,
  type LearningPath,
  type PathChange,
  type PathStep,
  type Resource,
  type StatusChange,
} from "./path.js";

/** Below this score the learner gets a remedial step; from STRONG_SCORE a step is cleanly done; in between it is done with a review flag. */
export const PASS_SCORE = 60;
export const STRONG_SCORE = 85;

const FALLBACK_CONCEPT = "Revisit the fundamentals";

/** Topics that (directly or through other topics) have `topic` as a prerequisite. */
function dependentTopics(topic: string, graph: LearningGraph): Set<string> {
  const out = new Set<string>();
  const queue = [topic];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const [t, pre] of Object.entries(graph.prerequisites)) {
      if (pre.includes(cur) && !out.has(t) && t !== topic) {
        out.add(t);
        queue.push(t);
      }
    }
  }
  return out;
}

function diffStatuses(before: readonly PathStep[], after: readonly PathStep[], graph: LearningGraph): StatusChange[] {
  const was = new Map(before.map((s) => [s.id, s.status]));
  return after
    .filter((s) => was.get(s.id) !== s.status)
    .map((s) => ({ step_id: s.id, label: s.kind === "remedial" ? `Revisit: ${s.concept}` : topicName(s.skill_id, graph), from: was.get(s.id) ?? null, to: s.status }));
}

function remedialConcept(role: Role, topic: string, graph: LearningGraph, previous: number, missing: readonly string[] | undefined): string {
  const skill = role.skills.find((s) => topicsOf(s, graph).some((t) => t.topic === topic));
  if (!skill) return `${FALLBACK_CONCEPT} of ${topicName(topic, graph)}`;
  const named = missing?.find((c) => skill.prerequisites.includes(c));
  return named ?? skill.prerequisites[previous % skill.prerequisites.length]!;
}

function upsertState(states: readonly LearnerSkillState[], topic: string, score: number): LearnerSkillState[] {
  const next = states.filter((s) => s.skill_id !== topic).map((s) => ({ ...s }));
  next.push({ skill_id: topic, declared: states.find((s) => s.skill_id === topic)?.declared ?? false, verified_proficiency: score / 100 });
  return next.sort((a, b) => a.skill_id.localeCompare(b.skill_id));
}

/**
 * Applies one graded result to a path. Below 60: a remedial step on the missing prerequisite is inserted and the failed
 * step and everything that depends on it wait for it. 60-84: done, flagged to review later. 85 and up: done, and the
 * next unblocked step becomes active. A pass also closes an open remedial step for that topic. Pure: `now` is passed in.
 */
export function adaptOnAssessment(
  path: LearningPath,
  result: AssessmentResult,
  role: Role,
  resources: readonly Resource[],
  graph: LearningGraph,
  now: Date,
): { path: LearningPath; change: PathChange } {
  assertKnownTopic(result.skill_id, graph);
  if (!Number.isFinite(result.score) || result.score < 0 || result.score > 100) throw new Error("score must be between 0 and 100");
  const topic = result.skill_id;
  const label = topicName(topic, graph);
  const before = path.steps.map((s) => ({ ...s, blocked_by: [...s.blocked_by] }));
  let steps = before.map((s) => ({ ...s, blocked_by: [...s.blocked_by] }));
  const states = upsertState(path.states, topic, result.score);
  const target = steps.find((s) => s.kind === "core" && s.skill_id === topic);
  const openRemedial = steps.find((s) => s.kind === "remedial" && s.skill_id === topic && s.status !== "done");
  const added: ChangeItem[] = [];
  let pace = path.pace;
  let reason: string;

  if (result.score < PASS_SCORE) {
    pace = "slow";
    if (openRemedial) {
      reason = `Scored ${result.score}% on ${label}, still below ${PASS_SCORE}%. The open remedial step on "${openRemedial.concept}" stays in front.`;
    } else {
      const previous = steps.filter((s) => s.kind === "remedial" && s.skill_id === topic).length;
      const concept = remedialConcept(role, topic, graph, previous, result.missing_concepts);
      const remedial: PathStep = {
        id: `remedial-${topic}-${previous + 1}`,
        skill_id: topic,
        role_skill_id: target?.role_skill_id ?? null,
        kind: "remedial",
        resource_ids: selectResources(topic, resources, true),
        status: "remedial",
        order: (target?.order ?? Math.max(0, ...steps.map((s) => s.order)) + 1) - 0.5,
        reason: `Scored ${result.score}% on ${label}: revisit "${concept}" before going on`,
        gap: 0,
        blocked_by: [],
        review_later: false,
        concept,
      };
      const dependents = dependentTopics(topic, graph);
      steps = steps.map((s) => (s.kind === "core" && s.status !== "done" && (s.skill_id === topic || dependents.has(s.skill_id)) ? { ...s, blocked_by: [...s.blocked_by, remedial.id] } : s));
      steps.push(remedial);
      const paused = steps.filter((s) => s.blocked_by.includes(remedial.id)).map((s) => topicName(s.skill_id, graph));
      added.push({ skill_id: topic, label: `Revisit: ${concept}`, reason: remedial.reason });
      reason = `Scored ${result.score}% on ${label} (below ${PASS_SCORE}%). Added a remedial step on "${concept}"${paused.length > 0 ? ` and paused ${paused.length} step(s) until it is done: ${paused.join(", ")}` : ""}. Pace set to slow.`;
    }
  } else {
    steps = steps.map((s) => {
      if (s.skill_id !== topic || s.status === "done") return s;
      if (s.kind === "remedial") return { ...s, status: "done" as const };
      return { ...s, status: "done" as const, review_later: result.score < STRONG_SCORE };
    });
    const closed = openRemedial ? ` and closed the remedial step on "${openRemedial.concept}"` : "";
    reason =
      result.score >= STRONG_SCORE
        ? `Scored ${result.score}% on ${label}: marked done${closed}.`
        : `Scored ${result.score}% on ${label}: marked done${closed}, flagged to review later (below ${STRONG_SCORE}%).`;
    if (result.score >= STRONG_SCORE && !steps.some((s) => s.kind === "remedial" && s.status !== "done")) pace = "normal";
  }

  const normalized = normalizeSteps(steps);
  const advanced = result.score >= PASS_SCORE ? normalized.find((s) => s.status === "active") : undefined;
  const status_changes = diffStatuses(before, normalized, graph);
  const unblocked = status_changes.filter((c) => c.from === "blocked" && c.to !== "blocked" && c.to !== "done").map((c) => c.label);
  if (unblocked.length > 0) reason += ` Unblocked: ${unblocked.join(", ")}.`;
  if (advanced && status_changes.some((c) => c.step_id === advanced.id)) reason += ` Next up: ${topicName(advanced.skill_id, graph)}.`;
  const change: PathChange = { at: now.toISOString(), kind: "assessment", reason, added, removed: [], reordered: [], kept: [], status_changes };
  return {
    path: { ...path, steps: normalized, states, pace, version: path.version + 1, created_from: "assessment", history: [...path.history, change] },
    change,
  };
}

/**
 * Rebuilds the path for a new role. What the learner already knows carries over (states are keyed by topic), and done
 * steps for topics the new role also needs stay done. Returns the diff: kept, added, removed and reordered, each with a reason.
 */
export function adaptOnGoalChange(
  path: LearningPath,
  newRole: Role,
  resources: readonly Resource[],
  graph: LearningGraph,
  now: Date,
): { path: LearningPath; change: PathChange } {
  const states = normalizeStates(path.states, graph);
  const fresh = buildPath(newRole, states, resources, graph, now);
  const roleTopics = new Set(newRole.skills.flatMap((s) => topicsOf(s, graph).map((t) => t.topic)));
  const freshTopics = new Set(fresh.steps.map((s) => s.skill_id));
  const oldOpen = path.steps.filter((s) => s.kind === "core" && s.status !== "done");
  const oldDone = path.steps.filter((s) => s.kind === "core" && s.status === "done");

  // Carry over done steps for topics the new role also needs.
  const carried = oldDone.filter((s) => roleTopics.has(s.skill_id) && !freshTopics.has(s.skill_id));
  const merged = normalizeSteps([...fresh.steps.map((s) => ({ ...s })), ...carried.map((s, i) => ({ ...s, blocked_by: [], order: -carried.length + i }))]);

  const label = (t: string): string => topicName(t, graph);
  const kept: ChangeItem[] = [];
  for (const s of states) {
    if (roleTopics.has(s.skill_id) && !freshTopics.has(s.skill_id) && (s.verified_proficiency !== null || s.declared)) {
      const verified = s.verified_proficiency !== null;
      kept.push({ skill_id: s.skill_id, label: label(s.skill_id), reason: `${label(s.skill_id)} already ${verified ? "verified" : `declared (counts as ${Math.round(DECLARED_MASTERY * 100)}% until verified)`}; it counts towards ${newRole.name}` });
    }
  }
  const oldTopics = new Set(oldOpen.map((s) => s.skill_id));
  for (const s of fresh.steps) {
    if (oldTopics.has(s.skill_id)) kept.push({ skill_id: s.skill_id, label: label(s.skill_id), reason: `${label(s.skill_id)} is still required by ${newRole.name}` });
  }
  const removed: ChangeItem[] = oldOpen
    .filter((s) => !freshTopics.has(s.skill_id))
    .map((s) => ({ skill_id: s.skill_id, label: label(s.skill_id), reason: roleTopics.has(s.skill_id) ? `${label(s.skill_id)} no longer needs a step: it is already covered for ${newRole.name}` : `${label(s.skill_id)} is not required by ${newRole.name}` }));
  const added: ChangeItem[] = fresh.steps.filter((s) => !oldTopics.has(s.skill_id)).map((s) => ({ skill_id: s.skill_id, label: label(s.skill_id), reason: s.reason }));

  const oldRank = new Map(oldOpen.map((s, i) => [s.skill_id, i]));
  const common = fresh.steps.filter((s) => oldTopics.has(s.skill_id));
  const reordered: ChangeItem[] = common
    .map((s, i) => ({ s, from: [...common].sort((a, b) => oldRank.get(a.skill_id)! - oldRank.get(b.skill_id)!).findIndex((c) => c.skill_id === s.skill_id), to: i }))
    .filter((x) => x.from !== x.to)
    .map((x) => ({ skill_id: x.s.skill_id, label: label(x.s.skill_id), reason: `${label(x.s.skill_id)} moved from position ${x.from + 1} to ${x.to + 1} among the steps kept` }));

  const reason = `Switched goal to ${newRole.name}: kept ${kept.length}, added ${added.length}, removed ${removed.length}, reordered ${reordered.length}.`;
  const change: PathChange = { at: now.toISOString(), kind: "goal_change", reason, added, removed, reordered, kept, status_changes: [] };
  return {
    path: { role_id: newRole.id, steps: merged, version: path.version + 1, created_from: "goal_change", history: [...path.history, change], states, pace: path.pace },
    change,
  };
}
