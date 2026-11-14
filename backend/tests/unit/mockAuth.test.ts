import { describe, expect, it } from "vitest";
import { MockTokenVerifier } from "../../src/auth/verifier.js";
import { loadConfig } from "../../src/config.js";

describe("MockTokenVerifier", () => {
  const v = new MockTokenVerifier();
  it("accepts mock:<uid> and returns that uid", async () => {
    await expect(v.verify("mock:demo-student")).resolves.toMatchObject({ uid: "demo-student", email_verified: true });
  });
  it("rejects anything else", async () => {
    for (const t of ["", "demo-student", "mock:", "mock:a b", "mock:../x", `mock:${"a".repeat(65)}`, "eyJhbGciOi.x.y"]) {
      await expect(v.verify(t)).rejects.toThrow();
    }
  });
});

describe("AUTH_MODE config", () => {
  it("defaults to firebase", () => {
    expect(loadConfig({ LLM_MODE: "mock" }).AUTH_MODE).toBe("firebase");
  });
  it("allows mock in development", () => {
    expect(loadConfig({ LLM_MODE: "mock", AUTH_MODE: "mock" }).AUTH_MODE).toBe("mock");
  });
  it("refuses mock in production", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", AUTH_MODE: "mock", LLM_MODE: "mock", ALLOW_MOCK_LLM: "true", STORE: "memory", ALLOW_EPHEMERAL_STORE: "true", FIREBASE_PROJECT_ID: "p", CORS_ORIGIN: "https://a.example.com" })
    ).toThrow(/AUTH_MODE/);
  });
});
