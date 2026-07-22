# Vibe-Trading 部署到 Cloudflare（Mac 隧道模式）

> 你只要做一件事：**在「终端」里粘贴一条命令，遇到浏览器弹窗就登录**。
> 其余安装、构建、配置、开机自启，脚本全自动。

---

## 一、这是什么（大白话）

- **前端**（你看到的网页）放到 Cloudflare 全球服务器 → 任何地方打开 `https://vibe-trading.pages.dev` 都能看界面。
- **后端**（算数据、拉行情的程序）继续跑在你的 **Mac** 上，通过一条加密隧道（Cloudflare Tunnel）暴露成公网网址，网页要数据时从隧道送回 Mac 算。
- 所以：**Mac 必须开机 + 联网 + 后端在跑**，数据才是活的。Mac 关机 → 网页能开但数据是空的。

为什么不全上云：Cloudflare 跑不了 Python + 直连行情端口（TCP 7709），所以后端留在 Mac 最稳、免费、零改代码。

---

## 二、开始前准备（一次性）

1. 有一个 **Cloudflare 账号**（免费注册：https://dash.cloudflare.com/sign-up ）。
2. 本机装了 **Homebrew**（终端里跑 `brew --version`，没有就去 https://brew.sh 按一行命令装）。
3. 你的 Vibe-Trading 后端能正常在 Mac 上跑（即平时 `bash ~/Claude/start-vibes.sh` 能起来）。

---

## 三、部署（就这一步）

打开「终端」(Terminal)，粘贴回车：

```bash
bash /Users/wangzhiping/Claude/大A投研看板/Vibe-Trading/deploy-vt-cf.sh
```

脚本会依次做 7 步，**其中有 2 次会弹出浏览器**，请在浏览器里登录同一个 Cloudflare 账号并授权：
- `wrangler login`（部署前端）
- `cloudflared tunnel login`（开隧道）

授权完回到终端，它会自动继续：建隧道 → 拿公网网址 → 填配置 → 构建前端 → 部署到 Pages → 设开机自启。

全部跑完，终端会打印两个网址：
- 前端：`https://vibe-trading.pages.dev`
- 后端隧道：`https://<一串字符>.cfargotunnel.com`

**用手机流量或别的电脑打开 `https://vibe-trading.pages.dev` 试试，能看界面、能刷出数据就成功了。**

---

## 四、日常使用

- **开机后自动**起后端 + 隧道（已设开机自启），不用手动点。
- 手动重启 / 排错：
  ```bash
  bash /Users/wangzhiping/Claude/大A投研看板/Vibe-Trading/start-vt-cf.sh
  ```
- 看日志：
  ```bash
  cat ~/.vt-cf-logs/backend.log    # 后端
  cat ~/.vt-cf-logs/tunnel.log     # 隧道
  ```

---

## 五、常见问题

**Q：打开网页是空白 / 数据加载不出来？**
A：多半是 Mac 睡着了或后端没起。在 Mac 上跑 `start-vt-cf.sh` 再看。也确认 Mac 联网。

**Q：换了网络 / 重装后隧道失效？**
A：重新跑一次 `deploy-vt-cf.sh` 即可（会复用已存在的隧道，不会重复创建）。

**Q：不想开机自启了？**
A：`launchctl unload ~/Library/LaunchAgents/com.wangzhiping.vt-cf.plist`

**Q：我想完全不用 Mac（后端也上云）？**
A：需要把后端放到 Python 云主机（Railway/Render/Fly 或国内云），项目已带 `Dockerfile` 可直接容器化。但行情 TCP 源在非国内主机可能连不上 → 数据可能空。需要的话告诉我，我再帮你配。

---

## 六、文件说明（不用改）

| 文件 | 作用 |
|------|------|
| `deploy-vt-cf.sh` | 一键部署脚本（你跑的就是它） |
| `start-vt-cf.sh` | 启动后端 + 隧道（幂等，可重复跑） |
| `functions/[[path]].js` | Cloudflare 边缘代理：把网页 API 请求转发到你的隧道，**前端代码零改动** |
| `wrangler.toml` | Pages 项目配置（脚本会自动填入隧道网址） |
| `com.wangzhiping.vt-cf.plist` | 开机自启配置（由脚本生成并加载） |
