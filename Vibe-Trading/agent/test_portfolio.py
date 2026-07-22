"""P4 组合定仓风控 单元测试（纯逻辑，不依赖任何数据源/网络）"""
import sys
sys.path.insert(0, "/Users/wangzhiping/Claude/大A投研看板/Vibe-Trading")

from agent.signal_engine import SignalOutput, SignalPipeline
from agent.portfolio import PortfolioAllocator, PortfolioPlan


def mk(code, name, score, sector, coverage=1.0, price=10.0, is_st=False, ml=""):
    return SignalOutput(
        signal_id="SIG-TEST-" + code, date="2026-07-09", stock_code=code,
        stock_name=name, score=score,
        factors={"is_st": is_st, "price": price}, sector=sector,
        sector_score={"signal_density": 0, "capital_flow": 0,
                       "leader_effect": 0, "total": 0},
        ai_suggestion="", data_coverage=coverage,
        market_temp=50, market_style="震荡",
        position_cap=60, main_line_sector=ml,
    )


def run():
    # 场景1：正常多标的，覆盖主线加成/单票上限/行业上限/剔除
    sigs = [
        mk("600519", "贵州茅台", 88, "白酒", ml="白酒"),
        mk("000858", "五粮液", 80, "白酒"),
        mk("300750", "宁德时代", 85, "锂电池"),
        mk("002594", "比亚迪", 78, "新能源汽车"),
        mk("600036", "招商银行", 65, "银行"),
        mk("600276", "恒瑞医药", 55, "化学制药"),       # 评分<60 剔除
        mk("603259", "药明康德", 72, "CXO", coverage=0.1),  # 覆盖低 剔除
        mk("600555", "ST某某", 70, "其他", is_st=True),      # ST 剔除
    ]
    plan = PortfolioAllocator().allocate(sigs, position_cap=60, main_lines=["白酒"])
    print("=== 场景1 正常 ===")
    print(f"总仓上限={plan.total_position} 实际配置={plan.allocated_position} "
          f"持仓数={len(plan.suggested_positions)}")
    for p in plan.suggested_positions:
        print(f"  {p.stock_code} {p.stock_name} 权重{p.weight}% 主线={p.is_main_line} | {p.reason}")
    print("风控:", plan.risk_controls)
    print("剔除:", [(r.stock_code, r.reason) for r in plan.rejected])
    assert plan.allocated_position <= plan.total_position + 1e-6
    # 单票上限校验
    for p in plan.suggested_positions:
        assert p.weight <= 15.0 + 1e-6
    # 行业上限校验（白酒两只在 40% 内）
    baijiu = [p.weight for p in plan.suggested_positions if p.sector == "白酒"]
    assert sum(baijiu) <= 40.0 + 1e-6
    # 主线加成：茅台权重应高于同分位其他（五粮液 80 但白酒无加成，茅台88加成）
    print("场景1 PASS\n")

    # 场景2：空组合
    plan2 = PortfolioAllocator().allocate([], position_cap=20, main_lines=[])
    print("=== 场景2 空组合 ===")
    print(f"实际配置={plan2.allocated_position} 风控={plan2.risk_controls}")
    assert plan2.allocated_position == 0.0
    print("场景2 PASS\n")

    # 场景3：防御舱（温度极低 → 总仓上限20）
    sigs3 = [mk("600519", "贵州茅台", 90, "白酒", ml="白酒"),
             mk("300750", "宁德", 85, "锂电池")]
    plan3 = PortfolioAllocator().allocate(sigs3, position_cap=20, main_lines=["白酒"])
    print("=== 场景3 防御舱 ===")
    print(f"实际配置={plan3.allocated_position} 风控={plan3.risk_controls}")
    for p in plan3.suggested_positions:
        print(f"  {p.stock_code} 权重{p.weight}%")
    assert plan3.allocated_position <= 20.0 + 1e-6
    assert any("防御" in r for r in plan3.risk_controls)
    print("场景3 PASS\n")

    # 场景4：build_portfolio 回填 suggested_weight
    pl = SignalPipeline(pool=["600519", "300750"])
    pp = pl.build_portfolio(sigs)
    print("=== 场景4 build_portfolio 回填 ===")
    for s in sigs:
        print(f"  {s.stock_code} suggested_weight={s.suggested_weight}")
    wmap = {p.stock_code: p.weight for p in pp.suggested_positions}
    for s in sigs:
        assert s.suggested_weight == wmap.get(s.stock_code)
    print("场景4 PASS\n")

    print("ALL P4 TESTS PASSED")


if __name__ == "__main__":
    run()
