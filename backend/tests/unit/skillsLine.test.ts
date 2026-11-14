import { describe, expect, it } from "vitest";
import { isSkillsListLine } from "../../src/core/claims.js";

describe("isSkillsListLine", () => {
  it("flags bare keyword lists", () => {
    for (const l of ["Skills: Node.js, PostgreSQL, Redis", "Technical Skills – Python | SQL | Docker", "Tech stack: React, TypeScript", "Languages: Java; Go", "Tools & Technologies: Git, Docker, Jenkins"]) expect(isSkillsListLine(l), l).toBe(true);
  });
  it("keeps real claims and ambiguous lines", () => {
    for (const l of [
      "- Added Redis caching to a Node.js API, cutting database load by 60 percent.",
      "Skills: built a Redis cache that cut load by 60%",
      "Skills: Node.js",
      "Skills",
      "Experience: Backend Intern, Acme Labs",
      "Languages: fluent in English and Hindi, wrote a 20-page Spanish thesis",
    ]) expect(isSkillsListLine(l), l).toBe(false);
  });
});
