/**
 * Helper functions and types extracted from Agent.tsx.
 * Pure functions for message grouping, live-action styling, and goal-snapshot utilities.
 */

import { Activity, Ban, OctagonX, CheckCircle2 } from "lucide-react";
import type { GoalSnapshot, LiveAction, LiveHalted, LiveStatus } from "@/lib/api";
import type { AgentMessage } from "@/types/agent";

/* ---------- Message grouping ---------- */

export type MsgGroup =
  | { kind: "single"; msg: AgentMessage }
  | { kind: "timeline"; msgs: AgentMessage[] };

export function groupMessages(msgs: AgentMessage[]): MsgGroup[] {
  const out: MsgGroup[] = [];
  let buf: AgentMessage[] = [];
  const flush = () => { if (buf.length) { out.push({ kind: "timeline", msgs: [...buf] }); buf = []; } };
  for (const m of msgs) {
    if (["thinking", "tool_call", "tool_result", "compact"].includes(m.type)) {
      buf.push(m);
    } else {
      flush();
      out.push({ kind: "single", msg: m });
    }
  }
  flush();
  return out;
}

/* ---------- Constants ---------- */

export const act = () => useAgentStore.getState();

/** Poll cadence for the shared `GET /live/status` snapshot. */
export const LIVE_STATUS_POLL_INTERVAL_MS = 15_000;

export const CONNECTOR_CHECK_PROMPT =
  "List my trading connector profiles, show which one is selected, then check that selected connector. If it is not ready, tell me exactly what setup step is missing. Do not place or modify orders.";

export const CONNECTOR_PORTFOLIO_PROMPT =
  "Use the selected trading connector profile to summarize my account, positions, concentration, cash, and portfolio risk. Do not place or modify orders.";

/* ---------- Connector runtime channel types ---------- */

export interface ProposalItem {
  kind: "proposal";
  timestamp: number;
  proposal: import("@/lib/api").MandateProposal;
}

export interface LiveActionItem {
  kind: "live_action";
  timestamp: number;
  action: LiveAction;
}

export type LiveItem = ProposalItem | LiveActionItem;

/* ---------- Broker scope helpers ---------- */

export function normalizeBrokerScope(broker: string | null | undefined): string | null {
  const normalized = broker?.trim().toLowerCase();
  return normalized || null;
}

export function isGlobalLiveHalt(halt: LiveHalted | null): boolean {
  return halt != null && normalizeBrokerScope(halt.broker) == null;
}

export function haltScopeStillActive(halt: LiveHalted, status: LiveStatus): boolean {
  const broker = normalizeBrokerScope(halt.broker);
  if (!broker) return status.global_halted;
  return status.global_halted || status.brokers.some((item) => (
    normalizeBrokerScope(item.auth.broker) === broker && item.halted
  ));
}

/* ---------- Live action styling ---------- */

export function liveActionStyle(kind: string): { icon: typeof Activity; tone: string } {
  switch (kind) {
    case "order_rejected":
    case "breach":
      return { icon: Ban, tone: "border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-400" };
    case "halt_tripped":
      return { icon: OctagonX, tone: "border-destructive/40 bg-destructive/5 text-destructive" };
    case "mandate_committed":
    case "halt_cleared":
      return { icon: CheckCircle2, tone: "border-emerald-500/40 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400" };
    default:
      return { icon: Activity, tone: "border-sky-500/40 bg-sky-500/5 text-sky-600 dark:text-sky-400" };
  }
}

export function liveActionLabel(action: LiveAction): string {
  return action.kind.replace(/_/g, " ");
}

/* ---------- Goal snapshot helpers ---------- */

export function isCriterionStatusMet(status: string): boolean {
  return !["", "pending", "open", "unsatisfied"].includes(status.toLowerCase());
}

export function getGoalProgress(snapshot: GoalSnapshot | null): {
  met: number;
  total: number;
  label: string;
  metLabel: string;
  evidenceTotal: number;
} {
  const total = snapshot?.criteria.length ?? 0;
  const met = snapshot?.criteria.filter((item) => criterionCovered(snapshot, item)).length ?? 0;
  const evidenceTotal = snapshot?.evidence_count ?? 0;
  return {
    met,
    total,
    label: total > 0 ? `${met}/${total}` : "",
    metLabel: total > 0 ? `${met}/${total} met` : "",
    evidenceTotal,
  };
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

export function isTerminalGoalStatus(status: string): boolean {
  return ["complete", "cancelled", "blocked", "superseded", "usage_limited"].includes(status);
}

export function criterionIndexLabel(index: number): string {
  return String(index + 1);
}

export function criterionEvidenceCount(snapshot: GoalSnapshot, criterionId: string): number {
  return snapshot.evidence.filter((item) => item.criterion_id === criterionId).length;
}

export function criterionCovered(snapshot: GoalSnapshot, criterion: GoalSnapshot["criteria"][number]): boolean {
  return isCriterionStatusMet(criterion.status) || criterionEvidenceCount(snapshot, criterion.criterion_id) > 0;
}

export function latestGoalEvidence(snapshot: GoalSnapshot) {
  return [...snapshot.evidence]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 2);
}

export function goalKickoffPrompt(objective: string): string {
  return [
    "立即开始执行此研究目标。",
    "仅限研究用途，需要证据时使用可用工具，将具体证据添加到目标账本，持续执行直至目标完成、阻塞、等待用户输入或达到预算上限。",
    "",
    `Goal: ${objective}`,
  ].join("\n");
}

export function goalContinuePrompt(snapshot: GoalSnapshot): string {
  const openCriteria = snapshot.criteria
    .filter((item) => item.required && !criterionCovered(snapshot, item))
    .map((item) => `- ${item.text}`)
    .join("\n");
  return [
    "继续执行当前研究目标。",
    "按需使用实际可用工具，将证据添加到目标账本，仅在目标完成、阻塞、等待用户输入或达到预算上限时停止。",
    "",
    `Goal: ${snapshot.goal.objective}`,
    openCriteria ? `Open criteria:\n${openCriteria}` : "所有标准似已覆盖；审计账本，若完成已合理则更新目标状态。",
  ].join("\n");
}

// Lazy import to avoid circular dependency at module load time.
// `act` needs the store, but the store doesn't need this file.
import { useAgentStore } from "@/stores/agent";
