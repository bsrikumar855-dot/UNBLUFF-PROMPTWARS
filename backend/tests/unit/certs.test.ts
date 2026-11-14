import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeCertText, skillsFromCertifications } from "../../src/core/certs.js";
import type { CertRule } from "../../src/core/pathTypes.js";
import { parseLearningData } from "../../src/learning/data.js";
import type { Role } from "../../src/types.js";
import { roles } from "../helpers.js";

const dir = join(import.meta.dirname, "..", "..", "data", "learning");
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8").replace(/^\uFEFF/, "")) as Record<string, unknown>;
const all = roles.list().map((s) => roles.get(s.id)!) as Role[];
const shipped = parseLearningData(read("graph.json"), read("resources.json"), all, read("certifications.json"));
const rules = shipped.graph.certifications!;

const R = (id: string, keywords: string[], topics: string[]): CertRule => ({ id, keywords, topics });

describe("normalizeCertText", () => {
  it("lower-cases, drops punctuation except + and ., and collapses spaces", () => {
    expect(normalizeCertText("  CompTIA   Network+ (N10-008) ")).toBe("comptia network+ n10 008");
    expect(normalizeCertText("Node.js: Certified!")).toBe("node.js certified");
    expect(normalizeCertText("")).toBe("");
  });
});

describe("skillsFromCertifications", () => {
  const r = [R("py", ["pcep", "certified entry-level python programmer"], ["python"]), R("web", ["meta front-end developer"], ["html", "css", "javascript", "react"]), R("data", ["google data analytics"], ["sql", "python"])];

  it("maps a matching certification to its topics, case-insensitively and ignoring punctuation", () => {
    expect(skillsFromCertifications(["PCEP — Certified Entry-Level Python Programmer"], r).mappings).toEqual([{ cert: "PCEP — Certified Entry-Level Python Programmer", topics: ["python"] }]);
    // a hyphen and a space normalise the same, so spelling variants of the same name match
    expect(skillsFromCertifications(["meta FRONT END developer professional certificate"], r).topics).toEqual(["css", "html", "javascript", "react"]);
  });

  it("matches whole words only", () => {
    const rules2 = [R("k", ["cka"], ["containers"])];
    expect(skillsFromCertifications(["Package Manager Basics"], rules2).topics).toEqual([]);
    expect(skillsFromCertifications(["CKA exam"], rules2).topics).toEqual(["containers"]);
    expect(skillsFromCertifications(["My-CKA"], rules2).topics).toEqual(["containers"]);
  });

  it("keeps a certification no rule matches, with no skills, in the order entered", () => {
    const out = skillsFromCertifications(["AWS Cloud Practitioner", "PCEP", "Scrum Master"], r);
    expect(out.mappings).toEqual([{ cert: "AWS Cloud Practitioner", topics: [] }, { cert: "PCEP", topics: ["python"] }, { cert: "Scrum Master", topics: [] }]);
    expect(out.topics).toEqual(["python"]);
  });

  it("unions topics across certifications and rules, sorted and de-duplicated", () => {
    const out = skillsFromCertifications(["Google Data Analytics Certificate", "PCEP", "Meta Front-End Developer"], r);
    expect(out.topics).toEqual(["css", "html", "javascript", "python", "react", "sql"]);
    expect(out.mappings[0]!.topics).toEqual(["python", "sql"]);
  });

  it("applies every rule that matches one certification", () => {
    const two = [R("a", ["data"], ["sql"]), R("b", ["analytics"], ["data_viz"])];
    expect(skillsFromCertifications(["Data Analytics"], two).mappings[0]!.topics).toEqual(["data_viz", "sql"]);
  });

  it("trims, drops blank names and repeats (same name in any case/spacing), and handles no input", () => {
    const out = skillsFromCertifications(["  PCEP ", "pcep", "PCEP", "   ", ""], r);
    expect(out.mappings).toEqual([{ cert: "PCEP", topics: ["python"] }]);
    expect(skillsFromCertifications([], r)).toEqual({ mappings: [], topics: [] });
    expect(skillsFromCertifications(["PCEP"], [])).toEqual({ mappings: [{ cert: "PCEP", topics: [] }], topics: [] });
  });

  it("ignores a rule keyword that normalises to nothing", () => {
    expect(skillsFromCertifications(["anything"], [R("blank", ["!!!"], ["python"])]).topics).toEqual([]);
  });

  it("is deterministic", () => {
    const input = ["Meta Front-End Developer", "PCEP"];
    expect(skillsFromCertifications(input, r)).toEqual(skillsFromCertifications([...input], r));
  });
});

describe("the shipped certification rules", () => {
  it("only name topics that exist in the graph (never invented)", () => {
    for (const rule of rules) for (const t of rule.topics) expect(shipped.graph.topic_names[t], `${rule.id}: ${t}`).toBeDefined();
  });
  it("map real certifications as documented and leave generic cloud certifications unmapped", () => {
    const out = skillsFromCertifications(["Meta Front-End Developer Professional Certificate", "HashiCorp Terraform Associate", "CompTIA Network+", "Certified Kubernetes Administrator (CKA)", "AWS Cloud Practitioner", "Microsoft Azure Fundamentals AZ-900", "Google Cloud Digital Leader"], rules);
    const by = Object.fromEntries(out.mappings.map((m) => [m.cert, m.topics]));
    expect(by["Meta Front-End Developer Professional Certificate"]).toEqual(["css", "html", "javascript", "react"]);
    expect(by["HashiCorp Terraform Associate"]).toEqual(["iac_cloud"]);
    expect(by["CompTIA Network+"]).toEqual(["networking"]);
    expect(by["Certified Kubernetes Administrator (CKA)"]).toEqual(["containers"]);
    for (const generic of ["AWS Cloud Practitioner", "Microsoft Azure Fundamentals AZ-900", "Google Cloud Digital Leader"]) expect(by[generic]).toEqual([]);
  });
  it("does not let a short keyword match inside an unrelated name", () => {
    expect(skillsFromCertifications(["Backpack Packaging Certificate", "Network engineering diploma"], rules).topics).toEqual([]);
  });
});

describe("certification rule validation", () => {
  const g = () => read("graph.json");
  const res = () => read("resources.json");
  it("rejects an unknown topic, a duplicate id, and empty keywords", () => {
    expect(() => parseLearningData(g(), res(), all, { rules: [{ id: "x", keywords: ["x cert"], topics: ["cloud_basics"] }] })).toThrow(/unknown topic cloud_basics/);
    expect(() => parseLearningData(g(), res(), all, { rules: [{ id: "x", keywords: ["a"], topics: ["sql"] }, { id: "x", keywords: ["b"], topics: ["sql"] }] })).toThrow(/duplicate certification rule id x/);
    expect(() => parseLearningData(g(), res(), all, { rules: [{ id: "x", keywords: [], topics: ["sql"] }] })).toThrow();
    expect(() => parseLearningData(g(), res(), all, { rules: [{ id: "x", keywords: ["a"], topics: [] }] })).toThrow();
  });
  it("is optional: no rules means no certification mapping", () => {
    expect(parseLearningData(g(), res(), all).graph.certifications).toEqual([]);
  });
});
