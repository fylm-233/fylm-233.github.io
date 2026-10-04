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
│   ├── player.js                    ← 媒体播放器窗口（原生 HTMLAudioElement 播放，挂 window.WinPlayer）
│   ├── audio/
│   │   └── dreamy-noise.mp3         ← 内置音源（12.92 MB，与页面同源，无跨域限制）
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
- 模态消息框（信息 / 警告 / 错误三种图标；**可拖动标题栏移动，且跟随父窗口联动**）
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

## 二之三、媒体播放器窗口（原生音频 + Windows 3.1 控件）

一个与主窗口、记事本并列的独立窗口，外观对齐 **原生 Windows「媒体播放机」**
（标题栏 → 单行菜单栏 → 细长刻度条 → 底部传输按钮排），
音频由页面**自带的本地文件**经 `<audio>` 播放。

### 1. 为什么放弃 iframe：跨域是死路

此前的实现内嵌网易云外链播放器，并叠加一层视觉覆盖层。该方案有**不可回避**的结构性缺陷：

| 缺陷 | 原因 |
| --- | --- |
| 无法真实控制播放 | iframe 位于 `music.163.com`，与本站不同源；父文档拿不到 `contentDocument`，`postMessage` 对方亦未声明接受 |
| 进度条只能是假的 | 读不到 `currentTime`，只能用自驱计时器模拟，与真实播放位置必然漂移 |
| 点击拦截不完整 | 覆盖层热区只能覆盖有限的几个按钮，iframe 内其余区域（歌词、音量、链接）依然会响应 |
| 外观无法像素级一致 | 原生控件的内边距、字体、hover 态由对方页面决定，覆盖层只能「盖住」，不能「改造」 |

**结论**：在纯前端、无反向代理的前提下，「把跨域 iframe 改造成经典控件」
不可能真正实现。因此在本次修订中**彻底移除 iframe**，
改为播放页面自带的音频文件——所有控件从此作用于**真实**的播放状态。

### 2. 当前架构

```
#winMp                              播放器窗口（独立窗口，走 window.WinWM）
└── .mp-workspace                   工作区（可滚动）
    └── .mp-stage                   舞台
        ├── <audio id="mpAudio">    真实音频引擎，src=assets/audio/dreamy-noise.mp3
        ├── .mp-scalerow            刻度条行
        │   ├── .mp-spin × 2        两端三角微调按钮（±5 秒）
        │   └── .mp-scale           刻度条本体（role="slider"，可拖动 seek）
        ├── .mp-readout             读数（00:00 / 04:04 + 曲目名）
        ├── .mp-pad                 传输按钮排（9 个按钮 + 2 个分隔符）
        ├── #mpVolPanel             音量面板（hidden 切换）
        └── #mpListPanel            播放列表面板（默认展开，hidden 折叠）
```

### 3. 全部控件都是真实值

音频与页面**同源**（`assets/audio/dreamy-noise.mp3`），因此不存在任何跨域限制。
所有交互直接读写 `HTMLAudioElement`：

| 控件 | 绑定的真实属性 / 方法 | 事件 |
| --- | --- | --- |
| 播放 / 暂停 | `play()` / `pause()` | `play` / `pause` |
| 停止 | `pause()` + `currentTime = 0` | — |
| 刻度条拖动 | 读写 `currentTime`（按 `duration` 换算比例） | `timeupdate`（拖动期间用 `st.scrubbing` 抑制覆写） |
| 时间读数 | `currentTime` / `duration` | `timeupdate` / `loadedmetadata` / `durationchange` |
| 快进 / 后退 | `currentTime += ±5` | — |
| 跳到首 / 尾 | `currentTime = 0` / `duration` | — |
| 音量滑杆 | `volume`（0–1） | `volumechange` |
| 静音 | `muted` | — |
| 循环 | `loop` | `ended`（未循环则停在末尾） |

`duration` 在 `loadedmetadata` 前为 `NaN`，此时界面显示 `--:--`，
拖动刻度条会被安全忽略（`if (d <= 0) return;`）。

### 4. 滑杆的统一实现（鼠标 / 触摸 / 键盘三通道）

刻度条与音量条共用 `bindSlider(el, onRatio, onStart, onEnd)`：

- **鼠标**：`mousedown` → 在 `document` 上挂 `mousemove` / `mouseup`
  （而非在元素上挂 `mousemove`，这样拖出元素范围也不会断开）
- **触摸**：`touchstart` / `touchmove` / `touchend`，配合 `passive: false` 以允许 `preventDefault`
- **键盘**：`ArrowLeft/Up` 步进 ±2%，`ArrowRight/Down` 步进 ±2%，`Home` / `End` 到两端

拖动期间置 `st.scrubbing = true`，`timeupdate` 处理器会跳过 UI 渲染，
避免音频推进把用户正在拖动的滑块"拽回去"。

### 5. 按钮图标全部用 SVG 矢量图（几何即所见）

播放 / 暂停 / 停止 / 首 / 前 / 后 / 末 / 出仓 / 循环 / 喇叭（含静音）
共 11 个图标，以及进度条与音量条的拖动旋钮，
**全部由内联 SVG `<symbol>` + `<use>` 画成，不再使用 `border` 三角形或任何字符字形**。

**为什么换掉 border 三角形**：`border` 三角形是「用边框伪装成图形」的 hack ——
元素的 **border box 与可见墨迹不重合**，多部件字形（`⏮` = 竖条+三角、`◀◀` = 两三角）
必须手推 `--gx` / `--gw` 才能居中，且 **sub-pixel 取整会随容器尺寸漂移**。
实测到的两个真实缺陷：旧版 `⏭` 被按钮右缘裁切、`⏏` 整体右偏 5px。
SVG 有确定的 `viewBox`，**几何即所见**，`preserveAspectRatio` 默认等比缩放，
居中与稳定性**由坐标系保证**，CSS 无需任何偏移补偿。

**图标精灵表**：15 个 `<symbol>` 集中定义在 `index.html` 顶部的
`<svg class="mp-sprite">`（`width/height:0`，不进布局），引用处写
`<use href="#mp-i-xxx" xlink:href="#mp-i-xxx"/>`。
**两条引用都写**：EdgeHTML 18 只认 `xlink:href`，现代浏览器认 `href`。

**三个几何硬约束**（对应用户提出的三条要求）：

1. **严格居中**：所有 symbol 共用 `viewBox="0 0 24 24"`，图元画在以 `(12,12)` 为心的
   对称范围内 → 图形几何中心恒等于 viewBox 中心。容器侧用
   `.mp-ico { position:absolute; top:0; right:0; bottom:0; left:0; margin:auto; }`
   把 SVG 盒子居中 → **图标中心恒与容器中心重合**，误差 0（实测 `|off| = 0.000px`）。
2. **容器宽高变化时不漂移**：居中由「四边归零 + `margin:auto`」完成，
   与容器宽高**解耦**；缩放由 `width/height: calc(var(--ico-size) * var(--ico-scale,1))`
   驱动，`--ico-scale` 只改系数，**不改中心**。
3. **不同尺寸下几何比例一致**：每个图标只声明一个 `--ico-size`（设计尺寸），
   缩放统一乘以 `--ico-scale`。窄视口只需改 `.mp-tbtn { --ico-scale: 0.9 }` 一处，
   全部图标**等比**缩小，且**恒为正方形**（实测 14×14 → 12.594×12.594，w==h）。

**旋钮（进度条 / 音量条）**：`viewBox="0 0 12 22"`，CSS 显式写 `width:7px; height:12.83px`
（= 7px × 22/12，与 viewBox 同比，故**不需要** `preserveAspectRatio="none"`，图形不失真）。
定位用 `top:50%; left:<百分比>; transform:translate(-50%,-50%)`：
`left` 是**百分比锚点**（随轨道长度线性伸缩），`translate` 让旋钮**以自身中心对齐锚点**，
**与旋钮尺寸、与轨道高度都无关**。
（这里不能用 `margin:auto` —— 要的是「锚点居中」而非「容器居中」。
也不能用 `top:1px; bottom:1px` 拉伸 —— 高度由内容驱动时会过约束，实测中心上偏 2.586px。）

**SVG 元素的 `className` 是只读的**：`SVGElement.className` 返回 `SVGAnimatedString`
（只有 getter），`el.className = '...'` 会抛 `TypeError` 并**中断整段初始化**。
改类名一律走 `setAttribute('class', ...)`，见 `player.js` 的 `setSvgClass()`。
`▶` / `⏸` 与喇叭图标的切换只改 `<use>` 的 `href`，**不动盒子尺寸**，
尺寸档位由类名（`mp-ico--play` / `mp-ico--pause` / `mp-ico--vol`）负责。

### 6. 打开播放器的四条入口

1. 桌面图标 **媒体播放机**
2. 菜单栏 `工具(T) → 打开媒体播放器…`
3. 开始菜单 → 媒体播放机
4. 任务栏按钮（打开后出现；语义与其他窗口一致：非活动→激活，已活动→最小化）

### 7. 播放器内的菜单（对齐参考图的五菜单结构）

| 菜单 | 项 | 说明 |
| --- | --- | --- |
| **文件(F)** | 打开音乐文件… / 重新载入本曲 / 在目录中查看本曲 / 关闭(C) Esc | 「重新载入」回到开头并重新计次 |
| **编辑(E)** | 复制曲名 / 回到开头 | 复制走 `navigator.clipboard`，含 `execCommand` 兜底 |
| **设备(D)** | 扬声器（默认输出）✓ / 音量控制… | 勾选态反映 `muted`；「音量控制…」展开音量面板 |
| **刻度(S)** | 时间 ✓ / 曲目 | 互斥勾选，切换读数区的分隔符与状态栏措辞 |
| **帮助(H)** | 关于媒体播放机… | 弹窗说明真实播放能力与键盘快捷键 |

### 7. 工具栏、初始状态与自动播放

工具栏三个开关：**音量**（展开 `#mpVolPanel`）、**列表**（展开 `#mpListPanel`）、**帮助**。

**初始状态**：播放列表**默认展开**（`#mpListPanel` 不带 `hidden`，工具栏「列表」按钮初始即
`is-on` + `aria-pressed="true"`）。理由：原生播放机打开窗口即可看到全部曲目，不会把列表
藏在开关后面。工具栏按钮用于**折叠**它，状态由 `setListPanel()` 单点维护。

**自动播放**：页面加载后，音频在**后台**自动开始播放第一首，无需用户点击；播放器窗口
**不会**自动弹出（按产品决定，保持由任务栏图标唤起）。

触发时机同时监听 `loadedmetadata` **与** `canplay`，并在初始化时探测 `readyState >= 1`
补触发一次。原因：`<audio preload="metadata">` 往往在页面脚本执行**之前**就已完成元数据
加载，若只绑事件而不做补触发，首次自动播放会稳定地「错过事件窗口」而静默失败。实现见
`tryAutoplay()` / `onAudioReady()`，有两条硬约束：

1. **只尝试一次**（`st.autoAttempted`）。若每次事件都重新拉起播放，用户按下的「暂停」会被
   下一次事件覆盖掉，按钮形同失效。
2. **用户已交互则放弃**（`st.userInteracted`）。**所有**传输按钮（`bindPress` 统一处理）、
   `togglePlay()` / `stop()` / `seekTo()` 都会置位该标记——用户表达过意图后，自动播放不再
   抢方向盘。

**被浏览器策略拒绝时的两级兜底**（Chromium / Safari / Firefox 默认会拦截非静音自动播放）：

1. **静音兜底**（`onAutoplayRejected()`）：先以 `muted` 方式 `play()`。浏览器对静音自动播放
   **无手势要求，必定成功**。状态栏提示「已静音播放（点击取消静音）」。
2. **首次手势重试**（`onFirstGesture()`）：监听 `document` 的 `pointerdown` / `keydown` /
   `touchstart`（`once` + `passive`）。用户在页面上的第一次点击/按键/触摸即自动解除静音并
   恢复有声播放，无需专门去找播放按钮。若此前已处于静音兜底态，只需改写 `muted` 标志，
   音频本就在播，不必再调一次 `play()`。

> **验证注意**：`Emulation.setAutoplayPolicy` 在本机 Edge 构建中**不存在**（返回 `-32601`），
> 无法通过 CDP 切换策略。要复现「被拒」路径，可用 `Page.addScriptToEvaluateOnNewDocument`
> 在文档脚本执行前替换 `HTMLMediaElement.prototype.play`，对非静音调用返回
> `NotAllowedError` 拒绝、静音调用放行。`autoplay-verify.js` 即用此法覆盖该分支。

**传输按钮排的间距与图标系统**（`classic.css` 15c 章节）：

- 间距用**相邻兄弟选择器**而非容器 `gap`——flex 容器的 `gap` 需 Edge 84+，本项目基线是
  EdgeHTML 18。按钮↔按钮 3px（`.mp-tbtn + .mp-tbtn`），分隔符左右各 5px（分隔符自带
  `margin: 0 5px`）。**规则必须拆成两条写**：`.mp-pad__sep + .mp-tbtn { margin-left: 0 }` 与
  `.mp-tbtn + .mp-pad__sep` 若并列进同一个块，会把分隔符自己的 `margin-left` 也清零，
  使「按钮—分隔符」塌成 0px。
- 首位按钮无左外边距、末位按钮无右外边距，整排左右两端与 `.mp-pad` 内边距对齐。

**图标尺寸由两个变量驱动**（`--ico-size` 声明在每个 `.mp-ico--*` 上，`--ico-scale` 由容器给）：

| 变量 | 含义 | 说明 |
| --- | --- | --- |
| `--ico-size` | 图标设计尺寸 | 每个图标一个值：play 14 / stop 13 / pause 14 / first 16 / prev 17 / fwd 17 / last 16 / eject 16 / loop 15 / vol 16 / caret 9 |
| `--ico-scale` | 容器给的缩放系数 | 默认 1；窄视口 `.mp-tbtn` 置 0.9 |
| `--tbtn-w` / `--tbtn-h` | 按钮外框尺寸 | 27px / 22px（窄视口 25px / 21px） |

尺寸写法 `calc(var(--ico-size) * var(--ico-scale, 1))` ——
**只改 `--ico-scale` 一个系数，11 个图标即等比缩放**，无需为任何图标单写媒体查询。
实测：`--ico-scale:1` → play `14×14`；`--ico-scale:0.9` → play `12.594×12.594`
（**恒为正方形**，`w == h`）。

**图标设计的四条硬约束**（每条都对应一个已修的真实缺陷）：

1. **所有 symbol 共用 `viewBox="0 0 24 24"`，图元画在以 `(12,12)` 为心的对称范围内**。
   这是「严格居中」的**唯一**依据：图形几何中心 = viewBox 中心 = 容器中心。
   旧版 `⏏` 因主元素 border box 与墨迹错位而右偏 5px，即因为缺少这个全局坐标系。
2. **复合图标内部间隙写死在 symbol 的 `d` 里**，不再用变量拼。`#mp-i-prev`（`◀◀`）的两个
   三角之间留有明确间隙（旧版间隙为 0，被读成一支宽箭头）。
3. **`fill` 只写一次**：`.mp-ico { fill: currentColor }`，各 symbol 的实心图元不写 `fill`
   即继承；只有描边类图元（喇叭的弧、循环的箭头）显式写 `fill="none" stroke="currentColor"`。
4. **`▶` / `⏸` / 喇叭的切换只换 `<use>` 的 `href`**，符号盒尺寸由类名单独控制，
   切换瞬间**盒子不变 → 图标不会跳大小**。旧版整体改写 `className` 会连带换掉尺寸补丁。

**几个必须记住的坑**：

- **SVG 元素的 `className` 是只读的**（`SVGAnimatedString`）。`el.className = 'x'` 抛
  `TypeError: Cannot set property className of #<SVGElement> which has only a getter`，
  且会**中断整段 `player.js` 初始化**（表现是窗口 `display:none`、`WinPlayer` undefined）。
  一律用 `setAttribute('class', ...)`（封装为 `setSvgClass()`）。
- **`getComputedStyle(el).getPropertyValue('--ico-size')` 返回声明值**（如 `calc(...)`），
  `parseFloat` 会得到垃圾数字。要拿解析后的像素值，挂探针元素继承变量、读
  `getBoundingClientRect().width`。
- **量测前必须先 `WinPlayer.pause()` 复位**：`#mpBtnPlay` 的 `<use>` 在播放态会切到
  `#mp-i-pause`，否则「▶ 是不是居中」会量到 ⏸ 上。
- **`/json/new` 在部分 Edge 构建要求 `PUT` 而非 `POST`**，用 `POST` 会返回
  `Using unsafe HTTP verb POST`。
- **量测前必须先 `WinPlayer.open()`**：播放器窗口默认隐藏（见 §7 自动播放节），
  窗口 `display:none` 时所有子元素 rect 退化为 0，`0-0=0` 会让「居中」断言**假通过**。
  验证脚本必须显式断言容器 `w>0 && h>0`。


### 8. 键盘快捷键

| 键 | 行为 |
| --- | --- |
| `空格` | 播放 / 暂停（焦点不在按钮/链接/输入框，也不在滑杆上时才响应） |
| `←` / `→` | 后退 / 前进 5 秒 |
| `Home` / `End` | 回到开头 / 跳到结尾 |
| `Esc` | 最小化窗口（焦点在滑杆上时先 `blur` 滑杆，不关窗） |

### 9. 曲库与音频资源

`player.js` 顶部的 `TRACKS` 数组声明曲库，当前为单曲：

```js
var TRACKS = [
  { id: 'dreamy-noise', title: 'Dreamy Noise', artist: 'ゆうかなで',
    file: 'assets/audio/dreamy-noise.mp3', duration: 0 },
];
```

`duration: 0` 是占位值，真实时长在 `loadedmetadata` 事件里回填。
数组结构与 `loadTrack(i)` / `renderList()` 已按多曲设计，
未来追加曲目只需往 `TRACKS` 里增加条目并把音频文件放进 `assets/audio/`。

音频文件 `assets/audio/dreamy-noise.mp3` 为 **12.92 MB**，
远低于 GitHub 单文件 100 MB 硬限与 50 MB 警告阈值。

> **注意（两个真实的坑）**：
>
> 1. **`file://` 协议**：部分浏览器会拦截本地音频加载。请改用本地 HTTP 服务。
> 2. **`python -m http.server` 无法支持拖动跳转**：`SimpleHTTPRequestHandler`
>    **不实现 HTTP `Range` 请求**（对 `Range: bytes=0-99` 仍返回 `200` + 完整文件，
>    不带 `Accept-Ranges` / `Content-Range`）。此时 `<audio>.seekable` 恒为 `[0, 0]`，
>    Chromium 会**静默拒绝**所有 `currentTime` 赋值并夹回 0——**进度条 UI 会正常移动
>    （因为它先于赋值更新），但音频不会跳转**，这是一个极难定位的陷阱。
>
>    验证 seek 功能时请改用自带 Range 支持的服务器（本项目验证用的 `range_server.py`
>    实现了 `206 Partial Content` + `Content-Range`，约 100 行）。
>    **线上 GitHub Pages 由 CDN 承载，原生支持 Range，故线上跳转正常。**

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
| **≤ 720px** | 任务栏降为 30px；窗口外边距收紧；行号槽变窄；标题栏按钮加大到易点尺寸；托盘图标隐藏；任务按钮改为紧凑标签；**记事本工作区改为有界高度**（见下） |
| **≤ 480px** | 播放器窗口宽度改为 `100%`，工作区高度 226px，按钮收窄到 25px，隐藏读数区的曲目名 |
| **≤ 420px** | 外边距进一步收紧；工具栏改为横向滚动（不换行、不溢出）；状态栏右侧信息隐藏 |
| **横屏矮视口**（`max-height: 520px`） | 窗口高度改由视口驱动，工作区内部滚动，避免窗口被裁切；播放器工作区高度降到 196px |

壁纸在全部断点下均保持 `cover` 填充，不会出现拉伸变形或留白。
播放器窗口最大化时，工作区用 `flex: 1 1 auto; min-height: 0` 吸收剩余高度，
刻度条与按钮排保持原尺寸不被拉伸（`min-height: 0` 是消除全屏缺口的关键）。

### 记事本在窄屏上的「滚动容器」问题（已修复）

**曾经的缺陷**：手机上打开记事本后，长 Markdown 内容**完全无法上下滑动**。

**根因（实测数据，非推测）**：≤720px 断点里原本给 `.np-workspace` 设了
`height: auto`，于是工作区随内容**无限撑高**：

| 容器 | 修复前 | 修复后 |
| --- | --- | --- |
| `#winNp` 窗口高 | **2445px**（远超 844px 视口） | 774px |
| `#npWorkspace` 高 | **2325px** | 654px |
| `.np-pane--preview` | client 2311 / scroll 2311 → **不可滚动** | client 640 / scroll 2311 → **可滚动** |

这形成**双重死锁**：① 工作区被撑到与内容等高，内部面板永不产生溢出
（`scrollHeight === clientHeight`），滚动容器形同虚设；
② 超高窗口又被外层 `.desktop` 的 `overflow: hidden` 裁掉，内容彻底不可达。
更隐蔽的是，`overflow: hidden` 的祖先会**吞掉触摸滚动手势**——
桌面端鼠标滚轮尚能作用于 `html` 绕过去，触摸手势却绑定在命中元素的滚动链上，
被截断后无处可去。**这就是「同一页面桌面能滚、手机不能滚」的成因。**

**修复（仅 `classic.css`，3 处）**：

1. **给工作区有界高度**，把「滚动」交还给内部面板：
   ```css
   @media (max-width: 720px) {
     .np-workspace {
       height: calc(100vh - 190px);    /* ① 安全基线，全内核可解析 */
       height: calc(100dvh - 190px);   /* ② 支持者覆盖；不支持者整条丢弃 → 退回 ① */
       min-height: 220px;              /* 矮视口不塌陷 */
     }
   }
   ```
   > 两条 `height` 是**有意的渐进增强**（声明级回退），不是笔误。
   > 移动端地址栏收放会让 `vh` 跳变，`dvh` 是动态视口高，专门解决这个；
   > 但**必须先写 `vh` 再写 `dvh`**，顺序颠倒会让不支持的内核拿到无效值。

2. **滚动容器显式声明触摸行为**：
   ```css
   .np-pane--preview { touch-action: pan-y;      -webkit-overflow-scrolling: touch; }
   .np-editor        { touch-action: pan-x pan-y; -webkit-overflow-scrolling: touch; }
   ```
   编辑器保留 `pan-x`，因为 `wrap="off"` 时长行需要横向滚动。

3. **刻意不用 `overscroll-behavior`**：该属性需 Edge 63+ / Chromium 内核，
   本项目基线 EdgeHTML 18 会**整条丢弃**（静默无效）。边界收口改由
   `touch-action` + 容器 `overflow` 完成，实测等效且全基线可用。

**验证**（Chromium 无头 + CDP **真实触摸事件序列**，非 `scrollTop` 赋值）：

| 套件 | 用例 | 结果 |
| --- | --- | --- |
| 触摸滚动端到端（上滑 / 下滑 / 边界不外泄 / 滚轮 / 编辑器） | 16 | 全部通过 |
| 触摸场景多视口（桌面 / 平板 / 手机竖 / 手机横 / 超窄 / 矮屏） | 54 | 全部通过 |
| 惯性滚动轨迹（松手后 +316px、17 段连续递增采样） | 1 | 惯性已证实 |

线上 `https://fylm-233.github.io/` 在 390×844 移动视口下重跑端到端套件亦为 **16/16**。

---

## 二之六、模态对话框的拖动与父窗口联动

**曾经的缺陷**：「关于媒体播放机」等模态框**完全无法移动**——标题栏看着像
Windows 对话框的标题栏（有蓝色渐变、能点），但没有任何拖动逻辑，位置被
`left: 50%` + `margin-left: -200px` 死死钉在视口中央。

### 1. 定位模型的改造（关键前置）

原样式用「百分比 + 负 margin」居中：

```css
.dialog { position: fixed; left: 50%; margin-left: -200px; }
```

这套写法**与像素级拖拽天然冲突**：`left` 是百分比，拖拽要写像素；
一旦把 `left` 改成 `400px`，`margin-left: -200px` 仍在生效，实际位置会再左偏 200px。

**改造**：首次打开时把「居中结果」固化成像素 `left/top`，并加上 `.dialog--placed`
把 `margin-left` 归零。此后 `left/top` 就是**拖拽的唯一真值来源**。
每次打开都重做一次（先清内联样式让 CSS 居中规则重新生效，再固化），
因此**重开时不会残留上次被拖到的位置**。

```css
.dialog--placed { margin-left: 0; }
```

### 2. 拖动实现

与窗口拖拽同构（`mousedown` / `mousemove` / `mouseup` + 触屏三件套），
但因为是 `position: fixed`，`left/top` **直接就是视口坐标**，无需像应用窗口那样
减去 `#desktop` 的原点偏移：

```js
dlg.style.left = (p.x - dlgOffX) + 'px';
dlg.style.top  = (p.y - dlgOffY) + 'px';
```

把手是 `.dialog__title`（`cursor: move`）；拖动中给对话框加 `.is-dragging`，
顺带禁掉正文的文本选中（`user-select: none`），否则会拖出一片蓝色选区。

### 3. 三条边界与联动规则

| 场景 | 行为 |
| --- | --- |
| **拖出视口** | `clampDialog()` 强制保留 **24px 可见**：水平 `left ∈ [-(w-24), vw-24]`，垂直 `top ∈ [0, vh-24]`（标题栏必须留出，否则拖丢了就再也点不到） |
| **父窗口移动** | 播放器 `dragMove()` 里调用 `WinDialog.syncOwner()`，对话框重新夹回视口 |
| **父窗口最小化 / 关闭** | 对话框**一并收起**，不留孤儿框 |
| **父窗口最大化 / 还原** | 重新夹回视口；最大化状态下依然可以自由拖动 |

### 4. 为什么必须用 `MutationObserver`

联动最初写在各个调用点（`hide()`、`toggleMax()`、`dragEnd()`）里同步检查
「父窗口是否还有尺寸」。**但播放器的最小化在开启动画时是异步的**——
`hide()` 里先播 240ms 缩小动画，动画结束才加 `.is-hidden`。
于是同步检查那一刻父窗口**仍然可见**，判定为「无需收起」，
对话框就变成了孤儿。

**对策**：观察父窗口的 `class` 变化，在状态**真正落地**时再判定：

```js
dlgOwnerObserver = new MutationObserver(() => syncDialogWithOwner());
dlgOwnerObserver.observe(ownerEl, { attributes: true, attributeFilter: ['class', 'style'] });
```

这样联动与动画时长**完全解耦**——无论谁、以何种方式把窗口隐藏，对话框都能跟上。
`attributeFilter: ['style']` 同时覆盖了「父窗口被拖动」的情形。

> **注意**：`notepad.js` 有一份**自己实现的** `infoDialog()`（不走 `showDialog`），
> 起初因此完全没有落位与拖动能力。现改为在开框后调用 `WinDialog.place(dlg, #winNp)`
> 复用同一套逻辑。

### 5. 实测（29 + 8 断言全通过）

| 用例 | 结果 |
| --- | --- |
| 拖动标题栏 → 位置改变，方向正确 | ✅ |
| 向右 / 向下拖出屏幕 → 夹回，标题栏可见 | ✅ |
| 向左上拖出屏幕 → 仍留 24px 可见 | ✅ |
| 父窗口移动 → 对话框仍在视口内 | ✅ |
| 父窗口最小化（含 240ms 动画）→ 对话框收起 | ✅ |
| 最大化 / 还原 → 对话框在视口内，且仍可拖动 | ✅ |
| 关闭 → 重开 → 回到默认居中，无位置残留 | ✅ |
| 记事本对话框同样可拖动、最小化时收起 | ✅ |

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
| `clip-path` | Edge 79+ | 播放器全部 11 个图标改用内联 SVG `<symbol>` + `<use>`（见「二之三 · 第 5 节」），不依赖 `clip-path` |
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
| 播放器端到端（音频装载 / 播放暂停 / seek / 音量 / 静音 / 循环 / 面板开关 / 刻度语义 / 键盘 / 响应式 / 任务栏 / 全屏缺口） | 90 | 全部通过 |
| 播放器按钮排几何（图标严格居中 / 间距均匀 / 无裁切 / 无尾距 / 默认展开列表 / 自动播放 / 暂停保持 / 窄视口） | 38 | 全部通过 |
| 播放器 SVG 图标几何（居中 / 等比 / viewBox 统一 / 引用合法 / 旋钮对齐 / 多视口不漂移） | 109 | 全部通过 |
| 模态对话框拖动与父窗口联动（拖动 / 夹回视口 / 父窗口移动·最小化·最大化·还原 / 重开无残留） | 29 | 全部通过 |
| 记事本对话框拖动（拖动 / 夹回 / 最小化收起） | 8 | 全部通过 |
| 记事本 + 主窗口回归（含 XSS 安全、壁纸、打印、快速开关稳定性） | 38 | 全部通过 |
| 记事本触摸滚动端到端（有界高度 / 上滑 / 下滑 / 边界不外泄 / 滚轮兼容 / 编辑器） | 16 | 全部通过 |
| 记事本触摸滚动多视口（桌面 / 平板 / 手机竖 / 手机横 / 超窄 / 矮屏 × 有界·可滚·不裁剪·最大化） | 54 | 全部通过 |
| 记事本惯性滚动轨迹（松手后位移 + 连续递增采样） | 1 | 惯性已证实 |
| 桌面端到端（图标 / 窗口 / 任务栏 / 响应式 / 无 JS 错误） | 73 | 全部通过 |
| 全屏缺口诊断（12 视口 × 2 窗口，窗口底 ↔ 任务栏顶净空） | 24 | 全部为 **0px** |
| EdgeHTML 18 禁用语法静态扫描（`index.html` / `app.js` / `markdown.js` / `notepad.js` / `player.js` / `classic.css`） | — | **0 违规** |

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
- **触摸滚动**：手机上（390×844）用 CDP 派发**真实触摸事件序列**（`Input.dispatchTouchEvent`）
  验证上滑 / 下滑均能改变 `scrollTop`，松手后有惯性减速曲线；滚到边界后**不外泄**到外层
  （`window.scrollY` 与窗口位置均不变）；同时保留桌面鼠标滚轮与拖动滚动。
  6 档视口（桌面 / 平板 / 手机竖 / 手机横 / 超窄 / 矮屏）下窗口高度均有界、不超视口、
  不被 `.desktop` 的 `overflow:hidden` 裁剪，最大化后依旧可滚。
- **播放器**：`<audio>` 真实装载与 `loadedmetadata` 回填时长、`play()` / `pause()` 改变
  `paused` 与派生字形、拖动刻度条写入 `currentTime` 且与 `timeupdate` 不互踩、
  音量滑杆写入 `volume`、静音切换 `muted` 并同步菜单勾选态、循环切换 `loop`、
  音量/列表面板开合与工具栏按钮 `aria-pressed` 一致、任务栏按钮三语义一致。
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
