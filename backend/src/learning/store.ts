import { Firestore } from "@google-cloud/firestore";
import type { AgentLogEntry, LearnerProfile, MentorNote } from "../agents/types.js";
import type { CertMapping, LearningPath } from "../core/pathTypes.js";

/** One learning path per document, owner-scoped. The owner is always the verified uid. */
export interface LearningPathRecord {
  id: string;
  owner_uid: string;
  role_id: string;
  profile: LearnerProfile;
  path: LearningPath;
  agent_log: AgentLogEntry[];
  mentor: MentorNote;
  /** Skill names the learner typed that matched no known topic. */
  unrecognized_skills: string[];
  /** What each certification mapped to when the profile was submitted. Absent on records saved before this field existed. */
  certification_skills?: CertMapping[];
  created_at: string;
  updated_at: string;
}

export interface LearningPathStore {
  get(id: string): Promise<LearningPathRecord | null>;
  put(rec: LearningPathRecord): Promise<void>;
  listByOwner(uid: string): Promise<LearningPathRecord[]>;
  delete(id: string): Promise<void>;
}

const SAFE_UID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_ID = /^lp_[0-9a-f-]{36}$/;

export class MemoryLearningPathStore implements LearningPathStore {
  private readonly docs = new Map<string, LearningPathRecord>();
  async get(id: string) {
    const r = SAFE_ID.test(id) ? this.docs.get(id) : undefined;
    return r ? structuredClone(r) : null;
  }
  async put(rec: LearningPathRecord) {
    if (!SAFE_ID.test(rec.id) || !SAFE_UID.test(rec.owner_uid)) throw new Error("invalid id");
    this.docs.set(rec.id, structuredClone(rec));
  }
  async listByOwner(uid: string) {
    if (!SAFE_UID.test(uid)) return [];
    return [...this.docs.values()].filter((r) => r.owner_uid === uid).map((r) => structuredClone(r));
  }
  async delete(id: string) {
    this.docs.delete(id);
  }
}

export class FirestoreLearningPathStore implements LearningPathStore {
  private readonly col;
  constructor(db: Firestore = new Firestore({ ignoreUndefinedProperties: true }), name = "unbluff_learning_paths") {
    this.col = db.collection(name);
  }
  async get(id: string) {
    if (!SAFE_ID.test(id)) return null;
    const snap = await this.col.doc(id).get();
    return snap.exists ? (snap.data() as LearningPathRecord) : null;
  }
  async put(rec: LearningPathRecord) {
    if (!SAFE_ID.test(rec.id) || !SAFE_UID.test(rec.owner_uid)) throw new Error("invalid id");
    await this.col.doc(rec.id).set({ ...rec });
  }
  async listByOwner(uid: string) {
    if (!SAFE_UID.test(uid)) return [];
    const snap = await this.col.where("owner_uid", "==", uid).limit(200).get();
    return snap.docs.map((d) => d.data() as LearningPathRecord);
  }
  async delete(id: string) {
    if (SAFE_ID.test(id)) await this.col.doc(id).delete();
  }
}
