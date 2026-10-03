# 哔哩哔哩 UID 11897608 · Windows Classic 风格静态主页

以 **Windows Classic（Windows 3.1 – 2000 / Y2K）** 界面为蓝本的静态主页，展示哔哩哔哩
UID `11897608` 的账号信息、信息动态与最新 5 条投稿。

页面在 **最低兼容 EdgeHTML 18（Microsoft Edge 18 / Windows 10 1809）** 的前提下实现：
使用 ES2017 语法（`let/const`、箭头函数、`async/await`）、`fetch` + `AbortController`
读取数据，CSS 使用自定义属性（`var()`）、Flexbox 与 CSS Grid，并保留 Windows Classic
的直角盒模型与凹凸立体边框。

数据链路完全静态，符合 GitHub Pages 限制：

```
GitHub Actions（每 6 小时）
        │  运行 scripts/fetch_bili.py（WBI 签名调用 B 站接口）
        ▼
   bili.json（提交回仓库根目录）  ── 同源副本 ──▶  bili.data.js
        ▼                                          ▼
GitHub Pages（静态托管）                  双击本地打开（file://）
        ▼                                          ▼
前端 fetch 读取 ./bili.json ─────┐        <script> 回退读取 bili.data.js
                                └──▶ 渲染为 Windows Classic 视频卡片
```

> **双数据源设计**：`file://` 协议下浏览器会拦截 `fetch` / `XHR`（origin 为 `null`），
> 因此脚本在生成 `bili.json` 的同时输出一份等价的 `bili.data.js`
> （`window.BILI_DATA = {...}`）。前端在 `file://` 场景自动改用 `<script>` 标签加载，
> 实现「双击 index.html 即可离线预览」。HTTP(S) 环境下仍优先 `fetch` 读取 `bili.json`。

---

## 一、目录结构

```
winclassic-blog/                     ← 仓库根目录，同时也是 Pages 站点根目录
├── index.html                       ← 页面（HTML5 + 内联 SVG 图标，无外部图标库）
├── bili.json                        ← 数据文件（由脚本生成 / Actions 定时更新）
├── bili.data.js                     ← 同一份数据的 JS 包装（file:// 离线预览用，自动生成）
├── assets/
│   ├── classic.css                  ← Windows Classic 主题样式（CSS 变量 + Grid/Flex）
│   ├── app.js                       ← 主窗口交互脚本（ES2017；含共享窗口管理器 WinWM）
│   ├── markdown.js                  ← 轻量 Markdown 解析器（无第三方依赖，挂 window.WinMD）
│   ├── notepad.js                   ← 记事本窗口（Markdown 渲染 / 源码编辑，挂 window.WinNotepad）
│   ├── player.js                    ← 媒体播放器窗口（网易云外链 + 视觉覆盖层，挂 window.WinPlayer）
│   └── img/
│       └── wallpaper.jpg            ← 默认桌面壁纸（1920×1080）
├── scripts/
│   └── fetch_bili.py                ← 抓取脚本（纯标准库 + WBI 签名，约 800 行）
├── .github/
│   └── workflows/
│       └── fetch-bili.yml           ← 每 6 小时定时抓取并提交
├── .nojekyll                        ← 空文件，让 Pages 跳过 Jekyll 构建
├── .gitignore
└── README.md
```

> **脚本加载顺序（`index.html` 末尾）**：`markdown.js` → `app.js` → `notepad.js` → `player.js`。
> `app.js` 会在 `window.WinWM` 上建立极简的共享窗口管理器；
> `notepad.js` 依赖 `window.WinMD`（解析器）与 `window.WinWM`（窗口互斥）二者，
> `player.js` 依赖 `window.WinWM` 与（可选的）`window.WinMainDialogs`，
> 任一缺失时它们都会安全退出，不会影响主窗口。

---

## 二、页面功能（对齐参考页 `aero-blog/src/index.html` 的交互）

| 参考页交互 | 本页实现 |
| --- | --- |
| 拖动标题栏移动窗口 | ✅ `mousedown/mousemove/mouseup` + `touch` 双通道，带边界回拉 |
| 双击标题栏最大化 / 还原 | ✅ 保存还原矩形，最大化时工作区高度自适应视口 |
| 最小化 / 关闭（吸入任务栏） | ✅ `transform` 缩放平移动画；关闭后弹出提示条 |
| 任务栏按钮 / 桌面图标唤回窗口 | ✅ |
| Esc 最小化窗口 | ✅ 对话框/菜单打开时优先关闭它们 |
| 任务栏时钟 | ✅ 每秒刷新 |
| 显示设置（复选框开关） | ✅ 显示桌面图标 / 显示视频封面 / 窗口动画 |
| 壁纸切换 | ✅ 壁纸图片 `wallpaper.jpg` / 经典灰 `#c0c0c0` / 青绿 `#008080` / 深蓝 `#000080` |
| 壁纸适配 | ✅ `cover`（填充）/ `contain`（完整显示）/ `tile`（平铺）三档 |
| 搜索框回车提示 | ✅ 改为状态栏与提示条反馈 |
| 内容滚动到底部状态栏反馈 | ✅ |
| 气泡提示 | ✅ 改为 Windows Classic 提示条（右下角，5 秒自动消失） |
| 兼容性说明面板 | ✅ |
| **记事本窗口** | ✅ 仿 Windows 记事本，渲染 / 源码 / 并排三视图 |
| **多窗口任务栏切换** | ✅ 主窗口 ↔ 记事本双向切换，活动窗口互斥 |
| **移动端自适应** | ✅ 1180 / 1060 / 720 / 420px 与横屏矮视口五档断点 |

**Windows Classic 特有新增：**

- 菜单栏（文件 / 编辑 / 查看 / 收藏 / 工具 / 帮助），含真实下拉菜单、快捷键标注、✓ 勾选项
- 工具栏（刷新 / 空间 / 投稿 / 动态 / 数据 / 设置 / 帮助），悬停凸起、按下凹陷
- 地址栏 + 「转到」按钮
- 开始菜单（含左侧竖排蓝色标题栏）
- 模态消息框（信息 / 警告 / 错误三种图标）
- Windows Classic 分段式进度条（加载动画，纯 CSS `@keyframes` 驱动，无定时器）
- 投稿「缩略图 / 列表」双视图切换
- 分区分布数据条

---

## 二之二、记事本窗口（Markdown 渲染器）

复用主窗口的窗口架构（拖拽 / 最大化 / 最小化吸入动画 / 任务栏按钮），
但拥有独立的实例状态，通过 `window.WinNotepad` 对外只暴露一个 `open()` 入口。

### 1. 三种视图

| 视图 | 说明 | 切换方式 |
| --- | --- | --- |
| **渲染** | 仅显示 Markdown 渲染结果（默认） | 工具栏「渲染」/ 菜单 `查看(V) → 渲染视图` |
| **源码** | 仅显示带行号的等宽源码编辑器 | 工具栏「源码」/ `查看(V) → 源码视图` |
| **并排** | 上方源码（带行号）+ 下方实时预览 | 工具栏「并排」/ `查看(V) → 并排显示` |

- 源码改动后 **160 ms 防抖**自动重新渲染，避免连续输入时反复解析。
- 行号列随编辑器滚动同步平移（`translateY` 量化到行高 `18px`，避免亚像素抖动）。
- 「打开」按钮可载入本地 `.md` / `.txt` 文件（`FileReader`，不发起网络请求）。
- 「复制」复制渲染后的纯文本，「语法」弹出内置语法速查表。

### 2. 支持的 Markdown 语法

| 类别 | 语法 |
| --- | --- |
| 块级 | ATX 标题 `#` ~ `######`、段落、分隔线 `---` / `***` / `___` |
| 列表 | 无序 `-` `*` `+`、有序 `1.` `1)`、**任意层级嵌套**、任务清单 `- [x]` |
| 代码 | 行内 `` `code` ``、围栏代码块 ``` ```lang ```（带语言角标）、4 空格缩进代码块 |
| 引用 | `>` 引用块（可嵌套、可内含标题/列表/代码块） |
| 行内 | 加粗 `**` `__`、斜体 `*` `_`、删除线 `~~`、链接、图片、自动链接 `<url>`、硬换行 |
| 附加 | 表格（`|` 分隔，支持 `:---:` 对齐）、行内 HTML 转义（不解析） |

> **安全设计**：解析器遵循「**先整体 HTML 转义，再拼接标签**」原则，
> 且 `safeUrl()` 拦截 `javascript:` / `vbscript:` / 非图片 `data:` 协议。
> 因此 `<script>`、`<img onerror=...>`、`[x](javascript:...)` 一律降级为纯文本，
> 不可能执行。已通过 6 项注入用例验证（见「六、验证」）。

### 3. 启动时的占位文档

`notepad.js` 内置 `SAMPLE_DOC` 常量。页面加载时即调用 `loadText(SAMPLE_DOC, '未命名.md')`
完成初始化，因此**打开记事本就能立即看到效果**，无需先准备 `.md` 文件。
该示例文档刻意覆盖了全部必需语法（含六级标题、三层嵌套列表、带语言标识的代码块、
嵌套引用、任务清单、表格等），可作为语法参考。

### 4. 多窗口协同（`window.WinWM`）

两个窗口模块通过一个约 30 行的共享契约协作，避免互相依赖内部状态：

```js
window.WinWM = {
  register(id, { isVisible, setInactive, show, hide }),  // 各窗口自注册
  setActive(id),        // 把某窗口设为活动，其余可见窗口转非活动
  isVisible(id), isActive(id),
}
```

任务栏按钮采用标准 Windows 语义：

| 当前状态 | 点击行为 |
| --- | --- |
| 窗口已最小化 | **显示**并激活 |
| 可见但非活动 | **激活**（置顶），不隐藏 |
| 可见且已活动 | **最小化** |

关闭 / 最小化当前窗口时，活动状态会**自动交还**给仍可见的另一个窗口，
因此不会出现「两个任务栏按钮同时高亮」或「无高亮」的状态。

### 5. 打开记事本的三条入口

1. 桌面图标 **记事本.md**
2. 菜单栏 `工具(T) → 打开记事本（Markdown）…`
3. 开始菜单 → 打开记事本

---

## 二之三、媒体播放器窗口（网易云外链 + 视觉覆盖）

一个与主窗口、记事本并列的独立窗口，内嵌网易云音乐外链播放器，
并叠加一层 Windows 3.1 风格的控件外观。

内嵌的 iframe（与需求原文一致，宽 330 高 86）：

```html
<iframe frameborder="no" border="0" marginwidth="0" marginheight="0"
        width=330 height=86
        src="//music.163.com/outchain/player?type=2&id=22636810&auto=1&height=66"></iframe>
```

### 1. 跨域限制与可行的替代方案（必须先讲清楚）

该 iframe 位于 `music.163.com`，与本站**不同源**。同源策略使父文档：

- 无法读取 iframe 内部 DOM（拿不到 `contentDocument`）
- 无法向内部元素注入样式
- 无法重排内部控件位置

因此「把网易云原生按钮改造成 Windows 3.1 按钮」在**纯前端、无反向代理**的前提下
不可能真正实现。本页采用业界通行的替代方案，并且不虚构任何跨域能力：

| 目标 | 实现方式 |
| --- | --- |
| **视觉替换** | 在 iframe 之上铺一层**同尺寸同位置**的覆盖层 `.mp-cover`，像素级盖住原生控件区 |
| **点击穿透拦截** | 覆盖层的装饰件一律 `pointer-events:none`（不吃事件）；真正拦截的是三个热区 `.mp-hot`，它们 `pointer-events:auto` 且 `z-index` 高于覆盖层装饰件 |
| **控件精确定位** | 覆盖层与 iframe 的 `left/top/width/height` 由 JS 统一写入（`updateStageMetrics()`），二者始终同框；热区坐标与装饰按钮坐标严丝合缝（实测 Δx=0、Δy≤1px） |
| **不能真的控制播放** | `play/prev/next` 只更新本地视觉状态，并**尽力而为**地 `postMessage` 广播一次（对方未声明接受，实际预期无效，且无副作用） |
| **进度条** | 原生进度条同样被盖住；覆盖层用自驱计时器呈现「视觉进度」，状态栏明确标注「模拟」，不谎称与真实播放位置同步 |
| **功能底线** | 工具栏「皮肤」按钮可整体关闭覆盖层，**回落到网易云原生控件**，保证「至少能正常播放/暂停」这一底线始终可用 |

### 2. 覆盖层的结构

```
.mp-stage                    舞台：居中摆放固定尺寸的 iframe（两侧留经典灰底）
├── iframe.mp-frame          真实播放器，330×86，懒装载（首次打开才请求）
└── .mp-cover                覆盖层，与 iframe 同框
    ├── .mp-cover__top       曲目图标 + 真实曲名 + 播放指示灯
    ├── .mp-cover__track     进度槽（可点，仅移动视觉进度）
    ├── .mp-cover__time      00:00 / 04:04
    ├── .mp-cover__pad       三个装饰按钮（pointer-events:none）
    └── .mp-hot × 3          三个热区（pointer-events:auto，拦截点击）
```

**曲目元数据**：网易云外链只传 `id`，界面无法反查歌名（跨域）。
因此 `player.js` 内置了本站曲目的元数据（取自网易云歌曲详情接口）：

- 曲名 `夢消失 ～ Lost Dream`
- 艺术家 `上海アリス幻樂団`
- 专辑 `東方夢時空 ～ Phantasmagoria of Dim.Dream.`

### 3. 按钮字形的兼容性处理（一个真实的坑）

覆盖层的播放/上一首/下一首字形用 **`border` 三角形**拼成，
**刻意没有使用 `clip-path`** —— `clip-path` 需要 Edge 79+，
在目标基线 EdgeHTML 18 上会完全失效，三角形会退化成实心方块。
`border` 三角形自 CSS1 起可用，是唯一能覆盖到 Edge 18 的画法。

三个字形的居中偏移量均**由实测几何反推**（而非估算），保证在 26×17 的
按钮内视觉居中：实测三者的可视中心与按钮中心完全重合。

### 4. 打开播放器的四条入口

1. 桌面图标 **播放器**
2. 菜单栏 `工具(T) → 打开媒体播放器…`
3. 开始菜单 → 媒体播放器
4. 任务栏按钮（打开后出现；语义与其他窗口一致：非活动→激活，已活动→最小化）

### 5. 播放器内的菜单

| 菜单 | 项 | 说明 |
| --- | --- | --- |
| 文件(F) | 在网易云打开本曲 / 重新载入播放器 / 关闭 | 重载会带时间戳强制重新请求 |
| 查看(V) | 经典皮肤 / 原生控件 / 重置视觉进度 | 皮肤与「原生」互斥勾选 |
| 帮助(H) | 关于覆盖层与跨域… | 弹窗如实说明上述限制 |

---

## 二之四、窗口布局：为什么不会出现「全屏缺口」

### 1. 曾经的缺陷

最大化窗口的工作区一度写成 `height: calc(100vh - 196px)`。
`196` 是把标题栏/菜单栏/工具栏/状态栏/内边距**估算**进去的一个魔法常量。
实测该常数多减了 79px，于是最大化后窗口底部与任务栏之间恒留下一条空隙
（在 1080/900/768/757/640/1024 六种视口高度下**缺口完全相同**，
这正是「硬编码常量」的典型指纹）。

此外还有两处常量互不相识：

- **工具栏高度可变** —— 窄屏下工具按钮换行，从 47px 涨到 90px+
- **任务栏高度可变** —— ≤720px 断点从 32px 变为 30px

### 2. 修复：用「弹性填充」取代「魔法常量」

```css
.window.is-maxed {
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--max-gap));   /* --max-gap = 任务栏高度 */
  min-height: 320px;
}
.window.is-maxed > .title-bar,
.window.is-maxed > .menubar,
.window.is-maxed > .toolbar,
.window.is-maxed > .statusbar { flex: none; }        /* 固定部件保持自身高度 */

.window.is-maxed > .workspace {
  flex: 1 1 auto;      /* 唯一伸缩项：吃掉全部剩余高度 */
  min-height: 0;       /* 关键！flex 项默认 min-height:auto 会被内容顶开 */
  height: auto;
  max-height: none;
}
```

让浏览器自己算剩余空间，就**不可能**再出现「常量估错」导致的缺口 ——
无论有多少固定部件、它们多高、任务栏多少像素，工作区都恰好填满。

`--max-gap` 与 `--desk-gap` 二者分离：前者专供最大化窗口贴合任务栏上沿，
后者保留「任务栏高度 + 间距」语义供别处使用，互不牵连。

### 3. 顺带修掉的两个真实缺陷

- **「幽灵高亮」**：主窗口在 `WinWM` 的 `setInactive` 只切了窗口渐变类，
  没同步任务栏按钮高亮。于是当记事本/播放器成为活动窗口时，
  主窗口按钮仍亮着，任务栏出现**两个按钮同时高亮**。现已在同一处同步按钮类。
- **「打开即不可见」**：新窗口原按文档流 `margin: auto` 排布，位置取决于页面滚动量。
  当视口偏矮时窗口会被推到首屏之外，用户必须向下滚动才能看到。
  现在首次显示时即转入绝对定位，并按
  「桌面水平居中 + 垂直夹在视口内」重算坐标，保证任意滚动位置下都在首屏可见。

### 4. 实测结果

12 种视口 × 2 个窗口（主窗口 / 记事本）的最大化缺口**全部为 0px**，
包括任务栏降到 30px 的 ≤720px 断点、以及工具栏可能换行的 860px 附近：

```
✓ 1920×1080  ✓ 1440×900  ✓ 1366×768  ✓ 1084×757  ✓ 1024×640  ✓ 900×700
✓ 860×700    ✓ 720×800   ✓ 600×900   ✓ 390×844   ✓ 844×390   ✓ 360×640
```

窗口底边与任务栏上沿严格重合（`任务栏顶 - 窗口底 = 0`），无空缺、无留白、无裁剪。

---

## 二之五、移动端自适应

| 断点 | 主要调整 |
| --- | --- |
| **≤ 1180px** | 隐藏桌面图标，为主窗口让出宽度 |
| **≤ 1060px** | 记事本「并排」视图自动改为上下堆叠 |
| **≤ 720px** | 任务栏降为 30px；窗口外边距收紧；工作区 `height:auto`；行号槽变窄；标题栏按钮加大到易点尺寸；托盘图标隐藏；任务按钮改为紧凑标签 |
| **≤ 480px** | 播放器窗口宽度改为 `100%`，舞台高度降到 220px |
| **≤ 420px** | 外边距进一步收紧；工具栏改为横向滚动（不换行、不溢出）；状态栏右侧信息隐藏 |
| **横屏矮视口**（`max-height: 520px`） | 窗口高度改由视口驱动，工作区内部滚动，避免窗口被裁切；播放器舞台下限降到 130px（只需容纳 86px 的 iframe） |

壁纸在全部断点下均保持 `cover` 填充，不会出现拉伸变形或留白。
播放器窗口最大化时，iframe 始终保持 330×86 不被拉伸，覆盖层与其同框居中。

---

## 三、本地预览

### 1. 两种打开方式

| 方式 | 数据来源 | 是否可用 | 说明 |
| --- | --- | --- | --- |
| **双击 `index.html`**（`file://`） | `bili.data.js` | ✅ 可用 | 前端检测到 `file://` 协议后自动注入 `<script src="bili.data.js">`，读取 `window.BILI_DATA` |
| **HTTP 服务**（`http://localhost`） | `bili.json` | ✅ 可用（推荐） | 与线上 Pages 环境完全一致，走 `fetch` 路径 |

> **前提**：`file://` 离线预览依赖同级目录下存在 `bili.data.js`。
> 若该文件缺失（例如首次克隆后尚未运行脚本），页面会弹出「无法加载数据源」对话框并给出排查指引。

`file://` 下 `fetch` 被拦截是浏览器的同源策略（origin 为 `null`），与旧版 IE 的
"允许活动内容"提示无关；这也是引入 `bili.data.js` 回退方案的根本原因。

### 2. 生成数据

```bash
# 在仓库根目录执行；默认同时生成 bili.json 与 bili.data.js
python scripts/fetch_bili.py --pretty

# 只需要 JSON（例如 CI 中另有用途）
python scripts/fetch_bili.py --no-js

# 自定义两个产物的路径
python scripts/fetch_bili.py --out dist/bili.json --js-out dist/bili.data.js
```

### 3. 启动本地服务（推荐方式）

```bash
# 方式 A：Python（标准库，无需安装任何依赖）
python -m http.server 8000

# 方式 B：Node
npx serve . -l 8000
# 或
npx http-server -p 8000
```

然后访问 **<http://localhost:8000/>**。

> 注意：`python -m http.server` 默认监听 `0.0.0.0`。若只需本机访问，
> 建议加 `--bind 127.0.0.1`。

### 4. 本地路径约定

```
winclassic-blog/
├── index.html      ← 页面
├── bili.json       ← 主数据源，必须与 index.html 同级
└── bili.data.js    ← 离线回退数据源，必须与 index.html 同级
```

前端常量定义在 `assets/app.js` 顶部：

```js
const DATA_URL     = 'bili.json';      // 主数据源（相对路径，相对于 index.html 所在目录）
const FALLBACK_URL = 'bili.data.js';   // file:// 场景的降级数据源
const GLOBAL_KEY   = 'BILI_DATA';      // bili.data.js 导出的全局变量名
```

---

## 四、GitHub Pages 部署与路径适配

### 1. 部署步骤

1. 把本目录作为仓库根目录推送到 GitHub（`index.html`、`bili.json`、`bili.data.js`
   三者必须在同一目录，即仓库根目录）。
2. 仓库 **Settings → Pages → Build and deployment**
   - Source：`Deploy from a branch`
   - Branch：`main`，目录选 **`/ (root)`**
3. 等待 1–2 分钟，访问 `https://<用户名>.github.io/<仓库名>/`。

### 2. 路径适配（关键）

| 场景 | 页面地址 | `bili.json` 实际地址 | 前端应写 |
| --- | --- | --- | --- |
| **项目站点（推荐，默认）** | `https://u.github.io/repo/` | `https://u.github.io/repo/bili.json` | `'bili.json'` ✅ |
| 用户/组织站点 | `https://u.github.io/` | `https://u.github.io/bili.json` | `'bili.json'` ✅ |
| 自定义域名（根路径） | `https://example.com/` | `https://example.com/bili.json` | `'bili.json'` ✅ |
| 页面放进子目录 | `https://u.github.io/repo/site/` | `https://u.github.io/repo/bili.json` | `'../bili.json'` |

**核心规则：使用相对路径，不要用绝对路径。**

```js
const DATA_URL = 'bili.json';      // ✅ 随页面所在目录解析，项目站点/根站点都正确
const DATA_URL = '/bili.json';     // ❌ 项目站点下会解析到 https://u.github.io/bili.json → 404
```

本项目 `index.html`、`bili.json`、`bili.data.js` 三者同处仓库根目录，因此 `'bili.json'`
在 **本地预览、项目站点、用户站点、自定义域名** 四种场景下都无需修改。
（Pages 环境走 `fetch` 路径，`bili.data.js` 不会被请求，但仍需保留在仓库中，
以供他人克隆后直接双击预览。）

### 3. 同源与缓存

- **无跨域问题**：`bili.json` 与页面同源，`fetch` 不需要任何 CORS 头。
- **绕开强缓存**：`app.js` 请求时使用 `cache: 'no-store'` 并追加时间戳 `bili.json?v=<毫秒>`，
  规避 Pages CDN 与浏览器缓存。
- **已包含 `.nojekyll`**：仓库根目录放了一个空的 `.nojekyll`，让 Pages 跳过 Jekyll 构建、
  把文件原样发布。当前 `index.html` 不含 `{{ }}` / `{% %}` 等 Liquid 语法（已校验），
  即使不跳过也不会被破坏；加它是为了**加快构建**并防止将来引入下划线目录或模板语法时出问题。

> 注意：**私有仓库**使用 Pages 需要 GitHub Pro / Team / Enterprise；GitHub Free 下
> Pages 仅对**公开仓库**可用。若仓库为私有且 Pages 已开启，站点本身仍是公开可访问的。

### 4. 数据更新时序

```
Actions 定时触发 → 抓取 → 提交 bili.json + bili.data.js → Pages 自动重建（约 1–2 分钟）→ 前端读到新数据
```

前端每次打开页面都会重新请求 `bili.json`，因此数据更新后刷新即可看到。

---

## 五、抓取脚本 `scripts/fetch_bili.py`

### 用法

```bash
python scripts/fetch_bili.py                      # 默认 UID 11897608 → ./bili.json + ./bili.data.js
python scripts/fetch_bili.py --mid 11897608 --limit 5 --pretty
python scripts/fetch_bili.py --out dist/bili.json
python scripts/fetch_bili.py --no-js              # 只生成 bili.json
```

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--mid` | `11897608` | 目标 UID，也可用环境变量 `BILI_MID` |
| `--out` | `bili.json` | `bili.json` 输出路径 |
| `--js-out` | 空 | `bili.data.js` 输出路径；留空则与 `--out` 同目录、同名（后缀改 `.js`） |
| `--no-js` | 关 | 只生成 `bili.json`，跳过 `bili.data.js` |
| `--limit` | `5` | 抓取投稿条数 |
| `--pretty` | 关 | 缩进输出，便于查看 git diff |
| `--attempts` | `4` | 单接口最大尝试次数 |

### `bili.data.js` 生成规则

`bili.data.js` 与 `bili.json` 内容完全一致，只是包了一层 JS 赋值：

```js
window.BILI_DATA = { /* 与 bili.json 相同的内容 */ };
```

两个实现细节：

- **转义 U+2028 / U+2029**：这两个字符在 JSON 中合法，但在 ES2019 之前的 JS 字符串字面量中
  属于非法换行符，会导致 `SyntaxError`。生成时统一转义为 `\u2028` / `\u2029`。
- **原子写入**：与 `bili.json` 相同，先写临时文件再 `os.replace`，避免中断产生半截文件。

| 环境变量 | 说明 |
| --- | --- |
| `BILI_COOKIE` | 可选。形如 `SESSDATA=xxx; bili_jct=yyy`。携带登录态可显著降低被风控的概率 |
| `BILI_MID` | 可选。目标 UID |

### WBI 签名实现

```
1. GET /x/web-interface/nav        → data.wbi_img.img_url / sub_url
2. 取文件名去扩展名                 → img_key、sub_key
3. (img_key + sub_key) 按 64 位置换表重排 → 取前 32 位 = mixin_key
4. 参数加入 wts（秒级时间戳）→ 按 key 排序 → 过滤 !'()* → urlencode
5. md5(排序后的查询串 + mixin_key) = w_rid
6. 请求携带 wts 与 w_rid
```

> **关键细节**：未登录时 `nav` 接口返回 `code=-101`（账号未登录），
> 但 `data.wbi_img` 依然有效。脚本对该接口放行 `-101`，否则永远拿不到 WBI 密钥。

### 容错设计

| 能力 | 实现 |
| --- | --- |
| 失败重试 | 指数退避 + 随机抖动，默认 4 次；`-404 / -400` 等确定性错误不重试 |
| 分层降级 | 账号信息：`wbi/acc/info` → `web-interface/card`<br>投稿列表：`wbi/arc/search` → `arc/search` |
| 旧数据保留 | 任一环节彻底失败时沿用旧 `bili.json` 的对应字段，**永远不会写出空数据文件** |
| 状态标记 | 写入 `ok` / `stale` / `errors[]`，前端据此显示「数据为缓存版本」提示 |
| 原子写入 | 先写 `bili.json.tmp` 再 `os.replace`，避免中断产生半截文件 |
| 退出码 | 只要写出合法 `bili.json` 就返回 0，避免定时任务因风控频繁报红 |

### 输出结构

```json
{
  "uid": 11897608,
  "ok": true,
  "stale": false,
  "generated_at": "2026-10-03T01:43:30+08:00",
  "generated_at_ts": 1790963010,
  "source": "bilibili-wbi",
  "limit": 5,
  "user":  { "mid": 11897608, "name": "…", "face": "…", "sign": "…",
             "level": 6, "sex": "保密", "fans": 11121, "following": 1607 },
  "stat":  { "play": null, "like": null, "video_count": 168 },
  "partitions": [ { "tid": 1, "name": "动画", "count": 158 }, … ],
  "videos": [ { "bvid": "BV…", "aid": 0, "title": "…", "cover": "https://…",
                "url": "https://www.bilibili.com/video/BV…",
                "pubdate": 1790855738, "pubdate_text": "2026-10-01 19:55",
                "play": 9503, "comment": 60, "duration": "01:37" } ],
  "dynamics": [ { "type": "video", "kind": "投稿", "text": "投稿了视频《…》",
                  "url": "https://…", "ts": 1790855738, "time_text": "2026-10-01 19:55" } ],
  "errors": []
}
```

---

## 六、定时工作流 `.github/workflows/fetch-bili.yml`

- **触发**：`cron: '0 */6 * * *'`（**UTC 时区**，对应北京时间 00:00 / 06:00 / 12:00 / 18:00）
  + `workflow_dispatch` 手动触发（可指定 `mid` / `limit` / `pretty`）。
- **权限**：`permissions: contents: write`，使用内置 `GITHUB_TOKEN` 提交，无需额外配置 PAT。
- **并发控制**：`concurrency: group: fetch-bili`，同一时间只跑一个抓取任务。
- **提交流程**：`git pull --rebase --autostash` → 检查 `bili.json` / `bili.data.js`
  是否有变化 → 有变化才 `commit` + `push`（提交信息带 `[skip ci]`，避免再次触发构建）。
- **产物校验**：提交前用 Python 校验两个产物 ——
  `bili.json` 结构（`videos` 必须是数组）、`bili.data.js` 必须包含 `window.BILI_DATA =` 赋值。
- **运行摘要**：写入 `$GITHUB_STEP_SUMMARY`。

### 可选：配置登录态 Cookie（强烈建议）

GitHub Actions 的机房 IP 容易触发 B 站风控（返回 `-352` / `-412`）。配置登录态可显著提高成功率：

1. 浏览器登录 B 站，从开发者工具复制 `SESSDATA` 与 `bili_jct`。
2. 仓库 **Settings → Secrets and variables → Actions → New repository secret**
   - Name：`BILI_COOKIE`
   - Value：`SESSDATA=xxxxxxxx; bili_jct=xxxxxxxx`
3. 工作流已自动读取该 Secret，未配置时以游客身份请求（仍可工作，但成功率较低）。

> ⚠️ 安全提示：`SESSDATA` 等同于账号登录凭证，**只能放在仓库 Secret 中**，
> 切勿写入代码或提交到仓库。建议使用小号。

---

## 七、兼容基线：EdgeHTML 18

**基线定义**：Microsoft Edge 18（EdgeHTML 18，随 Windows 10 1809 发布）为**最低可运行版本**。
所有语法与 CSS 特性在该引擎下必须可用；同时天然兼容 Chromium Edge / Chrome / Firefox / Safari。

> 此前的 IE11 兼容目标已取消 —— 该目标要求退回 ES5 + `XMLHttpRequest` + `float` 布局，
> 与本次 Windows Classic 视觉实现（CSS 变量驱动的主题系统、Grid 双栏、纯 CSS 进度条动画）
> 无法共存。取消后代码可读性与可维护性显著提升。

### 1. 使用的 ES2017 能力（Edge 18 全部支持）

| 能力 | Edge 起始版本 |
| --- | --- |
| `let` / `const`、箭头函数 | Edge 12–14 |
| `async` / `await` | Edge 15 |
| `Promise`、`Object.entries`、`Array.from`、`Object.assign` | Edge 12–14 |
| `fetch` + `AbortController` | Edge 14 / 16 |
| `Element.closest`、`NodeList.forEach` | Edge 15 / 16 |
| `String.prototype.padStart`、`Number.is*` | Edge 15 / 14 |

> 以下特性**本项目并未使用**，因此无需关心其版本门槛：
> 模板字符串、解构赋值、默认参数、剩余 / 展开运算符、`Map` / `Set` / `Symbol` / `Proxy`。
> 需要时它们同样受 Edge 18 支持（Edge 12–14 起），可直接引入。

### 2. 刻意规避的语法（写了会直接 `SyntaxError`）

| 特性 | 需要版本 | 替代写法 |
| --- | --- | --- |
| 可选链 `?.` | Edge 80+ | `value == null ? '' : value` |
| 空值合并 `??` | Edge 80+ | `a == null ? b : a` |
| 可选 catch 绑定 `catch { }` | Edge 79+ | `catch (err)`（显式声明形参） |
| 对象展开 `{ ...obj }` | Edge 79+ | `Object.assign({}, obj)` |
| `Array.prototype.flat` / `flatMap` | Edge 79+ | 手写 `reduce` 递归 |
| `String.prototype.replaceAll` | Edge 85+ | `split().join()` 或全局正则 `replace` |

> 前四项属于**语法级**特性，一旦出现整个脚本都无法解析（白屏），
> 因此 `app.js` 头部注释中固定保留这份禁用清单，供后续维护对照。

**本轮新增的三个 JS 文件同样遵守上述约束**，并额外接受了一次**自动静态扫描**：
剥离注释、字符串、模板串与正则字面量后，逐一匹配 18 条禁用规则
（含 `?.`、`??`、`catch {}`、对象/数组展开、`flat`/`flatMap`、`replaceAll`、
`Array.at`、`matchAll`、`Object.fromEntries`、`Promise.allSettled`、`globalThis`、
`BigInt` 字面量、class 私有字段、动态 `import()`、模板字符串等），
`markdown.js` / `notepad.js` / `app.js` 三个文件**违规数均为 0**。

`markdown.js` 与 `notepad.js` 统一采用 `var` + IIFE + `Array.prototype.forEach.call`
的写法，不使用模板字符串与解构，确保解析器与窗口逻辑在 EdgeHTML 18 下可直接运行。

### 3. CSS 能力与规避

**可用**（Edge 18 已支持）：

| 能力 | 起始版本 |
| --- | --- |
| CSS 自定义属性 `var()` | Edge 15 |
| Flexbox | Edge 12（带前缀）→ 无前缀 |
| CSS Grid（含 `gap`、`minmax()`、`repeat()`） | Edge 16 |
| `calc()`、`vh` / `vw`、渐变、`transform`、`transition`、关键帧动画 | Edge 12+ |
| `position: sticky`、`object-fit` | Edge 16 |
| **多重背景 + `background-size: cover` / `contain` / `repeat`** | Edge 12+ （记事本壁纸适配依赖此项，早于基线即已支持） |

**刻意规避**：

| 特性 | 需要版本 | 替代方案 |
| --- | --- | --- |
| Flex 容器的 `gap` | Edge 84+ | 见下方「flex gap 替代方案」 |
| `inset: 0` 简写 | Edge 87+ | `top: 0; right: 0; bottom: 0; left: 0` |
| `:is()` / `:where()` | Edge 88+ | 展开为逗号分隔的选择器列表 |
| `:focus-visible` | Edge 86+ | 用 `:focus` + `outline-offset` 负值模拟 |
| `aspect-ratio` | Edge 88+ | 固定宽高或 `padding-top` 百分比占位 |
| `clip-path` | Edge 79+ | 播放器字形用 `border` 三角形 + `::before` 竖条拼出（见「二之三 · 按钮字形」） |
| `backdrop-filter` | Edge 79+ | 本主题为不透明实心界面，无需该特性 |
| `::-webkit-scrollbar` 滚动条定制 | Edge 79+（Chromium 内核） | EdgeHTML 下自动回退为系统原生滚动条，属预期降级 |
| `border-radius` | 支持但不用 | Windows Classic 是直角设计 |

**flex gap 替代方案**（本项目的实际做法）：

```css
/* ① 单行容器：相邻兄弟选择器加外边距。
   space-between 场景下与 gap 语义等价：
   剩余空间充足时 visual gap = F，不足时 = 设定值。 */
.viewbar > * + * { margin-left: 8px; }

/* ② 可换行容器：容器负外边距 + 子项外边距。
   容器 margin 的负值抵消子项外边距，使四边不溢出；
   行列间距 = 子项外边距 × 2。 */
.btnrow { margin: 7px -3px -3px; }   /* 上间距 = 7 + 3 = 10px */
.btnrow > * { margin: 3px; }         /* 行列间距 = 3 + 3 = 6px */
```

> 注意区分：**CSS Grid 的 `gap` 自 Edge 16 起即支持**，无需替代。
> 本项目 Grid 容器（`.ws-inner` / `.video` / `.stats` / `.bar-row` 等 10 处）全部正常使用 `gap`。

### 4. Windows Classic 视觉实现要点

| 要点 | 做法 |
| --- | --- |
| 凹凸立体边框 | `border` 双色 + `box-shadow: inset` 双层叠加，精确复刻 Win95 立体边框色值 |
| 主题系统 | 22 个 CSS 自定义属性集中在 `:root`，换肤只需改一处 |
| 分段式进度条 | 纯 CSS：`linear-gradient` 生成条纹 + `@keyframes` 位移动画，无定时器 |
| 滚动条定制 | `::-webkit-scrollbar` 系列（EdgeHTML / Chromium Edge 均有效） |
| 开始菜单竖排标题 | `transform: rotate(-90deg)` + `transform-origin: 0 0` |
| 动效降级 | 尊重 `prefers-reduced-motion`；「窗口动画效果」可关闭，关闭后直接显隐 |

**立体边框色值（Windows 系统色）：**

```
凸起 raised：外层 上/左 #dfdfdf  下/右 #000000
            内层 上/左 #ffffff  下/右 #808080
凹陷 sunken：外层 上/左 #808080  下/右 #ffffff
            内层 上/左 #000000  下/右 #dfdfdf
```

### 5. 验证方式

本项目在真实 Edge 引擎中通过 CDP（Chrome DevTools Protocol）做过如下回归验证：

| 验证项 | 结果 |
| --- | --- |
| `http://` 路径（`fetch` 读 `bili.json`） | 5 条投稿 / 6 条动态 / 5 条分区，状态栏「就绪」 |
| `file://` 路径（`<script>` 回退读 `bili.data.js`） | 同上，且 `window.BILI_DATA` 存在、`fetch` 探针确认被拦截 |
| 交互回归 | 列表/缩略图切换、模态对话框、开始菜单、最小化吸底 全部通过 |
| JS 运行时异常 | 无 |
| 元素几何量测 | 任务栏按钮 26px 单行；`.statusbar` 间距 2px；`.btnrow` / `.errorbox__foot` 行列间距 6px；`.dialog__foot` 10px；`.title-btn__glyph` 四边 0 |

**壁纸 / 记事本 / 移动端 / 播放器（本轮新增）验证：**

| 验证项 | 用例数 | 结果 |
| --- | --- | --- |
| Markdown 解析器单元测试（Node，纯函数） | 46 | 全部通过 |
| 端到端功能验证（CDP 驱动真实浏览器，覆盖 7 图标 / 3 窗口 / 3 任务栏按钮） | 73 | 全部通过 |
| 既有功能回归（确认未被破坏） | 38 | 全部通过 |
| 播放器端到端（iframe 装载 / 覆盖层对齐 / 热区拦截 / 皮肤开关 / 响应式 / 任务栏） | 100 | 全部通过 |
| 全屏缺口诊断（12 视口 × 2 窗口，窗口底 ↔ 任务栏顶净空） | 24 | 全部为 **0px** |
| EdgeHTML 18 禁用语法静态扫描（`index.html` / `app.js` / `markdown.js` / `notepad.js` / `player.js`） | — | **0 违规** |

覆盖要点：

- **解析正确性**：六级标题、有序/无序/三层嵌套列表、任务清单、行内代码、带语言角标围栏代码块、
  4 空格缩进代码块、嵌套引用、分隔线、表格对齐、自动链接、硬换行、加粗内嵌斜体。
- **注入安全**：6 项用例（`onerror`、`<script>`、`javascript:` 链接等）全部被转义或降级，无一执行。
- **窗口协同**：任务栏「最小化 / 激活 / 恢复」三语义、活动状态交还与互斥、快速开关 8 次状态一致；
  打开记事本后主窗口与记事本按钮不同时高亮（「幽灵高亮」回归用例）。
- **壁纸**：`cover` / `contain` / `tile` 三档的 `background-size` 与 `background-repeat` 实测值，
  以及图片壁纸 ↔ 纯色壁纸互切后不再残留 `wallpaper.jpg` 引用。
- **响应式**：1440 / 1920 / 900×420 / 768 / 720 / 420 / 390 / 360 共 8 档视口下
  窗口宽度不溢出、无横向滚动、壁纸保持 `cover`、工具栏可横向滚动。
- **播放器**：iframe 懒装载与真实 HTTP 请求、覆盖层与 iframe 同框（实测 Δx = 0 / Δy ≤ 1）、
  三个热区中心 `elementFromPoint` 均命中热区自身（证明点击被拦截而非穿透）、
  热区与装饰按钮几何对齐、皮肤开关切 `no-skin` 后覆盖层隐藏并回落原生控件、
  最大化时 iframe 恒 330×86 不被拉伸、任务栏按钮三语义一致。
- **全屏缺口**：`.window.is-maxed > .workspace` 弹性填充后，窗口底边在 12 档视口下
  均与任务栏上沿重合（净空 0px），工作区高度随视口实时变化而非固定魔法常量。
- **既有功能回归**：桌面 7 个图标、6 + 4 个菜单、三条记事本入口、主窗口工具栏与托盘时钟、
  打印媒体下窗口隐藏。

---

## 八、已知限制

1. **B 站风控**：机房 IP（含 GitHub Actions）请求 `space/arc/search` 等接口可能返回
   `-352`（风控）/ `-412`（拦截）/ `-799`（限流）。脚本已做重试 + 降级 + 旧数据保留，
   配置 `BILI_COOKIE` 可明显改善。
2. **动态接口需登录**：`polymer/web-dynamic/v1/feed/space` 自 2023 年起基本要求登录态。
   未携带 Cookie 时，脚本会**用本次抓到的投稿合成「投稿了视频」动态**（附一条账号资料快照），
   保证前端始终有动态可展示；携带 Cookie 后会自动改用真实动态。
3. **`upstat` 累计数据为空**：`x/space/upstat` 对游客返回 `data: {}`，
   因此「播放 / 获赞」在未配置 Cookie 时显示 `—`。投稿数、粉丝、关注不受影响。
4. **封面图直连 B 站 CDN**：`i0/i1/i2.hdslb.com` 为直连资源（非接口调用），
   已加 `referrerpolicy="no-referrer"` 并实现 `onerror` 占位降级；
   若图片被拦截会显示斜纹占位块，不影响文字信息。
5. **GitHub 定时任务延迟**：`schedule` 在高峰期可能延迟数分钟至数十分钟；
   仓库连续 60 天无活动时定时任务会被自动暂停，需手动触发一次以恢复。
6. **浏览器基线为 EdgeHTML 18**：低于该版本的浏览器（IE11 及更早、Edge 17 及更早）不受支持，
   可能出现布局错乱或脚本无法解析。若确实需要覆盖 IE11，需回退到 ES5 + `XMLHttpRequest` +
   `float` 布局的另一套实现，无法与本版本共用样式。
7. **`file://` 离线预览依赖 `bili.data.js`**：首次克隆仓库后若尚未运行抓取脚本，
   直接双击 `index.html` 会弹出「无法加载数据源」对话框。运行一次
   `python scripts/fetch_bili.py` 即可生成该文件。
