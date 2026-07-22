# 板块资金流 · 动态折线视频管线

把「抖音财经号那种收盘板块资金流向动态折线」做成可定时自动产出的管线。
数据源：**同花顺 THS**（`data.10jqka.com.cn/funds/hyzjl` 行业 + `/funds/gnzjl` 概念）。

> ⚠️ 为何不用东财：用户公司网络下东财 push2 被代理/防火墙全断（Connection aborted），拿不到数据。
> 同花顺在用户网络可达（health()=ths ok），且把完整板块资金流表格（含净额/流入/流出/涨跌幅）服务端直出在 HTML 里，
> 解析 `<tbody>` 即可，零鉴权零 cookie，简单可靠。板块「净额(亿)」= 主力净流入，与东财 f62 同义。

## 原理
- **折线要"动"，必须有全天轨迹** → 不能只收盘拉一次。需盘中周期性抓快照。
- `f62` 是**当日累计净流入(元)**，每隔 15 分钟存一帧，连起来就是每个板块的全天资金流折线。
- 渲染时沿时间轴把线条从左到右描出，即得视频里那种"实时生长"的动态折线。
- Y 轴 = 主力净流入(亿元)；红=净流入(涨) / 绿=净流出(跌)，遵循 A股习惯。

## 文件
- `collector.py` —— 盘中快照采集器（仅依赖 urllib，零第三方包）。每次调用拉 THS 行业+概念两页、解析 tbody 得各板块净额(亿)，存一帧到 `data/<date>.jsonl`。
- `render.py`    —— 动态折线渲染器（matplotlib + ffmpeg）。读 jsonl → 输出 `output/<date>_sectorflow.mp4` + `.png`。
- `render_daily.sh` —— 收盘自动渲染包装脚本（算当天日期 + 无数据/周末守卫 → 调 render.py）。
- `com.wangzhiping.sectorflow.plist`        —— launchd：每 15 分钟跑 collector（交易时段守卫）。
- `com.wangzhiping.sectorflow-render.plist` —— launchd：交易日 15:05 自动跑 render_daily.sh。
- `data/`       —— 每日快照（jsonl，一行一帧）
- `output/`     —— 渲染产物（MP4 + PNG）

## 全自动闭环（推荐）
在真实 Mac 终端各执行一次 `launchctl load`，之后每个交易日自动「盘中采集 → 收盘出片」：
```bash
launchctl load ~/Claude/大A投研看板/sector_flow_pipeline/com.wangzhiping.sectorflow.plist        # 采集(每15min)
launchctl load ~/Claude/大A投研看板/sector_flow_pipeline/com.wangzhiping.sectorflow-render.plist  # 渲染(15:05)
```
- 采集任务 9:30–15:00 每 15 分钟抓一帧（约 18 帧/日），非交易时段自动跳过。
- 渲染任务 15:05 自动读当天 jsonl 出 MP4/PNG；无数据（如东财全断/未采到）自动跳过，不产生空视频。
- 日志：`logs/collector.*.log`、`logs/render*.log`。
- 卸载：把 `load` 换成 `unload`（同路径）。

## 一键使用
```bash
# 1) 盘中: 启动定时采集(每15分钟一帧, 交易时段才抓)
#    在真实 Mac 终端执行一次(加载后每次登录自动跑):
launchctl load ~/Claude/大A投研看板/sector_flow_pipeline/com.wangzhiping.sectorflow.plist
#    卸载: launchctl unload <同上路径>

# 2) 收盘后(15:00 之后)渲染当日视频:
python3 render.py 2026-07-16
#   只看某些板块(如视频里的半导体/存储芯片):
python3 render.py 2026-07-16 --names 半导体,存储芯片
#   取终值前 N 个板块:
python3 render.py 2026-07-16 --top 12
```

## 演示(无真实数据时)
```bash
python3 render.py 2026-07-16 --demo
```
会用合成数据跑通整条渲染链路，产出 `output/2026-07-16_sectorflow.mp4` 预览效果。

## 环境要求
- Python 3 + `requests`（collector）/ `matplotlib` + `numpy`（render）。Anaconda 自带。
- `ffmpeg` 用于导出 MP4（缺失时自动回退 GIF）。Mac 上 `brew install ffmpeg`。
- 东财接口在用户公司网络被防火墙全断，**故本管线改用同花顺 THS** 作为数据源（同花顺在用户网络可达）。
- collector 拉空/失败会自动跳过当帧并打 warn 日志，不影响其余帧。
- 若 Anaconda 路径不同，改 plist 里 `/opt/anaconda3/bin/python3` 为你的 python3 绝对路径。

## 接成片
MP4 已是 720×1280 (9:16) 竖屏，可直接进剪映加配音/标题/背景乐，或 ffmpeg 直接发。
