"""P5 回测验证闭环 — 离线单测（不依赖网络）

通过 mock build_sample 返回构造面板，验证：
1. 因子 IC 计算正确（Spearman）
2. 权重反哺：方向一致升权、方向反压地板、无证据减半、归一化=100
3. 诚实降级：无有效样本时 ok=False
4. 持久化往返：save → load 一致，SignalPipeline 自动加载
"""
from __future__ import annotations

from unittest.mock import patch

import pandas as pd

from agent.backtest.factor_backtest import (
    FACTOR_NAMES, compute_ic, optimize_weights, run_backtest,
    save_weights, load_weights, WEIGHTS_CACHE, DEFAULT_WEIGHTS,
)
from agent.signal_engine import SignalPipeline


def _make_panel(n=10):
    """构造回测面板：roe/price_position 与未来收益正相关设计，pe_percentile 负相关。

    - roe: 1..n            ↑ 与 fwd_ret_20d 正相关 → 方向一致(roe dir=+1) → 升权
    - price_position: n..1 ↓ 与 fwd_ret_20d 正相关（低位置高收益）→ dir=-1 → 升权
    - pe_percentile: n..1  ↓ 与 fwd_ret_20d 负相关 → dir=+1 → 方向反 → 压地板
    - 其余因子 None → IC 缺失 → 减半
    """
    fwd = list(range(1, n + 1))
    rows = []
    for i in range(n):
        row = {f: None for f in FACTOR_NAMES}
        row["code"] = f"{600000 + i:06d}"
        row["name"] = f"测试{i}"
        row["roe"] = float(i + 1)
        row["price_position"] = float(n - i)
        row["pe_percentile"] = float(n - i)
        row["fwd_ret_5d"] = float(fwd[i] * 0.5)
        row["fwd_ret_10d"] = float(fwd[i] * 0.8)
        row["fwd_ret_20d"] = float(fwd[i])
        rows.append(row)
    return pd.DataFrame(rows)


def test_compute_ic_and_optimize():
    panel = _make_panel(10)
    ic = compute_ic(panel, (5, 10, 20))
    # roe 应强正相关
    assert ic["roe"]["ic_mean"] > 0.9, ic["roe"]
    # pe_percentile 应强负相关
    assert ic["pe_percentile"]["ic_mean"] < -0.9, ic["pe_percentile"]
    # price_position 应强正相关(因 dir=-1，IC 本身为负但 aligned)
    assert ic["price_position"]["ic_mean"] < -0.9, ic["price_position"]

    new_w, notes = optimize_weights(ic, DEFAULT_WEIGHTS)
    # 归一化到 100
    assert abs(sum(new_w.values()) - 100) < 0.5, sum(new_w.values())
    # roe 升权（默认15）
    assert new_w["roe"] > DEFAULT_WEIGHTS["roe"], new_w["roe"]
    # price_position 升权（默认5）
    assert new_w["price_position"] > DEFAULT_WEIGHTS["price_position"], new_w["price_position"]
    # pe_percentile 压地板（默认12.5 → ~2.5）
    assert new_w["pe_percentile"] < DEFAULT_WEIGHTS["pe_percentile"], new_w["pe_percentile"]
    assert "相反" in notes["pe_percentile"], notes["pe_percentile"]
    print("[test] compute_ic + optimize 通过:", {k: new_w[k] for k in ("roe", "pe_percentile", "price_position")})


def test_run_backtest_end_to_end(tmp_path=None):
    # 用 mock 替换 build_sample，完全离线
    with patch("agent.backtest.factor_backtest.build_sample", side_effect=lambda pool, d: _make_panel(10)):
        result = run_backtest(["600000"], ["20260701"], (5, 10, 20), base=None, save=True)
    assert result["ok"] is True, result
    assert result["samples"] == 10, result["samples"]
    assert abs(sum(result["weights"].values()) - 100) < 0.5
    assert result["weights"]["roe"] > DEFAULT_WEIGHTS["roe"]
    assert result["weights"]["pe_percentile"] < DEFAULT_WEIGHTS["pe_percentile"]
    # 持久化往返
    loaded = load_weights()
    assert loaded is not None
    assert abs(loaded["roe"] - result["weights"]["roe"]) < 0.01
    print("[test] run_backtest 端到端通过, samples=10, IC(roe)=%.2f" % result["ic"]["roe"]["ic_mean"])


def test_honest_degradation():
    empty = pd.DataFrame()
    with patch("agent.backtest.factor_backtest.build_sample", return_value=empty):
        result = run_backtest(["600000"], ["20260701"], (5, 10, 20))
    assert result["ok"] is False
    assert "无有效回测样本" in result["error"], result
    print("[test] 诚实降级通过:", result["error"])


def test_pipeline_loads_feedback():
    # 先跑一次生成反哺权重（mock）
    with patch("agent.backtest.factor_backtest.build_sample", side_effect=lambda pool, d: _make_panel(10)):
        run_backtest(["600000"], ["20260701"], (5, 10, 20), base=None, save=True)
    # SignalPipeline 构造时应自动加载反哺权重（非 None 且 roe 已变）
    pipe = SignalPipeline(pool=["600000"])
    assert pipe.base_weights is not None, "应加载反哺权重"
    assert pipe.base_weights["roe"] > DEFAULT_WEIGHTS["roe"], pipe.base_weights["roe"]
    print("[test] SignalPipeline 自动加载反哺权重通过, roe=%.2f" % pipe.base_weights["roe"])


if __name__ == "__main__":
    # 清理可能残留的旧权重文件，保证测试确定性
    if WEIGHTS_CACHE.exists():
        WEIGHTS_CACHE.unlink()
    test_compute_ic_and_optimize()
    test_run_backtest_end_to_end()
    test_honest_degradation()
    test_pipeline_loads_feedback()
    print("\n✅ P5 回测验证闭环全部单测通过")
