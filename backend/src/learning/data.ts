import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { LearningGraph, Resource } from "../core/pathTypes.js";
import type { RoleRegistry } from "../services/roles.js";
import type { Role } from "../types.js";

const Id = z.string().regex(/^[a-z0-9_]+$/);

const GraphFile = z.object({
  topic_names: z.record(Id, z.string().min(1)),
  skill_topics: z.record(Id, z.array(z.object({ topic: Id, share: z.number().positive().max(1) })).min(1)),
  prerequisites: z.record(Id, z.array(Id)),
  aliases: z.record(z.string().min(1), Id).optional(),
});

const CertFile = z.object({
  rules: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), keywords: z.array(z.string().trim().min(1)).min(1), topics: z.array(Id).min(1) })),
});

const ResourceFile = z.object({
  resources: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9-]+$/),
      skill_id: Id,
      title: z.string().min(1),
      url: z.string().url().startsWith("https://"),
      type: z.enum(["course", "tutorial", "exercise"]),
      est_minutes: z.number().int().positive().max(3000),
      level: z.enum(["beginner", "intermediate", "advanced"]),
    }),
  ),
});

export interface LearningData {
  graph: LearningGraph;
  resources: Resource[];
}

function assertAcyclic(prerequisites: Record<string, string[]>): void {
  const state = new Map<string, 1 | 2>();
  const visit = (t: string, path: string[]): void => {
    if (state.get(t) === 2) return;
    if (state.get(t) === 1) throw new Error(`Prerequisite cycle: ${[...path, t].join(" -> ")}`);
    state.set(t, 1);
    for (const p of prerequisites[t] ?? []) visit(p, [...path, t]);
    state.set(t, 2);
  };
  for (const t of Object.keys(prerequisites)) visit(t, []);
}

/** Validates the curated learning data against the roles. Throws on any problem (fail fast at startup). */
export function parseLearningData(rawGraph: unknown, rawResources: unknown, roles: readonly Role[], rawCerts: unknown = { rules: [] }): LearningData {
  const g = GraphFile.parse(rawGraph);
  const r = ResourceFile.parse(rawResources);
  const c = CertFile.parse(rawCerts);

  const topicNames: Record<string, string> = { ...g.topic_names };
  const roleSkillIds = new Set<string>();
  for (const role of roles) {
    for (const s of role.skills) {
      roleSkillIds.add(s.id);
      if (!g.skill_topics[s.id]) topicNames[s.id] ??= s.name; // an identity topic is named after its role skill; mapped topics must be declared in topic_names
    }
  }
  for (const [skill, topics] of Object.entries(g.skill_topics)) {
    if (!roleSkillIds.has(skill)) throw new Error(`skill_topics names an unknown role skill: ${skill}`);
    const sum = topics.reduce((a, t) => a + t.share, 0);
    if (Math.abs(sum - 1) > 0.001) throw new Error(`skill_topics ${skill}: shares sum to ${sum}, expected 1`);
    for (const t of topics) if (!(t.topic in topicNames)) throw new Error(`skill_topics ${skill}: unknown topic ${t.topic}`);
  }
  for (const [topic, pre] of Object.entries(g.prerequisites)) {
    for (const t of [topic, ...pre]) if (!(t in topicNames)) throw new Error(`prerequisites: unknown topic ${t}`);
  }
  assertAcyclic(g.prerequisites);
  for (const [alias, topic] of Object.entries(g.aliases ?? {})) {
    if (!(topic in topicNames)) throw new Error(`alias "${alias}" points to unknown topic ${topic}`);
    if (alias !== alias.toLowerCase()) throw new Error(`alias "${alias}" must be lower case`);
  }

  const certIds = new Set<string>();
  for (const rule of c.rules) {
    if (certIds.has(rule.id)) throw new Error(`duplicate certification rule id ${rule.id}`);
    certIds.add(rule.id);
    for (const t of rule.topics) if (!(t in topicNames)) throw new Error(`certification rule ${rule.id}: unknown topic ${t}`);
  }

  const ids = new Set<string>();
  for (const res of r.resources) {
    if (ids.has(res.id)) throw new Error(`duplicate resource id ${res.id}`);
    ids.add(res.id);
    if (!(res.skill_id in topicNames)) throw new Error(`resource ${res.id}: unknown topic ${res.skill_id}`);
  }
  return { graph: { topic_names: topicNames, skill_topics: g.skill_topics, prerequisites: g.prerequisites, aliases: g.aliases ?? {}, certifications: c.rules }, resources: r.resources };
}

export function loadLearningData(dir: string, roles: RoleRegistry): LearningData {
  const list = roles.list().map((s) => roles.get(s.id)).filter((r): r is Role => r !== undefined);
  return parseLearningData(JSON.parse(readFileSync(join(dir, "graph.json"), "utf8").replace(/^\uFEFF/, "")), JSON.parse(readFileSync(join(dir, "resources.json"), "utf8").replace(/^\uFEFF/, "")), list, JSON.parse(readFileSync(join(dir, "certifications.json"), "utf8").replace(/^\uFEFF/, "")));
}
