import { Firestore } from "@google-cloud/firestore";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadLearningData } from "../../src/learning/data.js";
import { LearningPathService, MAX_PATHS_PER_STUDENT } from "../../src/learning/service.js";
import { FirestoreLearningPathStore, type LearningPathRecord } from "../../src/learning/store.js";
import { roles, silentLogger } from "../helpers.js";
import { PROJECT_ID, requireEmulators } from "./emulator.js";

/** SkillForge learning paths on the Firestore EMULATOR (never a live project). */
const run = randomUUID().slice(0, 8);
const collection = `t_learning_paths_${run}`;
const NOW = new Date("2026-11-14T08:00:00.000Z");
const PS = { role_id: "fullstack_developer", skills: ["Python", "SQL", "HTML"] };
let db: Firestore;
let store: FirestoreLearningPathStore;
const data = loadLearningData(join(import.meta.dirname, "..", "..", "data", "learning"), roles);
const service = () => new LearningPathService({ store, roles, data, logger: silentLogger, now: () => NOW });
const uid = (n: string) => `lp-${run}-${n}`;

beforeAll(() => {
  requireEmulators();
  db = new Firestore({ projectId: PROJECT_ID, ignoreUndefinedProperties: true });
  store = new FirestoreLearningPathStore(db, collection);
});
afterAll(async () => {
  const snap = await db.collection(collection).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
  await db.terminate();
});

describe("Firestore emulator: learning path store", () => {
  it("creates, reads back and lists a path by owner", async () => {
    const svc = service();
    const created = await svc.create(uid("a"), PS);
    expect(created.id).toMatch(/^lp_[0-9a-f-]{36}$/);
    const doc = await db.collection(collection).doc(created.id).get();
    expect(doc.exists).toBe(true);
    expect((doc.data() as LearningPathRecord).owner_uid).toBe(uid("a"));

    expect(await svc.get(uid("a"), created.id)).toEqual(created);
    const owned = await store.listByOwner(uid("a"));
    expect(owned.map((r) => r.id)).toEqual([created.id]);
    expect((await svc.list(uid("a"))).paths).toEqual([{ id: created.id, role: created.role, updated_at: NOW.toISOString(), percent_complete: 0 }]);
  });

  it("never gives one student another's path, and leaves it untouched", async () => {
    const svc = service();
    const mine = await svc.create(uid("owner"), PS);
    expect(await store.listByOwner(uid("intruder"))).toEqual([]);
    expect((await svc.list(uid("intruder"))).paths).toEqual([]);
    await expect(svc.get(uid("intruder"), mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(svc.agentLog(uid("intruder"), mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(svc.assess(uid("intruder"), mine.id, { source: "simulation", skill: "JavaScript", score: 10 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(svc.changeGoal(uid("intruder"), mine.id, { role_id: "data_analyst" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await svc.get(uid("owner"), mine.id)).toEqual(mine); // unchanged, still version 1
    expect(mine.path.version).toBe(1);
  });

  it("applies updates in order and serialises concurrent ones, and the result survives a fresh service", async () => {
    const svc = service();
    const p = await svc.create(uid("upd"), PS);
    const send = (skill: string, score: number) => svc.assess(uid("upd"), p.id, { source: "simulation", skill, score });
    await Promise.all([send("Git", 90), send("Testing", 90)]);
    const after = await service().get(uid("upd"), p.id); // a different service instance reads what Firestore holds
    expect(after.path.version).toBe(3);
    expect(after.path.states.map((s) => s.skill_id)).toEqual(expect.arrayContaining(["git", "testing"]));
    expect(after.path.history).toHaveLength(3);
    const ids = after.agent_log.map((e) => e.id);
    expect(ids).toEqual(ids.map((_, i) => `log-${i + 1}`)); // sequential, no id reused or lost
    expect(new Date(after.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(p.updated_at).getTime());
    const switched = await svc.changeGoal(uid("upd"), p.id, { role_id: "data_analyst" });
    expect((await service().get(uid("upd"), p.id)).path.version).toBe(4);
    expect(switched.role.id).toBe("data_analyst");
  });

  it("caps each student at 20 paths and the 21st is refused", async () => {
    const svc = service();
    for (let i = 0; i < MAX_PATHS_PER_STUDENT; i++) await svc.create(uid("cap"), { role_id: "fullstack_developer" });
    expect((await store.listByOwner(uid("cap"))).length).toBe(MAX_PATHS_PER_STUDENT);
    await expect(svc.create(uid("cap"), { role_id: "fullstack_developer" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: /most you can keep/ });
    expect((await store.listByOwner(uid("cap"))).length).toBe(MAX_PATHS_PER_STUDENT);
    // another student is not affected by someone else's cap
    await expect(svc.create(uid("cap-other"), { role_id: "fullstack_developer" })).resolves.toBeTruthy();
  });

  it("deletes everything a student has, and only theirs (what account deletion calls)", async () => {
    const svc = service();
    await svc.create(uid("del"), PS);
    await svc.create(uid("del"), PS);
    const keep = await svc.create(uid("del-keep"), PS);
    expect(await svc.exportAll(uid("del"))).toHaveLength(2);
    expect(await svc.deleteAll(uid("del"))).toBe(2);
    expect(await store.listByOwner(uid("del"))).toEqual([]);
    expect(await svc.deleteAll(uid("del"))).toBe(0); // idempotent
    expect((await svc.get(uid("del-keep"), keep.id)).id).toBe(keep.id);
  });

  it("round-trips the agent log, mentor note and roadmap exactly as written", async () => {
    const svc = service();
    const p = await svc.create(uid("log"), PS);
    const failed = await svc.assess(uid("log"), p.id, { source: "simulation", skill: "JavaScript", score: 40 });
    const raw = await store.get(failed.id);
    expect(raw).not.toBeNull();
    // what Firestore holds equals what the API returned: nulls kept (to, concept, verified_proficiency), nothing dropped
    expect(raw!.agent_log).toEqual(failed.agent_log);
    expect(raw!.mentor).toEqual(failed.mentor);
    expect(raw!.path).toEqual(failed.path);
    expect(raw!.agent_log.filter((e) => e.kind === "handoff").every((e) => e.to !== null)).toBe(true);
    expect(raw!.agent_log.filter((e) => e.kind === "action").every((e) => e.to === null)).toBe(true);
    expect(raw!.path.steps.some((s) => s.kind === "remedial" && s.concept === "Closures & event loop")).toBe(true);
    expect(raw!.path.steps.find((s) => s.kind === "core")!.concept).toBeNull();
    // the stored log can be read again, in order, through the API
    expect((await svc.agentLog(uid("log"), p.id)).entries).toEqual(failed.agent_log);
  });

  it("refuses unsafe ids instead of touching another path", async () => {
    expect(await store.get("../x")).toBeNull();
    expect(await store.get("lp_not-a-real-id")).toBeNull();
    expect(await store.listByOwner("a/b")).toEqual([]);
    await store.delete("../x"); // no-op
    const rec = (await store.listByOwner(uid("a")))[0]!;
    await expect(store.put({ ...rec, owner_uid: "a/b" })).rejects.toThrow(/invalid id/);
    await expect(store.put({ ...rec, id: "lp_nope" })).rejects.toThrow(/invalid id/);
  });
});
