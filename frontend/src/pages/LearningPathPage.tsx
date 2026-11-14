import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Sparkles, X } from "lucide-react";
import { api } from "@/api/endpoints";
import { useRoles } from "@/hooks/useRoles";
import { Pill } from "@/components/learn/LearnBits";
import { AgentTimeline, ChangePanel, MasteryBar, ResourceLink, StepStatusBadge } from "@/components/learningPath/parts";
import { lastAssessmentWasSimulation } from "@/components/learningPath/helpers";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { TILE } from "@/components/ui/GlassCard";
import { LoadingState } from "@/components/ui/LoadingState";
import { Page, PageHeader, Section } from "@/components/ui/Page";
import { cn } from "@/lib/cn";
import { getErrorMessage } from "@/lib/errors";
import { routes } from "@/lib/routes";
import type { LearningPathView } from "@/types/learningPath";

const SAMPLE = { role_id: "fullstack_developer", skills: ["Python", "SQL", "HTML"] };
const field = "w-full rounded-xl border border-line bg-white/80 px-3 py-2 text-sm text-ink-primary outline-none focus-visible:ring-2 focus-visible:ring-redline/40";

interface ProjectDraft {
  name: string;
  skills: string;
}

/** /learning-path: one screen that tells the whole story, from profile to adaptive roadmap, with the agents' activity. */
const LearningPathPage: React.FC = () => {
  const { roles } = useRoles();
  const [view, setView] = useState<LearningPathView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [busy, setBusy] = useState<null | "create" | "assess" | "goal">(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [editing, setEditing] = useState(false);

  // profile form
  const [roleId, setRoleId] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [skillDraft, setSkillDraft] = useState("");
  const [certs, setCerts] = useState("");
  const [projects, setProjects] = useState<ProjectDraft[]>([]);

  // assessment + goal
  const [assessSkill, setAssessSkill] = useState("");
  const [score, setScore] = useState(40);
  const [newGoal, setNewGoal] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { paths } = await api.listLearningPaths();
      setView(paths[0] ? await api.getLearningPath(paths[0].id) : null);
    } catch (e) {
      setLoadError(e);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const showForm = !loading && (view === null || editing);
  const topicOptions = useMemo(() => {
    if (!view) return [];
    const seen = new Set<string>();
    return view.path.steps
      .filter((s) => s.kind === "core" && s.status !== "done" && !seen.has(s.skill_id) && seen.add(s.skill_id))
      .map((s) => ({ id: s.skill_id, label: view.topic_names[s.skill_id] ?? s.skill_id }));
  }, [view]);
  useEffect(() => {
    if (topicOptions.length > 0 && !topicOptions.some((t) => t.id === assessSkill)) setAssessSkill(topicOptions[0]!.id);
  }, [topicOptions, assessSkill]);

  const run = async (kind: "create" | "assess" | "goal", fn: () => Promise<LearningPathView>, done: string) => {
    setBusy(kind);
    setActionError(null);
    try {
      const next = await fn();
      setView(next);
      setEditing(false);
      setAnnounce(done);
    } catch (e) {
      setActionError(getErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const addSkill = () => {
    const t = skillDraft.trim();
    if (t && !skills.some((s) => s.toLowerCase() === t.toLowerCase())) setSkills([...skills, t]);
    setSkillDraft("");
  };
  const loadSample = () => {
    setRoleId(SAMPLE.role_id);
    setSkills(SAMPLE.skills);
    setCerts("");
    setProjects([]);
  };
  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const pending = skillDraft.trim();
    const all = pending && !skills.some((s) => s.toLowerCase() === pending.toLowerCase()) ? [...skills, pending] : skills;
    setSkillDraft("");
    void run(
      "create",
      () =>
        api.createLearningPath({
          role_id: roleId,
          skills: all,
          certifications: certs.split(",").map((c) => c.trim()).filter(Boolean),
          projects: projects.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), skills: p.skills.split(",").map((s) => s.trim()).filter(Boolean) })),
        }),
      "Learning path created."
    );
  };

  const simulated = view ? lastAssessmentWasSimulation(view) : false;
  const changed = new Set(view ? view.last_change.status_changes.map((c) => c.step_id) : []);

  return (
    <Page>
      <PageHeader
        eyebrow="SkillForge"
        title="Your learning path"
        description="Tell us what you know and where you want to go. Specialised agents find your gaps, plan a roadmap with free resources, and re-plan when you change goal or struggle on an assessment. Every decision is a fixed rule; the AI only helps with wording."
      />

      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      {loading && <LoadingState message="Loading your learning path…" />}
      {loadError !== null && !loading && <ErrorState error={loadError} onRetry={() => void load()} />}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-10">
        {/* 1. Profile */}
        {!loading && loadError === null && (
          <Section title="Profile" index="01" id="profile">
            {showForm ? (
              <form onSubmit={create} className={cn(TILE, "space-y-5 p-5")} aria-label="Learner profile">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-ink-secondary">Skills you list count as declared (at most 40%) until you verify them.</p>
                  <Button type="button" variant="outline" size="sm" onClick={loadSample}>
                    <Sparkles size={14} aria-hidden="true" /> Load sample student (Python, SQL, HTML → Full Stack)
                  </Button>
                </div>

                <div>
                  <label htmlFor="skill-draft" className="mb-1 block text-sm font-medium text-ink-primary">
                    Skills you have
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="skill-draft"
                      className={field}
                      value={skillDraft}
                      placeholder="e.g. Python"
                      onChange={(e) => setSkillDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addSkill();
                        }
                      }}
                    />
                    <Button type="button" variant="outline" size="sm" onClick={addSkill}>
                      <Plus size={14} aria-hidden="true" /> Add skill
                    </Button>
                  </div>
                  {skills.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-2" aria-label="Your skills">
                      {skills.map((s) => (
                        <li key={s} className="inline-flex items-center gap-1 rounded-full bg-white/80 py-1 pl-3 pr-1 text-sm shadow-[inset_0_0_0_1px_rgba(24,24,27,0.1)]">
                          {s}
                          <button type="button" aria-label={`Remove ${s}`} className="grid size-6 place-items-center rounded-full hover:bg-black/5" onClick={() => setSkills(skills.filter((x) => x !== s))}>
                            <X size={12} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="certs" className="mb-1 block text-sm font-medium text-ink-primary">
                      Certifications (comma separated)
                    </label>
                    <input id="certs" className={field} value={certs} onChange={(e) => setCerts(e.target.value)} placeholder="e.g. AWS Cloud Practitioner" />
                  </div>
                  <div>
                    <label htmlFor="target-role" className="mb-1 block text-sm font-medium text-ink-primary">
                      Target career
                    </label>
                    <select id="target-role" className={field} value={roleId} onChange={(e) => setRoleId(e.target.value)} required>
                      <option value="">Choose a role…</option>
                      {(roles ?? []).map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <fieldset className="space-y-3">
                  <legend className="mb-1 text-sm font-medium text-ink-primary">Projects (their skills count as declared)</legend>
                  {projects.map((p, i) => (
                    <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <input aria-label={`Project ${i + 1} name`} className={field} placeholder="Project name" value={p.name} onChange={(e) => setProjects(projects.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                      <input aria-label={`Project ${i + 1} skills`} className={field} placeholder="Skills used, comma separated" value={p.skills} onChange={(e) => setProjects(projects.map((x, j) => (j === i ? { ...x, skills: e.target.value } : x)))} />
                      <Button type="button" variant="outline" size="sm" onClick={() => setProjects(projects.filter((_, j) => j !== i))}>
                        Remove
                      </Button>
                    </div>
                  ))}
                  {projects.length < 5 && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setProjects([...projects, { name: "", skills: "" }])}>
                      <Plus size={14} aria-hidden="true" /> Add project
                    </Button>
                  )}
                </fieldset>

                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" disabled={busy !== null || roleId === ""}>
                    {busy === "create" ? "Building your path…" : "Build my learning path"}
                  </Button>
                  {view && (
                    <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
            ) : (
              view && (
                <div className={cn(TILE, "space-y-3 p-5")}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-ink-secondary">
                      Target: <span className="font-medium text-ink-primary">{view.role.name}</span>
                    </p>
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
                      Start a new profile
                    </Button>
                  </div>
                  <ul className="flex flex-wrap gap-2" aria-label="Your skills">
                    {view.profile.skills.map((s) => (
                      <li key={s}>
                        <Pill>{s}</Pill>
                      </li>
                    ))}
                    {view.profile.projects.map((p) => (
                      <li key={p.name}>
                        <Pill tone="ink">Project: {p.name}</Pill>
                      </li>
                    ))}
                  </ul>
                  {view.certification_skills.length > 0 && (
                    <div>
                      <h3 className="mb-1 text-sm font-semibold text-ink-primary">Certifications</h3>
                      <ul className="space-y-1 text-sm text-ink-secondary" aria-label="Your certifications">
                        {view.certification_skills.map((c) => (
                          <li key={c.cert}>
                            <Pill tone="core">Cert</Pill> <span className="text-ink-primary">{c.cert}</span>:{" "}
                            {c.topics.length > 0 ? (
                              <>
                                from certifications: {c.topics.map((t) => view.topic_names[t] ?? t).join(", ")} <span className="text-ink-muted">(declared, not verified)</span>
                              </>
                            ) : (
                              <span className="text-ink-muted">no skills mapped</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {view.unrecognized_skills.length > 0 && (
                    <p role="note" className="text-sm text-redline">
                      We could not match these to a skill we can plan for yet: {view.unrecognized_skills.join(", ")}.
                    </p>
                  )}
                </div>
              )
            )}
            {actionError && (
              <p role="alert" className="mt-3 text-sm text-redline">
                {actionError}
              </p>
            )}
          </Section>
        )}

        {view && (
          <>
            {/* 2. Career match */}
            <Section title="Career match" index="02" id="match">
              <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
                <div className={cn(TILE, "p-5 text-center")}>
                  <p className="serif text-5xl font-medium tabular-nums text-ink-primary">{view.career_match.percent}%</p>
                  <p className="mt-1 text-sm text-ink-secondary">match for {view.role.name}</p>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-ink-primary">Other roles, by current match</h3>
                  <ul className="space-y-1 text-sm text-ink-secondary">
                    {view.career_match.alternatives.map((a) => (
                      <li key={a.role_id}>
                        {a.name}: <span className="tabular-nums text-ink-primary">{a.match_percent}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Section>

            {/* 3. Skill analysis */}
            <Section title="Skill analysis" index="03" id="analysis" description="Strengths and gaps for the role. A skill you only declared counts at most 40% until you verify it.">
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-ink-primary">Gaps</h3>
                  {view.analysis.gaps.length === 0 ? (
                    <p className="text-sm text-ink-muted">No gaps.</p>
                  ) : (
                    <ul className="space-y-4">
                      {view.analysis.gaps.map((g) => (
                        <li key={g.skill_id} className={cn(TILE, "p-4")}>
                          <MasteryBar label={g.name} mastery={g.mastery} unverified={g.unverified} />
                          {g.missing_topics.length > 0 && (
                            <p className="mt-2 text-sm text-ink-secondary">
                              Missing: <span className="text-ink-primary">{g.missing_topics.map((t) => t.name).join(", ")}</span>
                            </p>
                          )}
                          {g.unverified && (
                            <Link to={routes.setup} className="mt-2 inline-block text-sm text-redline underline underline-offset-4">
                              Verify this skill
                              <span className="sr-only"> ({g.name}) in the readiness audit</span>
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-ink-primary">Strengths</h3>
                  {view.analysis.strengths.length === 0 ? (
                    <p className="text-sm text-ink-muted">None yet. Verified skills appear here.</p>
                  ) : (
                    <ul className="space-y-4">
                      {view.analysis.strengths.map((g) => (
                        <li key={g.skill_id} className={cn(TILE, "p-4")}>
                          <MasteryBar label={g.name} mastery={g.mastery} unverified={g.unverified} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </Section>

            {/* What changed (assessment or goal change) */}
            {view.last_change.kind !== "initial" && (
              <Section title="What changed" id="changed" description="Built from the rules that re-planned your roadmap, not written by the AI.">
                <div className={cn(TILE, "p-5")} aria-live="polite">
                  <ChangePanel change={view.last_change} simulated={simulated} />
                </div>
              </Section>
            )}

            {/* 4. Roadmap */}
            <Section title="Roadmap" index="04" id="roadmap" description={`Pace: ${view.path.pace === "slow" ? "slowed after a result below 60%" : "normal"}. Steps follow prerequisites.`}>
              {view.has_simulation && (
                <p role="note" className="mb-4 flex items-center gap-2 text-sm text-ink-secondary">
                  <Pill tone="alert">Simulation</Pill> This roadmap includes simulated results. They are not real assessments.
                </p>
              )}
              {view.path.steps.length === 0 ? (
                <p className="text-sm text-ink-muted">No steps: every required skill is at or above the bar.</p>
              ) : (
                <ol className="space-y-4" aria-label="Roadmap steps in order">
                  {view.path.steps.map((s) => {
                    const label = s.kind === "remedial" ? `Revisit: ${s.concept}` : (view.topic_names[s.skill_id] ?? s.skill_id);
                    const isChanged = changed.has(s.id);
                    return (
                      <li key={s.id} className={cn(TILE, "p-4", isChanged && "ring-2 ring-redline/40")} data-step={s.id}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="tabular-nums text-sm text-ink-muted">{s.order}.</span>
                          <h3 className="text-base font-semibold text-ink-primary">{label}</h3>
                          <StepStatusBadge status={s.status} />
                          {s.review_later && <Pill tone="plain">Review later</Pill>}
                          {isChanged && <Pill tone="core">Changed</Pill>}
                        </div>
                        <p className="mt-1 text-sm text-ink-secondary">{s.reason}</p>
                        {s.resource_ids.length > 0 && (
                          <ul className="mt-3 space-y-1.5" aria-label={`Resources for ${label}`}>
                            {s.resource_ids.map((id) => {
                              const r = view.resources[id];
                              return r ? <ResourceLink key={id} title={r.title} url={r.url} type={r.type} minutes={r.est_minutes} /> : null;
                            })}
                          </ul>
                        )}
                        {s.resource_ids.length === 0 && <p className="mt-2 text-xs text-ink-muted">No curated resource for this topic yet.</p>}
                      </li>
                    );
                  })}
                </ol>
              )}
            </Section>

            {/* 5. Progress */}
            <Section title="Progress" index="05" id="progress">
              <div className="grid gap-6 md:grid-cols-[minmax(0,16rem)_1fr]">
                <div className={cn(TILE, "p-5")}>
                  <p className="serif text-4xl font-medium tabular-nums text-ink-primary" aria-label={`${view.progress.percent_complete} percent complete`}>
                    {view.progress.percent_complete}%
                  </p>
                  <p className="mt-1 text-sm text-ink-secondary">of the roadmap done</p>
                  {view.progress.next_step && (
                    <p className="mt-3 text-sm text-ink-secondary">
                      Next: <span className="text-ink-primary">{view.progress.next_step.kind === "remedial" ? `Revisit: ${view.progress.next_step.concept}` : (view.topic_names[view.progress.next_step.skill_id] ?? view.progress.next_step.skill_id)}</span>
                    </p>
                  )}
                </div>
                <ul className="space-y-3" aria-label="Mastery per skill">
                  {view.progress.skill_bars.map((b) => (
                    <li key={b.skill_id}>
                      <MasteryBar label={b.name} mastery={b.mastery} unverified={b.unverified} />
                    </li>
                  ))}
                </ul>
              </div>
            </Section>

            {/* 6. Assessment */}
            <Section title="Assessment" index="06" id="assessment" description="A real result comes from the readiness audit. For the demo you can also apply a clearly labelled simulated score.">
              <div className="grid gap-5 md:grid-cols-2">
                <div className={cn(TILE, "space-y-3 p-5")}>
                  <h3 className="text-sm font-semibold text-ink-primary">Real result</h3>
                  <p className="text-sm text-ink-secondary">Answer the interrogation on this skill, then bring the graded result here.</p>
                  <div className="flex flex-wrap gap-2">
                    <Link to={routes.setup} className="inline-flex items-center rounded-full bg-white/80 px-4 py-2 text-sm shadow-[inset_0_0_0_1px_rgba(24,24,27,0.1)] hover:bg-white">
                      Start an interrogation
                    </Link>
                    <Button type="button" variant="outline" size="sm" disabled={busy !== null || !assessSkill} onClick={() => void run("assess", () => api.assessLearningPath(view.id, { source: "interrogation", skill: assessSkill }), "Result from your interrogation applied.")}>
                      Use my interrogation result
                    </Button>
                  </div>
                </div>
                <fieldset className={cn(TILE, "space-y-3 p-5")}>
                  <legend className="sr-only">Simulation</legend>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-primary">
                    Simulate assessment score <Pill tone="alert">Simulation</Pill>
                  </h3>
                  <p className="text-sm text-ink-secondary">Not a real assessment. It only shows how the roadmap adapts.</p>
                  <div>
                    <label htmlFor="assess-skill" className="mb-1 block text-sm font-medium text-ink-primary">
                      Skill
                    </label>
                    <select id="assess-skill" className={field} value={assessSkill} onChange={(e) => setAssessSkill(e.target.value)}>
                      {topicOptions.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="sim-score" className="mb-1 block text-sm font-medium text-ink-primary">
                      Simulated score: <span className="tabular-nums">{score}%</span> (Simulation)
                    </label>
                    <input id="sim-score" type="range" min={0} max={100} step={5} value={score} onChange={(e) => setScore(Number(e.target.value))} className="w-full accent-[#c9362a]" />
                  </div>
                  <Button type="button" disabled={busy !== null || !assessSkill} onClick={() => void run("assess", () => api.assessLearningPath(view.id, { source: "simulation", skill: assessSkill, score }), `Simulated score of ${score}% applied.`)}>
                    {busy === "assess" ? "Re-planning…" : "Apply simulated score"}
                  </Button>
                </fieldset>
              </div>
              {actionError && (
                <p role="alert" className="mt-3 text-sm text-redline">
                  {actionError}
                </p>
              )}
            </Section>

            {/* 7. Goal change */}
            <Section title="Change career goal" index="07" id="goal" description="What you already know carries over. The roadmap is rebuilt and you see what was kept, added, removed and reordered.">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-56">
                  <label htmlFor="new-goal" className="mb-1 block text-sm font-medium text-ink-primary">
                    New target career
                  </label>
                  <select id="new-goal" className={field} value={newGoal} onChange={(e) => setNewGoal(e.target.value)}>
                    <option value="">Choose a role…</option>
                    {(roles ?? [])
                      .filter((r) => r.id !== view.role.id)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                </div>
                <Button type="button" disabled={busy !== null || newGoal === ""} onClick={() => void run("goal", () => api.changeLearningPathGoal(view.id, newGoal), "Goal switched. See what changed.")}>
                  {busy === "goal" ? "Switching…" : "Switch goal"}
                </Button>
              </div>
            </Section>

            {/* 8. Mentor */}
            <Section title="Mentor" index="08" id="mentor">
              <div className={cn(TILE, "space-y-2 p-5")}>
                <p className="leading-relaxed text-ink-primary">{view.mentor.message}</p>
                <p className="text-xs text-ink-muted">{view.mentor.source === "ai" ? "Wording written by the AI from the facts above." : "Template message: no AI model was used."}</p>
              </div>
            </Section>

            {/* 9. Agent activity */}
            <Section title="Agent activity" index="09" id="agents" description="Six specialised agents. Routing is fixed; each line says whether a rule or the AI produced it.">
              <div className={cn(TILE, "p-5")}>
                <AgentTimeline entries={view.agent_log} />
              </div>
            </Section>
          </>
        )}
      </div>
    </Page>
  );
};

export default LearningPathPage;
