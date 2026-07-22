#!/usr/bin/env python3
"""选股页面生成器 - 用法: python3 gen_stockpick.py 锂电"""
import sys, os, json, urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
MAP = {"锂电":"BK0574","锂电池":"BK0574","电池":"BK0574","光伏":"BK0478","储能":"BK1035","半导体":"BK1036","芯片":"BK1036","AI":"BK1131","人工智能":"BK1131","机器人":"BK1028","人形机器人":"BK1028","军工":"BK0481","医药":"BK0465","创新药":"BK0465","白酒":"BK0477","消费电子":"BK1040","低空":"BK1188","固态电池":"BK1166","CPO":"BK1154","光模块":"BK1154","算力":"BK1131","风电":"BK0812","新能源车":"BK0900","油气":"BK0438","银行":"BK0475","券商":"BK0476","游戏":"BK0908","电力":"BK0428","卫星":"BK1196","减肥药":"BK1195","CXO":"BK0465","医疗":"BK0465","鸿蒙":"BK1098","华为":"BK1098","量子":"BK1175","脑机":"BK1183","稀土":"BK0437","有色":"BK0437","煤炭":"BK0439","钢铁":"BK0450","农业":"BK0420","种业":"BK0420","房地产":"BK0451","保险":"BK0474","食品":"BK0433","旅游":"BK0434","传媒":"BK0908","数据中心":"BK1038","水电":"BK0428","核电":"BK0428"}

def F(u):
    r = urllib.request.Request(u, headers={"User-Agent": UA})
    return json.loads(urllib.request.urlopen(r, timeout=15).read().decode("utf-8"))

def fm(v):
    a = abs(v)
    if a >= 1e8: return f"{v/1e8:.2f}亿"
    if a >= 1e4: return f"{v/1e4:.1f}万"
    return f"{v:.0f}"

sector = sys.argv[1] if len(sys.argv) > 1 else "半导体"
code = MAP.get(sector, "")
if not code:
    for kw, cd in MAP.items():
        if sector in kw or kw in sector:
            code = cd; break
if not code:
    print(f"❌ 未找到: {sector}，支持: {'、'.join(list(MAP.keys())[:20])}..."); sys.exit(1)

print(f"🔍 {sector} -> {code}")
stocks = F(f"https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=200&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=b:{code}+f:!50&fields=f2,f3,f6,f8,f9,f12,f14,f23,f62")
items = stocks.get("data", {}).get("diff", [])
print(f"📊 {len(items)} 只成分股")

S = []
for it in items:
    c, n = it.get("f12",""), it.get("f14","")
    if not c or not n: continue
    S.append({"code":c,"name":n,"price":it.get("f2",0) or 0,"change_pct":it.get("f3",0) or 0,"amount":it.get("f6",0) or 0,"turnover":it.get("f8",0) or 0,"pe_ttm":it.get("f9",0) or 0,"pb":it.get("f23",0) or 0,"main_flow":it.get("f62",0) or 0})

pe = sorted([s["pe_ttm"] for s in S if 0 < s["pe_ttm"] < 1000])
pb = sorted([s["pb"] for s in S if 0 < s["pb"] < 100])
pe_m, pb_m = (pe[len(pe)//2] if pe else 0), (pb[len(pb)//2] if pb else 0)
sm = "low" if pe_m < 25 or pb_m < 2.5 else "high" if pe_m > 60 or pb_m > 6 else "mid"
vl = {"low":"低估","mid":"合理","high":"高估"}
vc = {"low":"#22c55e","mid":"#f59e0b","high":"#ef4444"}

kl = F(f"https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=90.{code}&ut=fa5fd1943c7b386f172d6893dbfba10b&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=90")
KL = [{"date":l.split(",")[0],"open":float(l.split(",")[1]),"close":float(l.split(",")[2]),"high":float(l.split(",")[3]),"low":float(l.split(",")[4]),"volume":int(float(l.split(",")[5]))} for l in kl.get("data",{}).get("klines",[])]
print(f"📈 {len(KL)} 根K线")

up = len([s for s in S if s["change_pct"]>0])
dn = len([s for s in S if s["change_pct"]<0])
mf = sum(s["main_flow"] for s in S)
ta = sum(s["amount"] for s in S)

rows = ""
for s in sorted(S, key=lambda x: x["change_pct"], reverse=True):
    pc = "text-red-500" if s["change_pct"]>0 else "text-green-500"
    mf2 = "text-red-500" if s["main_flow"]>0 else "text-green-500"
    pe_s = f'{s["pe_ttm"]:.1f}' if s["pe_ttm"]>0 else "-"
    pb_s = f'{s["pb"]:.2f}' if s["pb"]>0 else "-"
    rows += f'<tr class="border-b hover:bg-gray-50"><td class="px-2 py-2"><a href="https://stockpage.10jqka.com.cn/{s["code"]}/" target="_blank" class="text-xs font-semibold hover:text-blue-600">{s["name"]}</a> <span class="text-[10px] text-gray-400">{s["code"]}</span></td><td class="px-2 py-2 font-mono text-[11px] font-medium {pc}">{s["change_pct"]:+.2f}%</td><td class="px-2 py-2 font-mono text-[11px]">{s["price"]:.2f}</td><td class="px-2 py-2 font-mono text-[11px]">{pe_s}</td><td class="px-2 py-2 font-mono text-[11px]">{pb_s}</td><td class="px-2 py-2 font-mono text-[11px]">{s["turnover"]:.2f}%</td><td class="px-2 py-2 font-mono text-[11px]">{fm(s["amount"])}</td><td class="px-2 py-2 font-mono text-[11px] {mf2}">{"+"if s["main_flow"]>0 else ""}{fm(s["main_flow"])}</td></tr>'

html = f'''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>{sector} 选股</title>
<script src="https://cdn.tailwindcss.com"></script><script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>*{{margin:0;padding:0;box-sizing:border-box}}body{{font-family:-apple-system,sans-serif;background:#f5f6fa;font-size:13px}}</style></head><body>
<div class="max-w-7xl mx-auto p-3 md:p-4 space-y-3">
<div class="flex items-center gap-2"><h1 class="text-lg font-bold">📊 {sector}</h1><span class="text-xs text-gray-400">{len(S)}只 · 东方财富实时数据</span></div>
<div class="grid grid-cols-2 md:grid-cols-4 gap-2">
<div class="rounded-lg border bg-white p-3"><p class="text-[11px] text-gray-400">涨跌家数</p><div class="text-sm font-bold"><span class="text-red-500">{up}↑</span> <span class="text-green-500">{dn}↓</span></div></div>
<div class="rounded-lg border bg-white p-3"><p class="text-[11px] text-gray-400">PE中位数</p><div class="text-xl font-bold" style="color:{vc[sm]}">{pe_m:.1f} <span class="text-xs">{vl[sm]}</span></div></div>
<div class="rounded-lg border bg-white p-3"><p class="text-[11px] text-gray-400">PB中位数</p><div class="text-xl font-bold" style="color:{vc[sm]}">{pb_m:.1f}</div></div>
<div class="rounded-lg border bg-white p-3"><p class="text-[11px] text-gray-400">主力净流入</p><div class="text-xl font-bold {"text-red-500" if mf>0 else "text-green-500"}">{"+"if mf>0 else ""}{fm(mf)}</div></div>
</div>
<div class="rounded-lg border bg-white p-3"><div id="kc" style="height:300px"></div></div>
<div class="rounded-lg border bg-white overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b bg-gray-50">
<th class="px-2 py-2 text-left text-[11px] font-medium text-gray-400">股票</th><th class="px-2 py-2 text-left text-[11px] font-medium text-gray-400">涨幅</th><th class="px-2 py-2 text-left text-[11px] font-medium text-gray-400">最新价</th><th class="px-2 py-2 text-left text-[11px] font-medium text-gray-400">PE</th><th class="px-2 py-2 text-left text-[11px] font-medium text-gray-400">PB</th><th class="px-2 py-2 text-left text-[11px] font-medium text-gray-400">换手率</th><th class="px-2 py-2 text-left text-[11px] font-medium text-gray-400">成交额</th><th class="px-2 py-2 text-left text-[11px] font-medium text-gray-400">主力净流入</th></tr></thead><tbody>{rows}</tbody></table></div></div>
<script>
const KL={json.dumps(KL)};
const ch=echarts.init(document.getElementById("kc"));
const d=KL.map(k=>k.date),o=KL.map(k=>[k.open,k.close,k.low,k.high]),v=KL.map(k=>k.volume);
const ma=n=>{{const r=[];for(let i=0;i<KL.length;i++){{if(i<n-1){{r.push(null);continue}}let s=0;for(let j=0;j<n;j++)s+=KL[i-j].close;r.push(+(s/n).toFixed(2))}}return r}};
ch.setOption({{tooltip:{{trigger:"axis"}},grid:[{{left:"8%",right:"8%",top:"6%",height:"48%"}},{{left:"8%",right:"8%",top:"60%",height:"16%"}}],xAxis:[{{type:"category",data:d,gridIndex:0,axisLabel:{{show:false}}}},{{type:"category",data:d,gridIndex:1,axisLabel:{{fontSize:10,rotate:30}}}}],yAxis:[{{type:"value",gridIndex:0,scale:true}},{{type:"value",gridIndex:1,splitLine:{{show:false}},axisLabel:{{show:false}}}}],series:[{{type:"candlestick",data:o,itemStyle:{{color:"#ef4444",color0:"#22c55e",borderColor:"#ef4444",borderColor0:"#22c55e"}}}},{{type:"line",data:ma(5),smooth:true,lineStyle:{{color:"#f59e0b",width:1}},symbol:"none"}},{{type:"line",data:ma(10),smooth:true,lineStyle:{{color:"#3b82f6",width:1}},symbol:"none"}},{{type:"line",data:ma(20),smooth:true,lineStyle:{{color:"#8b5cf6",width:1}},symbol:"none"}},{{type:"bar",data:v,xAxisIndex:1,yAxisIndex:1,itemStyle:{{color:p=>o[p.dataIndex]?.[1]>=o[p.dataIndex]?.[0]?"#ef4444":"#22c55e"}}}}]}});
window.addEventListener("resize",()=>ch.resize());
</script></body></html>'''

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist", "index.html")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w", encoding="utf-8") as f:
    f.write(html)
print(f"✅ 已生成: {out}")
os.system(f"open '{out}'")
