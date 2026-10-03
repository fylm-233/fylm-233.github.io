# GitHub Pages 发布方案计划

> 目标：把 `E:/AIdev/winclassic-blog/` 发布为 GitHub Pages 站点，  
> 并让 B 站数据每 6 小时自动更新，全过程零服务器、零第三方运行时依赖。

---

## 0. 方案概要

| 项     | 内容                                                                            |
| ----- | ----------------------------------------------------------------------------- |
| 发布对象  | `winclassic-blog/` 目录整体（**仓库根目录 = 站点根目录**）                                    |
| 待发布体积 | 约 **200 KB**（assets 84K + scripts 32K + index.html 36K + README 24K + 数据 16K） |
| 托管方式  | GitHub Pages，**Deploy from a branch**（`main` / `/ (root)`）                    |
| 数据更新  | GitHub Actions cron `0 */6 * * *`（UTC）→ 抓取 → 提交 `bili.json` + `bili.data.js`  |
| 前置条件  | GitHub 账号；本机 `git`（已确认 2.55.0）；仓库需为**公开**（Free 账号）                            |
| 预估耗时  | 手工操作约 **10 分钟**；Pages 首次构建 1–2 分钟                                             |
| 关键结论  | 前端用相对路径 `'bili.json'`，**项目站点 / 用户站点 / 自定义域名三种场景均无需改代码**                       |

### 数据链路

```
GitHub Actions（cron 每 6 小时 / 可手动触发）
        │  scripts/fetch_bili.py（WBI 签名调用 B 站接口，纯标准库）
        ▼
   bili.json  +  bili.data.js   ──自动 commit & push──▶ 仓库 main 分支
        ▼
GitHub Pages 构建（已 .nojekyll 跳过 Jekyll，原样发布）
        ▼
访客浏览器 ── fetch ./bili.json ──▶ 渲染 Windows Classic 视频卡片
             （file:// 双击打开时自动回退读 bili.data.js）
```

---

## 1. 前置检查（Preflight）

### 1.1 已完成项 ✅

| 检查项          | 结果                                                                                  |
| ------------ | ----------------------------------------------------------------------------------- |
| 页面资源路径       | `assets/classic.css`、`assets/app.js`、`bili.json`、`bili.data.js` 全部为**相对路径**且文件存在    |
| Liquid 语法风险  | `index.html` 中 `{{` / `{%` 出现次数均为 **0**，Jekyll 不会破坏页面                               |
| `.nojekyll`  | 已在仓库根目录创建（空文件）                                                                      |
| 敏感信息         | 全项目扫描无硬编码 `SESSDATA` / `bili_jct` / token；Cookie 仅通过 `os.environ["BILI_COOKIE"]` 读取 |
| 数据产物         | `bili.json`（5 投稿 / 6 动态 / 5 分区，`ok=true`、`stale=false`）与 `bili.data.js` 均有效         |
| 脚本语法         | `node --check` 通过 `app.js` 与 `bili.data.js`；CSS 花括号配对（252/252）                      |
| 双路径渲染        | `http://` 与 `file://` 均已实测渲染 5 条投稿，无 JS 运行时异常                                       |
| `.gitignore` | 已覆盖 `.edge-*/`、`node_modules/`、`__pycache__/`、`bili.json.tmp` 等                     |
| git 环境       | `git 2.55.0`；全局身份已配置                                                                |

### 1.2 待确认项 ⚠️

| 检查项          | 现状                | 影响                   |
| ------------ | ----------------- | -------------------- |
| **git 仓库**   | **尚未 `git init`** | 阶段一必须执行，否则无法推送       |
| **`gh` CLI** | **未安装**           | 远程仓库需在网页创建，或先安装 `gh` |
| 仓库名 / 账号名    | 未知                | 决定站点 URL，见 §2        |
| 公开 / 私有      | 未知                | 决定 Pages 是否可用，见 §2   |

---

## 2. 关键决策（开工前需确定）

### 决策 A：仓库命名 → 决定站点 URL 形态

| 方案           | 仓库名                | 站点地址                                        | 适用                    |
| ------------ | ------------------ | ------------------------------------------- | --------------------- |
| **项目站点（推荐）** | `winclassic-blog`  | `https://<USER>.github.io/winclassic-blog/` | 一个账号下可以有多个站点，互不干扰     |
| 用户站点         | `<USER>.github.io` | `https://<USER>.github.io/`                 | 每个账号**只能有一个**，且会占用根路径 |

> **两种方案都无需修改任何代码** —— `DATA_URL = 'bili.json'` 是相对路径，随页面目录解析。

### 决策 B：仓库可见性 → 决定 Pages 是否可用

| 方案         | GitHub Free                 | 说明                         |
| ---------- | --------------------------- | -------------------------- |
| **公开（推荐）** | ✅ Pages 可用                  | 代码与数据公开；本项目无敏感信息，适合公开      |
| 私有         | ❌ 需 Pro / Team / Enterprise | Free 账号下私有仓库**无法开启 Pages** |

> 补充：即使仓库为私有且 Pages 已开启，站点本身**仍是公开可访问**的（除 Enterprise 的访问控制特性）。

### 决策 C：是否配置自定义域名（可选）

若有域名，可在 Pages 设置中填 `Custom domain`，并在 DNS 添加 `CNAME` 记录指向 `<USER>.github.io`。  
启用 HTTPS 需等待证书签发（通常几分钟到 24 小时）。**相对路径方案下同样无需改代码。**

---

## 3. 阶段一：本地仓库初始化

```bash
cd E:/AIdev/winclassic-blog

# 1) 初始化，主分支直接命名为 main
git init -b main

# 2) 确认忽略规则生效（.edge-cdp 不应出现在列表里）
git status --short

# 3) 暂存全部
git add -A

# 4) 复查将要提交的文件清单（确认无 .edge-cdp / *.7z / 临时截图）
git diff --cached --name-only

# 5) 首次提交
git commit -m "feat: Windows Classic 风格 B 站主页（EdgeHTML 18 基线）+ 静态数据流水线"
```

**验收**：`git diff --cached --name-only` 输出应恰为下列文件（顺序无关）：

```
.gitignore
.github/workflows/fetch-bili.yml
.nojekyll
README.md
DEPLOY.md
assets/app.js
assets/classic.css
bili.data.js
bili.json
index.html
scripts/fetch_bili.py
```

> 若出现 `.edge-cdp/...`，说明 `.gitignore` 未生效，执行 `git rm -r --cached .edge-cdp` 后重试。

---

## 4. 阶段二：创建远程仓库

### 方式 1：网页创建（`gh` 未安装时使用）

1. 打开 <https://github.com/new>
2. **Repository name**：填 `winclassic-blog`（或 `<USER>.github.io`，见决策 A）
3. **Visibility**：选 **Public**（见决策 B）
4. **不要**勾选 `Add a README file` / `.gitignore` / `license`  
   —— 本地已有内容，勾选会造成历史分叉，首次 push 需额外处理冲突
5. 点 **Create repository**，记下页面显示的仓库 URL

### 方式 2：安装 gh CLI（可选，可一条命令建库）

```bash
# Windows（winget）
winget install --id GitHub.cli
# 安装后登录
gh auth login
# 建库并自动加 remote + 推送
gh repo create winclassic-blog --public --source=. --remote=origin --push
```

> 用方式 2 时，可直接跳到 §6 验证。

---

## 5. 阶段三：关联并推送

```bash
cd E:/AIdev/winclassic-blog

# 关联远程（把 <USER> 换成你的 GitHub 用户名）
git remote add origin https://github.com/<USER>/winclassic-blog.git

# 校验远程地址
git remote -v

# 首次推送并建立上游跟踪
git push -u origin main
```

**认证提示**：GitHub 已不支持密码推送，需用 **Personal Access Token**（classic 或 fine-grained，  
勾选 `repo` / `Contents: Read and write`）或 **SSH key**。  
推送时用户名填 GitHub 用户名，密码处粘贴 Token。

**验收**：`git push` 输出 `main -> main`，且 GitHub 仓库页面能看到全部文件。

---

## 6. 阶段四：开启 GitHub Pages

1. 仓库 → **Settings** → 左侧 **Pages**
2. **Build and deployment**
   - **Source**：`Deploy from a branch`
   - **Branch**：`main`
   - **Folder**：`/ (root)`
   - 点 **Save**
3. 等待 1–2 分钟，页面顶部会出现绿色提示 `Your site is live at ...`
4. 访问站点：

| 仓库名                | 站点地址                                        |
| ------------------ | ------------------------------------------- |
| `winclassic-blog`  | `https://<USER>.github.io/winclassic-blog/` |
| `<USER>.github.io` | `https://<USER>.github.io/`                 |

**验收命令**：

```bash
# 页面可访问（期望 200）
curl -sI https://<USER>.github.io/winclassic-blog/ | head -1

# 数据文件可访问（期望 200 + application/json）
curl -sI https://<USER>.github.io/winclassic-blog/bili.json | head -3
```

> **常见坑**：`https://<USER>.github.io/<仓库名>` **末尾斜杠不能省**。  
> 省略时 GitHub 会 301 跳转，但 `bili.json` 的相对路径解析可能受影响。

---

## 7. 阶段五：验证 Actions 写权限

工作流需要 `contents: write` 才能把数据提交回仓库。

**结论：本项目的 `permissions: contents: write` 已足够，无需修改仓库设置。**  
GitHub 官方文档明确：*"Anyone with write access to a repository can modify the permissions granted to  
the GITHUB_TOKEN, adding or removing access as required, by editing the `permissions` key in the  
workflow file."* 即工作流内的 `permissions` 键可**覆盖**仓库默认的只读设置。

**验证步骤**：

1. 仓库 → **Actions** 标签页
2. 左侧应出现 **Fetch Bilibili Data**（若没有，说明 workflow 文件未推送成功或 YAML 有语法错误）
3. 点进去 → 右侧 **Run workflow** → 选 `main` 分支 → **Run workflow**
4. 观察执行结果

> **组织账号注意**：若仓库隶属于某个组织，且组织设置中强制了更严格的默认权限，  
> 则宽松选项可能被禁用。此时需联系组织管理员，或改用 PAT（见 §13 风险 4）。

---

## 8. 阶段六：首次数据抓取验证

手动触发后，逐项确认：

| 检查项         | 期望结果                                                                      |
| ----------- | ------------------------------------------------------------------------- |
| 工作流状态       | 全部步骤绿色 ✅                                                                  |
| `校验产物` 步骤日志 | 打印 `videos: 5`、`dynamics: 6`、`bili.data.js : OK (...字节)`                  |
| `提交变更` 步骤日志 | 出现 `chore(data): 更新 bili.json / bili.data.js [skip ci]`，或 `数据文件无变化，跳过提交。` |
| 仓库提交历史      | 多出一条 `github-actions[bot]` 的提交（数据无变化时不会产生）                                |
| 运行摘要        | Actions 页面底部 Summary 出现「Bilibili 数据抓取结果」表格                                |
| Pages 重建    | 若产生了新提交，1–2 分钟后站点数据刷新                                                     |

**说明 `[skip ci]`**：GitHub Actions 支持 `[skip ci]` / `[ci skip]` / `[no ci]` / `[skip actions]` /  
`[actions skip]` 跳过由 `push` / `pull_request` 触发的工作流。  
本工作流目前**只有 `schedule` 和 `workflow_dispatch` 触发器，没有 `push` 触发器**，  
因此 `[skip ci]` 当前是**无害的空操作**；它的作用是**将来若新增 `push` 触发器时防止自我循环**。

---

## 9. 阶段七（可选，强烈建议）：配置 BILI_COOKIE

GitHub Actions 的机房 IP 极易触发 B 站风控（`-352` 风控 / `-412` 拦截 / `-799` 限流）。

1. 浏览器登录 B 站 → F12 → Application → Cookies → 复制 `SESSDATA` 与 `bili_jct`
2. 仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
   - **Name**：`BILI_COOKIE`
   - **Secret**：`SESSDATA=xxxxxxxx; bili_jct=xxxxxxxx`
3. 工作流已内置读取（`BILI_COOKIE: ${{ secrets.BILI_COOKIE }}`），无需改动

> ⚠️ **安全**：`SESSDATA` 等同于账号登录凭证。**只能放 Secret，绝不写入代码或提交到仓库。**  
> 建议使用小号。

---

## 10. 阶段八（可选）：自定义域名

1. **Settings → Pages → Custom domain** 填入域名，保存
2. DNS 添加记录（以 `blog.example.com` 为例）：
   - 类型 `CNAME`，名称 `blog`，值 `<USER>.github.io`
   - 根域名 `example.com` 需用 4 条 `A` 记录指向 GitHub Pages IP
3. 等待 DNS 生效（几分钟到 48 小时），勾选 **Enforce HTTPS**

> 代码侧无需任何改动 —— `'bili.json'` 相对路径在自定义域名下同样正确解析。

---

## 11. 验收清单（Definition of Done）

按顺序全部打勾即发布完成：

- [ ] 本地 `git log` 有首次提交，`git remote -v` 指向正确仓库
- [ ] GitHub 仓库根目录能看到 `index.html`、`bili.json`、`bili.data.js`、`.nojekyll`
- [ ] Settings → Pages 显示 `Your site is live at ...`
- [ ] 访问站点 URL（**带末尾斜杠**）返回 200，页面渲染出 Windows Classic 界面
- [ ] 页面显示 5 条投稿、6 条动态、5 条分区数据条
- [ ] 状态栏显示「就绪」而非错误提示
- [ ] `curl -I` 检查 `bili.json` 返回 200
- [ ] Actions 手动触发一次，全部步骤绿色
- [ ] 运行摘要出现抓取结果表格
- [ ] （可选）配置 `BILI_COOKIE` 后，日志显示「已读取 BILI_COOKIE（N 字符）」
- [ ] 页面在目标浏览器（Edge 18+ / Chrome / Firefox）中布局正常

---

## 12. 路径适配速查

| 部署形态  | 页面地址                             | `bili.json` 实际地址                     | 代码应写             | 本项目状态          |
| ----- | -------------------------------- | ------------------------------------ | ---------------- | -------------- |
| 项目站点  | `https://u.github.io/repo/`      | `https://u.github.io/repo/bili.json` | `'bili.json'`    | ✅ 已适配          |
| 用户站点  | `https://u.github.io/`           | `https://u.github.io/bili.json`      | `'bili.json'`    | ✅ 已适配          |
| 自定义域名 | `https://example.com/`           | `https://example.com/bili.json`      | `'bili.json'`    | ✅ 已适配          |
| 子目录部署 | `https://u.github.io/repo/site/` | `https://u.github.io/repo/bili.json` | `'../bili.json'` | ⚠️ 需改 `app.js` |

**核心规则**：

```js
const DATA_URL = 'bili.json';   // ✅ 相对路径：随页面所在目录解析
const DATA_URL = '/bili.json';  // ❌ 绝对路径：项目站点下会 404
```

---

## 13. 风险与回滚

| # | 风险                 | 概率 | 影响      | 缓解 / 处置                                                                         |
| - | ------------------ | -- | ------- | ------------------------------------------------------------------------------- |
| 1 | B 站风控导致抓取失败        | 高  | 无新数据    | 脚本已有重试 + 分层降级 + **旧数据保留**，**永不写出空数据**；配 `BILI_COOKIE` 可显著改善                     |
| 2 | Actions 定时任务被暂停    | 中  | 数据停止更新  | 仓库连续 **60 天无活动**会被自动暂停；手动触发一次即恢复                                                |
| 3 | `schedule` 触发延迟    | 中  | 更新不及时   | 高峰期可延迟数分钟至数十分钟，属 GitHub 平台行为，无法规避                                               |
| 4 | Actions 无写权限（组织策略） | 低  | 提交失败    | 检查 Settings → Actions → General → Workflow permissions；组织受限时改用 PAT 写入 `secrets` |
| 5 | Pages CDN 缓存旧数据    | 低  | 看到旧数据   | 前端已用 `cache: 'no-store'` + `?v=<时间戳>`；必要时强制刷新                                   |
| 6 | 封面图被防盗链拦截          | 中  | 显示斜纹占位块 | 已加 `referrerpolicy="no-referrer"` + `onerror` 占位降级，不影响文字信息                      |
| 7 | 误提交敏感信息            | 低  | 凭证泄露    | 已扫描确认无硬编码密钥；**Cookie 只走 Secret**；一旦泄露立即在 B 站改密并撤销 Token                         |

### 回滚方案

| 场景     | 操作                                                                 |
| ------ | ------------------------------------------------------------------ |
| 页面有问题  | `git revert <commit>` 后 push；或 Pages 设置里临时切换 Source 到别的分支          |
| 停止站点   | Settings → Pages → Source 改为 `None`，站点立即下线                         |
| 撤销错误提交 | `git revert HEAD`（保留历史，推荐）；避免 `git reset --hard` + `--force` 强推    |
| 关闭自动更新 | Actions 页面 → Fetch Bilibili Data → 右上 `···` → **Disable workflow** |

---

## 14. 日常运维

| 频率     | 动作                                                |
| ------ | ------------------------------------------------- |
| 无需干预   | 每 6 小时自动抓取并提交（北京时间 00:00 / 06:00 / 12:00 / 18:00） |
| 每月     | 查看 Actions 历史，确认无连续失败                             |
| 每 45 天 | 在 Actions 页面手动触发一次，避免 60 天不活动被暂停                  |
| 需要立即更新 | Actions → Run workflow 手动触发                       |
| 想改数据条数 | 手动触发时把 `limit` 输入框改为目标值                           |

---

## 15. 执行顺序速览（TL;DR）

```
① git init -b main  →  git add -A  →  git commit
② GitHub 网页新建公开仓库（不要勾选 README/gitignore/license）
③ git remote add origin ...  →  git push -u origin main
④ Settings → Pages → Deploy from a branch → main / (root) → Save
⑤ 访问 https://<USER>.github.io/<REPO>/ 确认页面
⑥ Actions → Fetch Bilibili Data → Run workflow 验证抓取
⑦（建议）Settings → Secrets → Actions → 新增 BILI_COOKIE
```

---

## 附：本方案未采用的其他方案及原因

| 方案            | 未采用原因                          |
| ------------- | ------------------------------ |
| 浏览器端直接调 B 站接口 | 跨域（CORS）被拦 + 触发风控 + 需要签名密钥，不可行 |
| 第三方公共 API 中转  | 违反"不依赖跨域或第三方接口"的需求约束           |


| Cloudflare Workers / Vercel 等函数中转 | 引入额外平台依赖与运维成本，违背"完全静态、零服务器"目标 |
| Pages 用 GitHub Actions 产物部署（`deploy-pages`） | 需额外维护一个部署工作流；本项目只需静态文件 + 定时提交数据，分支部署更简单可靠 |
| 私有仓库 + Pages | Free 账号不支持；且站点本身仍是公开的，私有化意义有限 |
