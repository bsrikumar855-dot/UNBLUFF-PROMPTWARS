import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLearningData } from "../../src/learning/data.js";
import type { Role } from "../../src/types.js";
import { roles } from "../helpers.js";

const dir = join(import.meta.dirname, "..", "..", "data", "learning");
interface RawGraph { skill_topics: Record<string, { topic: string; share: number }[]>; prerequisites: Record<string, string[]> }
interface RawRes { resources: { id: string; skill_id: string; url: string }[] }
const rawGraph = () => JSON.parse(readFileSync(join(dir, "graph.json"), "utf8")) as RawGraph;
const rawRes = () => JSON.parse(readFileSync(join(dir, "resources.json"), "utf8")) as RawRes;
const all = roles.list().map((s) => roles.get(s.id)!) as Role[];

describe("parseLearningData", () => {
  it("accepts the shipped data, names identity topics after their role skill, and uses only https links", () => {
    const d = parseLearningData(rawGraph(), rawRes(), all);
    expect(d.graph.topic_names["javascript"]).toBe("JavaScript");
    expect(d.graph.topic_names["stats_prob"]).toBe("Statistics & Probability");
    expect(d.resources.length).toBeGreaterThan(40);
    expect(d.resources.every((r) => r.url.startsWith("https://"))).toBe(true);
  });
  it("rejects a skill_topics entry for an unknown role skill", () => {
    const g = rawGraph();
    g.skill_topics.not_a_skill = [{ topic: "sql", share: 1 }];
    expect(() => parseLearningData(g, rawRes(), all)).toThrow(/unknown role skill/);
  });
  it("rejects shares that do not sum to 1", () => {
    const g = rawGraph();
    g.skill_topics.sql_databases = [{ topic: "sql", share: 0.5 }];
    expect(() => parseLearningData(g, rawRes(), all)).toThrow(/shares sum to 0.5/);
  });
  it("rejects an unknown topic in skill_topics or prerequisites", () => {
    const a = rawGraph();
    a.skill_topics.sql_databases = [{ topic: "nope", share: 1 }];
    expect(() => parseLearningData(a, rawRes(), all)).toThrow(/unknown topic nope/);
    const b = rawGraph();
    b.prerequisites.react = ["nope"];
    expect(() => parseLearningData(b, rawRes(), all)).toThrow(/unknown topic nope/);
  });
  it("rejects a prerequisite cycle", () => {
    const g = rawGraph();
    g.prerequisites.javascript = ["react"];
    expect(() => parseLearningData(g, rawRes(), all)).toThrow(/Prerequisite cycle/);
  });
  it("rejects duplicate resource ids, unknown topics and non-https links", () => {
    const dup = rawRes();
    dup.resources.push({ ...dup.resources[0]! });
    expect(() => parseLearningData(rawGraph(), dup, all)).toThrow(/duplicate resource id/);
    const unk = rawRes();
    unk.resources[0]!.skill_id = "nope";
    expect(() => parseLearningData(rawGraph(), unk, all)).toThrow(/unknown topic nope/);
    const http = rawRes();
    http.resources[0]!.url = "http://insecure.test";
    expect(() => parseLearningData(rawGraph(), http, all)).toThrow();
  });
});
