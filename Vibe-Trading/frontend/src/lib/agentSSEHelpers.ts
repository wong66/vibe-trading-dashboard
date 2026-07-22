/**
 * SSE connection setup — extracted from Agent.tsx to reduce component size.
 * Exported function that creates and returns SSE event handler configuration.
 */

import type { ToolCallEntry } from "@/types/agent";
import type {
  GoalSnapshot,
  LiveAction,
  LiveHalted,
  MandateCommitted,
  MandateProposal,
} from "@/lib/api";
import { api } from "@/lib/api";
import { isReportWorthyRun } from "@/lib/runReports";
import {
  applySwarmEvent,
  buildSwarmStatusFromStarted,
  buildSwarmStatusFromToolResultPreview,
} from "@/lib/swarmStatus";
import {
  act,
  isTerminalGoalStatus,
  type LiveItem,
} from "@/lib/agentHelpers";
import { useAgentStore } from "@/stores/agent";
import { toast } from "sonner";

type EventHandler = (data: Record<string, unknown>) => void;
type Handlers = Record<string, EventHandler>;

export type SSESetupContext = {
  sid: string;
  sseSessionRef: React.MutableRefObject<string | null>;
  lastEventRef: React.MutableRefObject<number>;
  pendingProgressRef: React.MutableRefObject<Map<string, NonNullable<ToolCallEntry["progress"]>>>;
  progressRafRef: React.MutableRefObject<number>;
  connect: (url: string, handlers: Handlers) => void;
  disconnect: () => void;
  loadGoalSnapshot: (sid?: string | null) => Promise<void>;
  scrollToBottom: () => void;
  setLiveItems: React.Dispatch<React.SetStateAction<LiveItem[]>>;
  setCommittedMandates: React.Dispatch<React.SetStateAction<Record<string, MandateCommitted>>>;
  setLiveHalted: React.Dispatch<React.SetStateAction<LiveHalted | null>>;
  setLiveStatusRefresh: React.Dispatch<React.SetStateAction<number>>;
  setGoalSnapshot: React.Dispatch<React.SetStateAction<GoalSnapshot | null>>;
  setGoalDetailsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setGoalEditActive: React.Dispatch<React.SetStateAction<boolean>>;
};

export function connectAgentSSE(ctx: SSESetupContext): void {
  if (ctx.sseSessionRef.current === ctx.sid) return;
  ctx.disconnect();
  ctx.sseSessionRef.current = ctx.sid;

  const touch = () => { ctx.lastEventRef.current = Date.now(); };

  ctx.connect(api.sseUrl(ctx.sid, { replay: "active" }), {
    text_delta: (d) => { touch(); act().appendDelta(String(d.delta || "")); ctx.scrollToBottom(); },
    thinking_done: () => { touch(); /* don't flush — keep streaming text visible */ },

    tool_call: (d) => {
      touch();
      const toolName = String(d.tool || "");
      act().addToolCall({
        id: toolName, tool: toolName,
        arguments: (d.arguments as Record<string, string>) ?? {},
        status: "running", timestamp: Date.now(),
      });
      ctx.scrollToBottom();
    },

    tool_result: (d) => {
      touch();
      const toolName = String(d.tool || "");
      ctx.pendingProgressRef.current.delete(toolName);
      act().updateToolCall(toolName, {
        status: d.status === "ok" ? "ok" : "error",
        preview: String(d.preview || ""),
        elapsed_ms: Number(d.elapsed_ms || 0),
        elapsed_s: undefined,
        progress: undefined,
      });
      if (toolName === "run_swarm") {
        const fallback = buildSwarmStatusFromToolResultPreview(String(d.preview || ""));
        if (fallback && !act().messages.some((m) => m.type === "swarm_status" && m.swarmRunId === fallback.runId)) {
          act().upsertSwarmStatus(fallback);
        }
      }
    },

    tool_heartbeat: (d) => {
      touch();
      if (act().status !== "streaming") act().setStatus("streaming");
      const toolName = String(d.tool || "");
      if (!toolName) return;
      act().updateToolCall(toolName, {
        elapsed_s: Number(d.elapsed_s || 0),
      });
    },

    tool_progress: (d) => {
      touch();
      const toolName = String(d.tool || "");
      if (!toolName) return;
      const payload: NonNullable<ToolCallEntry["progress"]> = {};
      if (typeof d.stage === "string" && d.stage) payload.stage = d.stage;
      if (typeof d.message === "string" && d.message) payload.message = d.message;
      if (typeof d.current === "number") payload.current = d.current;
      if (typeof d.total === "number") payload.total = d.total;
      ctx.pendingProgressRef.current.set(toolName, payload);
      if (ctx.progressRafRef.current) return;
      ctx.progressRafRef.current = requestAnimationFrame(() => {
        ctx.progressRafRef.current = 0;
        const pending = ctx.pendingProgressRef.current;
        if (pending.size === 0) return;
        const store = act();
        for (const [tool, progress] of pending) {
          store.updateToolCall(tool, { progress });
        }
        pending.clear();
      });
    },

    compact: () => { touch(); },

    "attempt.created": () => {
      touch();
      if (act().status !== "streaming") act().setStatus("streaming");
    },

    "attempt.started": () => {
      touch();
      if (act().status !== "streaming") act().setStatus("streaming");
    },

    "attempt.completed": async (d) => {
      touch();
      const s = act();
      const completedTools = s.toolCalls;
      if (completedTools.length > 0) {
        for (const tc of completedTools) {
          s.addMessage({ id: tc.id + "_call", type: "tool_call", content: "", tool: tc.tool, args: tc.arguments, status: tc.status || "ok", timestamp: tc.timestamp });
          if (tc.elapsed_ms != null) {
            s.addMessage({ id: "", type: "tool_result", content: tc.preview || "", tool: tc.tool, status: tc.status || "ok", elapsed_ms: tc.elapsed_ms, timestamp: tc.timestamp + 1 });
          }
        }
      }

      s.clearStreaming();

      const runDir = String(d.run_dir || "");
      const runId = runDir ? runDir.split(/[/\\]/).pop() : undefined;
      const summary = String(d.summary || "");
      if (summary) s.addMessage({ id: "", type: "answer", content: summary, timestamp: Date.now() });

      const shadowCall = completedTools.find(
        (tc) => tc.tool === "render_shadow_report" && (tc.status || "ok") === "ok",
      );
      const shadowMatch = shadowCall?.preview?.match(/"shadow_id"\s*:\s*"(shadow_[A-Za-z0-9_]+)"/);
      const shadowId = shadowMatch?.[1];

      if (runId) {
        let runMetrics: Record<string, number> | undefined;
        let runCurve: Array<{ time: string; equity: number }> | undefined;
        let showCard = false;
        try {
          const runData = await api.getRun(runId);
          if (isReportWorthyRun(runData)) {
            runMetrics = runData.metrics;
            runCurve = runData.equity_curve?.map(e => ({ time: e.time, equity: Number(e.equity) }));
            showCard = true;
          }
        } catch {
          showCard = true;
        }
        if (showCard || shadowId) {
          s.addMessage({
            id: "", type: "run_complete", content: "", runId,
            metrics: showCard ? runMetrics : undefined,
            equityCurve: showCard ? runCurve : undefined,
            shadowId,
            timestamp: Date.now(),
          });
        }
      } else if (shadowId) {
        s.addMessage({ id: "", type: "run_complete", content: "", shadowId, timestamp: Date.now() });
      }

      s.setStatus("idle");
      useAgentStore.setState({ toolCalls: [] });
      ctx.scrollToBottom();
    },

    "attempt.failed": (d) => {
      touch();
      act().clearStreaming();
      act().addMessage({ id: "", type: "error", content: String(d.error || "Execution failed"), timestamp: Date.now() });
      act().setStatus("idle");
      useAgentStore.setState({ toolCalls: [] });
      ctx.scrollToBottom();
    },

    "goal.created": () => {
      touch();
      void ctx.loadGoalSnapshot(ctx.sid);
    },

    "swarm.started": (d) => {
      touch();
      const status = buildSwarmStatusFromStarted(d);
      if (!status) return;
      act().upsertSwarmStatus(status);
      ctx.scrollToBottom();
    },

    "swarm.event": (d) => {
      touch();
      if (act().status !== "streaming") act().setStatus("streaming");
      const runId = String(d.run_id || "");
      const event = d.event;
      if (!runId || !event) return;
      act().updateSwarmStatus(runId, (current) => applySwarmEvent(current, event));
      ctx.scrollToBottom();
    },

    "goal.evidence": () => {
      touch();
      void ctx.loadGoalSnapshot(ctx.sid);
    },

    "goal.updated": (d) => {
      touch();
      const snapshot = d.snapshot as GoalSnapshot | undefined;
      const goal = (d.goal as GoalSnapshot["goal"] | undefined) ?? snapshot?.goal;
      if (goal && isTerminalGoalStatus(goal.status)) {
        ctx.setGoalSnapshot(null);
        ctx.setGoalDetailsOpen(false);
        ctx.setGoalEditActive(false);
        return;
      }
      if (snapshot) {
        ctx.setGoalSnapshot(snapshot);
        return;
      }
      void ctx.loadGoalSnapshot(ctx.sid);
    },

    "mandate.proposal": (d) => {
      touch();
      const proposal = d as unknown as MandateProposal;
      if (!proposal.proposal_id || !Array.isArray(proposal.profiles)) return;
      ctx.setLiveItems((items) => [...items, { kind: "proposal", timestamp: Date.now(), proposal }]);
      ctx.scrollToBottom();
    },

    "mandate.committed": (d) => {
      touch();
      const committed = d as unknown as MandateCommitted;
      if (!committed.proposal_id) return;
      ctx.setCommittedMandates((prev) => ({ ...prev, [committed.proposal_id as string]: committed }));
      ctx.setLiveStatusRefresh((n) => n + 1);
      ctx.scrollToBottom();
    },

    "live.halted": (d) => {
      touch();
      const halted = d as unknown as LiveHalted;
      ctx.setLiveHalted(halted);
      ctx.setLiveStatusRefresh((n) => n + 1);
      toast.warning("连接器运行时已暂停——运行器已停止，挂单已取消");
    },

    "live.resumed": (d) => {
      touch();
      void d;
      ctx.setLiveHalted(null);
      ctx.setLiveStatusRefresh((n) => n + 1);
      toast.success("连接器运行时已恢复");
    },

    "live.action": (d) => {
      touch();
      const action = d as unknown as LiveAction;
      if (!action.kind) return;
      ctx.setLiveItems((items) => [...items, { kind: "live_action", timestamp: Date.now(), action }]);
      if (action.kind === "halt_tripped") ctx.setLiveHalted({ broker: action.broker, reason: action.intent_normalized });
      if (action.kind === "halt_cleared") ctx.setLiveHalted(null);
      if (["mandate_committed", "halt_tripped", "halt_cleared"].includes(action.kind)) {
        ctx.setLiveStatusRefresh((n) => n + 1);
      }
      ctx.scrollToBottom();
    },

    heartbeat: () => {},
    reconnect: (d) => { act().setSseStatus("reconnecting", Number(d.attempt ?? 0)); },
  });
}
