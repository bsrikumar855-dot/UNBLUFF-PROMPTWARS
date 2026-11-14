import type { Agent, MentorFacts, MentorNote } from "./types.js";

const MAX_MESSAGE = 1200;

/** The instruction sent with the facts. The model writes words only: it must not add scores, resources or steps. */
export const COACH_INSTRUCTION =
  "Write a short, encouraging coaching note (3 to 4 sentences) about this learner's learning-path update. Use ONLY the facts in the context block. Never invent scores, percentages, resources, links or steps, and do not mention anything that is not listed there.";

const list = (xs: readonly string[]): string => (xs.length === 0 ? "none" : xs.join(", "));

/** Deterministic message built only from the facts. Used in mock mode and whenever the model is unavailable. */
export function templateMessage(f: MentorFacts): string {
  const next = f.next_step ? `Next up: ${f.next_step.label}${f.next_step.resources[0] ? `, starting with "${f.next_step.resources[0].title}"` : ""}.` : "Your roadmap has no open steps right now.";
  if (f.event === "ASSESSMENT_SUBMITTED") {
    const lead = f.remedial ? `That result was below the bar, so I put a short review of "${f.remedial}" in front of the next steps.` : "Thanks for the result; I updated your roadmap with it.";
    return `${lead} ${f.change_reason} You're ${f.percent_complete}% through the roadmap${f.pace === "slow" ? " and I slowed the pace a little" : ""}. ${next}`;
  }
  if (f.event === "GOAL_CHANGED") {
    return `You're now aiming for ${f.role_name} and match it at ${f.match_percent}%. ${f.change_reason} ${next}`;
  }
  return `You're a ${f.match_percent}% match for ${f.role_name}. The biggest gaps right now: ${list(f.top_gaps)}. ${next}`;
}

export interface MentorInput {
  facts: MentorFacts;
  now: Date;
}
export interface MentorOutput {
  note: MentorNote;
}

/**
 * The only agent that may use a language model, and only to phrase the facts it is given. It never picks, ranks,
 * scores or routes. In mock mode, or if the model fails or returns nothing usable, the template is used instead.
 */
export const mentorAgent: Agent<MentorInput, MentorOutput> = {
  name: "mentor",
  async run({ facts, now }, ctx) {
    let ai: string | null = null;
    if (ctx.coach) {
      try {
        const text = (await ctx.coach(facts))?.trim() ?? "";
        ai = text !== "" ? text.slice(0, MAX_MESSAGE) : null;
      } catch {
        ai = null;
      }
    }
    const source = ai ? "ai" : "template";
    return {
      output: { note: { message: ai ?? templateMessage(facts), source, at: now.toISOString() } },
      handoff: "coaching message",
      log: [
        {
          agent: "mentor",
          action: "write_coaching_message",
          summary: ai ? "Wrote a coaching message from the facts above with the AI model (language only; it chose nothing)." : "Wrote a coaching message from the facts above using a fixed template (no AI model was used).",
          decided_by: ai ? "llm" : "deterministic",
          inputs_ref: "facts from the other agents",
          outputs_ref: "coaching message",
        },
      ],
    };
  },
};
