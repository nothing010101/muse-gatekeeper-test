/**
 * Protocol constants and types for the zkVerify Agent Games
 * "Proof Gatekeeper" event. Names and values come from the official
 * /build page and the /events/proof-gatekeeper sample payload.
 */

export const TASK_TYPE = "agent-games.proof-gatekeeper.v1";
export const PREFLIGHT_TYPE = "agent-games.preflight.v1";
export const PROTOCOL_VERSION = "v1";
export const SIGNATURE_HEADER = "x-agent-games-signature";

/** Reason codes from the trap encyclopedia on /events/proof-gatekeeper. */
export type ReasonCode =
  | "VALID_CONDITION"
  | "VK_SUBSTITUTION"
  | "PROOF_REUSED"
  | "THRESHOLD_MISMATCH"
  | "EXPIRED_CONDITION"
  | "RECIPIENT_MISMATCH"
  | "AMOUNT_OVERFLOW"
  /** Local fallback for envelope-level failures; outside the documented taxonomy. */
  | "INVALID_TASK";

export type Decision = "APPROVE" | "REJECT";

/** The `input` object of a task envelope, as sent by the platform. */
export interface GatekeeperInput {
  registered_vk: string;
  proof_vk: string;
  minimum: string;
  public_balance: string;
  expiry_block: number;
  current_block: number;
  recipient: string;
  condition_recipient: string;
  amount: string;
  max_transfer: string;
  proof_tx: string;
}

export interface TaskEnvelope {
  type: typeof TASK_TYPE;
  task_id: string;
  mode?: string;
  issued_at: string;
  deadline_at: string;
  input: GatekeeperInput;
}

export interface PreflightEnvelope {
  type: typeof PREFLIGHT_TYPE;
  agent_id?: string;
  issued_at?: string;
  nonce?: string;
}

/** snarkjs Groth16 proof object (bn128). */
export interface Groth16Proof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
}

export interface TaskResponse {
  decision: Decision;
  reason_code: ReasonCode;
  proof?: Groth16Proof;
  public_signals?: string[];
  proof_tx?: string;
}

export interface PreflightResponse {
  ok: true;
  protocolVersion: typeof PROTOCOL_VERSION;
}

/** Outcome of the deterministic policy check. */
export interface Evaluation {
  decision: Decision;
  reason_code: ReasonCode;
  /** Whether a Groth16 proof must accompany the answer (false only for PROOF_REUSED). */
  provable: boolean;
}
