import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_LABEL, ROUTES, buildFacts, route, runEvent, type LearnerState } from "../../src/agents/orchestrator.js";
import { COACH_INSTRUCTION, mentorAgent, templateMessage } from "../../src/agents/mentorAgent.js";
import { profilerAgent } from "../../src/agents/profiler.js";
import { skillAnalystAgent, verifiedFromInterviews } from "../../src/agents/skillAnalyst.js";
import type { AgentContext, LearnerProfile, MentorFacts } from "../../src/agents/types.js";
import { resolveTopic, buildPath } from "../../src/core/path.js";
import { loadLearningData } from "../../src/learning/data.js";
import type { InterviewEvidence } from "../../src/placement/evidence.js";
import { roles } from "../helpers.js";

const { graph, resources } = loadLearningData(join(import.meta.dirname, "..", "..", "data", "learning"), roles);
const NOW = new Date("2026-11-14T08:00:00.000Z");
const fullstack = roles.get("fullstack_developer")!;
const ctx = (over: Partial<AgentContext> = {}): AgentContext => ({ now: NOW, uid: "u", roles, graph, resources, interview: async () => null, coach: null, ...over });
const profile = (skills: string[], projects: LearnerProfile["projects"] = []): LearnerProfile => ({ skills, certifications: [], projects, career_interests: [] });

describe("routing table", () => {
  it("is a fixed function of the event type", () => {
    expect(route("PROFILE_SUBMITTED").map((s) => s.agent)).toEqual(["profiler", "skill_analyst", "career_matcher", "curriculum_planner", "mentor"]);
    expect(route("ASSESSMENT_SUBMITTED").map((s) => s.agent)).toEqual(["skill_analyst", "progress_evaluator", "curriculum_planner", "mentor"]);
    expect(route("GOAL_CHANGED").map((s) => s.agent)).toEqual(["profiler", "career_matcher", "curriculum_planner", "mentor"]);
    expect(route("GOAL_CHANGED")).toBe(ROUTES.GOAL_CHANGED);
  });
  it("only the planner after an assessment is conditional, and only on a remedial step", () => {
    const conditional = Object.values(ROUTES).flat().filter((s) => s.only_if);
    expect(conditional).toEqual([{ agent: "curriculum_planner", only_if: "remedial_added" }]);
  });
  it("always ends at the mentor and never lets the mentor run before a decision", () => {
    for (const steps of Object.values(ROUTES)) {
      expect(steps.at(-1)!.agent).toBe("mentor");
      expect(steps.filter((s) => s.agent === "mentor")).toHaveLength(1);
    }
  });
  it("names every agent", () => {
    expect(Object.keys(AGENT_LABEL).sort()).toEqual(["career_matcher", "curriculum_planner", "mentor", "profiler", "progress_evaluator", "skill_analyst"]);
  });
});

describe("resolveTopic", () => {
  it("matches ids, aliases and display names, ignoring case and punctuation", () => {
    expect(resolveTopic("JavaScript", graph)).toBe("javascript");
    expect(resolveTopic("  js ", graph)).toBe("javascript");
    expect(resolveTopic("Node.js", graph)).toBe("nodejs");
    expect(resolveTopic("PostgreSQL", graph)).toBe("sql");
    expect(resolveTopic("HTTP & REST APIs", graph)).toBe("http_api");
    expect(resolveTopic("Statistics & Probability", graph)).toBe("stats_prob");
    expect(resolveTopic("stats prob", graph)).toBe("stats_prob");
  });
  it("returns null for nothing, unknown skills and prototype keys", () => {
    expect(resolveTopic("", graph)).toBeNull();
    expect(resolveTopic("!!!", graph)).toBeNull();
    expect(resolveTopic("Cobol", graph)).toBeNull();
    expect(resolveTopic("constructor", graph)).toBeNull();
    expect(resolveTopic("__proto__", graph)).toBeNull();
    expect(resolveTopic("x", { ...graph, aliases: undefined })).toBeNull();
  });
});

describe("ProfilerAgent", () => {
  it("counts listed skills and project skills as declared, de-duplicated, and reports what it could not match", async () => {
    const r = await profilerAgent.run({ profile: profile(["Python", "python", "SQL", "Basket weaving"], [{ name: "Shop", description: "", skills: ["Node", "HTML"] }]) }, ctx());
    expect(r.output.states).toEqual([
      { skill_id: "html", declared: true, verified_proficiency: null },
      { skill_id: "nodejs", declared: true, verified_proficiency: null },
      { skill_id: "python", declared: true, verified_proficiency: null },
      { skill_id: "sql", declared: true, verified_proficiency: null },
    ]);
    expect(r.output.unrecognized).toEqual(["Basket weaving"]);
    expect(r.log[0]).toMatchObject({ agent: "profiler", decided_by: "deterministic" });
    expect(r.log[0]!.summary).toMatch(/including 1 project/);
  });
  it("handles an empty profile", async () => {
    const r = await profilerAgent.run({ profile: profile([]) }, ctx());
    expect(r.output).toEqual({ states: [], unrecognized: [], certification_skills: [] });
    expect(r.log[0]!.summary).not.toMatch(/could not match|certification/);
  });
  it("counts the topics a certification covers as declared skills only, merges them with typed skills, and keeps unmapped certifications with no skills", async () => {
    const p = { ...profile(["Python"]), certifications: ["Meta Front-End Developer Professional Certificate", "AWS Cloud Practitioner"] };
    const r = await profilerAgent.run({ profile: p }, ctx());
    expect(r.output.states.map((s) => s.skill_id)).toEqual(["css", "html", "javascript", "python", "react"]);
    expect(r.output.states.every((s) => s.declared && s.verified_proficiency === null)).toBe(true); // declared, never verified
    expect(r.output.certification_skills).toEqual([{ cert: "Meta Front-End Developer Professional Certificate", topics: ["css", "html", "javascript", "react"] }, { cert: "AWS Cloud Practitioner", topics: [] }]);
    expect(r.log[0]!.summary).toMatch(/1 of 2 certification\(s\) mapped to CSS, HTML, JavaScript, React \(1 mapped to no skill\)/);
    const none = await profilerAgent.run({ profile: { ...profile([]), certifications: ["AWS Cloud Practitioner"] } }, ctx());
    expect(none.output.states).toEqual([]);
    expect(none.log[0]!.summary).toMatch(/none of 1 certification\(s\) mapped to a skill/);
    const all = await profilerAgent.run({ profile: { ...profile([]), certifications: ["PCEP"] } }, ctx());
    expect(all.log[0]!.summary).toMatch(/1 of 1 certification\(s\) mapped to Python\.$/);
  });
});

describe("SkillAnalystAgent", () => {
  const iv = (over: Partial<InterviewEvidence> = {}, skills: Partial<InterviewEvidence["skills"][number]>[] = [{}]): InterviewEvidence => ({
    skills: skills.map((s) => ({ role_id: "fullstack_developer", skill_id: "web_frontend", name: "Frontend", state: "ready" as const, proficiency: 0.8, at: NOW.toISOString(), assessments: 1, retested: false, gaps: [], ...s })),
    sessions: [],
    demonstration: false,
    readFailed: false,
    ...over,
  });
  it("credits a role skill's proficiency to each of its topics, keeping the highest", () => {
    const m = verifiedFromInterviews(iv({}, [{}, { role_id: "frontend_developer", skill_id: "js_fundamentals", proficiency: 0.95 }, { state: "needs_work", skill_id: "rest_apis", proficiency: 0.3 }]), graph, roles);
    expect(m.get("javascript")).toBe(0.95);
    expect(m.get("react")).toBe(0.8);
    expect(m.get("nodejs")).toBe(0.3);
  });
  it("ignores demonstrations, unreadable results, unassessed states and unknown roles or skills", () => {
    expect(verifiedFromInterviews(null, graph, roles).size).toBe(0);
    expect(verifiedFromInterviews(iv({ demonstration: true }), graph, roles).size).toBe(0);
    expect(verifiedFromInterviews(iv({ readFailed: true }), graph, roles).size).toBe(0);
    expect(verifiedFromInterviews(iv({}, [{ state: "unverified" }]), graph, roles).size).toBe(0);
    expect(verifiedFromInterviews(iv({}, [{ role_id: "nope" }]), graph, roles).size).toBe(0);
    expect(verifiedFromInterviews(iv({}, [{ skill_id: "nope" }]), graph, roles).size).toBe(0);
  });
  it("merges verified evidence over declared skills and says what it did", async () => {
    const declared = [{ skill_id: "javascript", declared: true, verified_proficiency: null }, { skill_id: "sql", declared: true, verified_proficiency: null }];
    const r = await skillAnalystAgent.run({ kind: "verify_existing", declared }, ctx({ interview: async () => iv() }));
    if (r.output.kind !== "verify_existing") throw new Error("wrong kind");
    expect(r.output.states.find((s) => s.skill_id === "javascript")).toEqual({ skill_id: "javascript", declared: true, verified_proficiency: 0.8 });
    expect(r.output.states.find((s) => s.skill_id === "react")).toEqual({ skill_id: "react", declared: false, verified_proficiency: 0.8 });
    expect(r.output.states.find((s) => s.skill_id === "sql")!.verified_proficiency).toBeNull();
    expect(r.log[0]!.summary).toMatch(/Credited 4 topic/);
  });
  it("says so when results are demonstrations or absent", async () => {
    const demo = await skillAnalystAgent.run({ kind: "verify_existing", declared: [] }, ctx({ interview: async () => iv({ demonstration: true }) }));
    expect(demo.log[0]!.summary).toMatch(/demo model/);
    const none = await skillAnalystAgent.run({ kind: "verify_existing", declared: [] }, ctx());
    expect(none.log[0]!.summary).toMatch(/No verified interrogation results/);
  });
  it("ingests a result for a known skill and rejects an unknown one", async () => {
    const ok = await skillAnalystAgent.run({ kind: "ingest", skill: "React", score: 55, source: "simulation", missing_concepts: ["Hooks"] }, ctx());
    expect(ok.output).toEqual({ kind: "ingest", result: { skill_id: "react", score: 55, source: "simulation", missing_concepts: ["Hooks"] }, error: null });
    expect(ok.handoff).toBe("React: 55% (simulation)");
    const real = await skillAnalystAgent.run({ kind: "ingest", skill: "React", score: 70, source: "interrogation" }, ctx());
    expect(real.handoff).toBe("React: 70%");
    expect(real.log[0]!.summary).toBe("Recorded 70% on React from interrogation.");
    const bad = await skillAnalystAgent.run({ kind: "ingest", skill: "Cobol", score: 55, source: "simulation" }, ctx());
    expect(bad.output).toMatchObject({ result: null });
    expect(bad.log[0]!.summary).toMatch(/not a known skill/);
  });
});

describe("MentorAgent and its template", () => {
  const facts = (over: Partial<MentorFacts> = {}): MentorFacts => ({
    event: "PROFILE_SUBMITTED", role_name: "Full Stack Developer", match_percent: 12, percent_complete: 0, pace: "normal", change_reason: "Built a 9-step path.", top_gaps: ["JavaScript", "React"],
    next_step: { label: "JavaScript", resources: [{ title: "javascript.info", url: "https://javascript.info/" }] }, remedial: null, ...over,
  });
  it("writes each kind of message from the facts alone", () => {
    expect(templateMessage(facts())).toBe('You\'re a 12% match for Full Stack Developer. The biggest gaps right now: JavaScript, React. Next up: JavaScript, starting with "javascript.info".');
    expect(templateMessage(facts({ top_gaps: [] }))).toMatch(/gaps right now: none/);
    expect(templateMessage(facts({ next_step: null }))).toMatch(/no open steps/);
    expect(templateMessage(facts({ next_step: { label: "React", resources: [] } }))).toMatch(/Next up: React\.$/);
    const failed = templateMessage(facts({ event: "ASSESSMENT_SUBMITTED", remedial: "Closures & event loop", pace: "slow", change_reason: "Scored 40%." }));
    expect(failed).toMatch(/below the bar, so I put a short review of "Closures & event loop"/);
    expect(failed).toMatch(/slowed the pace/);
    const passed = templateMessage(facts({ event: "ASSESSMENT_SUBMITTED" }));
    expect(passed).toMatch(/^Thanks for the result/);
    expect(passed).not.toMatch(/slowed/);
    expect(templateMessage(facts({ event: "GOAL_CHANGED", role_name: "Data Analyst" }))).toMatch(/^You're now aiming for Data Analyst and match it at 12%\./);
  });
  it("uses the model's wording when it returns some, truncated, and the template otherwise", async () => {
    const ai = await mentorAgent.run({ facts: facts(), now: NOW }, ctx({ coach: async () => ` ${"a".repeat(2000)} ` }));
    expect(ai.output.note).toMatchObject({ source: "ai", at: NOW.toISOString() });
    expect(ai.output.note.message).toHaveLength(1200);
    expect(ai.log[0]!.decided_by).toBe("llm");
    for (const coach of [null, async () => { throw new Error("x"); }, async () => ""]) {
      const r = await mentorAgent.run({ facts: facts(), now: NOW }, ctx({ coach }));
      expect(r.output.note.source).toBe("template");
      expect(r.log[0]!.decided_by).toBe("deterministic");
    }
  });
  it("instructs the model not to invent anything", () => {
    expect(COACH_INSTRUCTION).toMatch(/ONLY the facts/);
    expect(COACH_INSTRUCTION).toMatch(/Never invent scores/);
    expect(COACH_INSTRUCTION.length).toBeLessThanOrEqual(500); // tutorHelp truncates the message at 500 characters
  });
});

describe("orchestrator errors and facts", () => {
  const prior = (over: Partial<LearnerState> = {}): LearnerState => ({ profile: profile([]), role: fullstack, path: null, states: [], ...over });
  const path = () => buildPath(fullstack, [], resources, graph, NOW);

  it("refuses an assessment or a goal change when there is no roadmap yet", async () => {
    await expect(runEvent({ type: "ASSESSMENT_SUBMITTED", skill: "JavaScript", score: 50, source: "simulation" }, prior(), ctx(), 1)).rejects.toMatchObject({ code: "BAD_REQUEST", message: /no roadmap/ });
    await expect(runEvent({ type: "GOAL_CHANGED", role: roles.get("data_analyst")! }, prior(), ctx(), 1)).rejects.toMatchObject({ code: "BAD_REQUEST", message: /no roadmap/ });
  });
  it("turns an unknown skill or an out-of-range score into a bad request", async () => {
    await expect(runEvent({ type: "ASSESSMENT_SUBMITTED", skill: "Cobol", score: 50, source: "simulation" }, prior({ path: path() }), ctx(), 1)).rejects.toMatchObject({ code: "BAD_REQUEST", message: /not a skill/ });
    await expect(runEvent({ type: "ASSESSMENT_SUBMITTED", skill: "JavaScript", score: Number.NaN, source: "simulation" }, prior({ path: path() }), ctx(), 1)).rejects.toMatchObject({ code: "BAD_REQUEST", message: /between 0 and 100/ });
  });
  it("continues the log id sequence and never lets two entries share an id", async () => {
    const out = await runEvent({ type: "PROFILE_SUBMITTED", profile: profile(["Python"]), role: fullstack }, prior(), ctx(), 7);
    const ids = out.log.map((e) => e.id);
    expect(ids[0]).toBe("log-7");
    expect(new Set(ids).size).toBe(ids.length);
    expect(out.log.every((e) => e.at === NOW.toISOString())).toBe(true);
  });
  it("builds mentor facts from the roadmap only", () => {
    const p = path();
    const f = buildFacts("PROFILE_SUBMITTED", fullstack, p, null, ctx());
    expect(f.change_reason).toBe(p.history[0]!.reason);
    expect(f.next_step!.label).toBeTruthy();
    expect(f.next_step!.resources.length).toBeGreaterThan(0);
    expect(f.top_gaps.length).toBeLessThanOrEqual(3);
    const finished = { ...p, steps: p.steps.map((s) => ({ ...s, status: "done" as const })) };
    expect(buildFacts("PROFILE_SUBMITTED", fullstack, finished, null, ctx()).next_step).toBeNull();
    const dangling = { ...p, steps: p.steps.map((s) => ({ ...s, resource_ids: ["missing-resource"] })) };
    expect(buildFacts("PROFILE_SUBMITTED", fullstack, dangling, null, ctx()).next_step!.resources).toEqual([]);
  });
});
