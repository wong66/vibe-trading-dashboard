import { authHeaders, withAuthQuery } from "@/lib/apiAuth";

// Re-export all API types from the dedicated types module.
// This preserves backward compatibility: all `import { type X } from "@/lib/api"` still work.
export * from "@/types/api";
import type {
  RunListItem, RunData, PineScriptResult,
  SessionItem, MessageItem,
  GoalSnapshot, CreateGoalRequest, UpdateGoalRequest, UpdateGoalResponse,
  AddGoalEvidenceRequest, AddGoalEvidenceResponse,
  UpdateGoalStatusRequest, UpdateGoalStatusResponse,
  SwarmPreset, SwarmRunSummary,
  LLMSettings, UpdateLLMSettingsRequest,
  DataSourceSettings, UpdateDataSourceSettingsRequest,
  AlphaListParams, AlphaListResponse, AlphaDetailResponse,
  AlphaBenchRequest, AlphaCompareRequest,
  CommitMandateRequest, CommitMandateResponse,
  HaltLiveResponse, LiveStatus, LiveAuthorizeResponse, LiveRunnerResponse,
  MarketDataParams, MarketDataResponse, IndustryReportsResponse,
  StockSearchResult, StockKlineResponse, StockMcapHistoryResponse,
  StockFundamentalsResponse, StockConsensusResponse, StockReportsResponse,
  StockReportsSummaryResponse,
  UploadResult,
} from "@/types/api";

const BASE: string = (import.meta as any).env?.VITE_API_BASE ?? "";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const AUTH_REQUIRED_MESSAGE =
  "Remote API access requires an API key. Add it in Settings, or run the backend on localhost for local-only use.";

export function isAuthRequiredError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

async function errorFromResponse(res: Response): Promise<ApiError> {
  let detail = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    detail = body.detail || body.message || detail;
  } catch { /* ignore */ }
  if (res.status === 401 || res.status === 403) {
    detail = AUTH_REQUIRED_MESSAGE;
  }
  return new ApiError(detail, res.status);
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const { headers, ...rest } = options ?? {};
  const mergedHeaders: Record<string, string> = { "Content-Type": "application/json", ...authHeaders() };
  if (headers) {
    new Headers(headers).forEach((value, key) => {
      mergedHeaders[key] = value;
    });
  }
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: mergedHeaders,
  });
  if (!res.ok) {
    throw await errorFromResponse(res);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : ({} as T);
}

async function uploadFile(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/upload`, { method: "POST", headers: authHeaders(), body: form });
  if (!res.ok) {
    throw await errorFromResponse(res);
  }
  return res.json();
}

function appendQueryParam(url: string, key: string, value: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

export const api = {
  uploadFile,
  listRuns: () => request<RunListItem[]>("/runs"),
  getRun: (id: string) => request<RunData>(`/runs/${id}`),
  getRunCode: (id: string) => request<Record<string, string>>(`/runs/${id}/code`),
  getRunPine: (id: string) => request<PineScriptResult>(`/runs/${id}/pine`),
  listSessions: () => request<SessionItem[]>("/sessions"),
  createSession: (title?: string) => request<SessionItem>("/sessions", { method: "POST", body: JSON.stringify({ title: title || "" }) }),
  deleteSession: (sid: string) => request<{ status: string }>(`/sessions/${sid}`, { method: "DELETE" }),
  renameSession: (sid: string, title: string) => request<{ status: string }>(`/sessions/${sid}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  sendMessage: (sid: string, content: string) => request<{ message_id: string; attempt_id: string }>(`/sessions/${sid}/messages`, { method: "POST", body: JSON.stringify({ content }) }),
  cancelSession: (sid: string) => request<{ status: string }>(`/sessions/${sid}/cancel`, { method: "POST" }),
  getSessionMessages: (sid: string) => request<MessageItem[]>(`/sessions/${sid}/messages`),
  createGoal: (sid: string, body: CreateGoalRequest) =>
    request<GoalSnapshot>(`/sessions/${sid}/goal`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getGoal: (sid: string) => request<GoalSnapshot>(`/sessions/${sid}/goal`),
  updateGoal: (sid: string, body: UpdateGoalRequest) =>
    request<UpdateGoalResponse>(`/sessions/${sid}/goal`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  addGoalEvidence: (sid: string, body: AddGoalEvidenceRequest) =>
    request<AddGoalEvidenceResponse>(`/sessions/${sid}/goal/evidence`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateGoalStatus: (sid: string, body: UpdateGoalStatusRequest) =>
    request<UpdateGoalStatusResponse>(`/sessions/${sid}/goal/status`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  sseUrl: (sid: string, options?: { replay?: "active" }) => {
    let url = withAuthQuery(`${BASE}/sessions/${sid}/events`);
    if (options?.replay) url = appendQueryParam(url, "replay", options.replay);
    return url;
  },

  // Swarm API
  listSwarmPresets: () => request<SwarmPreset[]>("/swarm/presets"),
  createSwarmRun: (preset_name: string, user_vars: Record<string, string>) =>
    request<{ id: string; status: string }>("/swarm/runs", {
      method: "POST",
      body: JSON.stringify({ preset_name, user_vars }),
    }),
  listSwarmRuns: () => request<SwarmRunSummary[]>("/swarm/runs"),
  getSwarmRun: (id: string) => request<Record<string, unknown>>(`/swarm/runs/${id}`),
  swarmSseUrl: (id: string) => withAuthQuery(`${BASE}/swarm/runs/${id}/events`),
  cancelSwarmRun: (id: string) =>
    request<{ status: string }>(`/swarm/runs/${id}/cancel`, { method: "POST" }),
  retrySwarmRun: (id: string) =>
    request<{ id: string; status: string; preset_name: string }>(`/swarm/runs/${id}/retry`, { method: "POST" }),
  getLLMSettings: () => request<LLMSettings>("/settings/llm"),
  updateLLMSettings: (settings: UpdateLLMSettingsRequest) =>
    request<LLMSettings>("/settings/llm", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  getDataSourceSettings: () => request<DataSourceSettings>("/settings/data-sources"),
  updateDataSourceSettings: (settings: UpdateDataSourceSettingsRequest) =>
    request<DataSourceSettings>("/settings/data-sources", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),

  // Alpha Zoo API
  listAlphas: (params: AlphaListParams = {}) => {
    const q = new URLSearchParams();
    if (params.zoo) q.set("zoo", params.zoo);
    if (params.theme) q.set("theme", params.theme);
    if (params.universe) q.set("universe", params.universe);
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<AlphaListResponse>(`/alpha/list${qs ? `?${qs}` : ""}`);
  },
  getAlpha: (alphaId: string) =>
    request<AlphaDetailResponse>(`/alpha/${encodeURIComponent(alphaId)}`),
  createAlphaBench: (body: AlphaBenchRequest) =>
    request<{ status: string; job_id: string }>("/alpha/bench", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  alphaBenchStreamUrl: (jobId: string) =>
    withAuthQuery(`${BASE}/alpha/bench/${encodeURIComponent(jobId)}/stream`),
  createAlphaCompare: (body: AlphaCompareRequest) =>
    request<{ status: string; job_id: string }>("/alpha/compare", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  alphaCompareStreamUrl: (jobId: string) =>
    withAuthQuery(`${BASE}/alpha/compare/${encodeURIComponent(jobId)}/stream`),

  // Connector runtime channel — privileged surface actions (NOT agent tools).
  // commit is the ONLY action that writes a mandate; halt trips the kill switch.
  commitMandate: (body: CommitMandateRequest) =>
    request<CommitMandateResponse>("/mandate/commit", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  haltLive: (session_id?: string, broker?: string, reason?: string) =>
    request<HaltLiveResponse>("/live/halt", {
      method: "POST",
      body: JSON.stringify({ session_id, broker, reason }),
    }),
  // Read the persistent runtime status across all authorized brokers (SPEC §7.5).
  // Polled by the RunnerStatus panel; a plain authenticated GET, never a chat message.
  getLiveStatus: () => request<LiveStatus>("/live/status"),
  authorizeLive: (broker: string) =>
    request<LiveAuthorizeResponse>("/live/authorize", {
      method: "POST",
      body: JSON.stringify({ broker }),
    }),
  // Start/stop the persistent runner (SPEC §7.5). Privileged surface actions, not agent tools.
  startLiveRunner: (broker: string) =>
    request<LiveRunnerResponse>("/live/runner/start", {
      method: "POST",
      body: JSON.stringify({ broker }),
    }),
  stopLiveRunner: (broker: string) =>
    request<LiveRunnerResponse>("/live/runner/stop", {
      method: "POST",
      body: JSON.stringify({ broker }),
    }),

  // Market data for overview dashboard (no auth — public quotes)
  getMarketData: (params: MarketDataParams) => {
    const parts: string[] = [];
    if (params.indices?.length) parts.push(`indices=${encodeURIComponent(params.indices.join(","))}`);
    if (params.stocks_a?.length) parts.push(`stocks_a=${encodeURIComponent(params.stocks_a.join(","))}`);
    if (params.stocks_us?.length) parts.push(`stocks_us=${encodeURIComponent(params.stocks_us.join(","))}`);
    return request<MarketDataResponse>(`/market-data?${parts.join("&")}`);
  },

  // Industry reports (no auth — public metadata). Pass industry group to filter by sector keywords.
  getIndustryReports: (industry: string = "robot") => request<IndustryReportsResponse>(`/industry-reports?industry=${encodeURIComponent(industry)}`),

  // Stock search by keyword (code or name) — returns A-shares and US stocks
  searchStocks: (q: string) => request<{ q: string; results: StockSearchResult[] }>(`/stock-search?q=${encodeURIComponent(q)}`),

  // Stock K-line (OHLCV bars) — A-share via Tencent, US via yfinance
  getStockKline: (code: string, market: "A" | "US", period: string = "5y") =>
    request<StockKlineResponse>(`/stock-kline?code=${encodeURIComponent(code)}&market=${market}&period=${encodeURIComponent(period)}`),

  // Stock market-cap history: monthly bars + total shares → mcap_yi per month
  getStockMcapHistory: (code: string, market: "A" | "US", startYear = 2018) =>
    request<StockMcapHistoryResponse>(
      `/stock-mcap-history?code=${encodeURIComponent(code)}&market=${market}&start_year=${startYear}`,
    ),

  // Stock quarterly fundamentals + business segments
  getStockFundamentals: (code: string, market: "A" | "US", segPeriod?: string) => {
    const params = new URLSearchParams({
      code,
      market,
      num_periods: "34",
    });
    if (segPeriod) params.set("seg_period", segPeriod);
    return request<StockFundamentalsResponse>(`/stock-fundamentals?${params}`);
  },

  // 同花顺一致预期 EPS / PE（研报一致性预测）
  getStockConsensus: (code: string, price: number = 0) =>
    request<StockConsensusResponse>(`/stock-consensus?code=${encodeURIComponent(code)}&price=${price}`),

  // 近半年研报列表（东财 reportapi + 爱问财）
  getStockReports: (code: string, months: number = 6) =>
    request<StockReportsResponse>(`/stock-reports?code=${encodeURIComponent(code)}&months=${months}`),

  // AI 研报总结（聚合东财结构化 + 爱问财摘要，调 LLM 生成要点）
  getStockReportsSummary: (code: string, months: number = 6) =>
    request<StockReportsSummaryResponse>(`/stock-reports-summary?code=${encodeURIComponent(code)}&months=${months}`),

  // ── A股量化决策 API ───────────────────────────────────────────
  // 主线决策
  listSignalDates: () => request<string[]>("/aquant/signals/dates"),
  getLatestSignals: (limit = 10, viewMode = "score", date?: string) => {
    const params = new URLSearchParams({ limit: String(limit), view_mode: viewMode });
    if (date) params.set("date", date);
    return request<any>(`/aquant/signals/latest?${params}`);
  },
  generateSignals: (force = false) =>
    request<any>("/aquant/signals/generate", {
      method: "POST",
      body: JSON.stringify({ force }),
    }),
  // 交易计划
  listPlans: () => request<any>("/aquant/plans"),
  createPlan: (plan: any) =>
    request<any>("/aquant/plans", {
      method: "POST",
      body: JSON.stringify(plan),
    }),
  updatePlanStatus: (tradeId: string, status: string) =>
    request<any>(`/aquant/plans/${tradeId}?status=${encodeURIComponent(status)}`, {
      method: "PATCH",
    }),
  deletePlan: (tradeId: string) =>
    request<any>(`/aquant/plans/${tradeId}`, { method: "DELETE" }),
  // 复盘雷达
  getReviewDashboard: (threshold = 5, windowDays = 5) =>
    request<any>(`/aquant/review/dashboard?threshold=${threshold}&window_days=${windowDays}`),
  getHitRate: (threshold = 5, windowDays = 5) =>
    request<any>(`/aquant/review/hit-rate?threshold=${threshold}&window_days=${windowDays}`),
  // 交割单复盘
  importDeliveryCsv: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${BASE}/aquant/delivery/import`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
    }).then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });
  },
  getDeliveryStats: () => request<any>("/aquant/delivery/stats"),
};
