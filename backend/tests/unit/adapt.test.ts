import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PASS_SCORE, STRONG_SCORE, adaptOnAssessment, adaptOnGoalChange } from "../../src/core/adapt.js";
import { buildPath, type AssessmentResult, type LearnerSkillState, type LearningGraph, type LearningPath } from "../../src/core/path.js";
import { loadLearningData } from "../../src/learning/data.js";
import { roles } from "../helpers.js";

const { graph, resources } = loadLearningData(join(import.meta.dirname, "..", "..", "data", "learning"), roles);
const T0 = new Date("2026-11-14T08:00:00.000Z");
const T1 = new Date("2026-11-14T09:00:00.000Z");
const fullstack = roles.get("fullstack_developer")!;
const declared = (id: string): LearnerSkillState => ({ skill_id: id, declared: true, verified_proficiency: null });
const PS = [declared("python"), declared("sql"), declared("html")];
const base = (): LearningPath => buildPath(fullstack, PS, resources, graph, T0);
const result = (skill_id: string, score: number, extra: Partial<AssessmentResult> = {}): AssessmentResult => ({ skill_id, score, source: "simulation", ...extra });
const step = (p: LearningPath, topic: string) => p.steps.find((s) => s.skill_id === topic && s.kind === "core")!;
const remedial = (p: LearningPath, topic: string) => p.steps.filter((s) => s.kind === "remedial" && s.skill_id === topic);

describe("adaptOnAssessment: failing score", () => {
  const before = base();
  const snapshot = structuredClone(before);
  const { path, change } = adaptOnAssessment(before, result("javascript", 40), fullstack, resources, graph, T1);

  it("inserts one remedial step for a prerequisite concept, right before the failed step", () => {
    const r = remedial(path, "javascript");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ status: "remedial", kind: "remedial", concept: "Closures & event loop", gap: 0 });
    expect(r[0]!.order).toBe(step(path, "javascript").order - 1);
    expect(r[0]!.resource_ids.length).toBeGreaterThan(0);
  });
  it("blocks the failed step and everything that depends on it, until the remedial is done", () => {
    const r = remedial(path, "javascript")[0]!;
    for (const t of ["javascript", "react", "nodejs", "http_api", "auth_sessions", "testing", "deploy_fullstack"]) {
      expect(step(path, t)).toMatchObject({ status: "blocked", blocked_by: [r.id] });
    }
    expect(step(path, "css").status).not.toBe("blocked");
  });
  it("lowers the pace, records the score and bumps the version", () => {
    expect(path).toMatchObject({ pace: "slow", version: 2, created_from: "assessment" });
    expect(path.states.find((s) => s.skill_id === "javascript")).toEqual({ skill_id: "javascript", declared: false, verified_proficiency: 0.4 });
    expect(path.history).toHaveLength(2);
    expect(path.history[1]).toBe(change);
  });
  it("explains itself from a template", () => {
    expect(change.reason).toMatch(/^Scored 40% on JavaScript \(below 60%\)\. Added a remedial step on "Closures & event loop" and paused 7 step\(s\)/);
    expect(change.added).toEqual([expect.objectContaining({ label: "Revisit: Closures & event loop" })]);
    expect(change.status_changes.some((c) => c.to === "blocked" && c.label === "React")).toBe(true);
    expect(change.status_changes.some((c) => c.to === "remedial" && c.from === null)).toBe(true);
  });
  it("does not mutate its input and is deterministic", () => {
    expect(before).toEqual(snapshot);
    expect(adaptOnAssessment(before, result("javascript", 40), fullstack, resources, graph, T1).path).toEqual(path);
  });
  it("keeps the same remedial step on a second failure instead of adding another", () => {
    const again = adaptOnAssessment(path, result("javascript", 30), fullstack, resources, graph, T1);
    expect(remedial(again.path, "javascript")).toHaveLength(1);
    expect(again.change.reason).toMatch(/still below 60%/);
    expect(again.change.added).toEqual([]);
  });
  it("uses a missed concept that is one of the skill's prerequisites, and ignores others", () => {
    const named = adaptOnAssessment(base(), result("javascript", 10, { missing_concepts: ["Quantum physics", "Flexbox & grid"] }), fullstack, resources, graph, T1);
    expect(remedial(named.path, "javascript")[0]!.concept).toBe("Flexbox & grid");
    const ignored = adaptOnAssessment(base(), result("javascript", 10, { missing_concepts: ["Quantum physics"] }), fullstack, resources, graph, T1);
    expect(remedial(ignored.path, "javascript")[0]!.concept).toBe("Closures & event loop");
  });
  it("moves to the next prerequisite concept after an earlier remedial was finished and the learner fails again", () => {
    const passed = adaptOnAssessment(path, result("javascript", 65), fullstack, resources, graph, T1).path;
    const reopened = adaptOnAssessment({ ...passed, steps: passed.steps.map((s) => (s.kind === "core" && s.skill_id === "javascript" ? { ...s, status: "pending" as const } : s)) }, result("javascript", 20), fullstack, resources, graph, T1);
    const all = remedial(reopened.path, "javascript");
    expect(all.map((r) => r.concept)).toEqual(["Closures & event loop", "Component state & re-render"]);
    expect(all[1]!.id).toBe("remedial-javascript-2");
  });
  it("adds a remedial at the end for a topic that has no step (and no role skill)", () => {
    const r = adaptOnAssessment(base(), result("html", 30), fullstack, resources, graph, T1).path;
    const added = remedial(r, "html")[0]!;
    expect(added.role_skill_id).toBeNull();
    expect(added.order).toBe(r.steps.length);
    // Failing HTML holds back the topics that build on it.
    expect(step(r, "javascript")).toMatchObject({ status: "blocked", blocked_by: [added.id] });
    expect(step(r, "git").status).not.toBe("blocked");
  });
  it("falls back to a generic concept for a topic the role does not use", () => {
    const r = adaptOnAssessment(base(), result("stats_prob", 10), fullstack, resources, graph, T1).path;
    expect(remedial(r, "stats_prob")[0]!.concept).toBe("Revisit the fundamentals of Statistics & Probability");
  });
  it("does not loop on a cyclic prerequisite graph", () => {
    const g: LearningGraph = { ...graph, prerequisites: { ...graph.prerequisites, javascript: ["react"] } };
    expect(() => adaptOnAssessment(base(), result("javascript", 10), fullstack, resources, g, T1)).not.toThrow();
  });
});

describe("adaptOnAssessment: passing scores", () => {
  const failed = adaptOnAssessment(base(), result("javascript", 40), fullstack, resources, graph, T1).path;

  it("a strong result closes the remedial step, marks the topic done, unblocks dependents and advances", () => {
    const { path, change } = adaptOnAssessment(failed, result("javascript", 90), fullstack, resources, graph, T1);
    expect(remedial(path, "javascript")[0]!.status).toBe("done");
    expect(step(path, "javascript")).toMatchObject({ status: "done", review_later: false });
    for (const t of ["react", "nodejs"]) expect(step(path, t).blocked_by).toEqual([]);
    expect(path.steps.filter((s) => s.status === "blocked")).toEqual([]);
    expect(path.steps.filter((s) => s.status === "active")).toHaveLength(1);
    expect(path.pace).toBe("normal");
    expect(change.reason).toMatch(/^Scored 90% on JavaScript: marked done and closed the remedial step on "Closures & event loop"\. Unblocked: /);
    expect(change.reason).toMatch(/Unblocked: .*React/);
    expect(change.reason).toMatch(/Unblocked: .*Node\.js/);
    expect(change.reason).not.toMatch(/Unblocked: .*JavaScript/);
    expect(change.status_changes.some((c) => c.label === "React" && c.from === "blocked")).toBe(true);
  });
  it("boundaries: 59 fails, 60 passes with a review flag, 84 keeps the flag, 85 is strong", () => {
    const at = (score: number) => adaptOnAssessment(base(), result("javascript", score), fullstack, resources, graph, T1).path;
    expect(remedial(at(PASS_SCORE - 1), "javascript")).toHaveLength(1);
    expect(step(at(PASS_SCORE), "javascript")).toMatchObject({ status: "done", review_later: true });
    expect(remedial(at(PASS_SCORE), "javascript")).toHaveLength(0);
    expect(step(at(STRONG_SCORE - 1), "javascript").review_later).toBe(true);
    expect(step(at(STRONG_SCORE), "javascript").review_later).toBe(false);
    expect(adaptOnAssessment(base(), result("javascript", 70), fullstack, resources, graph, T1).change.reason).toMatch(/flagged to review later \(below 85%\)/);
  });
  it("a strong result keeps the pace slow while another remedial is still open", () => {
    const twoOpen = adaptOnAssessment(failed, result("css", 20), fullstack, resources, graph, T1).path;
    const out = adaptOnAssessment(twoOpen, result("javascript", 95), fullstack, resources, graph, T1).path;
    expect(out.pace).toBe("slow");
  });
  it("a pass on a topic with no step only updates mastery", () => {
    const { path, change } = adaptOnAssessment(base(), result("html", 92), fullstack, resources, graph, T1);
    expect(path.steps).toEqual(base().steps);
    expect(path.states.find((s) => s.skill_id === "html")).toEqual({ skill_id: "html", declared: true, verified_proficiency: 0.92 });
    expect(change.status_changes).toEqual([]);
    expect(change.reason).not.toMatch(/Next up/);
  });
  it("raises progress after the pass", async () => {
    const { progressSummary } = await import("../../src/core/path.js");
    const after = adaptOnAssessment(failed, result("javascript", 90), fullstack, resources, graph, T1).path;
    expect(progressSummary(after, after.states, fullstack, graph).percent_complete).toBeGreaterThan(progressSummary(failed, failed.states, fullstack, graph).percent_complete);
  });
});

describe("adaptOnAssessment: invalid input", () => {
  it("rejects unknown skills and scores outside 0..100", () => {
    expect(() => adaptOnAssessment(base(), result("cobol", 50), fullstack, resources, graph, T1)).toThrow(/Unknown skill id/);
    for (const score of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => adaptOnAssessment(base(), result("javascript", score), fullstack, resources, graph, T1)).toThrow(/between 0 and 100/);
    }
  });
});

describe("adaptOnGoalChange", () => {
  const da = roles.get("data_analyst")!;
  const { path, change } = adaptOnGoalChange(base(), da, resources, graph, T1);
  const labels = (items: { label: string }[]) => items.map((i) => i.label);

  it("keeps what is already known (Python, SQL), adds what the new role needs, removes what it does not", () => {
    expect(labels(change.kept)).toEqual(expect.arrayContaining(["Python", "SQL"]));
    expect(change.kept.find((k) => k.label === "Python")!.reason).toBe("Python already declared (counts as 40% until verified); it counts towards Data Analyst");
    expect(labels(change.added)).toEqual(expect.arrayContaining(["Statistics & Probability", "Data Preparation", "Visualization & Storytelling"]));
    expect(change.added.find((a) => a.label === "Statistics & Probability")!.reason).toBe("Statistics & Probability is required by Data Analyst (20% of the role), never practiced");
    expect(labels(change.removed)).toEqual(expect.arrayContaining(["JavaScript", "React", "Node.js"]));
    expect(change.removed.find((r) => r.label === "React")!.reason).toBe("React is not required by Data Analyst");
  });
  it("rebuilds the path for the new role and carries the states over", () => {
    expect(path).toMatchObject({ role_id: "data_analyst", version: 2, created_from: "goal_change" });
    expect(path.steps.map((s) => s.skill_id)).not.toContain("react");
    expect(path.states.map((s) => s.skill_id)).toEqual(["html", "python", "sql"]);
    expect(path.history).toHaveLength(2);
    expect(change.reason).toMatch(/^Switched goal to Data Analyst: kept \d+, added \d+, removed \d+, reordered \d+\.$/);
  });
  it("is deterministic", () => {
    expect(adaptOnGoalChange(base(), da, resources, graph, T1)).toEqual({ path, change });
  });
  it("keeps done steps for topics the new role also needs and reports verified skills as kept", () => {
    const afterJs = adaptOnAssessment(base(), result("javascript", 90), fullstack, resources, graph, T1).path;
    const fe = roles.get("frontend_developer")!;
    const out = adaptOnGoalChange(afterJs, fe, resources, graph, T1);
    const jsStep = out.path.steps.find((s) => s.skill_id === "javascript")!;
    expect(jsStep.status).toBe("done");
    expect(out.path.steps.findIndex((s) => s.skill_id === "javascript")).toBe(0);
    expect(out.change.kept.find((k) => k.label === "JavaScript")!.reason).toBe("JavaScript already verified; it counts towards Frontend Developer");
    expect(out.change.kept.some((k) => k.reason.includes("is still required by Frontend Developer"))).toBe(true);
  });
  it("reports reordered steps when the new role changes their relative order", () => {
    const fe = roles.get("frontend_developer")!;
    const out = adaptOnGoalChange(base(), fe, resources, graph, T1);
    expect(out.change.reordered.length).toBeGreaterThan(0);
    expect(out.change.reordered[0]!.reason).toMatch(/moved from position \d+ to \d+ among the steps kept/);
  });
  it("says a topic is already covered when the new role weights it too lightly for a step", () => {
    const devops = roles.get("devops_engineer")!;
    const out = adaptOnGoalChange(base(), devops, resources, graph, T1);
    expect(out.change.removed.find((r) => r.label === "Git & Collaboration")!.reason).toBe("Git & Collaboration no longer needs a step: it is already covered for DevOps Engineer");
  });
  it("can rebuild for the same role, and rejects unknown states", () => {
    expect(adaptOnGoalChange(base(), fullstack, resources, graph, T1).path.role_id).toBe("fullstack_developer");
    expect(() => adaptOnGoalChange({ ...base(), states: [declared("cobol")] }, da, resources, graph, T1)).toThrow(/Unknown skill id/);
  });
});
