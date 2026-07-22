import { Loader2 } from "lucide-react";
import type { MandateCommitted } from "@/lib/api";
import type { MsgGroup, LiveItem } from "@/lib/agentHelpers";
import type { AgentMessage, ToolCallEntry } from "@/types/agent";
import { MandateProposalCard } from "@/components/chat/MandateProposalCard";
import { LiveActionChip } from "@/components/chat/LiveActionChip";
import { ThinkingTimeline } from "@/components/chat/ThinkingTimeline";
import { SwarmStatusCard } from "@/components/chat/SwarmStatusCard";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { AgentAvatar } from "@/components/chat/AgentAvatar";
import { ToolProgressIndicator } from "@/components/chat/ToolProgressIndicator";

type TimelineRow =
  | { sort: number; render: "group"; group: MsgGroup; key: string }
  | { sort: number; render: "live"; item: LiveItem; key: string };

interface ChatMessageListProps {
  timelineRows: TimelineRow[];
  messages: AgentMessage[];
  status: string;
  streamingText: string;
  toolCalls: ToolCallEntry[];
  onRetry: (errorMsg: AgentMessage) => void;
  onAdjust: (prompt: string) => void;
  committedMandates: Record<string, MandateCommitted>;
}

export function ChatMessageList({
  timelineRows,
  messages,
  status,
  streamingText,
  toolCalls,
  onRetry,
  onAdjust,
  committedMandates,
}: ChatMessageListProps) {
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {timelineRows.map((row, rowIdx) => {
        if (row.render === "live") {
          if (row.item.kind === "proposal") {
            return (
              <MandateProposalCard
                key={row.key}
                proposal={row.item.proposal}
                committed={committedMandates[row.item.proposal.proposal_id] ?? null}
                onAdjust={onAdjust}
              />
            );
          }
          return <LiveActionChip key={row.key} action={row.item.action} />;
        }
        const g = row.group;
        if (g.kind === "timeline") {
          const isLastRow = rowIdx === timelineRows.length - 1;
          return (
            <ThinkingTimeline
              key={row.key}
              messages={g.msgs}
              isLatest={isLastRow && status === "streaming"}
            />
          );
        }
        const msgIdx = messages.indexOf(g.msg);
        if (g.msg.type === "swarm_status" && g.msg.swarmStatus) {
          return (
            <div key={row.key} data-msg-idx={msgIdx}>
              <SwarmStatusCard status={g.msg.swarmStatus} />
            </div>
          );
        }
        return (
          <div key={row.key} data-msg-idx={msgIdx}>
            <MessageBubble msg={g.msg} onRetry={g.msg.type === "error" ? onRetry : undefined} />
          </div>
        );
      })}

      {/* Pre-stream placeholder: visible after Send, before first SSE event */}
      {status === "streaming" && !streamingText && toolCalls.length === 0 && !messages.some((m) => m.type === "swarm_status" && m.swarmStatus?.status === "running") && (
        <div className="flex gap-3">
          <AgentAvatar />
          <div className="flex-1 min-w-0 flex items-center gap-2 text-xs text-muted-foreground pt-1">
            <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
            <span>智能体正在思考…</span>
          </div>
        </div>
      )}

      {/* Live streaming area: text + tool status */}
      {(streamingText || (status === "streaming" && toolCalls.length > 0)) && (
        <div className="flex gap-3">
          <AgentAvatar />
          <div className="flex-1 min-w-0 space-y-1.5">
            {streamingText && (
              <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                {streamingText}
                <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" />
              </div>
            )}
            {status === "streaming" && toolCalls.length > 0 && (
              <ToolProgressIndicator toolCalls={toolCalls} />
            )}
          </div>
        </div>
      )}

      {/* Persistent streaming pulse bar — always visible while agent is working */}
      {status === "streaming" && (
        <div className="flex items-center gap-2 px-1 pt-1">
          <div className="h-0.5 flex-1 rounded-full bg-primary/20 overflow-hidden">
            <div className="h-full w-1/3 bg-primary rounded-full animate-[pulse-slide_2s_ease-in-out_infinite]" />
          </div>
          <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">running</span>
        </div>
      )}
    </div>
  );
}
