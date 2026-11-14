import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DECLARED_MASTERY,
  GAP_THRESHOLD,
  assertKnownTopic,
  buildPath,
  computeGaps,
  effectiveMastery,
  normalizeStates,
  normalizeSteps,
  orderTopologically,
  progressSummary,
  roleMatch,
  selectResources,
  topicName,
  type LearnerSkillState,
  type LearningGraph,
  type PathStep,
  type Resource,
} from "../../src/core/path.js";
import { loadLearningData } from "../../src/learning/data.js";
import type { Role } from "../../src/types.js";
import { roles } from "../helpers.js";

const data = loadLearningData(join(import.meta.dirname, "..", "..", "data", "learning"), roles);
const { graph, resources } = data;
const NOW = new Date("2026-11-14T08:00:00.000Z");
const fullstack = roles.get("fullstack_developer")!;
const declared = (id: string): LearnerSkillState => ({ skill_id: id, declared: true, verified_proficiency: null });
const verified = (id: string, p: number): LearnerSkillState => ({ skill_id: id, declared: true, verified_proficiency: p });
const PS_STATES = [declared("python"), declared("sql"), declared("html")];

describe("effectiveMastery", () => {
  it("uses verified proficiency, else 0.4 for declared, else 0", () => {
    expect(effectiveMastery(verified("sql", 0.9))).toBe(0.9);
    expect(effectiveMastery(verified("sql", 0))).toBe(0); // verified beats declared
    expect(effectiveMastery(declared("sql"))).toBe(DECLARED_MASTERY);
    expect(effectiveMastery({ skill_id: "sql", declared: false, verified_proficiency: null })).toBe(0);
  });
  it("clamps to 0..1", () => {
    expect(effectiveMastery(verified("sql", 1.4))).toBe(1);
    expect(effectiveMastery(verified("sql", -0.2))).toBe(0);
  });
});

describe("state validation", () => {
  it("rejects unknown ids, duplicates and out-of-range proficiency", () => {
    expect(() => normalizeStates([declared("cobol")], graph)).toThrow(/Unknown skill id: cobol/);
    expect(() => normalizeStates([declared("sql"), declared("sql")], graph)).toThrow(/Duplicate/);
    expect(() => normalizeStates([verified("sql", 1.2)], graph)).toThrow(/out of range/);
    expect(() => assertKnownTopic("__proto__", graph)).toThrow(/Unknown/);
  });
  it("returns a sorted copy", () => {
    const input = [declared("sql"), declared("python")];
    expect(normalizeStates(input, graph).map((s) => s.skill_id)).toEqual(["python", "sql"]);
    expect(input[0]!.skill_id).toBe("sql");
  });
  it("names unknown topics by their id", () => {
    expect(topicName("javascript", graph)).toBe("JavaScript");
    expect(topicName("nope", graph)).toBe("nope");
  });
});

describe("computeGaps: the problem-statement student (Python, SQL, HTML -> Full Stack)", () => {
  const { gaps, strengths } = computeGaps(fullstack, PS_STATES, graph);
  const missing = gaps.flatMap((g) => g.missing_topics.map((t) => t.name));

  it("finds JavaScript, React and Node.js as gaps (mapped onto Frontend Fundamentals and REST API Design)", () => {
    expect(missing).toEqual(expect.arrayContaining(["JavaScript", "React", "Node.js"]));
    expect(missing).not.toContain("HTML"); // declared, so present
    expect(gaps.find((g) => g.skill_id === "web_frontend")!.missing_topics.map((t) => t.topic)).toEqual(["javascript", "react", "css"]);
  });
  it("marks declared-only skills as unverified and counts them at 40%", () => {
    const sql = gaps.find((g) => g.skill_id === "sql_databases")!;
    expect(sql.mastery).toBe(0.4);
    expect(sql.unverified).toBe(true);
    expect(sql.gap).toBe(0.12);
    expect(gaps.find((g) => g.skill_id === "rest_apis")!.unverified).toBe(false);
  });
  it("sorts by gap desc then skill id, and has no strengths yet", () => {
    for (let i = 1; i < gaps.length; i++) {
      const a = gaps[i - 1]!;
      const b = gaps[i]!;
      expect(a.gap > b.gap || (a.gap === b.gap && a.skill_id < b.skill_id)).toBe(true);
    }
    expect(strengths).toEqual([]);
  });
});

describe("computeGaps: verified learners", () => {
  it("lists fully verified skills as strengths and no gaps", () => {
    const all = fullstack.skills.flatMap((s) => (graph.skill_topics[s.id] ?? [{ topic: s.id }]).map((t) => verified(t.topic, 1)));
    const r = computeGaps(fullstack, all, graph);
    expect(r.gaps).toEqual([]);
    expect(r.strengths).toHaveLength(fullstack.skills.length);
  });
  it("sorts strengths by mastery then id", () => {
    const r = computeGaps(fullstack, [verified("git", 1), verified("testing", 1)], graph);
    expect(r.strengths.map((s) => s.skill_id)).toEqual(["git", "testing"]);
  });
});

describe("selectResources", () => {
  const res = (id: string, type: Resource["type"], level: Resource["level"], skill = "t"): Resource => ({ id, skill_id: skill, title: id, url: "https://x.test", type, est_minutes: 10, level });
  const pool = [res("d-ex", "exercise", "advanced"), res("c-tut", "tutorial", "intermediate"), res("a-ex", "exercise", "beginner"), res("b-course", "course", "beginner"), res("e-extra", "tutorial", "advanced"), res("other", "tutorial", "beginner", "u")];
  it("prefers one tutorial/course and one exercise, max 3", () => {
    const ids = selectResources("t", pool);
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe("b-course"); // first non-exercise by id
    expect(ids[1]).toBe("a-ex");
  });
  it("puts beginner material first on request", () => {
    const adv = [res("a-tut", "tutorial", "advanced"), res("z-tut", "tutorial", "beginner")];
    expect(selectResources("t", adv)[0]).toBe("a-tut"); // by id
    expect(selectResources("t", adv, true)[0]).toBe("z-tut"); // beginner first
    expect(selectResources("t", pool, true)).toEqual(["b-course", "a-ex", "c-tut"]);
  });
  it("returns nothing for a topic without resources", () => {
    expect(selectResources("zzz", pool)).toEqual([]);
  });
  it("works when only one kind exists", () => {
    expect(selectResources("t", [res("only", "exercise", "beginner")])).toEqual(["only"]);
  });
});

describe("orderTopologically and normalizeSteps", () => {
  const step = (topic: string, gap: number, over: Partial<PathStep> = {}): PathStep => ({ id: `step-${topic}`, skill_id: topic, role_skill_id: null, kind: "core", resource_ids: [], status: "pending", order: 0, reason: "", gap, blocked_by: [], review_later: false, concept: null, ...over });
  const g = (prerequisites: Record<string, string[]>): LearningGraph => ({ topic_names: {}, skill_topics: {}, prerequisites });

  it("puts prerequisites first, then bigger gaps, then ids", () => {
    const out = orderTopologically([step("b", 0.1), step("a", 0.1), step("c", 0.5), step("d", 0.9)], g({ d: ["c"], c: ["a"] }));
    // a is the only free step; then c (0.5) beats b (0.1); d (0.9) follows c; b comes last.
    expect(out.map((s) => s.skill_id)).toEqual(["a", "c", "d", "b"]);
  });
  it("ignores prerequisites that are not in the path and self-edges", () => {
    const out = orderTopologically([step("a", 0.1), step("b", 0.2)], g({ a: ["zzz", "a"] }));
    expect(out.map((s) => s.skill_id)).toEqual(["b", "a"]);
  });
  it("does not loop forever on a cycle", () => {
    const out = orderTopologically([step("a", 0.2), step("b", 0.1)], g({ a: ["b"], b: ["a"] }));
    expect(out.map((s) => s.skill_id)).toEqual(["a", "b"]);
  });
  it("normalizeSteps numbers steps, makes the first free core step active, blocks and marks remedials", () => {
    const out = normalizeSteps([
      step("c", 0.1, { order: 3 }),
      step("a", 0.1, { order: 1, kind: "remedial", id: "r1" }),
      step("b", 0.1, { order: 2, blocked_by: ["r1"] }),
      step("d", 0.1, { order: 4, blocked_by: ["gone"], status: "done" }),
    ]);
    expect(out.map((s) => [s.id, s.status, s.order])).toEqual([["r1", "remedial", 1], ["step-b", "blocked", 2], ["step-c", "active", 3], ["step-d", "done", 4]]);
    const unblocked = normalizeSteps([step("a", 0.1, { id: "r1", status: "done", order: 1 }), step("b", 0.1, { order: 2, blocked_by: ["r1"] })]);
    expect(unblocked[1]).toMatchObject({ status: "active", blocked_by: [] });
  });
});

describe("buildPath", () => {
  const path = buildPath(fullstack, PS_STATES, resources, graph, NOW);
  const topics = path.steps.map((s) => s.skill_id);

  it("is deterministic", () => {
    expect(buildPath(fullstack, [...PS_STATES].reverse(), resources, graph, NOW)).toEqual(path);
  });
  it("orders steps after their prerequisites", () => {
    const at = (t: string) => topics.indexOf(t);
    expect(at("javascript")).toBeLessThan(at("react"));
    expect(at("javascript")).toBeLessThan(at("nodejs"));
    expect(at("nodejs")).toBeLessThan(at("http_api"));
    expect(at("http_api")).toBeLessThan(at("auth_sessions"));
    expect(at("nodejs")).toBeLessThan(at("deploy_fullstack"));
  });
  it("has steps for the gaps, none for declared topics, and numbers them from 1 with one active step", () => {
    expect(topics).toEqual(expect.arrayContaining(["javascript", "react", "nodejs"]));
    expect(topics).not.toContain("sql");
    expect(topics).not.toContain("html");
    expect(path.steps.map((s) => s.order)).toEqual(path.steps.map((_, i) => i + 1));
    expect(path.steps.filter((s) => s.status === "active")).toHaveLength(1);
  });
  it("attaches at most 3 curated resources per step", () => {
    for (const s of path.steps) {
      expect(s.resource_ids.length).toBeGreaterThan(0);
      expect(s.resource_ids.length).toBeLessThanOrEqual(3);
    }
  });
  it("records the initial change with a template reason", () => {
    expect(path).toMatchObject({ role_id: "fullstack_developer", version: 1, created_from: "initial", pace: "normal" });
    expect(path.history).toHaveLength(1);
    expect(path.history[0]!.reason).toMatch(/Built a \d+-step path for Full Stack Developer/);
    expect(path.steps.find((s) => s.skill_id === "javascript")!.reason).toBe("JavaScript is required by Full Stack Developer (20% of the role), never practiced");
  });
  it("gives a verified-but-low topic a step that says what was shown", () => {
    const p = buildPath(fullstack, [...PS_STATES, verified("javascript", 0.2)], resources, graph, NOW);
    expect(p.steps.find((s) => s.skill_id === "javascript")!.reason).toMatch(/only 20% shown so far/);
  });
  it("builds no steps when every skill is verified, and says so", () => {
    const all = fullstack.skills.flatMap((s) => (graph.skill_topics[s.id] ?? [{ topic: s.id }]).map((t) => verified(t.topic, 0.9)));
    const p = buildPath(fullstack, all, resources, graph, NOW);
    expect(p.steps).toEqual([]);
    expect(p.history[0]!.reason).toMatch(/No gaps found/);
  });
  it("makes no step for a skill below the threshold", () => {
    // sql_databases: weight 0.2 x (1 - 0.4) = 0.12 >= 0.1, but its only topic is declared, so still no step.
    expect(topics).not.toContain("sql");
    // git: weight 0.1, verified 0.5 -> gap 0.05, under the threshold: no step.
    const p = buildPath(fullstack, [...PS_STATES, verified("git", 0.5)], resources, graph, NOW);
    expect(p.steps.map((s) => s.skill_id)).not.toContain("git");
    expect(GAP_THRESHOLD).toBe(0.1);
  });
  it("respects a custom threshold", () => {
    const strict = buildPath(fullstack, PS_STATES, resources, graph, NOW, 0.15);
    expect(strict.steps.map((s) => s.skill_id)).not.toContain("git");
    expect(strict.steps.map((s) => s.skill_id)).toContain("nodejs");
  });
  it("gives a topic shared by two skills one step only", () => {
    const role: Role = { ...fullstack, skills: [{ ...fullstack.skills[0]!, id: "a", weight: 0.5 }, { ...fullstack.skills[1]!, id: "b", weight: 0.5 }] };
    const g: LearningGraph = { topic_names: { shared: "Shared" }, prerequisites: {}, skill_topics: { a: [{ topic: "shared", share: 1 }], b: [{ topic: "shared", share: 1 }] } };
    expect(buildPath(role, [], [], g, NOW).steps).toHaveLength(1);
  });
  it("rejects unknown skill ids", () => {
    expect(() => buildPath(fullstack, [declared("cobol")], resources, graph, NOW)).toThrow(/Unknown skill id/);
  });
});

describe("progressSummary and roleMatch", () => {
  const path = buildPath(fullstack, PS_STATES, resources, graph, NOW);
  it("starts at 0% with the active step next and a bar per role skill", () => {
    const p = progressSummary(path, path.states, fullstack, graph);
    expect(p.percent_complete).toBe(0);
    expect(p.next_step!.status).toBe("active");
    expect(p.skill_bars).toHaveLength(fullstack.skills.length);
    expect(p.skill_bars.find((b) => b.skill_id === "sql_databases")).toMatchObject({ mastery: 0.4, unverified: true });
    expect(p.skill_bars.find((b) => b.skill_id === "rest_apis")).toMatchObject({ mastery: 0, unverified: false });
  });
  it("weights completion by step gap", () => {
    const js = path.steps.find((s) => s.skill_id === "javascript")!;
    const done = { ...path, steps: path.steps.map((s) => (s.id === js.id ? { ...s, status: "done" as const } : s)) };
    const total = path.steps.reduce((a, s) => a + s.gap, 0);
    expect(progressSummary(done, done.states, fullstack, graph).percent_complete).toBe(Math.round((100 * js.gap) / total));
  });
  it("prefers an open remedial step as next, and reports 100% for an empty path", () => {
    const withRemedial = { ...path, steps: [{ ...path.steps[0]!, id: "r", kind: "remedial" as const, status: "remedial" as const, gap: 0 }, ...path.steps] };
    expect(progressSummary(withRemedial, withRemedial.states, fullstack, graph).next_step!.id).toBe("r");
    const empty = { ...path, steps: [] };
    expect(progressSummary(empty, empty.states, fullstack, graph)).toMatchObject({ percent_complete: 100, next_step: null });
  });
  it("matches a role by weighted effective mastery", () => {
    expect(roleMatch(fullstack, [], graph)).toBe(0);
    expect(roleMatch(fullstack, PS_STATES, graph)).toBe(Math.round(100 * (0.2 * 0.4 * 0.15 + 0.2 * 0.4)));
    expect(roleMatch(fullstack, fullstack.skills.flatMap((s) => (graph.skill_topics[s.id] ?? [{ topic: s.id }]).map((t) => verified(t.topic, 1))), graph)).toBe(100);
  });
});

describe("curated data", () => {
  it("covers every topic of every role with at least one resource", () => {
    for (const summary of roles.list()) {
      const role = roles.get(summary.id)!;
      for (const skill of role.skills) {
        for (const t of graph.skill_topics[skill.id] ?? [{ topic: skill.id }]) {
          expect(resources.some((r) => r.skill_id === t.topic), `${role.id}/${skill.id}/${t.topic}`).toBe(true);
        }
      }
    }
  });
});
