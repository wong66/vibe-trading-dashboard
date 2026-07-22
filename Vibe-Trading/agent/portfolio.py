"""A股量化决策 — 组合定仓与风控 (P4)

在单票多因子评分信号之上，做组合层面的仓位分配与风险控制：
  - 入选门槛：评分 + 数据诚实度(覆盖率) + 非ST + 有有效行情
  - 单票上限：防止过度集中
  - 行业分散：单一行业仓位上限，强制分散
  - 总仓纪律：受市场温度(仓位上限)约束，温度低则整体降仓，不强行凑仓
  - 主线加成：命中主线板块的标的获得权重加成

纯逻辑模块，不依赖任何数据源，可在无网络环境独立测试。
"""
from __future__ import annotations
from collections import defaultdict
from datetime import datetime
from typing import Any, List, Optional
from pydantic import BaseModel, Field


class PositionSuggestion(BaseModel):
    stock_code: str
    stock_name: str
    score: float
    sector: str
    weight: float                  # 建议仓位 (%)
    is_main_line: bool = False
    reason: str = ""


class RejectedHolding(BaseModel):
    stock_code: str
    stock_name: str
    score: float
    reason: str


class PortfolioPlan(BaseModel):
    total_position: int                          # 总仓位上限 (%) = 温度仓位上限
    allocated_position: float                    # 实际配置总仓位 (%)
    max_holdings: int
    suggested_positions: List[PositionSuggestion] = Field(default_factory=list)
    rejected: List[RejectedHolding] = Field(default_factory=list)
    risk_controls: List[str] = Field(default_factory=list)
    generated_at: str = ""


class PortfolioAllocator:
    """组合定仓与风控器（纯逻辑，不依赖数据源）"""

    def __init__(self, min_score: float = 60.0, min_coverage: float = 0.3,
                 single_cap_pct: float = 15.0, sector_cap_pct: float = 40.0,
                 max_holdings: int = 10, main_line_boost: float = 1.3):
        self.min_score = min_score
        self.min_coverage = min_coverage
        self.single_cap_pct = single_cap_pct
        self.sector_cap_pct = sector_cap_pct
        self.max_holdings = max_holdings
        self.main_line_boost = main_line_boost

    def allocate(self, signals: List[Any], position_cap: int,
                 main_lines: Optional[List[str]] = None) -> PortfolioPlan:
        main_lines = set(main_lines or [])
        now = datetime.now().isoformat(timespec="seconds")

        # ── 1. 候选筛选（诚实度 + 门槛） ──
        candidates = []
        rejected = []
        for sig in signals:
            factors = sig.factors or {}
            is_st = bool(factors.get("is_st", False))
            price = factors.get("price", 0) or 0
            score = float(sig.score or 0.0)
            coverage = float(sig.data_coverage or 0.0)
            if is_st:
                rejected.append(RejectedHolding(stock_code=sig.stock_code,
                    stock_name=sig.stock_name, score=score, reason="ST股，禁止配置"))
                continue
            if score < self.min_score:
                rejected.append(RejectedHolding(stock_code=sig.stock_code,
                    stock_name=sig.stock_name, score=score,
                    reason=f"评分 {score:.1f} < 入选门槛 {self.min_score:.0f}"))
                continue
            if coverage < self.min_coverage:
                rejected.append(RejectedHolding(stock_code=sig.stock_code,
                    stock_name=sig.stock_name, score=score,
                    reason=f"数据覆盖率 {coverage:.0%} < {self.min_coverage:.0%}，信号不可信"))
                continue
            if price <= 0:
                rejected.append(RejectedHolding(stock_code=sig.stock_code,
                    stock_name=sig.stock_name, score=score, reason="无有效行情价"))
                continue
            candidates.append(sig)

        # ── 空组合：诚实空仓 ──
        if not candidates:
            return PortfolioPlan(
                total_position=int(position_cap),
                allocated_position=0.0,
                max_holdings=self.max_holdings,
                rejected=rejected,
                risk_controls=[
                    f"市场温度对应总仓位上限 {int(position_cap)}%，但当前无达标标的",
                    "建议空仓观望，等待评分/数据质量达标的标的出现",
                ],
                generated_at=now,
            )

        # ── 2. 权重：评分归一化 × 主线加成 × 仓位纪律 ──
        boosted = {}
        for sig in candidates:
            s = max(float(sig.score or 0), 0)
            if sig.sector in main_lines:
                s *= self.main_line_boost
            boosted[sig.stock_code] = s
        total_boost = sum(boosted.values()) or 1.0
        # 自然总仓 = position_cap（纪律上限）
        desired = {sig.stock_code: boosted[sig.stock_code] / total_boost * position_cap
                   for sig in candidates}

        # ── 3. 单票上限截断 ──
        weights = {sig.stock_code: min(desired[sig.stock_code], self.single_cap_pct)
                   for sig in candidates}

        # ── 4. 行业上限压缩（强制分散） ──
        sector_sums = defaultdict(float)
        for sig in candidates:
            sector_sums[sig.sector] += weights[sig.stock_code]
        for sig in candidates:
            sec = sig.sector
            if sector_sums[sec] > self.sector_cap_pct:
                ratio = self.sector_cap_pct / sector_sums[sec]
                weights[sig.stock_code] *= ratio
                sector_sums[sec] = self.sector_cap_pct

        # ── 5. 最大持仓数（按权重降序留前 N） ──
        ranked = sorted(candidates, key=lambda s: -weights[s.stock_code])
        if len(ranked) > self.max_holdings:
            keep = {s.stock_code for s in ranked[:self.max_holdings]}
            for sig in candidates:
                if sig.stock_code not in keep:
                    weights[sig.stock_code] = 0.0

        # ── 6. 组装输出 ──
        allocated = sum(weights.values())
        final_sector = defaultdict(float)
        suggestions = []
        for sig in candidates:
            w = round(weights[sig.stock_code], 2)
            final_sector[sig.sector] += w
            if w <= 0:
                continue
            is_ml = sig.sector in main_lines
            reasons = [f"评分 {sig.score:.1f}"]
            if is_ml:
                reasons.append(f"主线板块加成×{self.main_line_boost:.1f}")
            if desired[sig.stock_code] > self.single_cap_pct + 1e-6:
                reasons.append(f"触达单票上限{self.single_cap_pct:.0f}%")
            elif abs(weights[sig.stock_code] - desired[sig.stock_code]) > 1e-6:
                reasons.append(f"行业{sig.sector}超配压缩至{self.sector_cap_pct:.0f}%上限")
            suggestions.append(PositionSuggestion(
                stock_code=sig.stock_code, stock_name=sig.stock_name,
                score=sig.score, sector=sig.sector, weight=w,
                is_main_line=is_ml, reason="；".join(reasons)))
        suggestions.sort(key=lambda x: -x.weight)

        # ── 7. 风控提示 ──
        risk = [f"市场温度对应总仓位上限 {int(position_cap)}%，本组合以该纪律仓位为准"]
        if allocated < position_cap - 1:
            risk.append(f"实际配置 {allocated:.1f}% 低于上限 {int(position_cap)}%，未强行凑仓")
        if position_cap <= 40:
            risk.append("市场温度偏低，已自动降仓至防御区间，严控回撤")
        over_sectors = [sec for sec, v in final_sector.items() if v >= self.sector_cap_pct - 1e-6]
        if over_sectors:
            risk.append(f"行业分散约束触发：{'、'.join(over_sectors)} 触及单行业上限{self.sector_cap_pct:.0f}%")
        if rejected:
            risk.append(f"已剔除 {len(rejected)} 只未达标标的（评分不足/数据覆盖低/ST），详见 rejected")

        return PortfolioPlan(
            total_position=int(position_cap),
            allocated_position=round(allocated, 2),
            max_holdings=self.max_holdings,
            suggested_positions=suggestions,
            rejected=rejected,
            risk_controls=risk,
            generated_at=now,
        )
