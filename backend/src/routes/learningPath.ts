import { Router, type RequestHandler } from "express";
import { ApiError } from "../errors.js";
import type { LearningPathService } from "../learning/service.js";
import { uidOf } from "../middleware/auth.js";

const noStore = { "Cache-Control": "no-store" };
const ID = /^lp_[0-9a-f-]{36}$/;

function idOf(raw: unknown): string {
  if (typeof raw !== "string" || !ID.test(raw)) throw new ApiError("NOT_FOUND", "Learning path not found");
  return raw;
}

/**
 * SkillForge learning paths. Owner-scoped: the owner is always the verified uid, never taken from the request.
 * A path is created from a learner profile and a target role; assessments and goal changes re-plan it through the
 * agent orchestrator (see src/agents). Every decision is deterministic; the model only phrases the mentor message.
 */
export function learningPathRouter(service: LearningPathService, limiters: { read: RequestHandler; write: RequestHandler }): Router {
  const router = Router();
  router.get("/learning-path", limiters.read, async (_req, res) => {
    res.set(noStore).json(await service.list(uidOf(res)));
  });
  router.post("/learning-path", limiters.write, async (req, res) => {
    res.set(noStore).status(201).json(await service.create(uidOf(res), req.body ?? {}));
  });
  router.get("/learning-path/:id", limiters.read, async (req, res) => {
    res.set(noStore).json(await service.get(uidOf(res), idOf(req.params.id)));
  });
  router.post("/learning-path/:id/assessment", limiters.write, async (req, res) => {
    res.set(noStore).json(await service.assess(uidOf(res), idOf(req.params.id), req.body ?? {}));
  });
  router.post("/learning-path/:id/goal", limiters.write, async (req, res) => {
    res.set(noStore).json(await service.changeGoal(uidOf(res), idOf(req.params.id), req.body ?? {}));
  });
  router.get("/learning-path/:id/agent-log", limiters.read, async (req, res) => {
    res.set(noStore).json(await service.agentLog(uidOf(res), idOf(req.params.id)));
  });
  return router;
}
