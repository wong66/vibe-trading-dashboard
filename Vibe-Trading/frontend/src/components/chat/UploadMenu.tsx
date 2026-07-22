import { Plus, Paperclip, Target, Users, Landmark } from "lucide-react";

interface UploadMenuProps {
  showUploadMenu: boolean;
  setShowUploadMenu: (show: boolean) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  status: string;
  uploading: boolean;
  onGoalComposerOpen: () => void;
  onSwarmMode: () => void;
  onConnectorCheck: () => void;
  onConnectorPortfolio: () => void;
}

export function UploadMenu({
  showUploadMenu,
  setShowUploadMenu,
  fileInputRef,
  status,
  uploading,
  onGoalComposerOpen,
  onSwarmMode,
  onConnectorCheck,
  onConnectorPortfolio,
}: UploadMenuProps) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowUploadMenu(!showUploadMenu)}
        disabled={status === "streaming" || uploading}
        className="w-9 h-9 rounded-full border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 shrink-0"
        title="More options"
      >
        <Plus className="h-4 w-4" />
      </button>
      {showUploadMenu && (
        <div className="absolute bottom-full left-0 mb-2 w-52 rounded-xl border bg-background/95 backdrop-blur-sm shadow-lg py-1 z-50">
          <button
            type="button"
            onClick={() => { fileInputRef.current?.click(); setShowUploadMenu(false); }}
            className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
          >
            <Paperclip className="h-4 w-4" />
            上传 PDF 文档
          </button>
          <div className="border-t my-1" />
          <button
            type="button"
            onClick={() => { setShowUploadMenu(false); onGoalComposerOpen(); }}
            className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
          >
            <Target className="h-4 w-4" />
            Research Goal
          </button>
          <button
            type="button"
            onClick={() => { setShowUploadMenu(false); onSwarmMode(); }}
            className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
          >
            <Users className="h-4 w-4" />
            Agent Swarm
          </button>
          <div className="border-t my-1" />
          <button
            type="button"
            onClick={() => { setShowUploadMenu(false); onConnectorCheck(); }}
            className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
          >
            <Landmark className="h-4 w-4" />
            检查交易连接器
          </button>
          <button
            type="button"
            onClick={() => { setShowUploadMenu(false); onConnectorPortfolio(); }}
            className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
          >
            <Landmark className="h-4 w-4" />
            分析连接器组合
          </button>
        </div>
      )}
    </div>
  );
}
