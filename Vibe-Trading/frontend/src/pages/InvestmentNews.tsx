import { useState, useEffect, useRef, useCallback } from "react";
import { RefreshCw, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDarkMode } from "@/hooks/useDarkMode";

const NEWS_SERVER = "http://localhost:8793";

export function InvestmentNews() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { dark } = useDarkMode();

  // ── 主题同步：向 iframe 发送当前主题 ──
  const sendTheme = useCallback(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: "theme", theme: dark ? "dark" : "light" },
        "*",
      );
    }
  }, [dark]);

  // 监听来自 iframe 的 ready 信号
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "news-iframe-ready") sendTheme();
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [sendTheme]);

  // iframe 加载完成后发送主题
  useEffect(() => {
    sendTheme();
  }, [dark, connected, sendTheme]);

  // Check if news server is reachable
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        await fetch(NEWS_SERVER, { mode: "no-cors" });
        if (!cancelled) {
          setConnected(true);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setConnected(false);
          setLoading(false);
        }
      }
    };
    check();
    const timer = setInterval(() => {
      if (!connected) check();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connected]);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetch(`${NEWS_SERVER}/api/refresh`, { method: "POST" });
      setTimeout(() => {
        if (iframeRef.current) {
          iframeRef.current.src = `${NEWS_SERVER}?embed=1&t=${Date.now()}`;
        }
        setRefreshing(false);
      }, 2000);
    } catch {
      setRefreshing(false);
    }
  };

  // iframe 加载完后再发一次主题
  const handleIframeLoad = () => {
    sendTheme();
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-sm text-muted-foreground">投资新闻服务未启动</p>
          <p className="text-xs text-muted-foreground/60">
            请在终端运行以启动服务：
          </p>
          <code className="block bg-muted px-4 py-2 rounded-lg text-xs font-mono text-foreground">
            cd investment-news &amp;&amp; python3 server.py
          </code>
          <p className="text-xs text-muted-foreground/60">
            服务启动后可访问{" "}
            <a
              href={NEWS_SERVER}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {NEWS_SERVER}
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-card shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">投资新闻</span>
          <span className="text-xs text-muted-foreground">
            覆盖 100+ 信息源 · 12 大赛道 · AI 提炼每日要点
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
              refreshing
                ? "bg-muted text-muted-foreground border-border cursor-not-allowed"
                : "bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-primary",
            )}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
            />
            {refreshing ? "刷新中..." : "刷新资讯"}
          </button>
          <a
            href={NEWS_SERVER}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            新窗口打开
          </a>
        </div>
      </div>

      {/* Embedded iframe */}
      <div className="flex-1 min-h-0">
        <iframe
          ref={iframeRef}
          src={`${NEWS_SERVER}?embed=1`}
          className="w-full h-full border-0"
          title="投资新闻"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          onLoad={handleIframeLoad}
        />
      </div>
    </div>
  );
}
