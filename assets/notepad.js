/* ==========================================================================
   notepad.js — 记事本窗口（Markdown 渲染 / 源码编辑）  v1
   --------------------------------------------------------------------------
   兼容目标：EdgeHTML 18（Edge 18 / Windows 10 1809）及以上

   职责边界（保持与 app.js 解耦）
     · app.js 负责主窗口（哔哩哔哩）的窗口管理、数据加载
     · 本文件负责记事本窗口的窗口管理、Markdown 渲染与源码编辑
     · 两者通过 window.WinNotepad 暴露的 open() 接口通信，互不侵入内部状态
     · 桌面图标点击 / 菜单项「打开记事本」/ 任务栏按钮统一走本模块

   窗口模型
     记事本的显示状态分为「关闭(is-hidden)」与「显示」两态。
     与主窗口一致：点任务栏按钮切换显示/最小化；点关闭按钮进入关闭态。
     采用与应用窗口相同的视觉与交互（拖拽、最大化、最小化动画）。

   规避的 ES 语法（EdgeHTML 18 会直接语法报错）
     可选链 ?. · 空值合并 ?? · 可选 catch 绑定 · 对象展开 · Array.flat ·
     String.replaceAll · String.prototype.at · Promise.allSettled（可用但未用）
   ========================================================================== */
(function (global) {
  'use strict';

  if (!global.WinMD) {
    /* markdown.js 未加载时直接退出，由 app.js 给出用户提示 */
    return;
  }

  var MD = global.WinMD;
  var $ = function (id) { return document.getElementById(id); };

  /* ======================================================================
     1. 占位示例文档
     ----------------------------------------------------------------------
     启动时若没有外部文档，就用这段内容初始化，覆盖全部必需语法，
     以便用户一打开就能看到各语法的渲染效果。
     ====================================================================== */
  var SAMPLE_DOC = [
    '# 欢迎使用记事本',
    '',
    '这是 **Windows Classic 风格记事本**，可直接渲染 Markdown（`.md`）文件。',
    '打开页面时若未载入文档，会自动生成这份 *占位示例* 供你参考。',
    '',
    '---',
    '',
    '## 一、标题层级（一到六级）',
    '',
    '# 一级标题 `#`',
    '## 二级标题 `##`',
    '### 三级标题 `###`',
    '#### 四级标题 `####`',
    '##### 五级标题 `#####`',
    '###### 六级标题 `######`',
    '',
    '## 二、基础排版',
    '',
    '支持 **加粗**、*斜体*、~~删除线~~ 与 `行内代码`，也可以混排：',
    '**加粗里嵌 *斜体* 与 `code`** 都能正确解析。',
    '',
    '硬换行：行尾加两个空格  ',
    '这一行就会另起一行。',
    '',
    '### 2.1 有序列表',
    '',
    '1. 第一项：读取 Markdown 文本',
    '2. 第二项：按块级语法切分',
    '3. 第三项：逐块渲染为 HTML',
    '   1. 嵌套有序列表',
    '   2. 缩进三个或四个空格即可',
    '4. 第四项：输出到预览面板',
    '',
    '### 2.2 无序列表（含嵌套）',
    '',
    '- 标题：一到六级（`#` 至 `######`）',
    '- 列表：有序 / 无序 / 嵌套',
    '  - 这是嵌套的第二层',
    '    - 这是嵌套的第三层',
    '- 代码：行内与代码块',
    '- 链接、图片、引用、分隔线',
    '',
    '## 三、代码块',
    '',
    '带语言标识的围栏代码块会在左上角显示语言标签：',
    '',
    '```js',
    '// 渲染入口：把 Markdown 文本转成 HTML',
    'function render(mdText) {',
    "  return WinMD.render(mdText);",
    '}',
    '```',
    '',
    '不带标识时同样可以正常高亮容器：',
    '',
    '```',
    'npm run preview   # 启动本地预览',
    'python -m http.server 8765',
    '```',
    '',
    '缩进四个空格也可作为代码块（无围栏写法）：',
    '',
    '    <div class="window">',
    '      <div class="title-bar">经典的标题栏</div>',
    '    </div>',
    '',
    '## 四、引用与分隔线',
    '',
    '> **提示**：记事本窗口独立于主窗口，',
    '> 可通过任务栏在两者之间来回切换。',
    '>',
    '> 引用块内部同样支持列表：',
    '>',
    '> - 引用里的第一项',
    '> - 引用里的第二项',
    '>',
    '> > 引用还可以嵌套引用。',
    '',
    '---',
    '',
    '## 五、链接与图片',
    '',
    '行内链接：[哔哩哔哩个人空间](https://space.bilibili.com/11897608 "打开 B 站")，',
    '裸链接会自动识别：https://github.com/',
    '',
    '图片示例（使用内联 SVG，无需额外请求）：',
    '',
    '![示例图片](data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20width%3D%27320%27%20height%3D%27120%27%3E%3Crect%20width%3D%27320%27%20height%3D%27120%27%20fill%3D%27%23c0c0c0%27%2F%3E%3Crect%20x%3D%274%27%20y%3D%274%27%20width%3D%27312%27%20height%3D%27112%27%20fill%3D%27%23ffffff%27%20stroke%3D%27%23000080%27%20stroke-width%3D%272%27%2F%3E%3Ctext%20x%3D%27160%27%20y%3D%2766%27%20font-family%3D%27monospace%27%20font-size%3D%2716%27%20fill%3D%27%23000080%27%20text-anchor%3D%27middle%27%3EMarkdown%20Image%3C%2Ftext%3E%3C%2Fsvg%3E "内联 SVG 示例")',
    '',
    '## 六、任务清单',
    '',
    '- [x] 标题与段落',
    '- [x] 行内代码与代码块',
    '- [x] 链接与图片',
    '- [ ] 更多语法（表格等附加支持）',
    '',
    '## 七、表格（附加支持）',
    '',
    '| 语法 | 写法 | 状态 |',
    '| --- | :---: | ---: |',
    '| 标题 | `# 标题` | 已支持 |',
    '| 加粗 | `**文字**` | 已支持 |',
    '| 代码块 | ` ```lang ` | 已支持 |',
    '',
    '> 编辑区可直接修改本文件内容，右侧预览会即时刷新。',
  ].join('\n');

  /* ======================================================================
     2. 元素引用
     ====================================================================== */
  var winNp      = $('winNp');
  var npTitlebar = $('npTitlebar');
  var npBtnMax   = $('npBtnMax');
  var npMaxGlyph = $('npMaxGlyph');
  var npTaskBtn  = $('taskBtnNp');
  var npSplit    = $('npSplit');
  var npEditor   = $('npEditor');
  var npPreview  = $('npPreview');
  var npLineNo   = $('npLineNo');
  var npFileInput = $('npFileInput');

  /* 元素缺失（HTML 未更新）时安全退出，避免抛错影响主窗口 */
  if (!winNp || !npEditor || !npPreview || !npTaskBtn) return;

  var reduceMotion = global.matchMedia
    ? global.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  /* ======================================================================
     3. 状态
     ====================================================================== */
  var st = {
    open: false,          // 窗口是否处于「显示」态
    maxed: false,         // 是否最大化
    pinned: false,        // 是否已从文档流转为绝对定位
    savedRect: null,      // 最大化前的几何
    view: 'render',       // render | source | split
    lineNo: true,         // 源码视图是否显示行号
    fileName: '未命名.md',
    renderTimer: null,
  };

  var DESKTOP_WINDOW_ID = 'win';   // 主窗口 id，用于互斥激活

  /* ======================================================================
     4. 工具
     ====================================================================== */
  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = String(text == null ? '' : text);
  }

  function npToast(title, body) {
    /* 复用主窗口的提示条（同一视觉语言）；不存在则静默跳过 */
    var t = $('toast');
    if (!t) return;
    setText('toastTitle', title);
    setText('toastBody', body);
    t.classList.add('is-open');
    if (npToast._timer) clearTimeout(npToast._timer);
    npToast._timer = setTimeout(function () { t.classList.remove('is-open'); }, 4200);
  }

  /* ======================================================================
     5. 窗口显示 / 隐藏 / 最大化
     ----------------------------------------------------------------------
     与 app.js 共用 window.WinWM 契约完成「活动窗口」互斥：
       · 本窗口激活 → 主窗口转 is-inactive
       · 本窗口退场 → 若主窗口仍可见，则交还活动状态
     这样任务栏按钮的语义才正确：点非活动的可见窗口 = 激活，非最小化。
     ====================================================================== */
  function wm() {
    return global.WinWM || null;
  }

  /* 统一的活动态设置：窗口标题栏 + 任务栏按钮高亮必须同步，
     否则任务栏会出现「两个按钮同时高亮」的错误观感。 */
  function setInactive(on) {
    winNp.classList.toggle('is-inactive', !!on);
    if (on) npTaskBtn.classList.remove('is-active');
    else npTaskBtn.classList.add('is-active');
  }

  function activate() {
    var m = wm();
    if (m && typeof m.setActive === 'function') {
      m.setActive('winNp');           // 管理器统一处理所有已登记窗口
    } else {
      /* 降级：管理器未就绪时自行处理 */
      setInactive(false);
      var mainWin = $(DESKTOP_WINDOW_ID);
      if (mainWin && !mainWin.classList.contains('is-hidden')) {
        mainWin.classList.add('is-inactive');
      }
    }
  }

  function deactivate() {
    setInactive(true);
    var m = wm();
    if (m && m.activeId === 'winNp') m.activeId = null;
  }

  function show() {
    st.open = true;
    winNp.classList.remove('is-hidden');
    /* 任务栏按钮必须同步出现，否则无法再从任务栏唤回窗口 */
    npTaskBtn.classList.remove('is-hidden');
    npTaskBtn.title = '记事本 · ' + st.fileName;
    winNp.setAttribute('aria-hidden', 'false');
    /* 首次显示时锚定到桌面顶部：static + margin:auto 会让窗口排在文档流里，
       视口偏矮时可能落在首屏之外（窗口已打开却看不见，需向下滚动）。
       转绝对定位后与文档流解耦，位置只取决于视口，与页面滚动无关。 */
    if (!st.pinned) {
      pinToPixels();
      st.pinned = true;
    }
    void winNp.offsetWidth;               // 强制回流，保证过渡生效
    winNp.style.opacity = '1';
    winNp.style.transform = 'none';
    activate();
    setText('npStatusMain', '就绪');
    syncTaskBtnLabel();
  }

  function hide(mode) {
    if (!st.open) return;
    st.open = false;
    closeMenus();

    var optAnim = $('optAnim');
    var animate = !!optAnim && optAnim.checked && !reduceMotion;

    if (animate) {
      var wr = winNp.getBoundingClientRect();
      var tr = npTaskBtn.getBoundingClientRect();
      var sx = Math.max(0.06, tr.width / wr.width);
      var sy = Math.max(0.04, tr.height / wr.height);
      var dx = (tr.left + tr.width / 2) - (wr.left + wr.width / 2);
      var dy = (tr.top + tr.height / 2) - (wr.top + wr.height / 2);

      winNp.style.transformOrigin = '50% 100%';
      winNp.style.transform =
        'translate(' + dx + 'px, ' + dy + 'px) scale(' + sx + ', ' + sy + ')';
      winNp.style.opacity = '0';
      setTimeout(function () { winNp.classList.add('is-hidden'); }, 240);
    } else {
      winNp.classList.add('is-hidden');
    }

    /* 任务栏按钮随窗口一起消失，避免留下无对应窗口的「幽灵按钮」 */
    npTaskBtn.classList.add('is-hidden');

    winNp.setAttribute('aria-hidden', 'true');
    deactivate();

    /* 本窗口退场后，若主窗口仍可见则把活动状态交还给它 */
    var m = wm();
    if (m && typeof m.setActive === 'function' && m.isVisible && m.isVisible('win')) {
      m.setActive('win');
    }

    setText('npStatusMain', mode === 'close' ? '已关闭' : '已最小化');
  }

  /* 任务栏按钮标签与窗口标题保持一致 */
  function syncTaskBtnLabel() {
    if (!npTaskBtn) return;
    var label = npTaskBtn.querySelector('.task-btn__label');
    if (label) label.textContent = '记事本 · ' + st.fileName;
  }

  function toggle() {
    /* 与主窗口同一套语义：
       · 已隐藏            → 显示并激活
       · 可见但非活动窗口  → 只激活（置顶），不隐藏
       · 可见且已活动      → 最小化 */
    if (!st.open) { show(); return; }
    var m = wm();
    if (m && m.activeId !== 'winNp') { activate(); return; }
    hide('min');
  }

  /* 打开（供 app.js / 桌面图标调用） */
  function open() {
    if (st.open) {
      /* 已打开则置顶聚焦，符合用户「再点一次就回到前面」的预期 */
      activate();
      return;
    }
    show();
  }

  /* 把窗口从「文档流」转入「绝对定位」。
     不能原样沿用文档流坐标：文档流里的窗口会被页面滚动带出视口，
     照搬就会「打开即不可见」。这里重新按「桌面水平居中 + 垂直夹在视口内」
     计算，保证任意滚动位置、任意视口高度下窗口都出现在首屏。 */
  function pinToPixels() {
    var dr = $('desktop').getBoundingClientRect();
    var wr = winNp.getBoundingClientRect();
    var w = wr.width || 900;
    var h = wr.height || 560;
    winNp.style.position = 'absolute';
    winNp.style.margin = '0';
    winNp.style.width = w + 'px';
    var left = Math.max(0, (dr.width - w) / 2);
    var top = 46;
    var maxTop = global.innerHeight - h - 8;
    if (maxTop < top) top = Math.max(8, maxTop);
    winNp.style.left = left + 'px';
    winNp.style.top = top + 'px';
  }

  /* 把最大化窗口的尺寸重新贴合当前视口。
     之前只在进入最大化那一刻写死宽度（desktop.clientWidth），
     用户之后改变窗口大小 / 缩放页面 / 旋屏时不会重算，
     于是右侧或底部就露出空缺，超出的内容还会被裁掉。
     这里统一负责：宽度跟随桌面可用宽度，高度交给 CSS flex 计算。 */
  function fitToDesktop() {
    if (!st.maxed) return;
    var desktop = $('desktop');
    if (!desktop) return;
    var w = desktop.clientWidth;
    if (w > 0 && Math.abs(winNp.getBoundingClientRect().width - w) > 1) {
      winNp.style.width = w + 'px';
    }
    /* 清掉可能残留的行内高度，避免覆盖 CSS 的弹性计算 */
    winNp.style.height = '';
  }

  function toggleMax() {
    var desktop = $('desktop');
    if (!st.maxed) {
      pinToPixels();
      st.savedRect = {
        left: winNp.style.left,
        top: winNp.style.top,
        width: winNp.style.width,
      };
      winNp.style.left = '0px';
      winNp.style.top = '0px';
      winNp.style.width = desktop.clientWidth + 'px';
      winNp.style.height = '';        // 高度交由 CSS flex 填充
      winNp.classList.add('is-maxed');
      st.maxed = true;
    } else {
      if (st.savedRect) Object.assign(winNp.style, st.savedRect);
      winNp.style.height = '';
      winNp.classList.remove('is-maxed');
      st.maxed = false;
    }
    npMaxGlyph.className = st.maxed ? 'glyph-max glyph-restore' : 'glyph-max';
    npBtnMax.title = st.maxed ? '向下还原' : '最大化';
    npBtnMax.setAttribute('aria-label', npBtnMax.title);
    npBtnMax.setAttribute('aria-pressed', String(st.maxed));
    /* 切换后立刻贴合一次，保证初始就是满宽 */
    fitToDesktop();
    syncLineNumbers();
  }

  /* ======================================================================
     6. 窗口拖动（与主窗口同一套逻辑，独立实例变量）
     ====================================================================== */
  var dragging = false;
  var dragOffX = 0, dragOffY = 0, dragBaseX = 0, dragBaseY = 0;

  function getPoint(e) {
    if (e.touches && e.touches.length) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    if (e.changedTouches && e.changedTouches.length) {
      return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  function dragStart(e) {
    if (st.maxed) return;
    if (e.target.closest('.title-btn')) return;

    pinToPixels();
    var dr = $('desktop').getBoundingClientRect();
    var p = getPoint(e);
    dragBaseX = dr.left;
    dragBaseY = dr.top;
    dragOffX = p.x - (parseFloat(winNp.style.left) || 0) - dr.left;
    dragOffY = p.y - (parseFloat(winNp.style.top) || 0) - dr.top;
    dragging = true;

    winNp.classList.add('is-dragging');
    document.addEventListener('mousemove', dragMove);
    document.addEventListener('mouseup', dragEnd);
    document.addEventListener('touchmove', dragMove, { passive: false });
    document.addEventListener('touchend', dragEnd);
    e.preventDefault();
  }

  function dragMove(e) {
    if (!dragging) return;
    var p = getPoint(e);
    var w = winNp.offsetWidth;
    var desktop = $('desktop');

    var left = p.x - dragOffX - dragBaseX;
    var top = p.y - dragOffY - dragBaseY;

    var maxLeft = desktop.clientWidth - 140;
    var maxTop = global.innerHeight - 32 - 30;
    left = Math.min(Math.max(left, -(w - 140)), maxLeft);
    top = Math.min(Math.max(top, -6), maxTop);

    winNp.style.left = left + 'px';
    winNp.style.top = top + 'px';
    e.preventDefault();
  }

  function dragEnd() {
    if (!dragging) return;
    dragging = false;
    winNp.classList.remove('is-dragging');
    document.removeEventListener('mousemove', dragMove);
    document.removeEventListener('mouseup', dragEnd);
    document.removeEventListener('touchmove', dragMove);
    document.removeEventListener('touchend', dragEnd);
  }

  npTitlebar.addEventListener('mousedown', dragStart);
  npTitlebar.addEventListener('touchstart', dragStart, { passive: false });
  npTitlebar.addEventListener('dblclick', function (e) {
    if (e.target.closest('.title-btn')) return;
    toggleMax();
  });
  npTitlebar.addEventListener('mousedown', activate);
  npTitlebar.addEventListener('touchstart', activate, { passive: true });

  $('npBtnMin').addEventListener('click', function () { hide('min'); });
  $('npBtnMax').addEventListener('click', toggleMax);
  $('npBtnClose').addEventListener('click', function () { hide('close'); });
  npTaskBtn.addEventListener('click', toggle);

  /* 记事本内点击时把本窗口置为活动窗口 */
  winNp.addEventListener('mousedown', function () { if (st.open) activate(); }, true);

  /* ======================================================================
     7. 菜单栏（与主窗口同一交互模式，独立开关状态）
     ====================================================================== */
  var openItem = null;

  function closeMenus() {
    if (openItem) {
      openItem.classList.remove('is-open');
      openItem = null;
    }
  }

  function toggleMenu(item) {
    if (openItem === item) { closeMenus(); return; }
    closeMenus();
    item.classList.add('is-open');
    openItem = item;
  }

  var menuItems = winNp.querySelectorAll('.menubar .menu-item');
  Array.prototype.forEach.call(menuItems, function (item) {
    item.addEventListener('click', function (e) {
      if (e.target.closest('.menu-pop')) return;
      toggleMenu(item);
      e.preventDefault();
    });
    item.addEventListener('mouseover', function (e) {
      if (openItem && openItem !== item && !e.target.closest('.menu-pop')) {
        toggleMenu(item);
      }
    });
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('#npMenubar')) closeMenus();
  });

  /* ======================================================================
     8. 视图模式
     ====================================================================== */
  var VIEW_LABEL = { render: '渲染视图', source: '源码视图', split: '并排显示' };

  function setView(mode) {
    st.view = mode;
    npSplit.classList.toggle('is-source', mode === 'source');
    npSplit.classList.toggle('is-split', mode === 'split');

    var map = { render: 'npMiRender', source: 'npMiSource', split: 'npMiSplit' };
    Object.keys(map).forEach(function (k) {
      var el = $(map[k]);
      if (el) el.classList.toggle('is-checked', k === mode);
    });

    var btnMap = { render: 'npTbRender', source: 'npTbSource', split: 'npTbSplit' };
    Object.keys(btnMap).forEach(function (k) {
      var el = $(btnMap[k]);
      if (el) el.classList.toggle('is-pressed', k === mode);
    });

    setText('npStatusMode', VIEW_LABEL[mode] || mode);
    if (mode !== 'render') syncLineNumbers();
  }

  /* 行号显示开关 */
  function setLineNo(show) {
    st.lineNo = !!show;
    npSplit.classList.toggle('no-lineno', !st.lineNo);
    var el = $('npMiLineNo');
    if (el) el.classList.toggle('is-checked', st.lineNo);
    if (st.lineNo) syncLineNumbers();
  }

  /* ======================================================================
     9. 行号同步
     ----------------------------------------------------------------------
     行号槽与编辑区使用完全相同字体与行高，只要维持相同的滚动偏移
     即可保证对齐；这里同时把滚动偏移按「行」量化，避免半行错位。
     ====================================================================== */
  var LINE_H = 18;

  function syncLineNumbers() {
    if (!st.lineNo) return;
    var total = npEditor.value.split('\n').length;
    var cur = npLineNo.getAttribute('data-lines');
    if (cur !== String(total)) {
      var buf = [];
      for (var i = 1; i <= total; i++) buf.push(String(i));
      npLineNo.textContent = buf.join('\n') + '\n';
      npLineNo.setAttribute('data-lines', String(total));
    }
    /* 量化滚动偏移，保持与文字行基线一致 */
    var offset = Math.floor(npEditor.scrollTop / LINE_H) * LINE_H;
    npLineNo.style.transform = 'translateY(' + (-offset) + 'px)';
  }

  function updateStat() {
    var md = npEditor.value;
    var chars = md.length;
    var lines = md.split('\n').length;
    setText('npStatusStat', chars + ' 字 / ' + lines + ' 行');
  }

  /* ======================================================================
     10. 渲染
     ----------------------------------------------------------------------
     输入防抖：连续输入时只在停顿后解析一次，避免长文档卡顿。
     ====================================================================== */
  function renderNow() {
    var md = npEditor.value;
    var html;
    try {
      html = MD.render(md);
    } catch (err) {
      html = '<p class="notice notice--warn">Markdown 解析出错：' +
             MD.escape(err && err.message ? err.message : String(err)) + '</p>';
    }
    npPreview.innerHTML = html;

    /* 图片加载失败 → 替换为占位块（与主窗口封面降级策略一致） */
    var imgs = npPreview.querySelectorAll('img[data-md-img]');
    Array.prototype.forEach.call(imgs, function (img) {
      img.addEventListener('error', function () {
        var ph = document.createElement('span');
        ph.className = 'md-imgfail';
        ph.textContent = '图片加载失败：' + (img.getAttribute('alt') || img.getAttribute('src') || '');
        if (img.parentNode) img.parentNode.replaceChild(ph, img);
      }, { once: true });
    });

    setText('npStatusHint', '已渲染 ' + npPreview.querySelectorAll('.md > *').length + ' 个块级元素');
    updateStat();
  }

  function queueRender() {
    if (st.renderTimer) clearTimeout(st.renderTimer);
    st.renderTimer = setTimeout(function () {
      st.renderTimer = null;
      renderNow();
    }, 160);
  }

  /* ======================================================================
     11. 文件载入 / 导出
     ====================================================================== */
  function loadText(text, fileName, note) {
    npEditor.value = String(text == null ? '' : text);
    st.fileName = fileName || '未命名.md';
    setText('npTitle', '记事本 · ' + st.fileName);
    setText('npStatusFile', st.fileName);
    npTaskBtn.title = '记事本 · ' + st.fileName;
    syncTaskBtnLabel();
    setText('npStatusHint', note || '已载入文档');
    npLineNo.setAttribute('data-lines', '');
    renderNow();
    syncLineNumbers();
    npEditor.scrollTop = 0;
    npPreview.scrollTop = 0;
  }

  function loadSample() {
    loadText(SAMPLE_DOC, '未命名.md', '已生成示例文档（含全部支持的语法）');
    npToast('示例文档', '已重新载入占位 Markdown 示例。');
  }

  function openFile() {
    if (npFileInput) npFileInput.click();
  }

  function readFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var name = file.name || '未命名.md';
      if (/\.mdx?$/i.test(name) || /markdown|text/i.test(file.type || '')) {
        loadText(String(reader.result || ''), name, '已载入本地文件');
        npToast('已打开', name);
      } else {
        npToast('格式提示', name + ' 可能不是 Markdown 文件，已按纯文本载入。');
        loadText(String(reader.result || ''), name, '已按纯文本载入');
      }
    };
    reader.onerror = function () {
      npToast('读取失败', '无法读取所选文件，请重试。');
    };
    reader.readAsText(file, 'utf-8');
  }

  function exportMd() {
    var blob = new Blob([npEditor.value], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = st.fileName.replace(/\.(md|markdown|txt)$/i, '') + '.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    npToast('已导出', a.download);
  }

  /* 复制：优先 Clipboard API，旧内核回退 execCommand */
  function copyText(text, label) {
    var done = function () { npToast('已复制', label + ' 已复制到剪贴板。'); };
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) done();
      else global.prompt('当前浏览器不允许自动复制，请手动复制：', text);
    };

    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  function selectAllText() {
    npEditor.focus();
    npEditor.select();
    setText('npStatusMain', '已全选');
  }

  /* ======================================================================
     12. 对话框（复用主窗口的 .dialog 结构）
     ====================================================================== */
  function infoDialog(title, html) {
    var dlg = $('dialog');
    if (!dlg) { npToast(title, ''); return; }
    setText('dlgTitle', title);
    var icon = $('dlgIcon');
    if (icon) {
      icon.innerHTML =
        '<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">' +
        '<circle cx="16" cy="16" r="14" fill="#000080" stroke="#000000"/>' +
        '<path d="M16 13v11" stroke="#ffffff" stroke-width="3"/>' +
        '<rect x="14.6" y="7" width="2.8" height="3" fill="#ffffff"/></svg>';
    }
    var txt = $('dlgText');
    if (txt) txt.innerHTML = html;
    var ok = $('dlgOk');
    if (ok) ok.textContent = '确定';
    var cancel = $('dlgCancel');
    if (cancel) cancel.style.display = 'none';
    var mask = $('modalMask');
    if (mask) mask.classList.add('is-open');
    dlg.classList.add('is-open');
    if (ok) ok.focus();
  }

  var SYNTAX_HELP =
    '<p><b>本记事本支持的 Markdown 语法</b></p>' +
    '<ul style="margin:6px 0 0 0;">' +
    '<li><b>标题</b>：<code>#</code> 至 <code>######</code>（一至六级）</li>' +
    '<li><b>段落</b>：空行分隔；行尾两空格或 <code>\\</code> 为硬换行</li>' +
    '<li><b>无序列表</b>：<code>-</code> / <code>*</code> / <code>+</code>；支持缩进嵌套与 <code>[ ]</code> 任务清单</li>' +
    '<li><b>有序列表</b>：<code>1.</code> / <code>1)</code>；支持嵌套</li>' +
    '<li><b>行内代码</b>：<code>`code`</code></li>' +
    '<li><b>代码块</b>：<code>```</code> 围栏，可在其后写语言标识（如 <code>```js</code>）</li>' +
    '<li><b>链接</b>：<code>[文本](地址 "标题")</code>；裸 <code>https://</code> 地址自动识别</li>' +
    '<li><b>加粗</b>：<code>**文字**</code> 或 <code>__文字__</code></li>' +
    '<li><b>斜体</b>：<code>*文字*</code> 或 <code>_文字_</code></li>' +
    '<li><b>删除线</b>：<code>~~文字~~</code>（附加支持）</li>' +
    '<li><b>图片</b>：<code>![说明](图片地址)</code></li>' +
    '<li><b>引用块</b>：行首 <code>&gt;</code>，可嵌套、可含其他块</li>' +
    '<li><b>分隔线</b>：<code>---</code> / <code>***</code> / <code>___</code></li>' +
    '<li><b>表格</b>：标准 GFM 表格（附加支持）</li>' +
    '</ul>' +
    '<p style="margin-top:8px;">出于安全考虑，原始 HTML 标签不会被渲染，' +
    '而是按纯文本显示。</p>';

  var ABOUT_TEXT =
    '<p><b>记事本 · Markdown 渲染器</b></p>' +
    '<p style="margin-top:6px;">纯前端实现，无任何第三方依赖，' +
    '解析器位于 <code>assets/markdown.js</code>，本窗口逻辑位于 <code>assets/notepad.js</code>。</p>' +
    '<p style="margin-top:6px;">与主窗口共用同一套 Windows Classic 视觉与窗口管理模型，' +
    '可通过任务栏在两个窗口间切换。</p>' +
    '<p style="margin-top:6px;">兼容基线：EdgeHTML 18（Edge 18）及以上。</p>';

  /* ======================================================================
     13. 动作分发
     ====================================================================== */
  function doAction(act) {
    closeMenus();
    switch (act) {
      case 'np-open':       openFile(); break;
      case 'np-export':     exportMd(); break;
      case 'np-reset':      loadSample(); break;
      case 'np-close':      hide('close'); break;
      case 'np-copy-md':    copyText(npEditor.value, 'Markdown 源码'); break;
      case 'np-copy-text':  copyText(MD.toPlain(npPreview.innerHTML), '渲染后纯文本'); break;
      case 'np-select-all': selectAllText(); break;
      case 'np-view-render': setView('render'); break;
      case 'np-view-source': setView('source'); break;
      case 'np-view-split':  setView('split'); break;
      case 'np-font-inc':    setLineNo(!st.lineNo); break;
      case 'np-help':        infoDialog('Markdown 语法支持', SYNTAX_HELP); break;
      case 'np-about':       infoDialog('关于记事本', ABOUT_TEXT); break;
      default: break;
    }
  }

  /* 记事本内的 data-act 统一处理（先于 app.js 的全局代理消化） */
  winNp.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (!act || act.indexOf('np-') !== 0) return;
    if (el.tagName === 'A') e.preventDefault();
    /* 阻止冒泡到 app.js 的动作代理（start/end 均为独立命名空间） */
    e.stopPropagation();
    doAction(act);
  });

  /* 工具栏按钮 */
  $('npTbOpen').addEventListener('click', openFile);
  $('npTbReset').addEventListener('click', loadSample);
  $('npTbRender').addEventListener('click', function () { setView('render'); });
  $('npTbSource').addEventListener('click', function () { setView('source'); });
  $('npTbSplit').addEventListener('click', function () { setView('split'); });
  $('npTbCopy').addEventListener('click', function () { copyText(npEditor.value, 'Markdown 源码'); });
  $('npTbHelp').addEventListener('click', function () { infoDialog('Markdown 语法支持', SYNTAX_HELP); });

  /* 文件选择 */
  if (npFileInput) {
    npFileInput.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      readFile(f);
      e.target.value = '';       // 允许重复选择同一文件
    });
  }

  /* 编辑区事件 */
  npEditor.addEventListener('input', function () {
    queueRender();
    npLineNo.setAttribute('data-lines', '');   // 行数变化，强制重建
    updateStat();
    setText('npStatusMain', '编辑中');
  });
  npEditor.addEventListener('scroll', syncLineNumbers, { passive: true });
  npEditor.addEventListener('keydown', function (e) {
    /* Tab 插入两个空格，避免焦点跳出编辑区 */
    if (e.key === 'Tab') {
      e.preventDefault();
      var s = npEditor.selectionStart;
      var en = npEditor.selectionEnd;
      var v = npEditor.value;
      npEditor.value = v.slice(0, s) + '  ' + v.slice(en);
      npEditor.selectionStart = npEditor.selectionEnd = s + 2;
      queueRender();
      return;
    }
    /* Ctrl+S 导出 */
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      exportMd();
      return;
    }
    /* Ctrl+O 打开 */
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      openFile();
    }
  });

  /* 拖拽文件到窗口即载入 */
  winNp.addEventListener('dragover', function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  winNp.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    readFile(f);
  });

  /* 视口变化：最大化态需重新贴合宽度（高度由 CSS flex 自动跟随，无需干预） */
  var resizeTimer = null;
  global.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!st.open) return;
      if (st.maxed) {
        winNp.style.left = '0px';
        winNp.style.top = '0px';
        fitToDesktop();
      } else if (winNp.style.position === 'absolute') {
        var w = winNp.offsetWidth;
        var left = parseFloat(winNp.style.left) || 0;
        var top = parseFloat(winNp.style.top) || 0;
        var desktop2 = $('desktop');
        var maxLeft = desktop2.clientWidth - 140;
        var maxTop = global.innerHeight - 62;
        winNp.style.left = Math.min(Math.max(left, -(w - 140)), maxLeft) + 'px';
        winNp.style.top = Math.min(Math.max(top, -6), maxTop) + 'px';
      }
      syncLineNumbers();
    }, 120);
  });

  /* Esc 关闭（仅在记事本为活动窗口且焦点不在对话框时） */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var dlg = $('dialog');
    if (dlg && dlg.classList.contains('is-open')) return;   // 交给主逻辑关闭对话框
    if (!st.open) return;
    if (openItem) { closeMenus(); return; }
    var active = document.activeElement;
    if (active && active.closest && active.closest('#winNp')) hide('min');
  });

  /* ======================================================================
     14. 启动
     ====================================================================== */
  setView('render');
  setLineNo(true);
  loadText(SAMPLE_DOC, '未命名.md', '已自动生成占位示例文档');

  /* 向共享窗口管理器登记，使主窗口的 activate 逻辑能感知本窗口存在 */
  if (global.WinWM && typeof global.WinWM.register === 'function') {
    global.WinWM.register('winNp', {
      isVisible: function () { return st.open && !winNp.classList.contains('is-hidden'); },
      setInactive: setInactive,
      show: show,
      hide: function () { hide('min'); },
    });
  }

  /* 对外接口：app.js / 桌面图标通过它打开记事本 */
  global.WinNotepad = {
    open: open,
    close: function () { hide('close'); },
    minimize: function () { hide('min'); },
    isOpen: function () { return st.open; },
    isActive: function () {
      return !!(global.WinWM && global.WinWM.activeId === 'winNp');
    },
    load: loadText,
    getSample: function () { return SAMPLE_DOC; },
  };
})(window);
