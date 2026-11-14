import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "@/App";
import { AuthProvider } from "@/auth/AuthContext";
import type { AuthClient } from "@/auth/types";
import { api } from "@/api/endpoints";
import type { AgentLogEntry, LearningPathView, PathChange, PathStep } from "@/types/learningPath";

vi.mock("@/api/endpoints", () => ({
  api: {
    getRoles: vi.fn(),
    listLearningPaths: vi.fn(),
    getLearningPath: vi.fn(),
    createLearningPath: vi.fn(),
    assessLearningPath: vi.fn(),
    changeLearningPathGoal: vi.fn(),
    getLearningPathAgentLog: vi.fn(),
    getHealth: vi.fn(),
  },
}));
const mocked = vi.mocked(api);

const fakeAuth: AuthClient = {
  configured: true,
  onChange(cb) {
    queueMicrotask(() => cb({ uid: "u1", email: "a@b.co" }));
    return () => undefined;
  },
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(async () => undefined),
  sendPasswordReset: vi.fn(),
  getIdToken: vi.fn(async () => "t"),
};
const renderPage = () =>
  render(
    <AuthProvider client={fakeAuth}>
      <MemoryRouter initialEntries={["/learning-path"]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthProvider>
  );

const NAMES: Record<string, string> = { javascript: "JavaScript", react: "React", nodejs: "Node.js", css: "CSS", git: "Git & Collaboration", python: "Python", sql: "SQL", stats_prob: "Statistics & Probability" };
const resources = {
  "js-javascript-info": { id: "js-javascript-info", skill_id: "javascript", title: "javascript.info: The Modern JavaScript Tutorial", url: "https://javascript.info/", type: "tutorial" as const, est_minutes: 600, level: "beginner" as const },
  "react-learn": { id: "react-learn", skill_id: "react", title: "React docs: Learn React", url: "https://react.dev/learn", type: "tutorial" as const, est_minutes: 300, level: "beginner" as const },
  "node-learn": { id: "node-learn", skill_id: "nodejs", title: "Node.js: Learn", url: "https://nodejs.org/en/learn", type: "tutorial" as const, est_minutes: 240, level: "beginner" as const },
};
const step = (topic: string, order: number, over: Partial<PathStep> = {}): PathStep => ({
  id: `step-${topic}`, skill_id: topic, role_skill_id: "web_frontend", kind: "core", resource_ids: Object.values(resources).filter((r) => r.skill_id === topic).map((r) => r.id),
  status: "pending", order, reason: `${NAMES[topic]} is required by Full Stack Developer (20% of the role), never practiced`, gap: 0.08, blocked_by: [], review_later: false, concept: null, ...over,
});
const change = (over: Partial<PathChange> = {}): PathChange => ({ at: "2026-11-14T08:00:00Z", kind: "initial", reason: "Built a 3-step path for Full Stack Developer.", added: [], removed: [], reordered: [], kept: [], status_changes: [], ...over });
const handoff = (id: number, agent: AgentLogEntry["agent"], to: AgentLogEntry["agent"], text: string): AgentLogEntry => ({ id: `log-${id}`, at: "2026-11-14T08:00:00Z", kind: "handoff", agent, to, action: "handoff", summary: text, decided_by: "deterministic", inputs_ref: agent, outputs_ref: to });
const action = (id: number, agent: AgentLogEntry["agent"], act: string, summary: string, decided_by: AgentLogEntry["decided_by"] = "deterministic"): AgentLogEntry => ({ id: `log-${id}`, at: "2026-11-14T08:00:00Z", kind: "action", agent, to: null, action: act, summary, decided_by, inputs_ref: "x", outputs_ref: "y" });

const view = (over: Partial<LearningPathView> = {}): LearningPathView => ({
  id: "lp_11111111-1111-1111-1111-111111111111",
  role: { id: "fullstack_developer", name: "Full Stack Developer" },
  created_at: "2026-11-14T08:00:00Z",
  updated_at: "2026-11-14T08:00:00Z",
  profile: { skills: ["Python", "SQL", "HTML"], certifications: [], projects: [], career_interests: [] },
  unrecognized_skills: [],
  certification_skills: [],
  career_match: { role_id: "fullstack_developer", percent: 9, alternatives: [{ role_id: "data_analyst", name: "Data Analyst", match_percent: 21 }, { role_id: "ml_engineer", name: "Machine Learning Engineer", match_percent: 8 }, { role_id: "backend_developer", name: "Backend Developer", match_percent: 6 }] },
  analysis: {
    gaps: [
      { skill_id: "web_frontend", name: "Frontend Fundamentals", weight: 0.2, mastery: 0.06, gap: 0.188, missing_topics: [{ topic: "javascript", name: "JavaScript", mastery: 0 }, { topic: "react", name: "React", mastery: 0 }], unverified: true },
      { skill_id: "rest_apis", name: "REST API Design", weight: 0.2, mastery: 0, gap: 0.2, missing_topics: [{ topic: "nodejs", name: "Node.js", mastery: 0 }], unverified: false },
    ],
    strengths: [],
  },
  path: { role_id: "fullstack_developer", steps: [step("javascript", 1, { status: "active" }), step("react", 2), step("nodejs", 3)], version: 1, created_from: "initial", history: [change()], states: [], pace: "normal" },
  upcoming: [],
  progress: { percent_complete: 0, skill_bars: [{ skill_id: "web_frontend", name: "Frontend Fundamentals", weight: 0.2, mastery: 0.06, unverified: true }, { skill_id: "sql_databases", name: "SQL & Data Modelling", weight: 0.2, mastery: 0.4, unverified: true }], next_step: step("javascript", 1, { status: "active" }) },
  mentor: { message: "You're a 9% match for Full Stack Developer.", source: "template", at: "2026-11-14T08:00:00Z" },
  last_change: change(),
  resources,
  topic_names: NAMES,
  agent_log: [
    action(1, "profiler", "normalize_profile", "Matched 3 declared skill(s) from 3 entered."),
    handoff(2, "profiler", "skill_analyst", "Profiler → Skill Analyst: 3 declared skill(s)"),
    action(3, "skill_analyst", "read_verified_evidence", "No verified interrogation results yet."),
    handoff(4, "skill_analyst", "career_matcher", "Skill Analyst → Career Matcher: 3 skill state(s), 0 verified"),
    action(5, "mentor", "write_coaching_message", "Wrote a coaching message from the facts above using a fixed template (no AI model was used)."),
  ],
  has_simulation: false,
  ...over,
});

const failedView = (): LearningPathView => {
  const remedial = step("javascript", 1, { id: "remedial-javascript-1", kind: "remedial", status: "remedial", gap: 0, concept: "Closures & event loop", reason: 'Scored 40% on JavaScript: revisit "Closures & event loop" before going on' });
  const c = change({
    kind: "assessment",
    reason: 'Scored 40% on JavaScript (below 60%). Added a remedial step on "Closures & event loop" and paused 3 step(s) until it is done: JavaScript, React, Node.js. Pace set to slow.',
    added: [{ skill_id: "javascript", label: "Revisit: Closures & event loop", reason: "Scored 40% on JavaScript" }],
    status_changes: [{ step_id: "remedial-javascript-1", label: "Revisit: Closures & event loop", from: null, to: "remedial" }, { step_id: "step-react", label: "React", from: "pending", to: "blocked" }],
  });
  return view({
    path: { role_id: "fullstack_developer", steps: [remedial, step("javascript", 2, { status: "blocked", blocked_by: [remedial.id] }), step("react", 3, { status: "blocked", blocked_by: [remedial.id] }), step("nodejs", 4, { status: "blocked", blocked_by: [remedial.id] })], version: 2, created_from: "assessment", history: [change(), c], states: [], pace: "slow" },
    last_change: c,
    mentor: { message: 'That result was below the bar, so I put a short review of "Closures & event loop" in front of the next steps.', source: "template", at: "2026-11-14T09:00:00Z" },
    has_simulation: true,
    agent_log: [
      ...view().agent_log,
      action(6, "skill_analyst", "ingest_assessment", "Recorded 40% on JavaScript from a simulation."),
      handoff(7, "skill_analyst", "progress_evaluator", "Skill Analyst → Progress Evaluator: JavaScript: 40% (simulation)"),
      action(8, "progress_evaluator", "evaluate_assessment", "Scored 40% on JavaScript (below 60%)."),
      handoff(9, "progress_evaluator", "curriculum_planner", "Progress Evaluator → Curriculum Planner: 1 remedial step added, dependent steps paused"),
      action(10, "curriculum_planner", "review_replan", "Checked the re-plan: 1 remedial step(s) first."),
      handoff(11, "curriculum_planner", "mentor", "Curriculum Planner → Mentor: 4 open step(s), next: Revisit: Closures & event loop"),
      action(12, "mentor", "write_coaching_message", "Wrote a coaching message from the facts above with the AI model (language only; it chose nothing).", "llm"),
    ],
  });
};

beforeEach(() => {
  vi.resetAllMocks();
  mocked.getHealth.mockResolvedValue({ status: "ok", llm_mode: "mock", model: null } as never);
  mocked.getRoles.mockResolvedValue({ roles: [{ id: "fullstack_developer", name: "Full Stack Developer", description: "", skill_count: 7 }, { id: "data_analyst", name: "Data Analyst", description: "", skill_count: 6 }] });
  mocked.listLearningPaths.mockResolvedValue({ paths: [] });
});

describe("Learning Path page", () => {
  it("builds the sample student's path: gaps, ordered roadmap with resources, match and unverified marks", async () => {
    mocked.createLearningPath.mockResolvedValue(view());
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Load sample student/ }));
    const chips = within(screen.getByRole("list", { name: "Your skills" }));
    expect(chips.getByText("Python")).toBeInTheDocument();
    expect(chips.getByText("SQL")).toBeInTheDocument();
    expect(chips.getByText("HTML")).toBeInTheDocument();
    expect(screen.getByLabelText("Target career")).toHaveValue("fullstack_developer");
    fireEvent.click(screen.getByRole("button", { name: "Build my learning path" }));

    await waitFor(() => expect(mocked.createLearningPath).toHaveBeenCalledWith({ role_id: "fullstack_developer", skills: ["Python", "SQL", "HTML"], certifications: [], projects: [] }));
    expect(await screen.findByText("9%")).toBeInTheDocument();
    expect(screen.getByText("match for Full Stack Developer")).toBeInTheDocument();
    expect(screen.getByText(/Data Analyst:/)).toBeInTheDocument();
    expect(screen.getByText("JavaScript, React")).toBeInTheDocument(); // missing topics under Frontend Fundamentals
    // unverified skills are marked and link to the existing interrogation flow
    expect(screen.getAllByText("Unverified, capped at 40%").length).toBeGreaterThan(0);
    const verify = screen.getAllByRole("link", { name: /Verify this skill/ })[0]!;
    expect(verify).toHaveAttribute("href", "/setup");
    // roadmap in order, with resources that open safely in a new tab
    const steps = within(screen.getByRole("list", { name: "Roadmap steps in order" })).getAllByRole("heading", { level: 3 });
    expect(steps.map((h) => h.textContent)).toEqual(["JavaScript", "React", "Node.js"]);
    const link = screen.getByRole("link", { name: /javascript\.info/ });
    expect(link).toHaveAttribute("href", "https://javascript.info/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("You're a 9% match for Full Stack Developer.")).toBeInTheDocument();
    expect(screen.getByText(/Template message: no AI model was used/)).toBeInTheDocument();
  });

  it("has exactly one h1 and labelled form controls", async () => {
    renderPage();
    await screen.findByLabelText("Skills you have");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const label of ["Skills you have", "Certifications (comma separated)", "Target career"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it("restores the latest path on reload instead of showing an empty form", async () => {
    mocked.listLearningPaths.mockResolvedValue({ paths: [{ id: view().id, role: view().role, updated_at: "x", percent_complete: 0 }] });
    mocked.getLearningPath.mockResolvedValue(failedView());
    renderPage();
    expect(await screen.findByText("Revisit: Closures & event loop", { selector: "h3" })).toBeInTheDocument();
    expect(mocked.getLearningPath).toHaveBeenCalledWith(view().id);
    expect(screen.queryByRole("button", { name: "Build my learning path" })).not.toBeInTheDocument();
  });

  it("a failed simulated assessment shows the remedial step, the paused steps, the reason, and the Simulation label", async () => {
    mocked.listLearningPaths.mockResolvedValue({ paths: [{ id: view().id, role: view().role, updated_at: "x", percent_complete: 0 }] });
    mocked.getLearningPath.mockResolvedValue(view());
    mocked.assessLearningPath.mockResolvedValue(failedView());
    renderPage();
    await screen.findByRole("button", { name: "Apply simulated score" });
    // the simulation is labelled before anything is applied
    expect(screen.getAllByText("Simulation").length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Simulated score/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Skill"), { target: { value: "javascript" } });
    fireEvent.change(screen.getByLabelText(/Simulated score/), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply simulated score" }));

    await waitFor(() => expect(mocked.assessLearningPath).toHaveBeenCalledWith(view().id, { source: "simulation", skill: "javascript", score: 40 }));
    const roadmap = within(await screen.findByRole("list", { name: "Roadmap steps in order" }));
    expect(roadmap.getByText("Revisit: Closures & event loop", { selector: "h3" })).toBeInTheDocument();
    expect(roadmap.getByText("Review first")).toBeInTheDocument();
    expect(roadmap.getAllByText("Paused until review is done")).toHaveLength(3);
    expect(roadmap.getAllByText("Changed").length).toBeGreaterThan(0);
    const changed = screen.getByRole("heading", { name: "What changed" }).closest("section")!;
    expect(within(changed).getByText(/Scored 40% on JavaScript \(below 60%\)\. Added a remedial step on "Closures & event loop"/)).toBeInTheDocument();
    expect(within(changed).getByText("Simulation")).toBeInTheDocument();
    expect(screen.getByText(/includes simulated results/)).toBeInTheDocument();
    expect(screen.getByText(/slowed after a result below 60%/)).toBeInTheDocument();
    expect(screen.getByText(/That result was below the bar/)).toBeInTheDocument();
    // the live region announces the update
    expect(screen.getByRole("status")).toHaveTextContent("Simulated score of 40% applied.");
  });

  it("shows the agents' handoffs and who decided each step", async () => {
    mocked.listLearningPaths.mockResolvedValue({ paths: [{ id: view().id, role: view().role, updated_at: "x", percent_complete: 0 }] });
    mocked.getLearningPath.mockResolvedValue(failedView());
    renderPage();
    const log = within(await screen.findByRole("list", { name: /Agent activity/ }));
    const handoffs = log.getAllByTestId("handoff").map((h) => h.textContent);
    expect(handoffs.some((t) => t!.includes("Progress Evaluator → Curriculum Planner: 1 remedial step added"))).toBe(true);
    expect(handoffs.some((t) => t!.includes("Curriculum Planner → Mentor"))).toBe(true);
    expect(log.getAllByText("Deterministic").length).toBeGreaterThan(3);
    expect(log.getAllByText("AI wording")).toHaveLength(1);
    expect(screen.getByText(/Wording written by the AI|Template message/)).toBeInTheDocument();
    expect(screen.getByText(/agent log entries/)).toBeInTheDocument();
    expect(document.querySelector("details")!.hasAttribute("open")).toBe(true);
  });

  it("switching goal shows what was kept, added, removed and reordered, with reasons", async () => {
    mocked.listLearningPaths.mockResolvedValue({ paths: [{ id: view().id, role: view().role, updated_at: "x", percent_complete: 0 }] });
    mocked.getLearningPath.mockResolvedValue(view());
    const c = change({
      kind: "goal_change",
      reason: "Switched goal to Data Analyst: kept 2, added 1, removed 2, reordered 1.",
      kept: [{ skill_id: "python", label: "Python", reason: "Python already declared (counts as 40% until verified); it counts towards Data Analyst" }, { skill_id: "sql", label: "SQL", reason: "SQL already declared (counts as 40% until verified); it counts towards Data Analyst" }],
      added: [{ skill_id: "stats_prob", label: "Statistics & Probability", reason: "Statistics & Probability is required by Data Analyst (20% of the role), never practiced" }],
      removed: [{ skill_id: "react", label: "React", reason: "React is not required by Data Analyst" }, { skill_id: "nodejs", label: "Node.js", reason: "Node.js is not required by Data Analyst" }],
      reordered: [{ skill_id: "git", label: "Git & Collaboration", reason: "Git & Collaboration moved from position 3 to 1 among the steps kept" }],
    });
    mocked.changeLearningPathGoal.mockResolvedValue(view({ role: { id: "data_analyst", name: "Data Analyst" }, last_change: c, path: { ...view().path, role_id: "data_analyst", created_from: "goal_change", version: 2, history: [change(), c] } }));
    renderPage();
    fireEvent.change(await screen.findByLabelText("New target career"), { target: { value: "data_analyst" } });
    fireEvent.click(screen.getByRole("button", { name: "Switch goal" }));
    await waitFor(() => expect(mocked.changeLearningPathGoal).toHaveBeenCalledWith(view().id, "data_analyst"));

    const panel = within((await screen.findByRole("heading", { name: "What changed" })).closest("section")!);
    expect(panel.getByText(/Switched goal to Data Analyst: kept 2, added 1, removed 2, reordered 1\./)).toBeInTheDocument();
    for (const h of ["Kept", "Added", "Removed", "Reordered"]) expect(panel.getByRole("heading", { name: new RegExp(h) })).toBeInTheDocument();
    expect(panel.getByText(/Python already declared/)).toBeInTheDocument();
    expect(panel.getByText(/React is not required by Data Analyst/)).toBeInTheDocument();
    expect(panel.getByText(/Statistics & Probability is required by Data Analyst/)).toBeInTheDocument();
    expect(panel.getByText(/moved from position 3 to 1/)).toBeInTheDocument();
    expect(panel.queryByText("Simulation")).not.toBeInTheDocument(); // a goal change is not a simulation
  });

  it("labels an AI-written mentor message as AI", async () => {
    mocked.listLearningPaths.mockResolvedValue({ paths: [{ id: view().id, role: view().role, updated_at: "x", percent_complete: 0 }] });
    mocked.getLearningPath.mockResolvedValue(view({ mentor: { message: "Nice start.", source: "ai", at: "x" } }));
    renderPage();
    expect(await screen.findByText("Nice start.")).toBeInTheDocument();
    expect(screen.getByText(/Wording written by the AI from the facts above/)).toBeInTheDocument();
  });

  it("shows a server error without leaving the page and lists skills it could not match", async () => {
    mocked.listLearningPaths.mockResolvedValue({ paths: [{ id: view().id, role: view().role, updated_at: "x", percent_complete: 0 }] });
    mocked.getLearningPath.mockResolvedValue(view({ unrecognized_skills: ["Basket weaving"] }));
    mocked.assessLearningPath.mockRejectedValue(Object.assign(new Error("No verified interrogation result for \"javascript\" yet."), { code: "BAD_REQUEST" }));
    renderPage();
    expect(await screen.findByText(/could not match these to a skill we can plan for yet: Basket weaving/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use my interrogation result" }));
    await waitFor(() => expect(mocked.assessLearningPath).toHaveBeenCalledWith(view().id, { source: "interrogation", skill: "javascript" }));
    expect((await screen.findAllByRole("alert"))[0]).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Roadmap steps in order" })).toBeInTheDocument(); // the path is still there
  });

  it("shows what each certification maps to, or that no skills were mapped", async () => {
    mocked.listLearningPaths.mockResolvedValue({ paths: [{ id: view().id, role: view().role, updated_at: "x", percent_complete: 0 }] });
    mocked.getLearningPath.mockResolvedValue(
      view({
        profile: { ...view().profile, certifications: ["Meta Front-End Developer Professional Certificate", "AWS Cloud Practitioner"] },
        certification_skills: [{ cert: "Meta Front-End Developer Professional Certificate", topics: ["javascript", "react"] }, { cert: "AWS Cloud Practitioner", topics: [] }],
      })
    );
    renderPage();
    const list = within(await screen.findByRole("list", { name: "Your certifications" }));
    const items = list.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Meta Front-End Developer Professional Certificate: from certifications: JavaScript, React (declared, not verified)");
    expect(items[1]).toHaveTextContent("AWS Cloud Practitioner: no skills mapped");
  });

  it("shows no certification list when none were entered", async () => {
    mocked.listLearningPaths.mockResolvedValue({ paths: [{ id: view().id, role: view().role, updated_at: "x", percent_complete: 0 }] });
    mocked.getLearningPath.mockResolvedValue(view());
    renderPage();
    await screen.findByRole("list", { name: "Roadmap steps in order" });
    expect(screen.queryByRole("list", { name: "Your certifications" })).not.toBeInTheDocument();
  });

  it("is reachable from the navigation and the landing page", async () => {
    render(
      <AuthProvider client={fakeAuth}>
        <MemoryRouter initialEntries={["/"]}>
          <AppRoutes />
        </MemoryRouter>
      </AuthProvider>
    );
    const links = await screen.findAllByRole("link", { name: "Build my learning path" });
    expect(links[0]).toHaveAttribute("href", "/learning-path");
    expect(screen.getAllByRole("link", { name: "Audit My Readiness" }).length).toBeGreaterThan(0);
  });
});
