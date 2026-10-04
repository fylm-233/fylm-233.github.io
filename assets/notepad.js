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
     1. 初始文档（启动时自动载入的自定义内容）
     ----------------------------------------------------------------------
    记事本打开时若没有外部文档，就用这段内容初始化。
    内容来源：用户提供的《欢迎来到我的小站.md》。
    图片已内联为 data URI（原文档中的本机绝对路径图片已移除，
    因为网页无法访问 D 盘本地文件）。
     ====================================================================== */
  var INITIAL_DOC = [
    '# **欢迎来到我的站点**',
    '',
    '这里是我的博客站和我们社团——唐人茅屋的官方站点',
    '',
    '唐人茅屋是一个以手书动画、MMD-3DCG、游戏制作、线下二创周边为主的创作型同人社团',
    '',
    '由风雨铃木于2017年发起创建。目前主要以描改手书MMD的内容创作为主。',
    '',
    '【唐人茅屋】的名称源起自《东方红魔乡》预订角色【冴月麟】，该角色胎死腹中，只可在代码中找到，拥有风符与花符。一般认为的【冴月麟】形象来自C62的社团cut，角色所持二胡侧有【唐人茅】三字，此处茅有祈福袪灾的茅之轮意。取【唐人茅屋】，一方面意于纪念冴月麟，表对原设认真负责之态度；另一方面取自杜工部《茅屋为秋风所破歌》，兼广济人才意。',
    '',
    '## 关于冴月麟',
    '',
    '原定于在《东方红魔乡》中出场的人物，可能是自机，但游戏开发时被神主腰斩。',
    '',
    '麟的痕迹![](data:image/png;base64,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)',
    '',
    '目前通常认为C62社团cut上的人物就是冴月麟的形象：头戴大蝴蝶结，手持刻有【唐人茅】字样的二胡。但在实际上，她是没有立绘的，而且名字的读音也不明（日语中"冴"和"月"的常用读音均为复数个，汉语中"冴"的多音字）（所以真的是超惨）',
    '',
    '但即使是这样，也还是有人坚持着对她的喜爱，并进行同人创作。在中国的人气似乎还可以，比许多出场人物还要强。',
    '',
    '【唐人茅屋】的社团名就是为进行针对【冴月麟】和【C62娘】的二次创作而产生的。',
    '',
    '**目前社团的制品有：**',
    '',
    '与边狱堂合作桌游',
    '',
    '*【U.N.O.wen就是她吗】制品群：922636296*',
    '',
    '*【魔理沙玩偶】制品群：1084940866*',
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
    loadText(INITIAL_DOC, '欢迎来到我的小站.md', '已重新载入初始文档');
    npToast('初始文档', '已重新载入预设内容。');
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
    /* 走共享对话框模块完成落位（固化居中为像素 + 夹回视口）。
       若不调用，left/top 会停留在上一次的残留值，且无拖动能力。 */
    if (global.WinDialog && typeof global.WinDialog.place === 'function') {
      global.WinDialog.place(dlg, $('winNp'));
    }
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
  loadText(INITIAL_DOC, '欢迎来到我的小站.md', '已载入初始文档');

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
    getSample: function () { return INITIAL_DOC; },
  };
})(window);
