# Vibe-Trading 云端部署指南（不开电脑也能看）

目标：把整套看板（前端 UI + FastAPI 后端）搬到一个**常驻云服务器**上，
得到一个独立云链接，例如 `http://<云服务器公网IP>:8899/stock-board`，
不再依赖你本地 Mac 上的后端 / Cloudflare 快速隧道。

> 现有的 `https://vibe-trading-dashboard-awi.pages.dev`（Pages + 本地隧道）保持不变，
> 那是"本地模式"。本指南新增的是一条**纯云端**的链接。

---

## 一、选云（零成本方案：Oracle Cloud 永久免费）

后端依赖 mootdx（通达信 TCP）和同花顺/腾讯等国内行情源，因此云服务器**要能稳定连国内**。
最省钱的常驻方案是 **Oracle Cloud Always Free**：

- 白给 **Ampere A1：4 OCPU / 24GB 内存**，永久免费、常驻在线。
- 选 **东京 / 首尔 / 孟买** 等亚太节点，连国内行情相对稳。
- 注册需信用卡验证（**不扣费**，仅验证身份）；国区可能无法注册，可用港澳/海外卡。

> 如果你已有腾讯云/阿里云轻量、或任意 VPS，同样适用，跳过注册步骤即可。

### 1. 创建 Always Free 实例
1. 注册并登录 Oracle Cloud Console → **Create a VM instance**。
2. Image 选 **Ubuntu 22.04/24.04 LTS**。
3. Shape 选 **Ampere A1 (Always Free)**，调成 **4 OCPU / 24GB**（免费额度内）。
4. 网络：用默认 VCN；**勾选"Assign a public IPv4 address"**（拿到公网 IP）。
5. 添加 SSH 密钥（用自己的公钥，或用 Oracle 生成的密钥对下载私钥）。
6. 记下分配到的 **Public IP**。

### 2. 开放 8899 端口（重要，否则外网访问不了）
1. 实例页 → **Virtual cloud network** → 对应的 **Security List**。
2. 添加 **Ingress Rule**：
   - Source CIDR：`0.0.0.0/0`
   - Destination port：`8899` (TCP)
3. 保存。

### 3. 在实例上装 Docker
```bash
ssh ubuntu@<Public IP>
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
# 可选：让当前用户免 sudo 跑 docker
sudo usermod -aG docker $USER   # 然后重开终端
```

---

## 二、拉代码 → 构建 → 运行

```bash
# 在云实例上
git clone https://github.com/wong66/vibe-trading-dashboard.git
cd vibe-trading-dashboard/Vibe-Trading

# 构建云端自包含镜像（前端+后端一体，约几分钟~十几分钟）
docker build -f Dockerfile.cloud -t vibe-trading-cloud .

# 运行（开机自启、崩溃自动重启）
docker run -d --restart unless-stopped -p 8899:8899 --name vibe vibe-trading-cloud
```

验证：
```bash
curl http://localhost:8899/health      # 应返回 healthy / 200
curl http://localhost:8899/stock-board  # 应返回 HTML
```

浏览器打开：**`http://<Public IP>:8899/stock-board`** —— 这就是新的"云端链接"。

> 嫌命令多可用 compose：`docker compose -f docker-compose.cloud.yml up -d --build`

---

## 三、可选增强

### 1. 智能分析等需要 LLM 的功能
`/stock-board` 的核心行情/复盘不需要密钥；但若用智能分析，给容器加环境变量：
```bash
docker run -d --restart unless-stopped -p 8899:8899 \
  -e OPENAI_API_KEY=sk-xxxx \
  --name vibe vibe-trading-cloud
```

### 2. 稳定的 https 域名（可选，非必须）
Oracle 公网 IP 在实例不终止时稳定，但 `http://IP:8899` 不够优雅。
若你**自有域名**且已接入 Cloudflare，可在云实例上跑 `cloudflared` 建一条
**命名隧道**指向 `localhost:8899`，绑定自定义主机名（如 `a.w你的域名.com`），
得到稳定 https 链接。裸 `*.trycloudflare.com` 快速隧道 URL 每次重启会变，不推荐用于此。

### 3. mootdx / 行情连不上的兜底
若云端区域连不上通达信 TCP（K线/信号空白），后端会自动降级到其他 HTTP 源
（腾讯/同花顺/东财）。如仍异常，优先确认云实例出网未被限制，或换更靠近国内的节点。

---

## 四、重要约束 / 风险
- **云实例要一直开着**（关机/释放后链接失效）。Always Free 实例只要不主动终止就常驻。
- **镜像在云上原生构建**（ARM），无需担心架构；若用 x86 云需相应调整。
- 这是"看板"用途；交易相关接口（如有）请自行评估安全，公网暴露建议加鉴权/隧道。
- `Vibe-Trading/Dockerfile`（原）用的是上游 `vibe-trading serve` CLI，在定制代码上
  可能起不来；本指南统一用 `Dockerfile.cloud`（命令 `uvicorn agent.api_server:app`）。
