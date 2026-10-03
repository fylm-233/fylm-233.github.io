/* ==========================================================================
   player.js — 媒体播放器窗口（网易云音乐外链 + 视觉覆盖层）  v1
   --------------------------------------------------------------------------
   兼容目标：EdgeHTML 18（Edge 18 / Windows 10 1809）及以上

   职责边界（保持与 app.js / notepad.js 解耦）
     · 本文件只负责「媒体播放器」窗口的窗口管理、iframe 装载与覆盖层交互
     · 与主窗口、记事本共用 window.WinWM 契约完成活动态互斥
     · 对外只暴露 window.WinPlayer = { open, close, minimize, ... }
     · 桌面图标 / 工具菜单 / 开始菜单 / 任务栏按钮统一走本模块

   ──────────────────────────────────────────────────────────────────────────
   关于「视觉覆盖网易云原生控件」的工程约束（必须如实说明）
   ──────────────────────────────────────────────────────────────────────────
   目标 iframe：
     //music.163.com/outchain/player?type=2&id=22636810&auto=1&height=66
   该文档位于 music.163.com 源，与本站不同源。同源策略使父文档：

     ✗ 无法读取 iframe 内部 DOM（无 contentDocument 访问权）
     ✗ 无法给内部元素挂样式（无 contentWindow.document 注入权）
     ✗ 无法重排内部控件位置

   因此「把网易云按钮换成 Windows 3.1 按钮」在纯前端、无代理的前提下
   不可能真正实现。本模块采用业界通行的可行替代方案：

     ① 视觉替换：在 iframe 之上铺一层同尺寸的 Windows 3.1 风控件条
        （.mp-cover），像素级盖住原生控件区，用户看到的是经典外观。
     ② 事件拦截：覆盖层是真实 DOM，天然吃掉落在其上的指针事件。
        对「需要把点击转交给下方 iframe 原生控件」的区域（播放/暂停、
        上一首、下一首），用透明热区（.mp-hot）承接点击，再以一个
        可拖拽的「校准光标」换算成 iframe 本地坐标，通过
        postMessage 尽力广播；若目标源不接受消息（实际情况），
        则降级为「不穿透」——热区保持显示、点击不产生副作用。
     ③ 进度反馈：原生进度条同样被盖住。我们用一个自我驱动的
        「视觉进度条」（.mp-progress）呈现播放意象，其推进由本模块的
        计时器模拟（不谎称同步真实播放位置，状态栏明确标注「模拟」）。
     ④ 无缝切换：覆盖层可整体开关（工具栏「皮肤」按钮 / 查看菜单），
        关闭后回落到原生 iframe 控件，保证「能听能控」这一底线可用。

   这样既满足「与主窗口风格一致、全屏响应式」的视觉要求，
   也不虚构任何跨域能力。
   ========================================================================== */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ======================================================================
     0. 曲目元数据（用于覆盖层的标题/时长展示）
     ----------------------------------------------------------------------
     网易云外链只传了歌曲 id，界面无法从 iframe 反查歌名（跨域）。
     这里把本站内置曲目的元数据写死，覆盖层即可显示真实曲名；
     若将来改动 id 而未同步此表，覆盖层会退化为占位标题，不影响播放。
     以下数据取自网易云歌曲详情接口（id=22636810）：
       name   夢消失 ～ Lost Dream
       artist 上海アリス幻樂団
       album  東方夢時空 ～ Phantasmagoria of Dim.Dream.
     时长为接口未提供的字段，04:04 为本页用于视觉进度条的近似值，
     不用于任何精确同步（跨域下也做不到）。
     ====================================================================== */
  var TRACK = {
    id: 22636810,
    title: '夢消失 ～ Lost Dream',
    artist: '上海アリス幻樂団',
    album: '東方夢時空 ～ Phantasmagoria of Dim.Dream.',
    duration: 244,        // 视觉进度条使用的近似时长（秒）
  };

  /* ======================================================================
     1. 元素引用
     ====================================================================== */
  var winMp        = $('winMp');
  var mpTitlebar   = $('mpTitlebar');
  var mpBtnMin     = $('mpBtnMin');
  var mpBtnMax     = $('mpBtnMax');
  var mpBtnClose   = $('mpBtnClose');
  var mpMaxGlyph   = $('mpMaxGlyph');
  var mpTaskBtn    = $('taskBtnMp');
  var mpCover      = $('mpCover');
  var mpFrame      = $('mpFrame');
  var mpStage      = $('mpStage');
  var mpProgress   = $('mpProgress');
  var mpBar        = $('mpBar');
  var mpTime       = $('mpTime');
  var mpBtnPlay    = $('mpBtnPlay');
  var mpBtnPrev    = $('mpBtnPrev');
  var mpBtnNext    = $('mpBtnNext');
  var mpBtnSkin    = $('mpTbSkin');
  var mpTbPlay     = $('mpTbPlay');
  var mpTbPrev     = $('mpTbPrev');
  var mpTbNext     = $('mpTbNext');
  var mpTbReload   = $('mpTbReload');
  var mpTbHelp     = $('mpTbHelp');
  var mpStatusMain = $('mpStatusMain');
  var mpStatusMode = $('mpStatusMode');
  var mpStatusTrack = $('mpStatusTrack');

  /* HTML 未更新时安全退出，避免抛错影响其它窗口 */
  if (!winMp || !mpFrame || !mpTaskBtn) return;

  var reduceMotion = global.matchMedia
    ? global.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  /* ======================================================================
     2. 状态
     ====================================================================== */
  var st = {
    open: false,
    maxed: false,
    pinned: false,        // 是否已从文档流转为绝对定位
    savedRect: null,
    skin: true,           // 是否启用视觉覆盖层
    playing: false,       // 播放意象（模拟，不谎称与 iframe 同步）
    elapsed: 0,           // 模拟进度秒
    tickTimer: null,
  };

  var DESKTOP_WINDOW_ID = 'win';
  var PLAYER_ORIGIN = 'https://music.163.com';

  /* ======================================================================
     3. 工具
     ====================================================================== */
  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = String(text == null ? '' : text);
  }

  function mpToast(title, body) {
    var t = $('toast');
    if (!t) return;
    setText('toastTitle', title);
    setText('toastBody', body);
    t.classList.add('is-open');
    if (mpToast._timer) clearTimeout(mpToast._timer);
    mpToast._timer = setTimeout(function () { t.classList.remove('is-open'); }, 4200);
  }

  function mmss(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ======================================================================
     4. 窗口显示 / 隐藏 / 最大化
     —— 与 notepad.js 使用完全相同的 WinWM 契约，语义一致
     ====================================================================== */
  function wm() { return global.WinWM || null; }

  function setInactive(on) {
    winMp.classList.toggle('is-inactive', !!on);
    if (on) mpTaskBtn.classList.remove('is-active');
    else mpTaskBtn.classList.add('is-active');
  }

  function activate() {
    var m = wm();
    if (m && typeof m.setActive === 'function') {
      m.setActive('winMp');
    } else {
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
    if (m && m.activeId === 'winMp') m.activeId = null;
  }

  /* 懒装载 iframe：窗口首次打开时才真正发起网络请求，
     避免首屏就向 music.163.com 拉取资源（省流量、也更快） */
  function ensureFrame() {
    if (!mpFrame) return;
    if (mpFrame.getAttribute('src')) return;
    var src = mpFrame.getAttribute('data-src');
    if (src) mpFrame.setAttribute('src', src);
  }

  function show() {
    st.open = true;
    ensureFrame();
    winMp.classList.remove('is-hidden');
    mpTaskBtn.classList.remove('is-hidden');
    mpTaskBtn.title = '媒体播放器 · ' + TRACK.title;
    winMp.setAttribute('aria-hidden', 'false');
    /* 首次显示时把窗口从「文档流」转为「绝对定位」并锚定到桌面顶部。
       若让它保持 static + margin:auto，它会排在文档流里 —— 位于记事本
       之后的位置，在视口高度不足时会被推到首屏之外，用户必须向下滚动
       才能看见（窗口"打开了"却不可见）。绝对定位则与视口无关，始终在眼底。 */
    if (!st.pinned) {
      pinToPixels();
      st.pinned = true;
    }
    void winMp.offsetWidth;
    winMp.style.opacity = '1';
    winMp.style.transform = 'none';
    activate();
    setText('mpStatusMain', '就绪');
    updateStageMetrics();
  }

  function hide(mode) {
    if (!st.open) return;
    st.open = false;

    var optAnim = $('optAnim');
    var animate = !!optAnim && optAnim.checked && !reduceMotion;

    if (animate) {
      var wr = winMp.getBoundingClientRect();
      var tr = mpTaskBtn.getBoundingClientRect();
      var sx = Math.max(0.06, tr.width / wr.width);
      var sy = Math.max(0.04, tr.height / wr.height);
      var dx = (tr.left + tr.width / 2) - (wr.left + wr.width / 2);
      var dy = (tr.top + tr.height / 2) - (wr.top + wr.height / 2);

      winMp.style.transformOrigin = '50% 100%';
      winMp.style.transform =
        'translate(' + dx + 'px, ' + dy + 'px) scale(' + sx + ', ' + sy + ')';
      winMp.style.opacity = '0';
      setTimeout(function () { winMp.classList.add('is-hidden'); }, 240);
    } else {
      winMp.classList.add('is-hidden');
    }

    mpTaskBtn.classList.add('is-hidden');
    winMp.setAttribute('aria-hidden', 'true');
    /* 关闭时暂停模拟进度，避免后台空转 */
    if (mode === 'close') stopTick();
    deactivate();

    var m = wm();
    if (m && typeof m.setActive === 'function' && m.isVisible && m.isVisible('win')) {
      m.setActive('win');
    }
    setText('mpStatusMain', mode === 'close' ? '已关闭' : '已最小化');
  }

  function toggle() {
    if (!st.open) { show(); return; }
    var m = wm();
    if (m && m.activeId !== 'winMp') { activate(); return; }
    hide('min');
  }

  function open() {
    if (st.open) { activate(); return; }
    show();
  }

  /* 把窗口从「文档流」转入「绝对定位」。
     关键点：不能原样沿用文档流中的坐标 —— 文档流里的窗口可能已经被
     页面滚动带到视口之外（top 远大于 innerHeight），照搬就会「打开即不可见」。
     这里把初始位置按「桌面水平居中 + 垂直方向夹在视口内」重新计算，
     保证无论页面滚到哪里、视口多矮，窗口一定出现在首屏可见范围内。 */
  function pinToPixels() {
    var dr = $('desktop').getBoundingClientRect();
    var wr = winMp.getBoundingClientRect();
    var w = wr.width || 430;
    var h = wr.height || 226;
    winMp.style.position = 'absolute';
    winMp.style.margin = '0';
    winMp.style.width = w + 'px';
    /* 水平居中（相对桌面可用宽度） */
    var left = Math.max(0, (dr.width - w) / 2);
    /* 垂直：优先停在桌面顶部下方 64px；若视口装不下，则压到 8px 处保证可见 */
    var top = 64;
    var maxTop = global.innerHeight - h - 8;
    if (maxTop < top) top = Math.max(8, maxTop);
    winMp.style.left = left + 'px';
    winMp.style.top = top + 'px';
  }

  /* 最大化：宽度贴合桌面可用宽度，高度交给 CSS flex 弹性填充
     （与 notepad.js 的 fitToDesktop 同一手法，杜绝魔法常量） */
  function fitToDesktop() {
    if (!st.maxed) return;
    var desktop = $('desktop');
    if (!desktop) return;
    var w = desktop.clientWidth;
    if (w > 0 && Math.abs(winMp.getBoundingClientRect().width - w) > 1) {
      winMp.style.width = w + 'px';
    }
    winMp.style.height = '';
  }

  function toggleMax() {
    var desktop = $('desktop');
    if (!st.maxed) {
      pinToPixels();
      st.savedRect = {
        left: winMp.style.left,
        top: winMp.style.top,
        width: winMp.style.width,
      };
      winMp.style.left = '0px';
      winMp.style.top = '0px';
      winMp.style.width = desktop.clientWidth + 'px';
      winMp.style.height = '';
      winMp.classList.add('is-maxed');
      st.maxed = true;
    } else {
      if (st.savedRect) Object.assign(winMp.style, st.savedRect);
      winMp.style.height = '';
      winMp.classList.remove('is-maxed');
      st.maxed = false;
    }
    mpMaxGlyph.className = st.maxed ? 'glyph-max glyph-restore' : 'glyph-max';
    mpBtnMax.title = st.maxed ? '向下还原' : '最大化';
    mpBtnMax.setAttribute('aria-label', mpBtnMax.title);
    mpBtnMax.setAttribute('aria-pressed', String(st.maxed));
    fitToDesktop();
    updateStageMetrics();
  }

  /* ======================================================================
     5. 拖拽（标题栏）
     ====================================================================== */
  var drag = { on: false, dx: 0, dy: 0 };

  function dragStart(e) {
    if (e.target.closest && e.target.closest('.title-btn')) return;
    if (st.maxed) return;
    pinToPixels();
    var p = e.touches ? e.touches[0] : e;
    var wr = winMp.getBoundingClientRect();
    drag.on = true;
    drag.dx = p.clientX - wr.left;
    drag.dy = p.clientY - wr.top;
    winMp.classList.add('is-dragging');
    if (e.cancelable) e.preventDefault();
  }

  function dragMove(e) {
    if (!drag.on) return;
    var p = e.touches ? e.touches[0] : e;
    var dr = $('desktop').getBoundingClientRect();
    var left = p.clientX - dr.left - drag.dx;
    var top = p.clientY - dr.top - drag.dy;
    /* 至少留 140px 在视口内，避免窗口被拖到完全够不着的地方 */
    var maxLeft = $('desktop').clientWidth - 140;
    var maxTop = global.innerHeight - 62;
    left = Math.min(Math.max(left, -(winMp.offsetWidth - 140)), maxLeft);
    top = Math.min(Math.max(top, -6), maxTop);
    winMp.style.left = left + 'px';
    winMp.style.top = top + 'px';
    if (e.cancelable) e.preventDefault();
  }

  function dragEnd() {
    if (!drag.on) return;
    drag.on = false;
    winMp.classList.remove('is-dragging');
    document.removeEventListener('mousemove', dragMove);
    document.removeEventListener('mouseup', dragEnd);
    document.removeEventListener('touchmove', dragMove);
    document.removeEventListener('touchend', dragEnd);
  }

  function onDragStart(e) {
    dragStart(e);
    if (!drag.on) return;
    document.addEventListener('mousemove', dragMove);
    document.addEventListener('mouseup', dragEnd);
    document.addEventListener('touchmove', dragMove, { passive: false });
    document.addEventListener('touchend', dragEnd);
  }

  /* ======================================================================
     6. 视觉覆盖层
     ----------------------------------------------------------------------
     覆盖层分两类子元素：
       · 装饰件（面板/按钮外观/进度条）—— pointer-events: none，
         不吃事件，纯视觉；
       · 热区（.mp-hot）—— pointer-events: auto，吃掉落在原生控件
         位置上的点击，阻止其穿透到 iframe，同时给出「已按下」的
         视觉反馈（避免用户以为点击失效）。
     ====================================================================== */

  /* 覆盖层开关。关闭后隐藏 .mp-cover，回落到网易云原生控件，
     保证「至少能正常播放/暂停」这一功能底线始终可用。 */
  function setSkin(on) {
    st.skin = !!on;
    winMp.classList.toggle('no-skin', !st.skin);
    if (mpBtnSkin) {
      mpBtnSkin.classList.toggle('is-on', st.skin);
      mpBtnSkin.setAttribute('aria-pressed', String(st.skin));
      mpBtnSkin.title = st.skin ? '视觉覆盖：开（点击回落到原生控件）' : '视觉覆盖：关';
    }
    setText('mpStatusMode', st.skin ? '经典皮肤' : '原生控件');
    syncMenuCheck();
  }

  function syncMenuCheck() {
    var a = $('mpMiSkin');
    if (a) a.classList.toggle('is-checked', st.skin);
    var b = $('mpMiNative');
    if (b) b.classList.toggle('is-checked', !st.skin);
  }

  /* 覆盖层与 iframe 的尺寸对齐：iframe 固定 330×86，
     覆盖层精确覆盖在它上面；窗口变宽时把整个舞台居中，
     并在两侧留出经典灰底，避免出现「被拉伸的 iframe」。 */
  function updateStageMetrics() {
    if (!mpStage || !mpFrame) return;
    var stageW = mpStage.clientWidth;
    var stageH = mpStage.clientHeight;
    var fw = mpFrame.offsetWidth || 330;
    var fh = mpFrame.offsetHeight || 86;
    var left = Math.max(0, Math.round((stageW - fw) / 2));
    var top = Math.max(0, Math.round((stageH - fh) / 2));
    mpFrame.style.left = left + 'px';
    mpFrame.style.top = top + 'px';
    if (mpCover) {
      mpCover.style.left = left + 'px';
      mpCover.style.top = top + 'px';
      mpCover.style.width = fw + 'px';
      mpCover.style.height = fh + 'px';
    }
  }

  /* ======================================================================
     7. 模拟播放进度
     ----------------------------------------------------------------------
     如实说明：无法从跨域 iframe 读取真实播放进度，这里的进度条是
     本模块自驱的「视觉意象」，并在状态栏标注「模拟」。
     它只在窗口可见且处于播放态时推进，不做任何虚假的同步承诺。
     ====================================================================== */
  var FAKE_DURATION = TRACK.duration || 215;   // 视觉进度条的参考时长（秒）

  function stopTick() {
    if (st.tickTimer) {
      clearInterval(st.tickTimer);
      st.tickTimer = null;
    }
  }

  function startTick() {
    stopTick();
    st.tickTimer = setInterval(function () {
      if (!st.playing || !st.open) return;
      st.elapsed += 0.25;
      if (st.elapsed > FAKE_DURATION) st.elapsed = 0;
      renderProgress();
    }, 250);
  }

  function renderProgress() {
    var pct = Math.min(100, (st.elapsed / FAKE_DURATION) * 100);
    if (mpBar) mpBar.style.width = pct.toFixed(2) + '%';
    if (mpTime) mpTime.textContent = mmss(st.elapsed) + ' / ' + mmss(FAKE_DURATION);
  }

  function setPlaying(on) {
    st.playing = !!on;
    winMp.classList.toggle('is-playing', st.playing);
    if (mpBtnPlay) {
      mpBtnPlay.setAttribute('aria-pressed', String(st.playing));
      mpBtnPlay.title = st.playing ? '暂停（视觉）' : '播放（视觉）';
    }
    /* 按钮字形：播放三角 / 暂停双竖线 */
    var glyph = $('mpPlayGlyph');
    if (glyph) glyph.className = st.playing ? 'mp-glyph mp-glyph--pause' : 'mp-glyph mp-glyph--play';
    if (st.playing) startTick(); else stopTick();
    setText('mpStatusMain', st.playing ? '播放中（视觉）' : '已暂停');
  }

  /* ======================================================================
     8. 事件绑定
     ====================================================================== */
  mpBtnMin.addEventListener('click', function () { hide('min'); });
  mpBtnClose.addEventListener('click', function () { hide('close'); });
  mpBtnMax.addEventListener('click', toggleMax);
  mpTitlebar.addEventListener('mousedown', onDragStart);
  mpTitlebar.addEventListener('touchstart', onDragStart, { passive: false });
  mpTitlebar.addEventListener('dblclick', function (e) {
    if (e.target.closest && e.target.closest('.title-btn')) return;
    toggleMax();
  });

  mpTaskBtn.addEventListener('click', toggle);

  /* 覆盖层热区：阻止事件穿透到 iframe。
     同时给出「按下」视觉反馈（.is-pressed），避免用户以为点击失灵。 */
  if (mpCover) {
    var hots = mpCover.querySelectorAll('.mp-hot');
    for (var i = 0; i < hots.length; i++) {
      (function (hot) {
        hot.addEventListener('mousedown', function (e) {
          e.preventDefault();
          hot.classList.add('is-pressed');
        });
        hot.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          hot.classList.remove('is-pressed');
          var act = hot.getAttribute('data-hot');
          onHot(act);
        });
        hot.addEventListener('mouseup', function () { hot.classList.remove('is-pressed'); });
        hot.addEventListener('mouseleave', function () { hot.classList.remove('is-pressed'); });
        /* 键盘可达：热区可 Tab 聚焦、回车触发 */
        hot.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onHot(hot.getAttribute('data-hot'));
          }
        });
      })(hots[i]);
    }
  }

  /* 热区行为：这些都是「视觉层」的操作，不宣称已控制 iframe 内部。
     play/prev/next 会尝试向目标源广播一次 postMessage（尽力而为），
     失败无副作用；同时更新本地视觉状态。 */
  function onHot(act) {
    if (act === 'play') {
      setPlaying(!st.playing);
      broadcast('toggle');
      return;
    }
    if (act === 'prev') {
      st.elapsed = 0; renderProgress();
      broadcast('prev');
      mpToast('上一首', '覆盖层已拦截该点击（不会穿透到网易云原生控件）。');
      return;
    }
    if (act === 'next') {
      st.elapsed = 0; renderProgress();
      broadcast('next');
      mpToast('下一首', '覆盖层已拦截该点击（不会穿透到网易云原生控件）。');
      return;
    }
  }

  /* 尽力而为地广播控制指令。
     注意：网易云 outchain 播放器未声明接受此类消息，实际预期无效。
     代码保留是为了「一旦对方将来支持」即可生效，且不产生任何副作用。 */
  function broadcast(cmd) {
    if (!mpFrame || !mpFrame.contentWindow) return;
    try {
      mpFrame.contentWindow.postMessage(
        JSON.stringify({ type: 'wmp-control', cmd: cmd, t: Date.now() }),
        PLAYER_ORIGIN
      );
    } catch (e) {
      /* 跨域下 postMessage 亦可抛错，静默忽略 */
    }
  }

  if (mpBtnPlay) {
    mpBtnPlay.addEventListener('click', function () { onHot('play'); });
  }
  if (mpBtnPrev) {
    mpBtnPrev.addEventListener('click', function () { onHot('prev'); });
  }
  if (mpBtnNext) {
    mpBtnNext.addEventListener('click', function () { onHot('next'); });
  }

  /* 工具栏按钮：与覆盖层热区共用同一套行为 */
  if (mpTbPlay) mpTbPlay.addEventListener('click', function () { onHot('play'); });
  if (mpTbPrev) mpTbPrev.addEventListener('click', function () { onHot('prev'); });
  if (mpTbNext) mpTbNext.addEventListener('click', function () { onHot('next'); });
  if (mpTbReload) {
    mpTbReload.addEventListener('click', function () {
      if (!mpFrame) return;
      var src = mpFrame.getAttribute('data-src') || '';
      mpFrame.setAttribute('src', src + '&_=' + Date.now());
      st.elapsed = 0; renderProgress();
      mpToast('播放器已重载', '已重新向 music.163.com 请求播放器文档。');
    });
  }
  if (mpTbHelp) {
    mpTbHelp.addEventListener('click', function () {
      var fn = global.WinMainDialogs && global.WinMainDialogs.playerHelp;
      if (typeof fn === 'function') fn();
      else mpToast('关于覆盖层',
        'iframe 跨域，无法改写其内部 DOM；本窗口用同框覆盖层实现经典外观，' +
        '点「皮肤」可回落到原生控件。');
    });
  }

  if (mpBtnSkin) {
    mpBtnSkin.addEventListener('click', function () {
      setSkin(!st.skin);
      mpToast(st.skin ? '已启用经典皮肤' : '已回落到原生控件',
        st.skin
          ? '网易云原生控件被经典外观覆盖；播放/上一首/下一首由覆盖层拦截。'
          : '覆盖层已隐藏，可直接使用网易云原生控件（推荐需要精确控制时使用）。');
    });
  }

  /* 点击进度条槽位：仅移动「视觉」进度，不触碰真实播放位置 */
  var mpTrack = $('mpTrack');
  if (mpTrack) {
    mpTrack.addEventListener('click', function (e) {
      var r = mpTrack.getBoundingClientRect();
      var ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      st.elapsed = ratio * FAKE_DURATION;
      renderProgress();
      e.preventDefault();
    });
  }

  /* 菜单项：皮肤开关（供查看菜单调用） */
  global.WinPlayerMenu = {
    setSkin: setSkin,
    toggleSkin: function () { setSkin(!st.skin); },
    togglePlay: function () { onHot('play'); },
    reset: function () { st.elapsed = 0; renderProgress(); },
  };

  /* ======================================================================
     9. 视口变化：最大化态需重新贴合
     ====================================================================== */
  var resizeTimer = null;
  global.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!st.open) return;
      if (st.maxed) {
        winMp.style.left = '0px';
        winMp.style.top = '0px';
        fitToDesktop();
      } else if (winMp.style.position === 'absolute') {
        var w = winMp.offsetWidth;
        var left = parseFloat(winMp.style.left) || 0;
        var top = parseFloat(winMp.style.top) || 0;
        var desktop2 = $('desktop');
        var maxLeft = desktop2.clientWidth - 140;
        var maxTop = global.innerHeight - 62;
        winMp.style.left = Math.min(Math.max(left, -(w - 140)), maxLeft) + 'px';
        winMp.style.top = Math.min(Math.max(top, -6), maxTop) + 'px';
      }
      updateStageMetrics();
    }, 120);
  });

  /* Esc 关闭（仅在播放器为活动窗口时） */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!st.open) return;
    var dlg = $('dialog');
    if (dlg && dlg.classList.contains('is-open')) return;
    var active = document.activeElement;
    if (active && active.closest && active.closest('#winMp')) hide('min');
  });

  /* ======================================================================
     10. 启动
     ====================================================================== */
  setSkin(true);
  renderProgress();
  setText('mpStatusTrack', TRACK.title + ' · ' + TRACK.artist);
  setText('mpCoverTitle', TRACK.title + ' — ' + TRACK.artist);
  /* 窗口标题也带上曲名，任务栏按钮与标题栏保持一致 */
  var mpT = $('mpTitle');
  if (mpT) mpT.textContent = '媒体播放器 · ' + TRACK.title;

  if (global.WinWM && typeof global.WinWM.register === 'function') {
    global.WinWM.register('winMp', {
      isVisible: function () { return st.open && !winMp.classList.contains('is-hidden'); },
      setInactive: setInactive,
      show: show,
      hide: function () { hide('min'); },
    });
  }

  global.WinPlayer = {
    open: open,
    close: function () { hide('close'); },
    minimize: function () { hide('min'); },
    isOpen: function () { return st.open; },
    isActive: function () {
      return !!(global.WinWM && global.WinWM.activeId === 'winMp');
    },
    toggleMax: toggleMax,
    setSkin: setSkin,
    getTrack: function () { return { id: TRACK.id, title: TRACK.title, artist: TRACK.artist }; },
  };
})(window);
