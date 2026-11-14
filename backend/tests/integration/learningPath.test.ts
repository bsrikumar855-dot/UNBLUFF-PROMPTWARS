import request from "supertest";
import { describe, expect, it } from "vitest";
import type { InterviewEvidence } from "../../src/placement/evidence.js";
import { bearer, testApp } from "./app.js";

const as = (uid: string) => ({ Authorization: bearer(uid) });
const NOW = new Date("2026-11-14T08:00:00Z");
const setup = (opts: Parameters<typeof testApp>[0] = {}) => testApp({ autoAuth: false, now: () => NOW, ...opts });
const PS = { role_id: "fullstack_developer", skills: ["Python", "SQL", "HTML"] };

const interview = (over: Partial<InterviewEvidence> = {}): InterviewEvidence => ({
  skills: [{ role_id: "fullstack_developer", skill_id: "web_frontend", name: "Frontend Fundamentals", state: "ready", proficiency: 0.9, at: NOW.toISOString(), assessments: 1, retested: false, gaps: [] }],
  sessions: [],
  demonstration: false,
  readFailed: false,
  ...over,
});

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const step = (b: Body, topic: string) => b.path.steps.find((s: Body) => s.skill_id === topic && s.kind === "core");
const handoffs = (b: Body) => b.agent_log.filter((e: Body) => e.kind === "handoff").map((e: Body) => `${e.agent}>${e.to}`);

describe("the problem-statement scenario end to end (LLM_MODE=mock)", () => {
  it("builds the path, adapts to a failed and a passed assessment, then to a goal change, and persists", async () => {
    const app = setup();

    // 1. Python, SQL, HTML -> Full Stack
    const created = await request(app).post("/api/learning-path").set(as("asha")).send(PS).expect(201);
    const a = created.body as Body;
    const missing = a.analysis.gaps.flatMap((g: Body) => g.missing_topics.map((t: Body) => t.name));
    expect(missing).toEqual(expect.arrayContaining(["JavaScript", "React", "Node.js"]));
    expect(a.role).toEqual({ id: "fullstack_developer", name: "Full Stack Developer" });
    expect(a.career_match.percent).toBeGreaterThan(0);
    expect(a.career_match.alternatives).toHaveLength(3);
    const order = a.path.steps.map((s: Body) => s.skill_id);
    expect(order.indexOf("javascript")).toBeLessThan(order.indexOf("react"));
    expect(order.indexOf("javascript")).toBeLessThan(order.indexOf("nodejs"));
    expect(step(a, "react").resource_ids.every((id: string) => a.resources[id].url.startsWith("https://"))).toBe(true);
    expect(a.mentor.source).toBe("template");
    expect(a.mentor.message).toMatch(/Full Stack Developer/);
    expect(handoffs(a)).toEqual(["profiler>skill_analyst", "skill_analyst>career_matcher", "career_matcher>curriculum_planner", "curriculum_planner>mentor"]);
    expect(a.agent_log.every((e: Body) => e.decided_by === "deterministic")).toBe(true);
    expect(a.unrecognized_skills).toEqual([]);
    const id = a.id as string;

    // 2. Simulated 40% on JavaScript
    const failed = (await request(app).post(`/api/learning-path/${id}/assessment`).set(as("asha")).send({ source: "simulation", skill: "JavaScript", score: 40 }).expect(200)).body as Body;
    const remedial = failed.path.steps.find((s: Body) => s.kind === "remedial");
    expect(remedial).toMatchObject({ status: "remedial", skill_id: "javascript", concept: "Closures & event loop" });
    expect(step(failed, "react")).toMatchObject({ status: "blocked", blocked_by: [remedial.id] });
    expect(step(failed, "nodejs")).toMatchObject({ status: "blocked", blocked_by: [remedial.id] });
    expect(failed.last_change.reason).toMatch(/^Scored 40% on JavaScript \(below 60%\)\. Added a remedial step/);
    expect(failed.mentor.message).not.toBe(a.mentor.message);
    expect(failed.mentor.message).toMatch(/Closures & event loop/);
    expect(failed.path.pace).toBe("slow");
    expect(failed.has_simulation).toBe(true);
    const fresh = failed.agent_log.slice(a.agent_log.length);
    expect(fresh.map((e: Body) => e.agent).filter((x: string, i: number, all: string[]) => all.indexOf(x) === i)).toEqual(["skill_analyst", "progress_evaluator", "curriculum_planner", "mentor"]);
    expect(handoffs({ agent_log: fresh })).toEqual(["skill_analyst>progress_evaluator", "progress_evaluator>curriculum_planner", "curriculum_planner>mentor"]);
    expect(fresh.find((e: Body) => e.kind === "handoff" && e.agent === "progress_evaluator").summary).toMatch(/Progress Evaluator → Curriculum Planner: 1 remedial step added/);
    // the planner hands the mentor the learner's real next step: the open remedial step, not just the first open one
    expect(fresh.find((e: Body) => e.kind === "handoff" && e.agent === "curriculum_planner").summary).toMatch(/next: Revisit: Closures & event loop/);
    expect(failed.agent_log.map((e: Body) => e.id)).toEqual(failed.agent_log.map((_: unknown, i: number) => `log-${i + 1}`));

    // 3. Pass the remedial (simulate 90)
    const passed = (await request(app).post(`/api/learning-path/${id}/assessment`).set(as("asha")).send({ source: "simulation", skill: "javascript", score: 90 }).expect(200)).body as Body;
    expect(passed.path.steps.filter((s: Body) => s.status === "blocked")).toEqual([]);
    expect(step(passed, "javascript").status).toBe("done");
    expect(passed.path.steps.find((s: Body) => s.kind === "remedial").status).toBe("done");
    expect(passed.progress.percent_complete).toBeGreaterThan(failed.progress.percent_complete);
    expect(passed.path.pace).toBe("normal");
    expect(passed.last_change.reason).toMatch(/Unblocked: .*React/);
    // the passed assessment does not hand to the planner: no remedial was added
    expect(handoffs({ agent_log: passed.agent_log.slice(failed.agent_log.length) })).toEqual(["skill_analyst>progress_evaluator", "progress_evaluator>mentor"]);

    // 4. Switch the goal to Data Analyst
    const switched = (await request(app).post(`/api/learning-path/${id}/goal`).set(as("asha")).send({ role_id: "data_analyst" }).expect(200)).body as Body;
    const c = switched.last_change;
    expect(c.kind).toBe("goal_change");
    expect(c.kept.map((k: Body) => k.label)).toEqual(expect.arrayContaining(["Python", "SQL", "JavaScript"].filter((n) => n !== "JavaScript")));
    expect(c.removed.map((k: Body) => k.label)).toEqual(expect.arrayContaining(["React", "Node.js"]));
    expect(c.added.map((k: Body) => k.label)).toEqual(expect.arrayContaining(["Statistics & Probability"]));
    expect(switched.role.id).toBe("data_analyst");
    expect(switched.path.role_id).toBe("data_analyst");
    expect(switched.path.steps.map((s: Body) => s.skill_id)).not.toContain("react");
    expect(handoffs({ agent_log: switched.agent_log.slice(passed.agent_log.length) })).toEqual(["profiler>career_matcher", "career_matcher>curriculum_planner", "curriculum_planner>mentor"]);
    expect(switched.agent_log.slice(passed.agent_log.length)[0]!.action).toBe("reuse_profile");

    // 5. Reload: everything persisted
    const reloaded = (await request(app).get(`/api/learning-path/${id}`).set(as("asha")).expect(200)).body as Body;
    expect(reloaded).toEqual(switched);
    const list = (await request(app).get("/api/learning-path").set(as("asha")).expect(200)).body as Body;
    expect(list.paths).toEqual([{ id, role: { id: "data_analyst", name: "Data Analyst" }, updated_at: NOW.toISOString(), percent_complete: expect.any(Number) }]);
    const log = (await request(app).get(`/api/learning-path/${id}/agent-log`).set(as("asha")).expect(200)).body as Body;
    expect(log.entries).toEqual(switched.agent_log);
  });
});

describe("validation, ownership and errors", () => {
  it("rejects bad input with the contract error shape", async () => {
    const app = setup();
    const post = (body: unknown) => request(app).post("/api/learning-path").set(as("a")).send(body as object);
    expect((await post({ role_id: "nope" })).status).toBe(404);
    expect((await post({ role_id: "nope" })).body.error.code).toBe("ROLE_NOT_FOUND");
    for (const bad of [{}, { role_id: "fullstack_developer", extra: 1 }, { role_id: "fullstack_developer", skills: [""] }, { role_id: "fullstack_developer", skills: "Python" }, { role_id: "fullstack_developer", projects: [{ name: "x", skills: [], evil: 1 }] }, { role_id: "../x" }]) {
      const r = await post(bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.body.error.code).toBe("BAD_REQUEST");
    }
    const id = (await post(PS)).body.id as string;
    const assess = (body: unknown) => request(app).post(`/api/learning-path/${id}/assessment`).set(as("a")).send(body as object);
    for (const bad of [{ source: "simulation", skill: "JavaScript", score: 101 }, { source: "simulation", skill: "JavaScript", score: -1 }, { source: "simulation", skill: "JavaScript", score: 40.5 }, { source: "simulation", skill: "JavaScript" }, { source: "quiz", skill: "JavaScript", score: 50 }, { source: "interrogation", skill: "JavaScript", score: 99 }, {}]) {
      expect((await assess(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    const unknown = await assess({ source: "simulation", skill: "Cobol", score: 50 });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.message).toMatch(/not a skill this platform can assess/);
    expect((await request(app).post(`/api/learning-path/${id}/goal`).set(as("a")).send({ role_id: "nope" })).status).toBe(404);
    expect((await request(app).post(`/api/learning-path/${id}/goal`).set(as("a")).send({})).status).toBe(400);
  });

  it("reports skills it could not match instead of dropping them silently", async () => {
    const r = await request(setup()).post("/api/learning-path").set(as("a")).send({ role_id: "fullstack_developer", skills: ["JS", "Underwater basket weaving"], projects: [{ name: "Shop", description: "a store", skills: ["Node", "Postgres"] }], certifications: ["AWS Cloud Practitioner"], career_interests: ["Web"] });
    expect(r.body.unrecognized_skills).toEqual(["Underwater basket weaving"]);
    expect(r.body.profile.certifications).toEqual(["AWS Cloud Practitioner"]);
    // projects' skills count as declared evidence
    expect(r.body.path.states.map((s: Body) => s.skill_id)).toEqual(["javascript", "nodejs", "sql"]);
    expect(r.body.agent_log[0].summary).toMatch(/could not match: Underwater basket weaving/);
  });

  it("never shows one student's path to another", async () => {
    const app = setup();
    const id = (await request(app).post("/api/learning-path").set(as("alice")).send(PS)).body.id as string;
    const attempts = [
      ["get", "", undefined],
      ["get", "/agent-log", undefined],
      ["post", "/assessment", { source: "simulation", skill: "JavaScript", score: 50 }],
      ["post", "/goal", { role_id: "data_analyst" }],
    ] as const;
    for (const [m, p, body] of attempts) {
      const res = await request(app)[m](`/api/learning-path/${id}${p}`).set(as("bob")).send(body);
      expect(res.status, `${m} ${p}`).toBe(404);
    }
    // alice's path is untouched by bob's attempts
    expect((await request(app).get(`/api/learning-path/${id}`).set(as("alice"))).body.path.version).toBe(1);
    expect((await request(app).get("/api/learning-path").set(as("bob"))).body.paths).toEqual([]);
    expect((await request(app).get("/api/learning-path/not-an-id").set(as("alice"))).status).toBe(404);
  });

  it("caps the number of paths per student", async () => {
    const app = setup();
    for (let i = 0; i < 20; i++) await request(app).post("/api/learning-path").set(as("a")).send({ role_id: "fullstack_developer" }).expect(201);
    const r = await request(app).post("/api/learning-path").set(as("a")).send({ role_id: "fullstack_developer" });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/most you can keep/);
  });

  it("serialises two quick assessments so neither is lost", async () => {
    const app = setup();
    const id = (await request(app).post("/api/learning-path").set(as("a")).send(PS)).body.id as string;
    const send = (skill: string, score: number) => request(app).post(`/api/learning-path/${id}/assessment`).set(as("a")).send({ source: "simulation", skill, score });
    await Promise.all([send("Git", 90), send("Testing", 90)]);
    const b = (await request(app).get(`/api/learning-path/${id}`).set(as("a"))).body as Body;
    expect(b.path.states.map((s: Body) => s.skill_id)).toEqual(expect.arrayContaining(["git", "testing"]));
    expect(b.path.version).toBe(3);
  });
});

describe("certifications", () => {
  it("count as declared skills only (40% cap), are shown per certification, and unmapped ones add no skill", async () => {
    const r = await request(setup()).post("/api/learning-path").set(as("a")).send({ role_id: "fullstack_developer", skills: ["SQL"], certifications: ["Meta Front-End Developer Professional Certificate", "AWS Cloud Practitioner"] }).expect(201);
    const b = r.body as Body;
    expect(b.certification_skills).toEqual([{ cert: "Meta Front-End Developer Professional Certificate", topics: ["css", "html", "javascript", "react"] }, { cert: "AWS Cloud Practitioner", topics: [] }]);
    expect(b.path.states).toEqual(["css", "html", "javascript", "react", "sql"].map((skill_id) => ({ skill_id, declared: true, verified_proficiency: null })));
    const fe = b.analysis.gaps.find((g: Body) => g.skill_id === "web_frontend");
    expect(fe.mastery).toBeLessThanOrEqual(0.4); // never above the declared cap
    expect(fe.unverified).toBe(true);
    expect(b.path.steps.map((s: Body) => s.skill_id)).not.toContain("javascript"); // declared, so no learning step, but it still needs verifying
    expect(b.agent_log[0].summary).toMatch(/1 of 2 certification\(s\) mapped to CSS, HTML, JavaScript, React/);
  });
  it("keeps them after later changes", async () => {
    const app = setup();
    const made = (await request(app).post("/api/learning-path").set(as("a")).send({ role_id: "fullstack_developer", certifications: ["PCEP"] })).body as Body;
    const after = (await request(app).post(`/api/learning-path/${made.id}/goal`).set(as("a")).send({ role_id: "data_analyst" })).body as Body;
    expect(after.certification_skills).toEqual([{ cert: "PCEP", topics: ["python"] }]);
    expect(after.path.states.find((s: Body) => s.skill_id === "python")).toEqual({ skill_id: "python", declared: true, verified_proficiency: null });
  });
});

describe("real (interrogation) results", () => {
  it("credits verified proficiency from the student's graded interrogations, and reads the score on the server", async () => {
    const app = setup({ interview: async () => interview() });
    const created = (await request(app).post("/api/learning-path").set(as("a")).send(PS)).body as Body;
    // Frontend Fundamentals verified at 90% covers JavaScript, React, HTML and CSS: no gap steps remain for them.
    expect(created.path.steps.map((s: Body) => s.skill_id)).not.toContain("javascript");
    expect(created.analysis.gaps.find((g: Body) => g.skill_id === "web_frontend").unverified).toBe(false);
    expect(created.agent_log.find((e: Body) => e.agent === "skill_analyst").summary).toMatch(/Credited \d+ topic\(s\) with verified proficiency/);
    const r = await request(app).post(`/api/learning-path/${created.id}/assessment`).set(as("a")).send({ source: "interrogation", skill: "React" }).expect(200);
    expect(r.body.last_change.reason).toMatch(/Scored 90% on React/);
    expect(r.body.agent_log.at(-5).summary).toMatch(/Recorded 90% on React from interrogation/);
  });

  it("refuses a real result that does not exist, and ignores demonstration-graded results", async () => {
    const none = setup({ interview: async () => null });
    const id = (await request(none).post("/api/learning-path").set(as("a")).send(PS)).body.id as string;
    const miss = await request(none).post(`/api/learning-path/${id}/assessment`).set(as("a")).send({ source: "interrogation", skill: "JavaScript" });
    expect(miss.status).toBe(400);
    expect(miss.body.error.message).toMatch(/No verified interrogation result/);

    const demo = setup({ interview: async () => interview({ demonstration: true }) });
    const made = (await request(demo).post("/api/learning-path").set(as("a")).send(PS)).body as Body;
    expect(made.path.steps.map((s: Body) => s.skill_id)).toContain("javascript"); // not credited
    expect(made.agent_log.find((e: Body) => e.agent === "skill_analyst").summary).toMatch(/graded by the built-in demo model/);
    expect((await request(demo).post(`/api/learning-path/${made.id}/assessment`).set(as("a")).send({ source: "interrogation", skill: "JavaScript" })).status).toBe(400);
  });

  it("survives the interrogation results being unreadable", async () => {
    const app = setup({ interview: async () => { throw new Error("store down"); } });
    const r = await request(app).post("/api/learning-path").set(as("a")).send(PS).expect(201);
    expect(r.body.path.steps.length).toBeGreaterThan(0);
  });
});

describe("the mentor message", () => {
  it("uses the AI model for wording only, and labels it", async () => {
    const seen: unknown[] = [];
    const app = setup({ coach: async (_uid, facts) => { seen.push(facts); return "Great start, keep going."; } });
    const r = await request(app).post("/api/learning-path").set(as("a")).send(PS).expect(201);
    expect(r.body.mentor).toMatchObject({ source: "ai", message: "Great start, keep going." });
    expect(r.body.agent_log.at(-1)).toMatchObject({ agent: "mentor", decided_by: "llm" });
    expect(r.body.agent_log.filter((e: Body) => e.decided_by === "llm")).toHaveLength(1);
    // the model is handed facts only: no ids, resources it could pick from, or roadmap objects
    expect(Object.keys(seen[0] as object).sort()).toEqual(["change_reason", "event", "match_percent", "next_step", "pace", "percent_complete", "remedial", "role_name", "top_gaps"]);
  });

  it("falls back to the template when the model fails or says nothing", async () => {
    for (const coach of [async () => { throw new Error("quota"); }, async () => "   ", async () => null]) {
      const r = await request(setup({ coach })).post("/api/learning-path").set(as("a")).send(PS).expect(201);
      expect(r.body.mentor.source).toBe("template");
      expect(r.body.agent_log.at(-1).decided_by).toBe("deterministic");
    }
  });
});

describe("account export and deletion include learning paths", () => {
  it("exports and deletes them", async () => {
    const app = setup();
    await request(app).post("/api/learning-path").set(as("zed")).send(PS).expect(201);
    const exp = await request(app).get("/api/me/export").set(as("zed")).expect(200);
    expect(exp.body.data.learning_paths).toHaveLength(1);
    expect(exp.body.data.learning_paths[0].owner_uid).toBe("zed");
    const del = await request(app).delete("/api/me").set(as("zed")).send({ confirm: "DELETE MY DATA" });
    expect(del.status).toBe(200);
    expect(del.body.removed.learning_paths).toBe(1);
    expect((await request(app).get("/api/learning-path").set(as("zed"))).body.paths).toEqual([]);
  });
});
