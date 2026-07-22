import { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

const DAILY_PICK_SERVER = "http://localhost:5173";

export function DailyPick() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Check if the daily-pick dev server is reachable
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        await fetch(DAILY_PICK_SERVER, { mode: "no-cors" });
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
          <p className="text-sm text-muted-foreground">每日选股分析服务未启动</p>
          <p className="text-xs text-muted-foreground/60">
            本地开发服务（{DAILY_PICK_SERVER}）未运行，请确认服务已启动：
          </p>
          <code className="block bg-muted px-4 py-2 rounded-lg text-xs font-mono text-foreground">
            cd &lt;每日选股分析项目&gt; &amp;&amp; npm run dev
          </code>
          <p className="text-xs text-muted-foreground/60">
            服务启动后可访问{" "}
            <a
              href={DAILY_PICK_SERVER}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {DAILY_PICK_SERVER}
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full">
      <iframe
        ref={iframeRef}
        src={`${DAILY_PICK_SERVER}?t=${Date.now()}`}
        className="w-full h-full border-0"
        title="每日选股分析"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}
