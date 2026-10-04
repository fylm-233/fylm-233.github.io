/* ==========================================================================
   player.js — 媒体播放机窗口（原生音频播放 + Windows 3.1 视觉）  v2
   --------------------------------------------------------------------------
   兼容目标：EdgeHTML 18（Edge 18 / Windows 10 1809）及以上

   职责边界（与 app.js / notepad.js 解耦）
     · 只负责「媒体播放机」窗口的窗口管理、音频播放与控件交互
     · 与主窗口、记事本共用 window.WinWM 契约完成活动态互斥
     · 对外暴露 window.WinPlayer / window.WinPlayerMenu
     · 桌面图标 / 工具菜单 / 开始菜单 / 任务栏按钮统一走本模块

   ──────────────────────────────────────────────────────────────────────────
   v1 → v2 的根本变化
   ──────────────────────────────────────────────────────────────────────────
   v1 播放的是 music.163.com 的外链 iframe。跨域使父文档：
       ✗ 读不到 iframe 内部 DOM     ✗ 注不进样式     ✗ 拿不到真实播放进度
   因此 v1 只能做「视觉覆盖层 + 点击拦截 + 自驱模拟进度」，
   并在文档里如实声明「这不是真正的控件替换」。

   v2 改用本站自有的 assets/audio/dreamy-noise.mp3，经 HTMLAudioElement 播放：
       ✓ 进度 / 时长 / 音量 / 播放态全部是**真实值**（timeupdate / loadedmetadata）
       ✓ 可精确 seek、调音量、循环、静音
       ✓ 不再需要同框对齐、pointer-events 分层、postMessage 广播等任何跨域 hack

   字形一律用 border 三角形绘制 —— 禁用 clip-path（Edge 79+ 才支持，
   在 EdgeHTML 18 会退化成实心方块）。
   ========================================================================== */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ======================================================================
     0. 曲库元数据
     ----------------------------------------------------------------------
     与 assets/audio/ 下的实际文件一一对应。曲目信息用于标题栏、刻度读数
     与播放列表；duration 为兜底值，真实时长以 loadedmetadata 事件为准。
     ====================================================================== */
  var TRACKS = [
    {
      id: 'dreamy-noise',
      title: 'Dreamy Noise',
      artist: 'ゆうかなで',
      file: 'assets/audio/dreamy-noise.mp3',
      duration: 0,          // 0 = 待 loadedmetadata 填充真实值
    },
  ];

  var cur = 0;              // 当前曲目索引

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

  var mpAudio      = $('mpAudio');
  var mpStage      = $('mpStage');
  var mpScale      = $('mpScale');
  var mpBar        = $('mpBar');
  var mpKnob       = $('mpKnob');
  var mpSpinLeft   = $('mpSpinLeft');
  var mpSpinRight  = $('mpSpinRight');
  var mpTime       = $('mpTime');
  var mpDur        = $('mpDur');
  var mpCoverTitle = $('mpCoverTitle');

  var mpBtnPlay    = $('mpBtnPlay');
  var mpBtnStop    = $('mpBtnStop');
  var mpBtnPause   = $('mpBtnPause');
  var mpBtnFirst   = $('mpBtnFirst');
  var mpBtnPrev    = $('mpBtnPrev');
  var mpBtnFwd     = $('mpBtnFwd');
  var mpBtnLast    = $('mpBtnLast');
  var mpBtnEject   = $('mpBtnEject');
  var mpBtnLoop    = $('mpBtnLoop');
  var mpPlayGlyph  = $('mpPlayGlyph');

  var mpVolPanel   = $('mpVolPanel');
  var mpVolSlot    = $('mpVolSlot');
  var mpVolBar     = $('mpVolBar');
  var mpVolKnob    = $('mpVolKnob');
  var mpVolNum     = $('mpVolNum');
  var mpBtnMute    = $('mpBtnMute');
  var mpMuteGlyph  = $('mpMuteGlyph');

  var mpListPanel  = $('mpListPanel');
  var mpList       = $('mpList');

  var mpTbReload   = $('mpTbReload');
  var mpTbVolume   = $('mpTbVolume');
  var mpTbList     = $('mpTbList');
  var mpTbHelp     = $('mpTbHelp');

  var mpStatusMain = $('mpStatusMain');
  var mpStatusMode = $('mpStatusMode');
  var mpStatusTrack = $('mpStatusTrack');
  var mpStatusNote = $('mpStatusNote');

  var mpMiScaleTime = $('mpMiScaleTime');
  var mpMiScaleTrack = $('mpMiScaleTrack');
  var mpMiDevice = $('mpMiDevice');

  /* HTML 未更新时安全退出，避免抛错影响其它窗口 */
  if (!winMp || !mpAudio || !mpTaskBtn) return;

  var reduceMotion = global.matchMedia
    ? global.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  /* ======================================================================
     2. 状态
     ====================================================================== */
  var st = {
    open: false,
    maxed: false,
    pinned: false,
    savedRect: null,
    volPanel: false,      // 音量面板显隐
    listPanel: false,     // 播放列表面板显隐
    volume: 0.8,
    muted: false,
    loop: false,
    scrubbing: false,     // 是否正在拖动刻度条
    seeking: false,
    scaleMode: 'time',    // 刻度语义：'time' | 'track'
    autoAttempted: false, // 首曲自动播放是否已尝试（只尝试一次）
    userInteracted: false,// 用户是否已主动操作过播放控制
    autoplayBlocked: false, // 自动播放是否已被浏览器策略拒绝（等待首次手势重试）
    mutedFallback: false,   // 当前是否处于「静音兜底自动播放」态
  };

  var DESKTOP_WINDOW_ID = 'win';
  var STEP_SEC = 5;       // 快进/后退步长（秒）

  /* ======================================================================
     3. 工具
     ====================================================================== */
  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = String(text == null ? '' : text);
  }

  /* 为一个 SVG 元素整体设置类名。
     注意：SVGElement.className 是只读的 SVGAnimatedString（只有 getter），
     直接 `el.className = '...'` 会抛 TypeError 并中断整段初始化。
     改用 setAttribute 写入 class 属性——HTML 与 SVG 元素通用。 */
  function setSvgClass(el, name) {
    if (!el) return;
    if (el.setAttribute) el.setAttribute('class', String(name));
    else el.className = String(name);
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
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function trackNow() { return TRACKS[cur] || TRACKS[0]; }

  function fullTitle() {
    var t = trackNow();
    return t.artist + ' — ' + t.title;
  }

  /* ======================================================================
     4. 窗口显示 / 隐藏 / 最大化（WinWM 契约，与 notepad.js 语义一致）
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

  function show() {
    st.open = true;
    winMp.classList.remove('is-hidden');
    mpTaskBtn.classList.remove('is-hidden');
    mpTaskBtn.title = '媒体播放机 — ' + trackNow().title;
    winMp.setAttribute('aria-hidden', 'false');
    /* 首次显示时把窗口从「文档流」转为「绝对定位」并锚定到视口内。
       若保持 static + margin:auto，它会排在文档流里，视口偏矮时会被推到
       首屏之外（窗口"打开了"却看不见）。绝对定位则始终在眼底。 */
    if (!st.pinned) {
      pinToPixels();
      st.pinned = true;
    }
    void winMp.offsetWidth;
    winMp.style.opacity = '1';
    winMp.style.transform = 'none';
    activate();
    setText('mpStatusMain', mpAudio.paused ? '就绪' : '播放中');
    /* 从最小化恢复时同步对话框位置 */
    notifyDialog();
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
    /* 最小化/关闭时暂停播放，避免后台持续发声（符合原生播放机行为） */
    pause();
    deactivate();

    var m = wm();
    if (m && typeof m.setActive === 'function' && m.isVisible && m.isVisible('win')) {
      m.setActive('win');
    }
    setText('mpStatusMain', mode === 'close' ? '已关闭' : '已最小化');
    /* 最小化/关闭时同步对话框：父窗口不可见 → 对话框一并收起 */
    notifyDialog();
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

  /* 视口内夹取：桌面水平居中 + 垂直落在可见范围 */
  /* 把窗口从「文档流」转为「绝对定位」并锚定到视口内。
     关键：**不写入固定像素宽度**。宽度交由 CSS（--window-w + 媒体查询）管理，
     否则首次打开时捕获的像素宽会被内联样式冻结，视口变窄后仍沿用旧值 →
     窗口溢出桌面容器（曾经的缺陷）。这里只负责 left/top。 */
  function pinToPixels() {
    var dr = $('desktop').getBoundingClientRect();
    var wr = winMp.getBoundingClientRect();
    var h = wr.height || 208;
    winMp.style.position = 'absolute';
    winMp.style.margin = '0';
    /* 清除可能残留的内联宽度/高度，恢复 CSS 主导 */
    winMp.style.width = '';
    winMp.style.height = '';
    /* 以「生效后的实际宽度」居中；若 CSS 宽度超出桌面，left 收敛为 0 */
    var effW = wr.width || 460;
    if (effW > dr.width) effW = dr.width;
    var left = Math.max(0, (dr.width - effW) / 2);
    var top = 64;
    var maxTop = global.innerHeight - h - 8;
    if (maxTop < top) top = Math.max(8, maxTop);
    winMp.style.left = left + 'px';
    winMp.style.top = top + 'px';
  }

  /* 视口变化时重新锚定：纠正因视口收窄而变得不合法的 left/top，
     并清掉任何来源的残留内联宽度（最大化态除外，它由 fitToDesktop 接管）。 */
  function reclamp() {
    if (!st.open || st.maxed) return;
    if (winMp.style.position !== 'absolute') return;
    var dr = $('desktop');
    if (!dr) return;
    var dw = dr.clientWidth;
    var wr = winMp.getBoundingClientRect();
    if (winMp.style.width) winMp.style.width = '';
    if (wr.width > dw) {
      winMp.style.left = '0px';
    } else {
      var l = parseFloat(winMp.style.left) || 0;
      var maxLeft = Math.max(0, dw - wr.width);
      if (l > maxLeft) winMp.style.left = maxLeft + 'px';
    }
    var wh = wr.height;
    var maxTop = global.innerHeight - wh - 8;
    var t = parseFloat(winMp.style.top) || 0;
    if (t > maxTop && maxTop > 0) winMp.style.top = Math.max(8, maxTop) + 'px';
  }

  /* 最大化：宽度贴合桌面，高度交给 CSS flex 弹性填充（杜绝魔法常量） */
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
      /* 退出最大化：恢复 left/top（宽度不再恢复为像素值，交由 CSS 响应式决定），
         并立即重新收敛，避免在窄视口下沿用旧的 left 造成溢出。 */
      winMp.classList.remove('is-maxed');
      st.maxed = false;
      if (st.savedRect) {
        winMp.style.left = st.savedRect.left;
        winMp.style.top = st.savedRect.top;
      }
      winMp.style.width = '';
      winMp.style.height = '';
      reclamp();
    }
    mpMaxGlyph.className = st.maxed ? 'glyph-max glyph-restore' : 'glyph-max';
    mpBtnMax.title = st.maxed ? '向下还原' : '最大化';
    mpBtnMax.setAttribute('aria-label', mpBtnMax.title);
    mpBtnMax.setAttribute('aria-pressed', String(st.maxed));
    fitToDesktop();
    /* 最大化/还原后同步对话框（避免对话框被新窗口尺寸挤出屏幕） */
    notifyDialog();
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
    var maxLeft = $('desktop').clientWidth - 140;
    var maxTop = global.innerHeight - 62;
    left = Math.min(Math.max(left, -(winMp.offsetWidth - 140)), maxLeft);
    top = Math.min(Math.max(top, -6), maxTop);
    winMp.style.left = left + 'px';
    winMp.style.top = top + 'px';
    /* 对话框跟随父窗口实时移动 */
    notifyDialog();
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
    notifyDialog();
  }

  /* 父窗口位置/尺寸变化后，通知对话框重新夹回视口。
     对话框模块可能尚未加载（加载顺序无关），故做存在性判断。 */
  function notifyDialog() {
    if (global.WinDialog && typeof global.WinDialog.syncOwner === 'function') {
      global.WinDialog.syncOwner();
    }
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
     6. 音频播放引擎
     ----------------------------------------------------------------------
     全部基于 HTMLAudioElement 的真实事件与属性，无任何模拟。
     ====================================================================== */
  function duration() {
    var d = mpAudio.duration;
    return (isFinite(d) && d > 0) ? d : 0;
  }

  function renderProgress() {
    var d = duration();
    var t = mpAudio.currentTime || 0;
    var pct = d > 0 ? (t / d) * 100 : 0;
    if (mpBar) mpBar.style.width = pct + '%';
    if (mpKnob) mpKnob.style.left = Math.max(1, pct) + '%';
    if (mpTime) mpTime.textContent = mmss(t);
    if (mpDur) mpDur.textContent = d > 0 ? mmss(d) : '--:--';
    if (mpStatusNote) mpStatusNote.textContent = d > 0 ? (mmss(t) + ' / ' + mmss(d)) : '--:--';
    if (mpScale) mpScale.setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  /* ----------------------------------------------------------------------
     play([opts])
     ----------------------------------------------------------------------
     opts.fromAutoplay = true 时表示这是「自动播放」发起的一次尝试。此时若被
     浏览器策略拒绝，不当成用户可见的失败，而是：
       ① 置 st.autoplayBlocked，交由「首次手势」监听器稍后重试；
       ② 先退一步尝试 muted 自动播放（浏览器**永远允许**静音自动播放），
          在 UI 上给出「点击取消静音」的入口。
     普通点击播放（无 opts）被拒时才按失败提示用户。

     兼容性：EdgeHTML 18 下 play() 可能不返回 Promise；此处两种分支都覆盖。
     ---------------------------------------------------------------------- */
  function play(opts) {
    var fromAutoplay = !!(opts && opts.fromAutoplay);
    var p;
    try {
      p = mpAudio.play();
    } catch (e) {
      if (fromAutoplay) { onAutoplayRejected(); return; }
      setText('mpStatusMain', '待播放');
      mpToast('无法播放', '浏览器阻止了播放，请点击「播放」按钮重试。');
      return;
    }
    /* EdgeHTML / 旧 Chromium 返回 Promise 可能不存在或不支持 rejection 捕获 */
    if (p && typeof p.then === 'function') {
      p.then(function () {
        setText('mpStatusMain', '播放中');
      })['catch'](function () {
        if (fromAutoplay) { onAutoplayRejected(); return; }
        /* 自动播放被策略拦截（muted 或未交互）——如实提示，不假装成功 */
        setText('mpStatusMain', '待播放');
        mpToast('需要一次交互', '浏览器阻止了自动播放，请点击「播放」按钮开始。');
      });
    } else {
      setText('mpStatusMain', '播放中');
    }
  }

  function pause() {
    mpAudio.pause();
  }

  /* 用户主动暂停：同时脱离静音兜底态，避免「暂停后又被静音拉起」的错觉 */
  function userPause() {
    st.mutedFallback = false;
    pause();
  }

  /* ----------------------------------------------------------------------
     自动播放首曲
     ----------------------------------------------------------------------
     触发时机：音频「就绪」即可。这里同时监听 loadedmetadata 与 canplay，
     并在初始化时做一次 readyState 探测 —— 因为 <audio preload="metadata">
     往往在页面脚本执行**之前**就已触发过 loadedmetadata，若只绑事件而
     不做补触发，首次自动播放会稳定地「错过事件窗口」而静默失败。

     三条约束：
     1. 只自动播放一次（st.autoAttempted）。之后用户按暂停、按停止都不应
        被下一次事件重新拉起——否则「暂停」按钮会失效。
     2. 用户若已主动交互过（点过播放/暂停、拖过进度条），则放弃自动播放，
        以免覆盖用户意图。
     3. 窗口保持隐藏（按产品决定：自动播放仅在后台进行，不自动弹窗）。
     ---------------------------------------------------------------------- */
  function tryAutoplay() {
    if (st.autoAttempted) return;
    if (st.userInteracted) return;
    if (!mpAudio.paused) return;   /* 已经在播（例如 loop 归位），不重复 */
    st.autoAttempted = true;
    play({ fromAutoplay: true });
  }

  /* 自动播放被策略拒绝后的处理：转入「静音兜底」，并等待首次手势重试 */
  function onAutoplayRejected() {
    st.autoplayBlocked = true;
    /* 兜底一：静音自动播放。浏览器对 muted 的自动播放无手势要求，必定成功。 */
    var wasMuted = st.muted;
    mpAudio.muted = true;
    var p2;
    try { p2 = mpAudio.play(); } catch (e) { p2 = null; }
    if (p2 && typeof p2.then === 'function') {
      p2.then(function () {
        /* 静音兜底成功：记录状态，等用户手势或主动点击时解除静音 */
        st.mutedFallback = true;
        setMuted(true, true);
        setText('mpStatusMain', '已静音播放（点击取消静音）');
      })['catch'](function () {
        /* 连静音都被拒（极罕见）：如实置为待播放，手势重试兜底 */
        if (!wasMuted) mpAudio.muted = false;
        setText('mpStatusMain', '待播放');
      });
    } else {
      st.mutedFallback = true;
      setMuted(true, true);
      setText('mpStatusMain', '已静音播放（点击取消静音）');
    }
  }

  /* 首次用户手势：若此前自动播放被拒，则立刻重试（带声音）。
     绑定 once，且 passive —— 不影响页面其它交互，也不阻塞滚动。 */
  function onFirstGesture() {
    if (st.userInteracted) return;
    if (!st.autoplayBlocked) return;
    st.autoplayBlocked = false;
    /* 先解除静音兜底，让这次重试是有声的 */
    if (st.mutedFallback) {
      st.mutedFallback = false;
      mpAudio.muted = false;
      setMuted(false, true);
    }
    if (mpAudio.paused) play({ fromAutoplay: true });
    else setText('mpStatusMain', '播放中');
  }

  st.bindGestureRetry = function () {
    var o = { once: true, passive: true };
    document.addEventListener('pointerdown', onFirstGesture, o);
    document.addEventListener('keydown', onFirstGesture, { once: true });
    document.addEventListener('touchstart', onFirstGesture, o);
  };

  function stop() {
    st.userInteracted = true;
    mpAudio.pause();
    try { mpAudio.currentTime = 0; } catch (e) { /* 元数据未就绪时改值可抛错 */ }
    renderProgress();
    setText('mpStatusMain', '已停止');
  }

  function seekTo(sec) {
    var d = duration();
    if (d <= 0) return;
    st.userInteracted = true;
    sec = Math.min(Math.max(0, sec), d);
    try { mpAudio.currentTime = sec; } catch (e) { return; }
    renderProgress();
  }

  function step(delta) {
    seekTo((mpAudio.currentTime || 0) + delta);
  }

  /* 播放状态镜像到 UI */
  function syncPlayUI() {
    var playing = !mpAudio.paused && !mpAudio.ended;
    winMp.classList.toggle('is-playing', playing);
    if (mpBtnPlay) {
      mpBtnPlay.setAttribute('aria-pressed', String(playing));
      /* 原生播放机语义：处于播放态时 ▶ 呈「按下」凹陷外观，
         与暂停/停止按钮的「抬起」外观形成对比 */
      mpBtnPlay.classList.toggle('is-on', playing);
      mpBtnPlay.title = playing ? '播放中' : '播放';
    }
    if (mpPlayGlyph) {
      /* 播放按钮的 ▶ / ⏸ 互换：只改 <use> 引用的 symbol，**不动盒子尺寸**。
         图标尺寸由 CSS 的 --ico-size × --ico-scale 固定，切换时盒子不变，
         因此图标中心不动、不会跳动（旧版整体改写 className 会连带换掉
         尺寸补丁，导致切换瞬间图标大小变化）。 */
      var useEl = mpPlayGlyph.querySelector ? mpPlayGlyph.querySelector('use') : null;
      var target = playing ? '#mp-i-pause' : '#mp-i-play';
      /* 类名切换负责尺寸档位（play 与 pause 设计尺寸不同，需各自补偿）
         —— SVG 元素必须用 setAttribute('class')，不能赋 className */
      setSvgClass(mpPlayGlyph, playing ? 'mp-ico mp-ico--pause' : 'mp-ico mp-ico--play');
      if (useEl) {
        useEl.setAttribute('href', target);
        /* EdgeHTML 18 只认 xlink:href，两条都写以覆盖新旧引擎 */
        useEl.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', target);
      }
    }
    var m = wm();
    if (playing && st.open) setText('mpStatusMain', '播放中');
  }
  /* 音频事件绑定 */
  function onAudioReady() {
    var d = duration();
    if (d > 0) TRACKS[cur].duration = d;
    renderProgress();
    renderList();
    tryAutoplay();
  }
  mpAudio.addEventListener('loadedmetadata', onAudioReady);
  /* canplay 作为第二入口：某些引擎在 preload="metadata" 下不重发
     loadedmetadata，但会给出 canplay；两个都监听才能保证「就绪即播」。 */
  mpAudio.addEventListener('canplay', onAudioReady);
  mpAudio.addEventListener('durationchange', renderProgress);
  mpAudio.addEventListener('timeupdate', function () {
    if (!st.scrubbing) renderProgress();
  });
  mpAudio.addEventListener('play', syncPlayUI);
  mpAudio.addEventListener('pause', syncPlayUI);
  mpAudio.addEventListener('ended', function () {
    syncPlayUI();
    if (st.loop) {
      seekTo(0);
      play();
    } else {
      setText('mpStatusMain', '播放结束');
      renderProgress();
    }
  });
  mpAudio.addEventListener('error', function () {
    setText('mpStatusMain', '载入失败');
    mpToast('无法载入音频', '请确认 assets/audio/dreamy-noise.mp3 可访问（file:// 下需同目录存在该文件）。');
  });

  /* ======================================================================
     7. 传输控制
     ====================================================================== */
  function togglePlay() {
    /* 任何一次播放/暂停点击都记为「用户已交互」，
       此后不再自动拉起播放，避免覆盖用户意图（例如用户按了暂停）。
       同时清掉「等待手势重试」标记——用户已经自己动手了。 */
    st.userInteracted = true;
    st.autoplayBlocked = false;
    /* 用户主动点击播放时，若仍处于静音兜底态，说明他想要的是有声音的播放 */
    if (mpAudio.paused || mpAudio.ended) {
      if (st.mutedFallback) {
        st.mutedFallback = false;
        mpAudio.muted = false;
        setMuted(false, true);
      }
      play();
    } else {
      pause();
    }
  }

  function setLoop(on) {
    st.loop = !!on;
    mpAudio.loop = st.loop;
    if (mpBtnLoop) {
      mpBtnLoop.classList.toggle('is-on', st.loop);
      mpBtnLoop.setAttribute('aria-pressed', String(st.loop));
      mpBtnLoop.title = st.loop ? '循环播放：开' : '循环播放：关';
    }
    /* 状态栏文案统一由 syncModeText() 计算：面板优先级高于循环。
       此前这里内联了一段重复的三元表达式，与 syncModeText() 的优先级
       不一致（两者同时开启时会给出互相矛盾的文案），故改为直接委托。 */
    syncModeText();
  }

  /* 真实音量控制 */
  function setVolume(v, silent) {
    st.volume = clamp01(v);
    mpAudio.volume = st.volume;
    if (st.volume > 0 && st.muted) setMuted(false, true);
    renderVolume();
    if (!silent) setText('mpStatusMain', '音量 ' + Math.round(st.volume * 100) + '%');
  }

  function setMuted(on, silent) {
    st.muted = !!on;
    mpAudio.muted = st.muted;
    /* 用户手动取消静音时，视为已经脱离「静音兜底」态 */
    if (!st.muted) st.mutedFallback = false;
    if (mpBtnMute) {
      mpBtnMute.classList.toggle('is-on', st.muted);
      mpBtnMute.setAttribute('aria-pressed', String(st.muted));
      mpBtnMute.title = st.muted ? '取消静音' : '静音';
    }
    if (mpMuteGlyph) {
      /* 同播放按钮：只换 symbol 引用，不动盒子尺寸 */
      var mUse = mpMuteGlyph.querySelector ? mpMuteGlyph.querySelector('use') : null;
      var mTarget = st.muted ? '#mp-i-vol-mute' : '#mp-i-vol';
      setSvgClass(mpMuteGlyph, 'mp-ico mp-ico--vol');
      if (mUse) {
        mUse.setAttribute('href', mTarget);
        mUse.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', mTarget);
      }
    }
    if (mpMiDevice) {
      /* 菜单「设备 → 扬声器（默认输出）」的勾选态反映「正在输出」 */
      mpMiDevice.classList.toggle('is-checked', !st.muted);
    }
    renderVolume();
    if (!silent) setText('mpStatusMain', st.muted ? '已静音' : ('音量 ' + Math.round(st.volume * 100) + '%'));
  }

  function renderVolume() {
    var pct = Math.round(st.volume * 100);
    if (mpVolBar) mpVolBar.style.width = pct + '%';
    if (mpVolKnob) mpVolKnob.style.left = Math.max(1, pct) + '%';
    if (mpVolNum) mpVolNum.textContent = st.muted ? '静音' : (pct + '%');
    if (mpVolSlot) mpVolSlot.setAttribute('aria-valuenow', String(pct));
  }

  /* ======================================================================
     8. 刻度条 / 音量条的拖动
     ----------------------------------------------------------------------
     用 pointer 事件模型统一处理鼠标与触摸。拖动期间置 st.scrubbing，
     暂停 timeupdate 对 UI 的覆写，松手后才落定真实 currentTime。
     ====================================================================== */
  function ratioFromEvent(el, e) {
    var r = el.getBoundingClientRect();
    if (r.width <= 0) return 0;
    var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    return clamp01(x / r.width);
  }

  function bindSlider(el, onRatio, onStart, onEnd) {
    if (!el) return;

    function move(e) {
      onRatio(ratioFromEvent(el, e));
      if (e.cancelable) e.preventDefault();
    }
    function up(e) {
      el.classList.remove('is-pressed');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
      if (onEnd) onEnd();
      if (e && e.cancelable) e.preventDefault();
    }
    function down(e) {
      el.classList.add('is-pressed');
      if (onStart) onStart();
      move(e);
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      document.addEventListener('touchmove', move, { passive: false });
      document.addEventListener('touchend', up);
    }

    el.addEventListener('mousedown', down);
    el.addEventListener('touchstart', down, { passive: false });

    /* 键盘可达：方向键微调 */
    el.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowDown') { onRatio(-0.02, true); e.preventDefault(); }
      else if (k === 'ArrowRight' || k === 'ArrowUp') { onRatio(0.02, true); e.preventDefault(); }
      else if (k === 'Home') { onRatio(-1, true); e.preventDefault(); }
      else if (k === 'End') { onRatio(1, true); e.preventDefault(); }
    });
  }

  /* 刻度条：拖动 = seek */
  bindSlider(mpScale, function (r, isKey) {
    var d = duration();
    if (d <= 0) return;
    if (isKey) {
      /* 键盘：相对调整 */
      seekTo((mpAudio.currentTime || 0) + r * d);
      return;
    }
    var t = r * d;
    if (mpBar) mpBar.style.width = (r * 100) + '%';
    if (mpKnob) mpKnob.style.left = Math.max(1, r * 100) + '%';
    if (mpTime) mpTime.textContent = mmss(t);
    mpAudio.currentTime = t;
  }, function () { st.scrubbing = true; }, function () {
    st.scrubbing = false;
    renderProgress();
  });

  /* 音量条：拖动 = 调音量 */
  bindSlider(mpVolSlot, function (r, isKey) {
    if (isKey) setVolume(st.volume + r);
    else setVolume(r);
  }, null, null);

  /* 刻度左右微调按钮 */
  if (mpSpinLeft) {
    mpSpinLeft.addEventListener('click', function () { step(-STEP_SEC); });
  }
  if (mpSpinRight) {
    mpSpinRight.addEventListener('click', function () { step(STEP_SEC); });
  }

  /* ======================================================================
     9. 传输按钮
     ====================================================================== */
  function bindPress(el, fn, opts) {
    if (!el) return;
    el.addEventListener('mousedown', function () { el.classList.add('is-pressed'); });
    el.addEventListener('mouseup', function () { el.classList.remove('is-pressed'); });
    el.addEventListener('mouseleave', function () { el.classList.remove('is-pressed'); });
    el.addEventListener('click', function (e) {
      e.preventDefault();
      el.classList.remove('is-pressed');
      /* 任何一次传输控制点击都算「用户已主动操作」——此后自动播放与
         手势重试都必须让路，否则用户按下的「暂停」会被后台逻辑拉起。
         opts.keepAuto = true 用于少数不应打断自动播放意图的按钮。 */
      if (!opts || !opts.keepAuto) {
        st.userInteracted = true;
        st.autoplayBlocked = false;
      }
      fn();
    });
  }

  bindPress(mpBtnPlay, togglePlay);
  bindPress(mpBtnPause, userPause);
  bindPress(mpBtnStop, stop);
  bindPress(mpBtnFirst, function () { seekTo(0); });
  bindPress(mpBtnPrev, function () { step(-STEP_SEC); });
  bindPress(mpBtnFwd, function () { step(STEP_SEC); });
  bindPress(mpBtnLast, function () {
    var d = duration();
    if (d > 0) seekTo(d - 0.2);
  });
  bindPress(mpBtnEject, function () { stop(); });
  bindPress(mpBtnLoop, function () { setLoop(!st.loop); });
  bindPress(mpBtnMute, function () { setMuted(!st.muted); });

  /* ======================================================================
     10. 面板：音量 / 播放列表（工具栏开关）
     ----------------------------------------------------------------------
     这是原「皮肤开关」的职能替代：音源自有时，回落到原生控件已无意义，
     开关改为切换音量面板与播放列表这两个真正有用的视图。
     ====================================================================== */
  /* 刻度语义切换：'time'（时间轴，默认）/ 'track'（曲目相对位置）
     单曲场景下两者数值一致，差异体现在读数区与状态栏的措辞上，
     保留该开关是为了让菜单结构与参考图一致，并兼容未来多曲库。 */
  function setScaleMode(mode) {
    st.scaleMode = (mode === 'track') ? 'track' : 'time';
    var isTrack = st.scaleMode === 'track';
    if (mpMiScaleTime) mpMiScaleTime.classList.toggle('is-checked', !isTrack);
    if (mpMiScaleTrack) mpMiScaleTrack.classList.toggle('is-checked', isTrack);
    var sep = $('mpTimeSep');
    if (sep) sep.textContent = isTrack ? '·' : '/';
    setText('mpStatusMain', isTrack ? '刻度：曲目位置' : '刻度：时间轴');
    renderProgress();
  }

  function syncModeText() {
    var s;
    if (st.volPanel && st.listPanel) s = '音量 + 列表';
    else if (st.volPanel) s = '音量面板：开';
    else if (st.listPanel) s = '列表：开';
    else s = st.loop ? '循环：开' : '就绪';
    setText('mpStatusMode', s);
  }

  function setVolPanel(on) {
    st.volPanel = !!on;
    if (mpVolPanel) mpVolPanel.hidden = !st.volPanel;
    if (mpTbVolume) {
      mpTbVolume.classList.toggle('is-on', st.volPanel);
      mpTbVolume.setAttribute('aria-pressed', String(st.volPanel));
      mpTbVolume.title = st.volPanel ? '音量面板：已显示（点击隐藏）' : '音量面板：已隐藏（点击显示）';
    }
    var mi = $('mpMiDevice');
    if (mi) mi.classList.toggle('is-checked', st.volPanel);
    syncModeText();
  }

  function setListPanel(on) {
    st.listPanel = !!on;
    if (mpListPanel) mpListPanel.hidden = !st.listPanel;
    if (mpTbList) {
      mpTbList.classList.toggle('is-on', st.listPanel);
      mpTbList.setAttribute('aria-pressed', String(st.listPanel));
      mpTbList.title = st.listPanel ? '播放列表：已显示（点击隐藏）' : '播放列表：已隐藏（点击显示）';
    }
    syncModeText();
  }

  /* 播放列表渲染 */
  function renderList() {
    if (!mpList) return;
    mpList.innerHTML = '';
    for (var i = 0; i < TRACKS.length; i++) {
      var t = TRACKS[i];
      var li = document.createElement('li');
      li.className = 'mp-list__item' + (i === cur ? ' is-current' : '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', i === cur ? 'true' : 'false');
      li.setAttribute('data-idx', String(i));

      var idx = document.createElement('span');
      idx.className = 'mp-list__idx';
      idx.textContent = String(i + 1);

      var nm = document.createElement('span');
      nm.className = 'mp-list__name';
      nm.textContent = t.artist + ' — ' + t.title;

      var du = document.createElement('span');
      du.className = 'mp-list__dur';
      du.textContent = t.duration > 0 ? mmss(t.duration) : '--:--';

      li.appendChild(idx);
      li.appendChild(nm);
      li.appendChild(du);
      mpList.appendChild(li);
    }
  }

  if (mpList) {
    mpList.addEventListener('click', function (e) {
      var li = e.target.closest ? e.target.closest('.mp-list__item') : null;
      if (!li) return;
      var i = parseInt(li.getAttribute('data-idx'), 10);
      if (!isNaN(i) && i !== cur) loadTrack(i);
    });
  }

  /* 切换曲目：本项目只有 1 首，此处保留完整能力以便扩展 */
  function loadTrack(i) {
    if (i < 0 || i >= TRACKS.length) return;
    cur = i;
    var t = TRACKS[cur];
    mpAudio.setAttribute('src', t.file);
    try { mpAudio.load(); } catch (e) { /* 旧引擎可能不支持 */ }
    updateTrackText();
    renderList();
    renderProgress();
    play();
  }

  function updateTrackText() {
    var t = trackNow();
    setText('mpCoverTitle', t.artist + ' — ' + t.title);
    setText('mpStatusTrack', t.artist + ' — ' + t.title);
    var mpT = $('mpTitle');
    if (mpT) mpT.textContent = '媒体播放机 — ' + t.title;
    if (st.open) mpTaskBtn.title = '媒体播放机 — ' + t.title;
  }

  /* ======================================================================
     11. 工具栏 / 菜单事件
     ====================================================================== */
  if (mpTbVolume) {
    mpTbVolume.addEventListener('click', function () { setVolPanel(!st.volPanel); });
  }
  if (mpTbList) {
    mpTbList.addEventListener('click', function () { setListPanel(!st.listPanel); });
  }
  if (mpTbReload) {
    mpTbReload.addEventListener('click', function () {
      seekTo(0);
      play();
      mpToast('已重新载入', '「' + trackNow().title + '」已回到开头并开始播放。');
    });
  }
  if (mpTbHelp) {
    mpTbHelp.addEventListener('click', function () {
      var fn = global.WinMainDialogs && global.WinMainDialogs.playerHelp;
      if (typeof fn === 'function') fn();
      else mpToast('关于媒体播放机',
        '音源为本站自有的 ' + trackNow().file + '，经 HTMLAudioElement 播放，' +
        '进度、时长、音量均为真实值。');
    });
  }

  /* 标题栏按钮 */
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

  /* 对外菜单 API（供 app.js 的 data-act 分支调用） */
  global.WinPlayerMenu = {
    togglePlay: togglePlay,
    play: play,
    pause: pause,
    stop: stop,
    reset: function () { seekTo(0); },
    setVolume: setVolume,
    getVolume: function () { return st.volume; },
    setVolPanel: setVolPanel,
    toggleVolPanel: function () { setVolPanel(!st.volPanel); },
    isVolPanel: function () { return st.volPanel; },
    setListPanel: setListPanel,
    toggleListPanel: function () { setListPanel(!st.listPanel); },
    isListPanel: function () { return st.listPanel; },
    setLoop: setLoop,
    toggleLoop: function () { setLoop(!st.loop); },
    isLoop: function () { return st.loop; },
    setMuted: setMuted,
    toggleMute: function () { setMuted(!st.muted); },
    isMuted: function () { return st.muted; },
    getTrack: function () { return trackNow(); },
    /* 刻度语义：'time' = 显示已播时长（默认）；'track' = 显示曲目相对位置 */
    setScaleMode: function (mode) { setScaleMode(mode); },
    getScaleMode: function () { return st.scaleMode; },
    isPlaying: function () { return !mpAudio.paused && !mpAudio.ended; },
    /* v1 兼容垫片：旧代码调用 setSkin / toggleSkin 时映射到音量面板，避免报错 */
    setSkin: function (on) { setVolPanel(on); },
    toggleSkin: function () { setVolPanel(!st.volPanel); },
  };

  /* ======================================================================
     12. 视口变化：最大化态重新贴合；普通态重新收敛 left/top 并清除残留内联宽度
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
      } else {
        reclamp();
      }
    }, 120);
  });

  /* Esc ：停止并最小化（仅在播放器为活动窗口时） */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!st.open) return;
    var dlg = $('dialog');
    if (dlg && dlg.classList.contains('is-open')) return;
    var active = document.activeElement;
    if (active && active.closest && active.closest('#winMp')) {
      /* 焦点在滑杆上时，Esc 先归还焦点与停止拖动，不冒然关窗 */
      if (active.id === 'mpScale' || active.id === 'mpVolSlot') {
        active.blur();
        return;
      }
      hide('min');
    }
  });

  /* 空格键：播放器为活动窗口且焦点不在控件上时，切换播放 */
  document.addEventListener('keydown', function (e) {
    if (e.key !== ' ' && e.key !== 'Spacebar') return;
    if (!st.open) return;
    var a = document.activeElement;
    if (!a || !a.closest || !a.closest('#winMp')) return;
    var tag = (a.tagName || '').toLowerCase();
    if (tag === 'button' || tag === 'a' || tag === 'input') return;
    if (a.id === 'mpScale' || a.id === 'mpVolSlot') return;
    e.preventDefault();
    togglePlay();
  });

  /* ======================================================================
     13. 启动
     ====================================================================== */
  setVolume(0.8, true);
  setMuted(false, true);
  setLoop(false);
  setVolPanel(false);
  /* 播放列表默认展开：原生播放机不会把列表藏在工具栏开关后面，
     打开窗口即可看到全部曲目；工具栏的列表按钮仍可折叠它。 */
  setListPanel(true);
  setScaleMode('time');
  updateTrackText();
  renderProgress();
  renderList();
  renderVolume();
  syncPlayUI();

  /* 首次手势重试：被策略拒绝时，用户在页面上的第一次点击/按键/触摸
     就会把播放拉起来（有声音），无需再专门找播放按钮。 */
  st.bindGestureRetry();

  /* 补触发：<audio preload="metadata"> 常常在本脚本执行前就已完成
     loadedmetadata，事件窗口已关闭。此处探测 readyState，若元数据已就绪
     则立即触发一次自动播放逻辑（幂等，靠 st.autoAttempted 去重）。 */
  if (mpAudio.readyState >= 1) {
    onAudioReady();
  } else {
    /* readyState 为 0 时，某些引擎不重发事件，补一个载入动作 */
    try { mpAudio.load(); } catch (e) { /* 旧引擎可能不支持 */ }
  }

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
    play: play,
    pause: pause,
    stop: stop,
    setVolume: setVolume,
    getVolume: function () { return st.volume; },
    setVolPanel: setVolPanel,
    setListPanel: setListPanel,
    getTrack: function () {
      var t = trackNow();
      return { id: t.id, title: t.title, artist: t.artist, file: t.file };
    },
    /* 自动播放诊断接口：供验证脚本与排障读取真实状态 */
    getAutoplayState: function () {
      return {
        autoAttempted: st.autoAttempted,
        autoplayBlocked: st.autoplayBlocked,
        mutedFallback: st.mutedFallback,
        userInteracted: st.userInteracted,
        paused: mpAudio.paused,
        muted: mpAudio.muted,
        currentTime: mpAudio.currentTime,
        readyState: mpAudio.readyState,
      };
    },
  };
})(window);
