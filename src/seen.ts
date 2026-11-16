import * as fs from "fs";
import * as path from "path";
import type { Decision, ReasonCode } from "./types";

/**
 * One logged task decision. Deliberately minimal: task id, trap type
 * (reason_code), APPROVE/REJECT, whether a proof was attached, and
 * end-to-end latency. No input values, no proof content, no secret —
 * nothing in here can authenticate or replay anything.
 */
export interface DecisionRecord {
  /** ISO timestamp when the decision was made. */
  ts: string;
  task_id: string | null;
  reason_code: ReasonCode;
  decision: Decision;
  proof_attached: boolean;
  latency_ms: number;
  /** True when the answer came from the idempotency cache (redelivery). */
  cached?: boolean;
}

/** Cap on persisted decisions (8 tasks x 8 rounds = 64 max; headroom included). */
const MAX_DECISIONS = 200;

/**
 * Seen-set for proof_tx references ("The proof reference has not already
 * been used for another task" — /build Security checklist; PROOF_REUSED
 * trap).
 *
 * In-memory Set is authoritative for the life of the process; a JSON file
 * backs it across restarts (best-effort: on serverless the file lives in
 * /tmp and may vanish on cold start — see README for the operational
 * implication). Also keeps a task_id -> serialized response cache so a
 * redelivered task is answered idempotently instead of being misread as
 * proof reuse.
 */
export class SeenStore {
  private seenProofTx = new Set<string>();
  private responseByTaskId = new Map<string, string>();
  private decisions: DecisionRecord[] = [];
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const data = JSON.parse(raw) as {
        proofTx?: string[];
        responses?: Record<string, string>;
        decisions?: DecisionRecord[];
      };
      for (const tx of data.proofTx ?? []) this.seenProofTx.add(normalizeTx(tx));
      for (const [k, v] of Object.entries(data.responses ?? {})) {
        this.responseByTaskId.set(k, v);
      }
      if (Array.isArray(data.decisions)) {
        this.decisions = data.decisions.filter(
          (d) =>
            d && typeof d.task_id !== "undefined" && typeof d.decision === "string" &&
            typeof d.reason_code === "string" && typeof d.proof_attached === "boolean" &&
            typeof d.latency_ms === "number",
        );
      }
    } catch {
      /* missing/corrupt file -> start empty (fail-open for storage, fail-closed for policy) */
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(
        tmp,
        JSON.stringify({
          proofTx: [...this.seenProofTx],
          responses: Object.fromEntries(this.responseByTaskId),
          decisions: this.decisions,
        }),
      );
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error("[seen-store] persist failed:", (err as Error).message);
    }
  }

  hasProofTx(proofTx: string): boolean {
    return this.seenProofTx.has(normalizeTx(proofTx));
  }

  recordProofTx(proofTx: string): void {
    const key = normalizeTx(proofTx);
    if (!key) return;
    if (!this.seenProofTx.has(key)) {
      this.seenProofTx.add(key);
      this.persist();
    }
  }

  getResponse(taskId: string): string | null {
    return this.responseByTaskId.get(taskId) ?? null;
  }

  recordResponse(taskId: string, serializedResponse: string): void {
    if (!this.responseByTaskId.has(taskId)) {
      this.responseByTaskId.set(taskId, serializedResponse);
      this.persist();
    }
  }

  get size(): number {
    return this.seenProofTx.size;
  }

  /** Append a decision record (oldest dropped past MAX_DECISIONS). */
  recordDecision(record: DecisionRecord): void {
    this.decisions.push(record);
    if (this.decisions.length > MAX_DECISIONS) {
      this.decisions = this.decisions.slice(-MAX_DECISIONS);
    }
    this.persist();
  }

  /** Decisions in chronological order (copy). */
  getDecisions(): DecisionRecord[] {
    return [...this.decisions];
  }
}

export function normalizeTx(tx: string): string {
  return (tx ?? "").trim().toLowerCase();
}
