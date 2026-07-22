import { type FormEvent, type RefObject, type MutableRefObject, type Dispatch, type SetStateAction, useEffect, useRef } from "react";
import { Send, Square, Download, Paperclip, X, Users, Target, OctagonX, Loader2 } from "lucide-react";
import type { GoalSnapshot, LiveStatus } from "@/lib/api";
import { GoalDetailPanel } from "@/components/chat/GoalDetailPanel";
import { UploadMenu } from "@/components/chat/UploadMenu";
import { RunnerStatus } from "@/components/chat/RunnerStatus";

interface InputAreaProps {
  /* -- input state -- */
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  isComposingRef: MutableRefObject<boolean>;
  lastCompositionEndRef: MutableRefObject<number>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  /* -- swarm -- */
  swarmPreset: { name: string; title: string } | null;
  setSwarmPreset: Dispatch<SetStateAction<{ name: string; title: string } | null>>;
  /* -- goal -- */
  goalComposerActive: boolean;
  setGoalComposerActive: Dispatch<SetStateAction<boolean>>;
  goalSnapshot: GoalSnapshot | null;
  goalDetailsOpen: boolean;
  setGoalDetailsOpen: Dispatch<SetStateAction<boolean>>;
  goalEditActive: boolean;
  goalEditValue: string;
  setGoalEditValue: Dispatch<SetStateAction<string>>;
  setGoalEditActive: Dispatch<SetStateAction<boolean>>;
  /* -- runtime -- */
  status: string;
  liveStatus: LiveStatus | null;
  liveStatusUnavailable: boolean;
  liveActive: boolean;
  liveIsHalted: boolean;
  halting: boolean;
  uploading: boolean;
  /* -- attachment -- */
  attachment: { filename: string; filePath: string } | null;
  setAttachment: Dispatch<SetStateAction<{ filename: string; filePath: string } | null>>;
  /* -- upload menu -- */
  showUploadMenu: boolean;
  setShowUploadMenu: Dispatch<SetStateAction<boolean>>;
  /* -- misc -- */
  messages: unknown[];
  /* -- handlers -- */
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
  onExport: () => void;
  onHaltLive: () => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onContinueGoal: () => void;
  onStartGoalEdit: () => void;
  onSaveGoalEdit: () => void;
  onCancelGoal: () => void;
  onGoalComposerOpen: () => void;
  onSwarmMode: () => void;
  onConnectorCheck: () => void;
  onConnectorPortfolio: () => void;
  onRefreshLiveStatus: () => void;
  runPrompt: (prompt: string) => Promise<void>;
}

export function InputArea({
  input, setInput, inputRef, isComposingRef, lastCompositionEndRef, fileInputRef,
  swarmPreset, setSwarmPreset,
  goalComposerActive, setGoalComposerActive,
  goalSnapshot, goalDetailsOpen, setGoalDetailsOpen,
  goalEditActive, goalEditValue, setGoalEditValue, setGoalEditActive,
  status, liveStatus, liveStatusUnavailable, liveActive, liveIsHalted, halting, uploading,
  attachment, setAttachment, showUploadMenu, setShowUploadMenu,
  messages,
  onSubmit, onCancel, onExport, onHaltLive, onFileSelect,
  onContinueGoal, onStartGoalEdit, onSaveGoalEdit, onCancelGoal,
  onGoalComposerOpen, onSwarmMode, onConnectorCheck, onConnectorPortfolio,
  onRefreshLiveStatus, runPrompt,
}: InputAreaProps) {
  const uploadMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (uploadMenuRef.current && !uploadMenuRef.current.contains(e.target as Node)) {
        setShowUploadMenu(false);
      }
    };
    if (showUploadMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showUploadMenu, setShowUploadMenu]);

  return (
    <form onSubmit={onSubmit} className="border-t p-4 bg-background/80 backdrop-blur-sm">
      <div className="max-w-3xl mx-auto space-y-2">
        {/* Swarm preset badge */}
        {swarmPreset && (
          <div className="flex items-center gap-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-medium">
              <Users className="h-3 w-3" />
              {swarmPreset.title}
              <button type="button" onClick={() => setSwarmPreset(null)} className="hover:text-destructive transition-colors">
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}
        {goalComposerActive && (
          <div className="flex items-center gap-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-xs font-medium">
              <Target className="h-3 w-3" />
              新建研究目标
              <button type="button" onClick={() => setGoalComposerActive(false)} className="hover:text-destructive transition-colors">
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}
        <GoalDetailPanel
          goalSnapshot={goalSnapshot}
          goalDetailsOpen={goalDetailsOpen}
          setGoalDetailsOpen={setGoalDetailsOpen}
          goalEditActive={goalEditActive}
          goalEditValue={goalEditValue}
          setGoalEditValue={setGoalEditValue}
          status={status}
          onContinue={onContinueGoal}
          onStartEdit={onStartGoalEdit}
          onSaveEdit={onSaveGoalEdit}
          onCancelGoal={onCancelGoal}
          setGoalEditActive={setGoalEditActive}
        />
        {/* Persistent live runtime status panel */}
        <RunnerStatus
          status={liveStatus}
          unavailable={liveStatusUnavailable}
          halted={liveIsHalted}
          onRefresh={onRefreshLiveStatus}
        />
        {/* Attachment badge */}
        {attachment && (
          <div className="flex items-center gap-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-xs font-medium">
              <Paperclip className="h-3 w-3" />
              {attachment.filename}
              <button type="button" onClick={() => setAttachment(null)} className="hover:text-destructive transition-colors">
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}
        {/* Uploading indicator */}
        {uploading && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            上传中...
          </div>
        )}
        {/* Persistent kill switch */}
        {liveActive && (
          <div className="flex items-center gap-2">
            {liveIsHalted ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
                <OctagonX className="h-3 w-3" />
                连接器运行时已暂停
              </span>
            ) : (
              <button
                type="button"
                onClick={onHaltLive}
                disabled={halting}
                className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/5 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-40"
                title="立即停止连接器运行时活动"
              >
                {halting ? <Loader2 className="h-3 w-3 animate-spin" /> : <OctagonX className="h-3 w-3" />}
                暂停连接器运行时
              </button>
            )}
          </div>
        )}
        <div className="flex gap-2 items-end">
          {/* "+" menu: PDF upload + Swarm presets */}
          <div ref={uploadMenuRef}>
            <UploadMenu
              showUploadMenu={showUploadMenu}
              setShowUploadMenu={setShowUploadMenu}
              fileInputRef={fileInputRef}
              status={status}
              uploading={uploading}
              onGoalComposerOpen={onGoalComposerOpen}
              onSwarmMode={onSwarmMode}
              onConnectorCheck={onConnectorCheck}
              onConnectorPortfolio={onConnectorPortfolio}
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.xlsx,.xls,.pptx,.csv,.tsv,.txt,.md,.log,.json,.yaml,.yml,.toml,.html,.xml,.rst,.png,.jpg,.jpeg,.gif,.bmp,.webp,.tiff"
            onChange={onFileSelect}
            className="hidden"
          />
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
              lastCompositionEndRef.current = Date.now();
            }}
            onInput={(e) => {
              const el = e.target as HTMLTextAreaElement;
              el.style.height = "auto";
              el.style.height = el.scrollHeight + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                const nativeEvent = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
                const justFinishedComposing = Date.now() - lastCompositionEndRef.current < 80;
                if (isComposingRef.current || nativeEvent.isComposing || (nativeEvent as unknown as { keyCode: number }).keyCode === 229) {
                  return;
                }
                if (justFinishedComposing) {
                  e.preventDefault();
                  return;
                }
                e.preventDefault();
                void runPrompt(input.trim());
              }
            }}
            placeholder={
              goalComposerActive
                ? "描述要关联到本会话的研究目标"
                : "例如：为 000001.SZ 创建双均线交叉策略，回测 2024 年"
            }
            className="flex-1 px-4 py-2.5 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition-shadow resize-none max-h-32 overflow-y-auto"
            disabled={status === "streaming"}
          />
          {(messages as unknown[]).length > 0 && (
            <button
              type="button"
              onClick={onExport}
              className="px-3 py-2.5 rounded-xl border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Export chat"
            >
              <Download className="h-4 w-4" />
            </button>
          )}
          {status === "streaming" ? (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2.5 rounded-xl bg-destructive text-destructive-foreground text-sm font-medium hover:opacity-90 transition-opacity"
              title="Stop generation"
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={goalComposerActive ? !input.trim() : (!input.trim() && !attachment)}
              className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
