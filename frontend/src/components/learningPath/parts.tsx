import React from "react";
import { ArrowRight, BookOpen, CheckCircle2, Circle, ExternalLink, GraduationCap, Lock, PencilLine, PlayCircle, RotateCcw, type LucideIcon } from "lucide-react";
import { Pill } from "@/components/learn/LearnBits";
import { cn } from "@/lib/cn";
import type { AgentLogEntry, ChangeItem, PathChange, StepStatus } from "@/types/learningPath";
import { AGENT_LABEL } from "./helpers";

/** Label + icon + colour for every status: colour is never the only signal. */
const STATUS: Record<StepStatus, { label: string; icon: LucideIcon; className: string }> = {
  pending: { label: "Up next", icon: Circle, className: "bg-white/80 text-ink-secondary shadow-[inset_0_0_0_1px_rgba(24,24,27,0.1)]" },
  active: { label: "In progress", icon: PlayCircle, className: "bg-ink-primary text-surface-50" },
  done: { label: "Done", icon: CheckCircle2, className: "bg-verified/12 text-verified shadow-[inset_0_0_0_1px_rgba(30,110,70,0.25)]" },
  blocked: { label: "Paused until review is done", icon: Lock, className: "bg-redline-soft/70 text-redline shadow-[inset_0_0_0_1px_rgba(179,41,26,0.2)]" },
  remedial: { label: "Review first", icon: RotateCcw, className: "bg-redline-soft text-redline" },
};

export const StepStatusBadge: React.FC<{ status: StepStatus }> = ({ status }) => {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", s.className)}>
      <Icon size={13} aria-hidden="true" />
      {s.label}
    </span>
  );
};

const TYPE_ICON: Record<string, { icon: LucideIcon; label: string }> = {
  course: { icon: GraduationCap, label: "Course" },
  tutorial: { icon: BookOpen, label: "Tutorial" },
  exercise: { icon: PencilLine, label: "Exercise" },
};

export const ResourceLink: React.FC<{ title: string; url: string; type: string; minutes: number }> = ({ title, url, type, minutes }) => {
  const t = TYPE_ICON[type] ?? TYPE_ICON.tutorial!;
  const Icon = t.icon;
  return (
    <li>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-ink-primary underline-offset-4 hover:text-redline hover:underline"
      >
        <Icon size={14} aria-hidden="true" className="shrink-0 text-ink-muted" />
        <span className="sr-only">{t.label}: </span>
        {title}
        <span className="text-ink-muted no-underline">· {minutes} min</span>
        <ExternalLink size={12} aria-hidden="true" className="shrink-0 text-ink-muted" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </li>
  );
};

export const MasteryBar: React.FC<{ label: string; mastery: number; unverified: boolean }> = ({ label, mastery, unverified }) => {
  const pct = Math.round(mastery * 100);
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="text-ink-primary">{label}</span>
        <span className="tabular-nums text-ink-secondary">{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label} mastery`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-2 overflow-hidden rounded-full bg-black/[0.07]"
      >
        <div className={cn("h-full rounded-full", unverified ? "bg-redline/60" : "bg-verified")} style={{ width: `${pct}%` }} />
      </div>
      {unverified && <p className="mt-1 text-xs text-ink-muted">Unverified, capped at 40%</p>}
    </div>
  );
};

const List: React.FC<{ title: string; tone: "verified" | "alert" | "plain" | "core"; items: ChangeItem[] }> = ({ title, tone, items }) => (
  <div>
    <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-primary">
      <Pill tone={tone}>{items.length}</Pill>
      {title}
    </h4>
    {items.length === 0 ? (
      <p className="text-sm text-ink-muted">None</p>
    ) : (
      <ul className="space-y-1.5 text-sm text-ink-secondary">
        {items.map((i) => (
          <li key={`${i.skill_id}-${i.label}`}>
            <span className="font-medium text-ink-primary">{i.label}.</span> {i.reason}
          </li>
        ))}
      </ul>
    )}
  </div>
);

/** What the latest assessment or goal change did, in the rules' own words. */
export const ChangePanel: React.FC<{ change: PathChange; simulated: boolean }> = ({ change, simulated }) => {
  const goal = change.kind === "goal_change";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {simulated && !goal && <Pill tone="alert">Simulation</Pill>}
        <p className="text-sm leading-relaxed text-ink-primary">{change.reason}</p>
      </div>
      {goal ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <List title="Kept" tone="verified" items={change.kept} />
          <List title="Added" tone="core" items={change.added} />
          <List title="Removed" tone="alert" items={change.removed} />
          <List title="Reordered" tone="plain" items={change.reordered} />
        </div>
      ) : (
        <>
          {change.added.length > 0 && <List title="Added" tone="core" items={change.added} />}
          {change.status_changes.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-ink-primary">Steps that changed status</h4>
              <ul className="space-y-1 text-sm text-ink-secondary">
                {change.status_changes.map((c) => (
                  <li key={`${c.step_id}-${c.to}`}>
                    <span className="font-medium text-ink-primary">{c.label}:</span> {c.from ? STATUS[c.from].label : "new"} <ArrowRight size={12} className="inline" aria-hidden="true" />{" "}
                    {STATUS[c.to].label}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
};

/** The proof that the agents work together: every action, with who decided it, and the handoffs between agents. */
export const AgentTimeline: React.FC<{ entries: AgentLogEntry[] }> = ({ entries }) => (
  <details open className="group">
    <summary className="cursor-pointer text-sm font-medium text-ink-secondary underline-offset-4 hover:text-ink-primary hover:underline">
      {entries.length} agent log entries (click to collapse)
    </summary>
    <ol className="mt-4 space-y-2" aria-label="Agent activity, oldest first">
      {entries.map((e) =>
        e.kind === "handoff" ? (
          <li key={e.id} className="flex items-center gap-2 pl-4 text-xs text-ink-muted" data-testid="handoff">
            <ArrowRight size={14} aria-hidden="true" className="shrink-0 text-redline" />
            <span>
              <span className="sr-only">Handoff: </span>
              {e.summary}
            </span>
          </li>
        ) : (
          <li key={e.id} className="rounded-xl bg-white/60 px-4 py-3 shadow-[inset_0_0_0_1px_rgba(24,24,27,0.06)]">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink-primary">{AGENT_LABEL[e.agent]}</span>
              <span className="font-mono text-xs text-ink-muted">{e.action}</span>
              {e.decided_by === "llm" ? <Pill tone="core">AI wording</Pill> : <Pill tone="plain">Deterministic</Pill>}
            </div>
            <p className="text-sm leading-relaxed text-ink-secondary">{e.summary}</p>
          </li>
        )
      )}
    </ol>
  </details>
);
