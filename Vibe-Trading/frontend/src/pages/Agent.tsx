import { useEffect, useRef, useState, useMemo, useCallback, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAgentStore } from "@/stores/agent";
import { useSSE } from "@/hooks/useSSE";
import { ApiError, AUTH_REQUIRED_MESSAGE, api, isAuthRequiredError, type GoalSnapshot, type MandateCommitted, type LiveHalted, type LiveStatus } from "@/lib/api";
import { isReportWorthyRun } from "@/lib/runReports";
import type { AgentMessage, ToolCallEntry } from "@/types/agent";
import { WelcomeScreen } from "@/components/chat/WelcomeScreen";
import { ConversationTimeline } from "@/components/chat/ConversationTimeline";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { SkeletonLoading } from "@/components/chat/SkeletonLoading";
import { ScrollToBottomButton } from "@/components/chat/ScrollToBottomButton";
import { InputArea } from "@/components/chat/InputArea";
import { connectAgentSSE } from "@/lib/agentSSEHelpers";
import {
  groupMessages,
  act,
  LIVE_STATUS_POLL_INTERVAL_MS,
  CONNECTOR_CHECK_PROMPT,
  CONNECTOR_PORTFOLIO_PROMPT,
  type MsgGroup,
  type LiveItem,
  isGlobalLiveHalt,
  haltScopeStillActive,
  goalKickoffPrompt,
  goalContinuePrompt,
} from "@/lib/agentHelpers";

/* ---------- Component ---------- */
export function Agent() {
  const [input, setInput] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndRef = useRef(0);
  const sseSessionRef = useRef<string | null>(null);
  const prevSseStatusRef = useRef<string>("disconnected");
  const genRef = useRef(0);
  const pendingGoalSessionRef = useRef<string | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const lastEventRef = useRef(0);
  const sseTimeoutMsRef = useRef(90_000);

  /* tool_progress coalescing — keep latest payload per-tool, flush once per rAF. */
  const pendingProgressRef = useRef<Map<string, NonNullable<ToolCallEntry["progress"]>>>(new Map());
  const progressRafRef = useRef(0);

  const [attachment, setAttachment] = useState<{ filename: string; filePath: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [swarmPreset, setSwarmPreset] = useState<{ name: string; title: string } | null>(null);
  const [goalComposerActive, setGoalComposerActive] = useState(false);
  const [goalDetailsOpen, setGoalDetailsOpen] = useState(false);
  const [goalSnapshot, setGoalSnapshot] = useState<GoalSnapshot | null>(null);
  const [goalEditActive, setGoalEditActive] = useState(false);
  const [goalEditValue, setGoalEditValue] = useState("");

  /* Connector runtime channel state (SPEC Consent §1/§4/§5) */
  const [liveItems, setLiveItems] = useState<LiveItem[]>([]);
  const [committedMandates, setCommittedMandates] = useState<Record<string, MandateCommitted>>({});
  const [liveHalted, setLiveHalted] = useState<LiveHalted | null>(null);
  const [halting, setHalting] = useState(false);
  /* Bumped to force an immediate live-status re-poll on a live event
   * (commit / halt / resume / runner-affecting action) rather than waiting a tick. */
  const [liveStatusRefresh, setLiveStatusRefresh] = useState(0);
  /* Shared `GET /live/status` snapshot. Owned here (single poller) and passed down
   * to RunnerStatus, so the global kill switch can be shown whenever connector runtime
   * could be active out-of-band (CLI/another session), not only off in-session SSE
   * items (audit M2: always-available global halt — SPEC Consent §4). */
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  /* The status endpoint is not wired on every backend; a 404/501 hides the panel
   * and removes status from the kill-switch visibility condition. */
  const [liveStatusUnavailable, setLiveStatusUnavailable] = useState(false);

  const messages = useAgentStore(s => s.messages);
  const streamingText = useAgentStore(s => s.streamingText);
  const status = useAgentStore(s => s.status);
  const sessionId = useAgentStore(s => s.sessionId);
  const toolCalls = useAgentStore(s => s.toolCalls);
  const sessionLoading = useAgentStore(s => s.sessionLoading);

  const { connect, disconnect, onStatusChange } = useSSE();

  const urlSessionId = searchParams.get("session");

  /* Smart scroll — only auto-scroll when near bottom */
  const isNearBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }, []);

  const rafRef = useRef(0);
  const scrollToBottom = useCallback(() => {
    if (!isNearBottom()) {
      setShowScrollBtn(true);
      return;
    }
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  }, [isNearBottom]);

  const forceScrollToBottom = useCallback(() => {
    setShowScrollBtn(false);
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  }, []);

  /* Track scroll position to show/hide scroll button */
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      if (isNearBottom()) setShowScrollBtn(false);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [isNearBottom]);

  useEffect(() => {
    onStatusChange((s) => {
      act().setSseStatus(s);
      if (s === "reconnecting" && prevSseStatusRef.current === "connected") toast.warning("连接丢失，正在重连…");
      else if (s === "connected" && prevSseStatusRef.current === "reconnecting") toast.success("连接已恢复");
      prevSseStatusRef.current = s;
    });
  }, [onStatusChange]);

  const doDisconnect = useCallback(() => {
    disconnect();
    sseSessionRef.current = null;
  }, [disconnect]);

  const loadGoalSnapshot = useCallback(async (sid?: string | null) => {
    const targetSession = sid || act().sessionId;
    if (!targetSession) {
      setGoalSnapshot(null);
      setGoalDetailsOpen(false);
      setGoalEditActive(false);
      return;
    }
    try {
      const snapshot = await api.getGoal(targetSession);
      if (act().sessionId !== targetSession) return;
      setGoalSnapshot(snapshot);
    } catch (error) {
      if (act().sessionId !== targetSession) return;
      if (error instanceof ApiError && error.status === 404) {
        setGoalSnapshot(null);
        setGoalDetailsOpen(false);
        setGoalEditActive(false);
      } else {
        toast.error(error instanceof Error ? error.message : "Failed to load goal.");
      }
    }
  }, []);

  const loadSessionMessages = useCallback(async (sid: string, gen: number) => {
    try {
      const msgs = await api.getSessionMessages(sid);
      if (genRef.current !== gen) return;
      const agentMsgs: AgentMessage[] = [];
      for (const m of msgs) {
        const meta = m.metadata as Record<string, unknown> | undefined;
        const runId = meta?.run_id as string | undefined;
        const metrics = meta?.metrics as Record<string, number> | undefined;
        const ts = new Date(m.created_at).getTime();
        if (m.role === "user") {
          agentMsgs.push({ id: m.message_id, type: "user", content: m.content, timestamp: ts });
        } else if (runId) {
          // Show text answer first (if non-empty), then chart card
          if (m.content && m.content !== "Strategy execution completed.") {
            agentMsgs.push({ id: m.message_id + "_ans", type: "answer", content: m.content, timestamp: ts });
          }
          if (metrics && Object.keys(metrics).length > 0) {
            agentMsgs.push({ id: m.message_id, type: "run_complete", content: "", runId, metrics, timestamp: ts + 1 });
          } else {
            // Fetch run data to check report-worthiness; show fallback card if fetch fails
            let fetchedMetrics: Record<string, number> | undefined;
            let fetchedCurve: Array<{ time: string; equity: number }> | undefined;
            let showCard = false;
            try {
              const runData = await api.getRun(runId);
              if (isReportWorthyRun(runData)) {
                fetchedMetrics = runData.metrics;
                fetchedCurve = runData.equity_curve?.map((e) => ({ time: e.time, equity: Number(e.equity) }));
                showCard = true;
              }
              // succeeded but not report-worthy (plain chat turn) → skip card
            } catch {
              // fetch failed (auth/404/network) → can't tell, show link as fallback
              showCard = true;
            }
            if (showCard) {
              agentMsgs.push({
                id: m.message_id,
                type: "run_complete",
                content: "",
                runId,
                metrics: fetchedMetrics,
                equityCurve: fetchedCurve,
                timestamp: ts + 1,
              });
            }
          }
        } else {
          agentMsgs.push({ id: m.message_id, type: "answer", content: m.content, timestamp: ts });
        }
      }
      if (genRef.current !== gen) return;
      act().loadHistory(agentMsgs);
      act().setSessionLoading(false);
      act().cacheSession(sid, agentMsgs);
      setTimeout(() => forceScrollToBottom(), 50);
    } catch {
      act().setSessionLoading(false);
    }
  }, [forceScrollToBottom]);

  const setupSSE = useCallback((sid: string) => {
    connectAgentSSE({
      sid,
      sseSessionRef,
      lastEventRef,
      pendingProgressRef,
      progressRafRef,
      connect,
      disconnect,
      loadGoalSnapshot,
      scrollToBottom,
      setLiveItems,
      setCommittedMandates,
      setLiveHalted,
      setLiveStatusRefresh,
      setGoalSnapshot,
      setGoalDetailsOpen,
      setGoalEditActive,
    });
  }, [connect, disconnect, loadGoalSnapshot, scrollToBottom]);

  useEffect(() => {
    const { sessionId: curSid, messages: curMsgs, cacheSession, reset, getCachedSession, switchSession } = act();

    if (urlSessionId && urlSessionId !== curSid) {
      const gen = genRef.current + 1;
      genRef.current = gen;
      doDisconnect();
      // Live-channel timeline items are per-session; clear on switch.
      setLiveItems([]);
      setCommittedMandates({});
      setLiveHalted(null);
      setLiveStatusRefresh((n) => n + 1);
      if (curSid && curMsgs.length > 0) cacheSession(curSid, curMsgs);

      // Atomic switch: cache hit = instant, cache miss = show loading skeleton
      const cached = getCachedSession(urlSessionId);
      switchSession(urlSessionId, cached);
      if (cached) {
        setTimeout(() => forceScrollToBottom(), 50);
      } else {
        loadSessionMessages(urlSessionId, gen);
      }
      setupSSE(urlSessionId);
    } else if (!urlSessionId && curSid) {
      genRef.current += 1;
      doDisconnect();
      setLiveItems([]);
      setCommittedMandates({});
      setLiveHalted(null);
      setLiveStatusRefresh((n) => n + 1);
      if (curSid && curMsgs.length > 0) cacheSession(curSid, curMsgs);
      reset();
    }
  }, [urlSessionId, doDisconnect, loadSessionMessages, setupSSE, forceScrollToBottom]);

  /* Single shared poller for `GET /live/status`. RunnerStatus consumes this snapshot
   * as a prop rather than polling independently, and the global kill switch reads it
   * to stay available whenever connector runtime activity could be active out-of-band. */
  const refreshLiveStatus = useCallback(async () => {
    try {
      const next = await api.getLiveStatus();
      setLiveStatus(next);
      setLiveHalted((current) => (
        current && !haltScopeStillActive(current, next) ? null : current
      ));
      setLiveStatusUnavailable(false);
    } catch (error) {
      // A 404/501 means the runtime endpoint is not wired on this backend; treat the
      // status source as unavailable. Any other failure keeps the last snapshot.
      if (error instanceof ApiError && (error.status === 404 || error.status === 501)) {
        setLiveStatus(null);
        setLiveStatusUnavailable(true);
      }
    }
  }, []);

  useEffect(() => {
    refreshLiveStatus();
    const timer = setInterval(refreshLiveStatus, LIVE_STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refreshLiveStatus]);

  // Force an immediate re-poll when a live event bumps refreshKey (commit/halt/resume).
  useEffect(() => {
    if (liveStatusRefresh > 0) refreshLiveStatus();
  }, [liveStatusRefresh, refreshLiveStatus]);

  useEffect(() => {
    if (!sessionId) {
      setGoalSnapshot(null);
      setGoalDetailsOpen(false);
      return;
    }
    if (pendingGoalSessionRef.current === sessionId) {
      pendingGoalSessionRef.current = null;
      return;
    }
    loadGoalSnapshot(sessionId);
  }, [sessionId, loadGoalSnapshot]);

  useEffect(() => () => doDisconnect(), [doDisconnect]);

  useEffect(() => {
    api.getLLMSettings().then((s) => {
      sseTimeoutMsRef.current = s.sse_timeout_seconds * 1000;
    }).catch(() => {});
  }, []);

  /* Safety timeout: if streaming but no SSE event for sseTimeoutMsRef.current ms, reset to idle */
  useEffect(() => {
    if (status !== "streaming") return;
    // Arm the clock at the start of every streaming turn. Without this, a turn
    // whose very first event never arrives (e.g. the LLM provider hangs before
    // emitting a single token) left lastEventRef at its 0 / stale value, so the
    // guard below short-circuited and the UI hung on "智能体正在思考…"
    // forever. touch() refreshes this on every real event; the no-op heartbeat
    // deliberately does not, so a connection that only keep-alives still trips.
    lastEventRef.current = Date.now();
    const timer = setInterval(() => {
      if (lastEventRef.current && Date.now() - lastEventRef.current > sseTimeoutMsRef.current && act().status === "streaming") {
        act().setStatus("idle");
        toast.warning("执行超时，已自动停止");
      }
    }, 10_000);
    return () => clearInterval(timer);
  }, [status]);

  const runPrompt = async (prompt: string) => {
    if (!prompt.trim() || status === "streaming") return;

    if (goalComposerActive) {
      setInput("");
      inputRef.current?.focus();
      try {
        const sid = await ensureGoalSession(prompt);
        const snapshot = await api.createGoal(sid, { objective: prompt });
        setGoalSnapshot(snapshot);
        setGoalComposerActive(false);
        setGoalDetailsOpen(true);
        toast.success("研究目标已关联");
        const kickoff = goalKickoffPrompt(prompt);
        act().addMessage({ id: "", type: "user", content: kickoff, timestamp: Date.now() });
        act().setStatus("streaming");
        forceScrollToBottom();
        setupSSE(sid);
        await api.sendMessage(sid, kickoff);
      } catch (error) {
        act().setStatus("idle");
        toast.error(error instanceof Error ? error.message : "Failed to start goal.");
      }
      return;
    }

    let finalPrompt = prompt;

    // Swarm mode: let agent auto-select the right preset
    if (swarmPreset) {
      setSwarmPreset(null);
      finalPrompt = `[Swarm Team Mode] Use the swarm tool to assemble the best specialist team for this task. Auto-select the most appropriate preset.\n\n${prompt}`;
    }

    if (attachment) {
      finalPrompt = `[Uploaded file: ${attachment.filename}, path: ${attachment.filePath}]\n\n${finalPrompt}`;
      setAttachment(null);
    }
    setInput("");
    act().addMessage({ id: "", type: "user", content: finalPrompt, timestamp: Date.now() });
    act().setStatus("streaming");
    forceScrollToBottom();
    inputRef.current?.focus();

    try {
      let sid = act().sessionId;
      if (!sid) {
        const session = await api.createSession(prompt.slice(0, 50));
        sid = session.session_id;
        act().setSessionId(sid);
        setSearchParams({ session: sid }, { replace: true });
      }
      setupSSE(sid);
      await api.sendMessage(sid, finalPrompt);
    } catch (error) {
      act().setStatus("error");
      const message = isAuthRequiredError(error) ? AUTH_REQUIRED_MESSAGE : "发送消息失败，请重试。";
      toast.error(message);
      act().addMessage({ id: "", type: "error", content: message, timestamp: Date.now() });
    }
  };

  const ensureGoalSession = useCallback(async (title: string): Promise<string> => {
    let sid = act().sessionId;
    if (sid) return sid;
    const session = await api.createSession(title.slice(0, 50));
    sid = session.session_id;
    pendingGoalSessionRef.current = sid;
    act().setSessionId(sid);
    setSearchParams({ session: sid }, { replace: true });
    setupSSE(sid);
    return sid;
  }, [setSearchParams, setupSSE]);

  const handleSubmit = (e: FormEvent) => { e.preventDefault(); runPrompt(input.trim()); };

  const handleCancel = async () => {
    if (!sessionId) {
      act().setStatus("idle");
      return;
    }
    try {
      await api.cancelSession(sessionId);
      act().setStatus("idle");
      act().clearStreaming();
      useAgentStore.setState({ toolCalls: [] });
      toast.info("已发送取消请求");
    } catch {
      toast.error("取消失败");
    }
  };

  const handleHaltLive = useCallback(async () => {
    if (halting) return;
    setHalting(true);
    try {
      // The kill switch is global and must fire even with no active chat session
      // (e.g. a runner started from the CLI / another session). The backend scopes
      // the SSE broadcast by session_id when present; an empty string is a valid
      // global trip.
      await api.haltLive(sessionId ?? undefined);
      // Preemptive halt: the server trips the kill switch (cancel resting orders +
      // optional flatten per SPEC §7.5 #6) and broadcasts live.halted. Reflect
      // optimistically and re-poll the runtime panel so the runner shows stopped.
      setLiveHalted((cur) => cur ?? { broker: null, by: "frontend", tripped_at: new Date().toISOString() });
      setLiveStatusRefresh((n) => n + 1);
      toast.success("连接器运行时已暂停");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to halt connector runtime.");
    } finally {
      setHalting(false);
    }
  }, [sessionId, halting]);

  const handleCancelGoal = useCallback(async () => {
    if (!sessionId || !goalSnapshot) return;
    try {
      await api.updateGoalStatus(sessionId, {
        goal_id: goalSnapshot.goal.goal_id,
        expected_goal_id: goalSnapshot.goal.goal_id,
        status: "cancelled",
        recap: "Cancelled from Web UI.",
      });
      setGoalSnapshot(null);
      setGoalDetailsOpen(false);
      toast.success("研究目标已取消");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel goal.");
    }
  }, [goalSnapshot, sessionId]);

  const handleStartGoalEdit = useCallback(() => {
    if (!goalSnapshot) return;
    setGoalEditValue(goalSnapshot.goal.objective);
    setGoalEditActive(true);
  }, [goalSnapshot]);

  const handleSaveGoalEdit = useCallback(async () => {
    const objective = goalEditValue.trim();
    if (!sessionId || !goalSnapshot || !objective) return;
    try {
      const response = await api.updateGoal(sessionId, {
        goal_id: goalSnapshot.goal.goal_id,
        expected_goal_id: goalSnapshot.goal.goal_id,
        objective,
      });
      setGoalSnapshot(response.snapshot);
      setGoalEditActive(false);
      toast.success("研究目标已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update goal.");
    }
  }, [goalEditValue, goalSnapshot, sessionId]);

  const handleContinueGoal = useCallback(async () => {
    if (!sessionId || !goalSnapshot || status === "streaming") return;
    const prompt = goalContinuePrompt(goalSnapshot);
    act().addMessage({ id: "", type: "user", content: prompt, timestamp: Date.now() });
    act().setStatus("streaming");
    forceScrollToBottom();
    inputRef.current?.focus();
    try {
      setupSSE(sessionId);
      await api.sendMessage(sessionId, prompt);
    } catch (error) {
      act().setStatus("error");
      const message = isAuthRequiredError(error) ? AUTH_REQUIRED_MESSAGE : "继续目标失败，请重试。";
      toast.error(message);
      act().addMessage({ id: "", type: "error", content: message, timestamp: Date.now() });
    }
  }, [forceScrollToBottom, goalSnapshot, sessionId, setupSSE, status]);

  const handleRetry = useCallback((errorMsg: AgentMessage) => {
    if (status === "streaming") return;
    const msgs = act().messages;
    const errorIdx = msgs.findIndex(m => m.id === errorMsg.id);
    if (errorIdx === -1) return;
    // Find the most recent user message before this error
    let userContent: string | null = null;
    for (let i = errorIdx - 1; i >= 0; i--) {
      if (msgs[i].type === "user") {
        userContent = msgs[i].content;
        break;
      }
    }
    if (!userContent) return;
    runPrompt(userContent);
  }, [status]);

  const handleGoalComposerOpen = useCallback(() => {
    setGoalComposerActive(true);
    inputRef.current?.focus();
  }, []);

  const handleSwarmMode = useCallback(() => {
    setSwarmPreset({ name: "auto", title: "Agent Swarm" });
    inputRef.current?.focus();
  }, []);

  const handleConnectorCheck = useCallback(() => {
    void runPrompt(CONNECTOR_CHECK_PROMPT);
  }, [runPrompt]);

  const handleConnectorPortfolio = useCallback(() => {
    void runPrompt(CONNECTOR_PORTFOLIO_PROMPT);
  }, [runPrompt]);

  const handleExport = () => {
    if (messages.length === 0) return;
    const lines: string[] = [`# Chat Export`, ``, `Export time: ${new Date().toLocaleString()}`, ``];
    for (const msg of messages) {
      const time = new Date(msg.timestamp).toLocaleString();
      if (msg.type === "user") {
        lines.push(`## User (${time})`, ``, msg.content, ``);
      } else if (msg.type === "answer") {
        lines.push(`## Assistant (${time})`, ``, msg.content, ``);
      } else if (msg.type === "error") {
        lines.push(`## Error (${time})`, ``, msg.content, ``);
      } else if (msg.type === "tool_call") {
        lines.push(`> Tool call: ${msg.tool || "unknown"}`, ``);
      } else if (msg.type === "swarm_status") {
        lines.push(`> Swarm status: ${msg.swarmStatus?.preset || "swarm"} ${msg.swarmStatus?.status || ""}`, ``);
      } else if (msg.type === "run_complete") {
        lines.push(`> Backtest complete: ${msg.runId || ""}`, ``);
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const blockedExts = [
      ".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".app", ".dmg",
      ".so", ".dll", ".dylib",
      ".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".bz2", ".xz",
    ];
    const lowered = file.name.toLowerCase();
    if (blockedExts.some((ext) => lowered.endsWith(ext))) {
      toast.error("不允许上传可执行文件和压缩包");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error("文件大小超过 50 MB 限制");
      return;
    }
    setUploading(true);
    setShowUploadMenu(false);
    try {
      const result = await api.uploadFile(file);
      setAttachment({ filename: result.filename, filePath: result.file_path });
      toast.success(`Uploaded: ${result.filename}`);
    } catch (err) {
      toast.error(`Upload failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setUploading(false);
    }
  }, []);

  const groups = useMemo(() => groupMessages(messages), [messages]);

  /* Merge message groups with live-channel items, ordered by timestamp, so a
   * mandate proposal / live-action chip renders inline at the point it arrived. */
  type TimelineRow =
    | { sort: number; render: "group"; group: MsgGroup; key: string }
    | { sort: number; render: "live"; item: LiveItem; key: string };
  const timelineRows = useMemo<TimelineRow[]>(() => {
    const rows: TimelineRow[] = groups.map((g, i) => {
      const ts = g.kind === "timeline" ? g.msgs[0].timestamp : g.msg.timestamp;
      const key = g.kind === "timeline" ? `g_${g.msgs[0].id || g.msgs[0].timestamp}` : `g_${g.msg.id || g.msg.timestamp}_${i}`;
      return { sort: ts, render: "group", group: g, key };
    });
    for (const item of liveItems) {
      const key = item.kind === "proposal" ? `lp_${item.proposal.proposal_id}` : `la_${item.action.audit_id || item.timestamp}`;
      rows.push({ sort: item.timestamp, render: "live", item, key });
    }
    return rows.sort((a, b) => a.sort - b.sort);
  }, [groups, liveItems]);

  /* Whether connector runtime activity could be active *anywhere* — the global kill switch must be
   * available whenever it could (audit M2 / SPEC Consent §4). Driven off both
   * in-session SSE artifacts AND the shared `/live/status` snapshot, so a runner
   * started from the CLI or another browser session still surfaces the halt button
   * in a freshly-loaded web session. */
  const liveStatusActive =
    liveStatus != null &&
    (liveStatus.global_halted ||
      liveStatus.brokers.some((b) => b.auth.oauth_token_present || b.runner?.alive || b.mandate != null));
  const liveActive =
    liveItems.length > 0 ||
    Object.keys(committedMandates).length > 0 ||
    liveHalted != null ||
    liveStatusActive;
  /* The global kill switch reflects only a global halt from either an in-session SSE
   * event or the polled status; broker-scoped halts stay on their broker row. */
  const liveIsHalted = isGlobalLiveHalt(liveHalted) || (liveStatus?.global_halted ?? false);

  return (
    <div className="flex flex-col flex-1 min-w-0 overflow-hidden h-full">
      <div ref={listRef} className="flex-1 overflow-auto p-6 scroll-smooth relative">
        <div className="max-w-3xl mx-auto space-y-4">
          {sessionLoading && <SkeletonLoading />}
          {!sessionLoading && messages.length === 0 && <WelcomeScreen onExample={runPrompt} />}
          <ChatMessageList
            timelineRows={timelineRows}
            messages={messages}
            status={status}
            streamingText={streamingText}
            toolCalls={toolCalls}
            onRetry={handleRetry}
            onAdjust={runPrompt}
            committedMandates={committedMandates}
          />
        </div>
        {showScrollBtn && <ScrollToBottomButton onClick={forceScrollToBottom} />}
        <ConversationTimeline messages={messages} containerRef={listRef} />
      </div>
      <InputArea
        input={input}
        setInput={setInput}
        inputRef={inputRef}
        isComposingRef={isComposingRef}
        lastCompositionEndRef={lastCompositionEndRef}
        fileInputRef={fileInputRef}
        swarmPreset={swarmPreset}
        setSwarmPreset={setSwarmPreset}
        goalComposerActive={goalComposerActive}
        setGoalComposerActive={setGoalComposerActive}
        goalSnapshot={goalSnapshot}
        goalDetailsOpen={goalDetailsOpen}
        setGoalDetailsOpen={setGoalDetailsOpen}
        goalEditActive={goalEditActive}
        goalEditValue={goalEditValue}
        setGoalEditValue={setGoalEditValue}
        setGoalEditActive={setGoalEditActive}
        status={status}
        liveStatus={liveStatus}
        liveStatusUnavailable={liveStatusUnavailable}
        liveActive={liveActive}
        liveIsHalted={liveIsHalted}
        halting={halting}
        uploading={uploading}
        attachment={attachment}
        setAttachment={setAttachment}
        showUploadMenu={showUploadMenu}
        setShowUploadMenu={setShowUploadMenu}
        messages={messages}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        onExport={handleExport}
        onHaltLive={handleHaltLive}
        onFileSelect={handleFileSelect}
        onContinueGoal={handleContinueGoal}
        onStartGoalEdit={handleStartGoalEdit}
        onSaveGoalEdit={handleSaveGoalEdit}
        onCancelGoal={handleCancelGoal}
        onGoalComposerOpen={handleGoalComposerOpen}
        onSwarmMode={handleSwarmMode}
        onConnectorCheck={handleConnectorCheck}
        onConnectorPortfolio={handleConnectorPortfolio}
        onRefreshLiveStatus={refreshLiveStatus}
        runPrompt={runPrompt}
      />
    </div>
  );
}
