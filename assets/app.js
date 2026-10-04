/* ==========================================================================
   app.js — Windows Classic 风格主页交互脚本  v2
   --------------------------------------------------------------------------
   兼容目标：EdgeHTML 18（Edge 18 / Windows 10 1809）及以上
             同时兼容 Chromium Edge / Chrome / Firefox / Safari 现代版本

   可用能力（Edge 18 已支持）：
     · ES2017：let/const、箭头函数、async/await
     · fetch + AbortController、Promise、Object.entries、Array.from、Object.assign
     · Element.closest、NodeList.forEach、String.padStart、Number.is*
     · Array.prototype.map / filter / reduce

   未使用（但 Edge 18 同样支持，可按需引入）：
     模板字符串、解构赋值、默认参数、剩余/展开运算符、for...of、Map/Set/Symbol/Proxy

   刻意规避（EdgeHTML 18 不支持，写了会直接语法报错）：
     · 可选链 ?.  与空值合并 ??       —— 需 Edge 80+
     · 可选 catch 绑定 catch { }      —— 需 Edge 79+
     · 对象展开 { ...obj }            —— 需 Edge 79+
     · Array.prototype.flat / flatMap —— 需 Edge 79+
     · String.prototype.replaceAll    —— 需 Edge 85+

   数据读取策略（关键）：
     1. http(s) 环境下用 fetch 读取 ./bili.json
     2. file:// 协议下（双击打开）fetch 必然被同源策略拦截，
        自动回退为 <script src="bili.data.js"> —— 传统 script 标签
        不受 CORS 限制，因此离线双击也能正常渲染
     3. 两者都失败才显示错误对话框
   ========================================================================== */
(() => {
  'use strict';

  /* ======================================================================
     0. 常量
     ====================================================================== */
  const UID          = '11897608';
  const SPACE_URL    = 'https://space.bilibili.com/' + UID;
  const DATA_URL     = 'bili.json';        // 主数据源（与 index.html 同级）
  const FALLBACK_URL = 'bili.data.js';     // file:// 场景的降级数据源
  const GLOBAL_KEY   = 'BILI_DATA';        // bili.data.js 导出的全局变量名
  const TIMEOUT_MS   = 15000;
  const MAX_RETRY    = 2;

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* ======================================================================
     1. 格式化工具
     ====================================================================== */
  const pad2 = (n) => String(n).padStart(2, '0');

  /** HTML 转义，防止标题/签名中的特殊字符破坏结构 */
  const esc = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  /** 数字缩写：12345 → 1.2万 */
  const fmtNum = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return '0';
    if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
    return String(Math.round(n));
  };

  /** 时间戳（秒）→ 2026-10-03 01:37 */
  const fmtTime = (ts) => {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return '';
    const d = new Date(n * 1000);
    if (Number.isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
           ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  };

  /** 时间戳（秒）→ 相对时间 */
  const fmtRel = (ts) => {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return '';
    const diff = Math.floor(Date.now() / 1000) - n;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 86400 * 30) return Math.floor(diff / 86400) + ' 天前';
    if (diff < 86400 * 365) return Math.floor(diff / (86400 * 30)) + ' 个月前';
    return Math.floor(diff / (86400 * 365)) + ' 年前';
  };

  const setText = (id, text) => {
    const el = $(id);
    if (el) el.textContent = String(text == null ? '' : text);
  };
  const setHTML = (id, html) => {
    const el = $(id);
    if (el) el.innerHTML = html;
  };
  /** 为可能不存在的元素绑定事件 */
  const on = (id, type, fn) => {
    const el = $(id);
    if (el) el.addEventListener(type, fn);
  };

  /* ======================================================================
     2. 元素引用
     ====================================================================== */
  const desktop   = $('desktop');
  const win       = $('win');
  const titlebar  = $('titlebar');
  const btnMax    = $('btnMax');
  const maxGlyph  = $('maxGlyph');
  const workspace = $('workspace');
  const taskBtn   = $('taskBtn');
  const startBtn  = $('startBtn');
  const startMenu = $('startMenu');
  const deskIcons = $('deskIcons');
  const videoList = $('videoList');

  const reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  /* ======================================================================
     3. 窗口拖动
     窗口初始由 CSS 居中；首次拖动时把布局结果固化为绝对定位像素值。
     ====================================================================== */
  let dragging = false;
  let dragOffX = 0, dragOffY = 0, dragBaseX = 0, dragBaseY = 0;

  const pinToPixels = () => {
    if (win.style.position === 'absolute') return;
    const wr = win.getBoundingClientRect();
    const dr = desktop.getBoundingClientRect();
    win.style.position = 'absolute';
    win.style.margin   = '0';
    win.style.width    = wr.width + 'px';
    win.style.left     = (wr.left - dr.left) + 'px';
    win.style.top      = (wr.top - dr.top) + 'px';
  };

  const getPoint = (e) => {
    if (e.touches && e.touches.length) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    if (e.changedTouches && e.changedTouches.length) {
      return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  };

  const dragStart = (e) => {
    if (isMaxed) return;
    if (e.target.closest('.title-btn')) return;

    pinToPixels();
    const dr = desktop.getBoundingClientRect();
    const p  = getPoint(e);
    dragBaseX = dr.left;
    dragBaseY = dr.top;
    dragOffX  = p.x - (parseFloat(win.style.left) || 0) - dr.left;
    dragOffY  = p.y - (parseFloat(win.style.top) || 0) - dr.top;
    dragging  = true;

    win.classList.add('is-dragging');
    document.addEventListener('mousemove', dragMove);
    document.addEventListener('mouseup', dragEnd);
    document.addEventListener('touchmove', dragMove, { passive: false });
    document.addEventListener('touchend', dragEnd);
    e.preventDefault();
  };

  const dragMove = (e) => {
    if (!dragging) return;
    const p = getPoint(e);
    const w = win.offsetWidth;

    let left = p.x - dragOffX - dragBaseX;
    let top  = p.y - dragOffY - dragBaseY;

    /* 边界限制：至少保留 140px 可见，避免窗口被拖出屏幕找不回 */
    const maxLeft = desktop.clientWidth - 140;
    const maxTop  = window.innerHeight - 32 - 30;
    left = Math.min(Math.max(left, -(w - 140)), maxLeft);
    top  = Math.min(Math.max(top, -6), maxTop);

    win.style.left = left + 'px';
    win.style.top  = top + 'px';
    e.preventDefault();
  };

  const dragEnd = () => {
    if (!dragging) return;
    dragging = false;
    win.classList.remove('is-dragging');
    document.removeEventListener('mousemove', dragMove);
    document.removeEventListener('mouseup', dragEnd);
    document.removeEventListener('touchmove', dragMove);
    document.removeEventListener('touchend', dragEnd);
    /* 位置记忆：拖动结束即固化并去抖写盘 */
    WM.captureRect('win');
    WM.persist('win');
  };

  titlebar.addEventListener('mousedown', dragStart);
  titlebar.addEventListener('touchstart', dragStart, { passive: false });

  /* ======================================================================
     4. 最大化 / 还原
     工作区高度由 CSS（.window.is-maxed .workspace）通过 calc + vh 自适应，
     无需 JS 参与布局计算。
     ====================================================================== */
  let isMaxed = false;
  let savedRect = null;

  const toggleMax = () => {
    if (!isMaxed) {
      pinToPixels();
      /* 修正 B2：进入最大化前先捕获「最近的 normal 几何」。
         拖动会实时更新 WM 的 rect，因此这里取到的就是拖动后的结果，
         「拖动 → 最大化 → 还原」不会再丢失拖动位置。 */
      WM.captureRect('win');
      const r = WM.reg['win'] ? WM.reg['win'].rect : null;
      savedRect = r
        ? { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px' }
        : { left: win.style.left, top: win.style.top, width: win.style.width };
      win.style.left  = '0px';
      win.style.top   = '0px';
      win.style.width = desktop.clientWidth + 'px';
      win.classList.add('is-maxed');
      isMaxed = true;
    } else {
      if (savedRect) Object.assign(win.style, savedRect);
      win.classList.remove('is-maxed');
      isMaxed = false;
      /* 还原后同步 WM 几何，保证后续拖动/持久化基于正确坐标 */
      WM.captureRect('win');
      WM.persist('win');
    }
    maxGlyph.className = isMaxed ? 'glyph-max glyph-restore' : 'glyph-max';
    btnMax.title = isMaxed ? '向下还原' : '最大化';
    btnMax.setAttribute('aria-label', btnMax.title);
    btnMax.setAttribute('aria-pressed', String(isMaxed));
    updateZoom();
  };

  btnMax.addEventListener('click', toggleMax);
  titlebar.addEventListener('dblclick', (e) => {
    if (e.target.closest('.title-btn')) return;
    toggleMax();
  });

  /* ======================================================================
     5. 最小化 / 关闭 / 恢复
     ----------------------------------------------------------------------
     与 WinWM 的分工（统一框架）：
       · 本文件只负责「主窗口的内容与几何」（拖动、最大化、pinToPixels）；
       · 显隐 / 状态机 / Z 序 / 任务栏联动 / 位置持久化一律交给 WinWM。
     这样三个窗口的窗口行为由同一处代码保证一致，不再各写一份。
     ====================================================================== */
  let hidden = false;

  /* 隐藏：动画 + 状态落地。mode ∈ {'min','close'}。
     reduced-motion 或关闭动画开关时走无动画分支。 */
  const hideWindow = (mode) => {
    if (hidden) return;
    hidden = true;
    closeMenus();
    closeStart();

    /* 记录当前 normal 几何，供位置记忆与最大化还原使用 */
    WM.captureRect('win');

    const optAnim = $('optAnim');
    const animate = !!optAnim && optAnim.checked && !reduceMotion;

    if (animate) {
      const wr = win.getBoundingClientRect();
      const tr = taskBtn.getBoundingClientRect();
      const sx = Math.max(0.06, tr.width / wr.width);
      const sy = Math.max(0.04, tr.height / wr.height);
      const dx = (tr.left + tr.width / 2) - (wr.left + wr.width / 2);
      const dy = (tr.top + tr.height / 2) - (wr.top + wr.height / 2);

      win.style.transformOrigin = '50% 100%';
      win.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) scale(' + sx + ', ' + sy + ')';
      win.style.opacity = '0';
      /* 动画结束后彻底隐藏，避免不可见元素仍拦截点击 */
      setTimeout(() => {
        if (WM.getState('win') === 'normal') return;   // 期间被重新唤醒则放弃隐藏
        win.classList.add('is-hidden');
      }, 240);
    } else {
      win.classList.add('is-hidden');
    }

    /* 状态机：min 与 close 语义不同，任务栏按钮的处置也不同 */
    if (mode === 'close') {
      WM.setState('win', 'closed');
      toast('窗口已关闭', '点击开始菜单或桌面图标即可重新打开。');
      setText('statusMain', '已关闭');
    } else {
      WM.setState('win', 'minimized');
      setText('statusMain', '已最小化');
    }

    /* 交还活动状态给其他可见窗口 */
    WM.releaseFocus('win');
    WM.persist('win');
  };

  const showWindow = () => {
    if (!hidden) {
      /* 已可见：仅需置顶聚焦，不应重复播放出现动画 */
      WM.focus('win');
      return;
    }
    hidden = false;
    WM.setState('win', 'normal');
    /* 位置记忆：优先套用上次保存的几何，否则退回默认锚定 */
    WM.applyRect('win', pinToPixels);
    win.classList.remove('is-hidden', 'is-inactive');
    void win.offsetWidth;                 // 强制回流，保证过渡生效
    win.style.opacity = '1';
    win.style.transform = 'none';
    hideToast();
    setText('statusMain', '就绪');
    WM.focus('win');
    WM.persist('win');
  };

  const toggleWindow = () => (hidden ? showWindow() : hideWindow('min'));

  /* ======================================================================
     5b. 窗口管理器 WinWM（统一框架 · 唯一真相源）
     ----------------------------------------------------------------------
     职责（三窗口共用，模块不再各自实现）：
       1. 注册表：id → { el, taskBtn, api, state, rect, timer }
       2. Z 序：focus(id) 时把该窗口 z-index 提到 maxZ+1，真正实现「点击置顶」
       3. 状态机：normal / minimized / closed（+ maximized 由模块自管修饰）
       4. 任务栏联动：按钮的 is-hidden(closed) / is-minimized / is-active 集中同步
       5. 位置持久化：captureRect / applyRect / persist / recall（localStorage，去抖 + 容错）
     ====================================================================== */
  const WM = (window.WinWM = window.WinWM || {});

  WM.reg        = WM.reg || {};       // id → { el, taskBtn, api, state, rect, saveTimer }
  WM.order      = WM.order || [];     // 登记顺序（保持稳定的继承者选择）
  WM.activeId   = WM.activeId || null;
  WM.maxZ       = WM.maxZ || 5;       // 窗口 z-index 游标（.window 基础值为 5）
  WM.STORE_KEY  = WM.STORE_KEY || 'winclassic.wm.v1';
  WM.SAVE_DEBOUNCE = 200;

  /* ---- 持久化底层（隐私模式 / 存储禁用时静默降级） ---- */
  function safeLoad() {
    try {
      const raw = window.localStorage.getItem(WM.STORE_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (err) { return {}; }
  }
  function safeSave(store) {
    try { window.localStorage.setItem(WM.STORE_KEY, JSON.stringify(store)); }
    catch (err) { /* 忽略：不影响功能 */ }
  }

  /* 登记窗口。api = { isVisible, setInactive, show, hide, getRect, setRect } */
  function wmRegister(id, api) {
    const rec = WM.reg[id] || {};
    if (!WM.reg[id]) WM.order.push(id);
    rec.api = api;
    rec.el = api.el || rec.el || null;
    rec.taskBtn = api.taskBtn || rec.taskBtn || null;
    rec.state = rec.state || 'normal';
    rec.rect = rec.rect || null;
    WM.reg[id] = rec;
    /* 用存储里的历史状态初始化（首次加载时恢复窗口） */
    const saved = safeLoad()[id];
    if (saved && saved.state) rec.state = saved.state;
    syncTaskBtn(id);
  }
  WM.register = wmRegister;   /* 必须暴露：notepad.js / player.js 依赖此入口登记 */

  /* ---- Z 序 ---- */
  function wmRaise(id) {
    const rec = WM.reg[id];
    if (!rec || !rec.el) return;
    WM.maxZ += 1;
    /* 防止极端累积导致 z-index 过大：超过阈值时归一化重排 */
    if (WM.maxZ > 900) wmNormalizeZ();
    rec.el.style.zIndex = String(WM.maxZ);
  }
  function wmNormalizeZ() {
    let z = 5;
    WM.order.forEach((wid) => {
      const rec = WM.reg[wid];
      if (rec && rec.el) { z += 1; rec.el.style.zIndex = String(z); }
    });
    WM.maxZ = z;
  }

  /* ---- 状态 ---- */
  WM.getState = (id) => (WM.reg[id] ? WM.reg[id].state : null);
  WM.setState = (id, state) => {
    const rec = WM.reg[id];
    if (!rec) return;
    rec.state = state;
    if (rec.el) rec.el.setAttribute('data-wm-state', state);
    syncTaskBtn(id);
  };

  /* ---- 任务栏按钮联动（集中处理，消除「图标残留」） ---- */
  function syncTaskBtn(id) {
    const rec = WM.reg[id];
    if (!rec || !rec.taskBtn) return;
    const st = rec.state;
    rec.taskBtn.classList.toggle('is-hidden', st === 'closed');     // 关闭 → 按钮消失
    rec.taskBtn.classList.toggle('is-minimized', st === 'minimized'); // 最小化 → 按钮保留但去高亮
    rec.taskBtn.classList.toggle('is-active', WM.activeId === id && st === 'normal');
  }
  WM.syncTaskBtn = syncTaskBtn;

  /* ---- 焦点：唯一入口，原子完成「置顶 + 高亮 + 互斥」 ---- */
  function wmFocus(id) {
    const rec = WM.reg[id];
    if (!rec || rec.state !== 'normal') return;   // 不可见窗口不可聚焦
    WM.activeId = id;
    wmRaise(id);                                  // 关键修正 C1/C2：聚焦即置顶
    WM.order.forEach((wid) => {
      const r = WM.reg[wid];
      if (!r || !r.api) return;
      r.api.setInactive(wid !== id);
      syncTaskBtn(wid);
    });
  }
  WM.focus = wmFocus;

  /* 某窗口退场（关闭/最小化）时交还焦点。
     规则（按优先级）：
       1) 交给「最近登记的其它可见窗口」——符合「退场后自然落到前台窗口」的直觉；
       2) 若无其它可见窗口，但退场者自身仍可见（关闭≠隐藏的边界情形），
          则保留它自己的焦点，避免出现「窗口明明在屏幕上、却没有活动窗口」的悬空态；
       3) 否则清空 activeId 并刷新所有任务栏按钮高亮。 */
  WM.releaseFocus = (fromId) => {
    if (WM.activeId !== fromId) return;
    const heir = WM.order.slice().reverse().filter((wid) =>
      wid !== fromId && WM.isVisible(wid))[0];
    if (heir) { wmFocus(heir); return; }
    if (WM.isVisible(fromId)) {
      /* 自身仍可见：仅需刷新高亮，activeId 保持不变（防止「可见却无活动窗口」） */
      wmFocus(fromId);
      return;
    }
    WM.activeId = null;
    WM.order.forEach((wid) => { syncTaskBtn(wid); });
  };

  WM.isVisible = (id) => {
    const rec = WM.reg[id];
    return !!(rec && rec.api && rec.api.isVisible());
  };
  WM.isActive = (id) => WM.activeId === id;

  /* ---- 位置持久化 ---- */
  /* 捕获当前几何（仅 normal 态有意义；最大化/隐藏时跳过，避免把满屏坐标当常态） */
  WM.captureRect = (id) => {
    const rec = WM.reg[id];
    if (!rec || !rec.api || typeof rec.api.getRect !== 'function') return null;
    if (rec.state !== 'normal') return rec.rect;
    const r = rec.api.getRect();
    if (r) rec.rect = r;
    return rec.rect;
  };

  WM.persist = (id) => {
    const rec = WM.reg[id];
    if (!rec) return;
    if (rec.saveTimer) clearTimeout(rec.saveTimer);
    rec.saveTimer = setTimeout(() => {
      rec.saveTimer = null;
      const store = safeLoad();
      const prev = store[id] || {};
      store[id] = {
        state: rec.state,
        rect: rec.rect || prev.rect || null,
      };
      safeSave(store);
    }, WM.SAVE_DEBOUNCE);
  };

  /* 套用记忆的几何；无记录或与视口不相容时调用 fallback（默认锚定） */
  WM.applyRect = (id, fallback) => {
    const rec = WM.reg[id];
    if (!rec || !rec.api || typeof rec.api.setRect !== 'function') {
      if (fallback) fallback();
      return false;
    }
    const saved = (safeLoad()[id] || {}).rect;
    if (!saved || !Number.isFinite(saved.left) || !Number.isFinite(saved.top)) {
      if (fallback) fallback();
      return false;
    }
    /* 相容性检查：窗口至少要有 80px 落在视口内，否则视为失效（换屏/旋转） */
    const vw = window.innerWidth, vh = window.innerHeight;
    const onScreen = saved.left < vw - 80 && saved.top < vh - 40 &&
                     saved.left + (saved.width || 0) > 80 && saved.top > -8;
    if (!onScreen) { if (fallback) fallback(); return false; }
    rec.api.setRect(saved);
    rec.rect = saved;
    return true;
  };

  /* 恢复历史状态（页面加载时调用一次）：仅恢复位置，不自动弹出窗口 */
  WM.recallAll = () => {
    WM.order.forEach((wid) => {
      const saved = safeLoad()[wid];
      if (saved && saved.rect) {
        const rec = WM.reg[wid];
        if (rec) rec.rect = saved.rect;
      }
    });
  };

  /* ---- 事件绑定 ---- */
  on('btnMin', 'click', () => hideWindow('min'));
  on('btnClose', 'click', () => hideWindow('close'));
  on('btnMin2', 'click', () => hideWindow('min'));

  /* 任务栏按钮：已关闭 → 显示；已活动 → 最小化；可见非活动 → 聚焦置顶 */
  taskBtn.addEventListener('click', () => {
    if (hidden || WM.getState('win') === 'closed' || WM.getState('win') === 'minimized') {
      showWindow(); return;
    }
    if (WM.isActive('win')) hideWindow('min');
    else WM.focus('win');
  });

  /* 桌面图标：我的电脑 / 回收站 / 最新投稿 → 唤回窗口 */
  ['icoComputer', 'icoRecycle', 'icoVideos'].forEach((id) => {
    on(id, 'click', (e) => { e.preventDefault(); showWindow(); });
  });

  /* 主窗口「点击本体聚焦」：沿用拖动之外的任意 mousedown（捕获阶段），
     修正「点主窗口标题栏不会成为活动窗口」的缺失（与记事本/播放器对齐）。 */
  win.addEventListener('mousedown', () => {
    if (!hidden) WM.focus('win');
  }, true);

  /* 向共享管理器登记主窗口。
     setInactive 只负责「标题栏渐变」——任务栏高亮由 WinWM.syncTaskBtn 统一处理，
     避免两处重复切换导致「两个按钮同时高亮」。 */
  wmRegister('win', {
    el: win,
    taskBtn: taskBtn,
    isVisible: () => !hidden && !win.classList.contains('is-hidden'),
    setInactive: (on2) => { win.classList.toggle('is-inactive', !!on2); },
    show: () => showWindow(),
    hide: () => hideWindow('min'),
    close: () => hideWindow('close'),
    getRect: () => ({
      left: parseFloat(win.style.left) || 0,
      top: parseFloat(win.style.top) || 0,
      width: win.offsetWidth || 0,
      height: win.offsetHeight || 0,
      position: win.style.position || 'relative',
    }),
    setRect: (r) => {
      win.style.position = 'absolute';
      win.style.margin = '0';
      if (r.width) win.style.width = r.width + 'px';
      win.style.left = r.left + 'px';
      win.style.top = r.top + 'px';
    },
  });
  WM.setState('win', 'normal');
  WM.activeId = 'win';
  syncTaskBtn('win');
  taskBtn.classList.add('is-active');

  /* 记事本图标 → 打开记事本窗口（由 notepad.js 提供实现） */
  on('icoNotepad', 'click', (e) => {
    e.preventDefault();
    if (window.WinNotepad && typeof window.WinNotepad.open === 'function') {
      window.WinNotepad.open();
    } else {
      toast('记事本不可用', 'assets/notepad.js 未加载。');
    }
  });

  /* 播放器图标 → 打开媒体播放器窗口（由 player.js 提供实现） */
  on('icoPlayer', 'click', (e) => {
    e.preventDefault();
    if (window.WinPlayer && typeof window.WinPlayer.open === 'function') {
      window.WinPlayer.open();
    } else {
      toast('播放器不可用', 'assets/player.js 未加载。');
    }
  });

  /* ======================================================================
     6. 开始菜单 / 菜单栏
     ====================================================================== */
  let openMenuItem = null;

  function closeMenus() {
    if (openMenuItem) {
      openMenuItem.classList.remove('is-open');
      openMenuItem = null;
    }
  }
  function toggleMenu(item) {
    if (openMenuItem === item) { closeMenus(); return; }
    closeMenus();
    item.classList.add('is-open');
    openMenuItem = item;
  }
  function closeStart() {
    startMenu.classList.remove('is-open');
    startBtn.classList.remove('is-open');
    startBtn.setAttribute('aria-expanded', 'false');
  }
  function toggleStart() {
    if (startMenu.classList.contains('is-open')) {
      closeStart();
    } else {
      closeMenus();
      startMenu.classList.add('is-open');
      startBtn.classList.add('is-open');
      startBtn.setAttribute('aria-expanded', 'true');
    }
  }

  document.querySelectorAll('.menu-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.menu-pop')) return;   // 交给动作处理器
      toggleMenu(item);
      e.preventDefault();
    });
    /* 已有菜单展开时，悬停即切换（Windows 原生行为） */
    item.addEventListener('mouseover', (e) => {
      if (openMenuItem && openMenuItem !== item && !e.target.closest('.menu-pop')) {
        toggleMenu(item);
      }
    });
  });

  startBtn.addEventListener('click', (e) => { toggleStart(); e.stopPropagation(); });

  /* ======================================================================
     7. 动作分发（菜单项 / 开始菜单 / 工具栏共用 data-act）
     ====================================================================== */
  let lastBvid = '';

  function doAction(act) {
    closeMenus();
    closeStart();

    switch (act) {
      case 'refresh':      loadData(); break;
      case 'open-space':   window.open(SPACE_URL, '_blank'); break;
      case 'open-videos':  scrollToEl($('postsGroup')); break;
      case 'open-feed':    scrollToEl($('feedGroup')); break;
      case 'raw':          window.open(DATA_URL, '_blank'); break;
      /* 记事本由 notepad.js 接管；此处仅在其未加载时给出提示，保证降级可用 */
      case 'open-notepad':
        if (window.WinNotepad && typeof window.WinNotepad.open === 'function') {
          window.WinNotepad.open();
        } else {
          toast('记事本不可用', 'assets/notepad.js 未加载，无法打开记事本窗口。');
        }
        break;
      /* 媒体播放器由 player.js 接管，同上做降级处理 */
      case 'open-player':
        if (window.WinPlayer && typeof window.WinPlayer.open === 'function') {
          window.WinPlayer.open();
        } else {
          toast('播放器不可用', 'assets/player.js 未加载，无法打开媒体播放器窗口。');
        }
        break;
      case 'mp-close':
        if (window.WinPlayer) window.WinPlayer.close();
        break;
      case 'mp-reset':
        if (window.WinPlayerMenu) window.WinPlayerMenu.reset();
        break;
      case 'mp-reload':
        if (window.WinPlayerMenu) window.WinPlayerMenu.reset();
        break;
      case 'mp-open-native':
        if (window.WinPlayerMenu) window.WinPlayerMenu.setVolPanel(true);
        toast('设备', '已展开音量面板，可调节输出音量或静音。');
        break;
      case 'mp-open-file':
        if (window.WinPlayerMenu) window.WinPlayerMenu.togglePlay();
        break;
      case 'mp-copy-title':
        copyText(playerNowTitle(), '当前曲目');
        break;
      case 'mp-device-speaker':
        if (window.WinPlayerMenu) window.WinPlayerMenu.setMuted(!window.WinPlayerMenu.isMuted());
        break;
      case 'mp-volume':
        if (window.WinPlayerMenu) window.WinPlayerMenu.toggleVolPanel();
        break;
      case 'mp-scale-time':
        if (window.WinPlayerMenu) window.WinPlayerMenu.setScaleMode('time');
        break;
      case 'mp-scale-track':
        if (window.WinPlayerMenu) window.WinPlayerMenu.setScaleMode('track');
        break;
      case 'mp-help': dialogPlayerHelp(); break;
      case 'copy-link':    copyText(location.href, '本页链接'); break;
      case 'copy-uid':     copyText(UID, 'UID'); break;
      case 'copy-bv':
        if (lastBvid) copyText(lastBvid, '最新 BV 号');
        else toast('暂无数据', '尚未读取到投稿数据，无法复制 BV 号。');
        break;
      case 'select-all':   selectWorkspace(); break;
      case 'mode-thumb':   setViewMode('thumb'); break;
      case 'mode-list':    setViewMode('list'); break;
      case 'toggle-icons':
        $('optIcons').checked = !$('optIcons').checked;
        applyIcons();
        break;
      case 'toggle-thumb':
        $('optThumbs').checked = !$('optThumbs').checked;
        applyThumbs();
        break;
      case 'wall-img':
      case 'wall-gray':
      case 'wall-teal':
      case 'wall-navy':    setWall(act); break;
      case 'check-source': dialogCheckSource(); break;
      case 'about-json':   dialogAboutJson(); break;
      case 'dialog-settings':
        /* 修正 D1/D2：主窗口被最小化/关闭时，先把它恢复并聚焦，
           再滚动到设置区，否则滚动的是不可见容器，用户零反馈。 */
        if (!WM.isVisible('win')) {
          showWindow();
          /* 恢复动画有一帧延迟，推迟滚动以等待布局稳定 */
          setTimeout(() => scrollToEl($('optIcons').closest('.group')), 60);
        } else {
          WM.focus('win');
          scrollToEl($('optIcons').closest('.group'));
        }
        toast('显示设置', '已在右侧「显示设置」中列出，可直接勾选。');
        break;
      case 'about':        dialogAbout(); break;
      case 'compat':       dialogCompat(); break;
      case 'close':
        /* 修正 A1：语义改为「关闭当前活动窗口」。
           优先调用该窗口登记的真实 close（而非 hide 的最小化别名）；
           无活动窗口时兜底关闭主窗口，保持旧行为可用。 */
        if (WM.activeId && WM.activeId !== 'win') {
          const rec = WM.reg[WM.activeId];
          if (rec && rec.api && typeof rec.api.close === 'function') { rec.api.close(); break; }
          if (rec && rec.api && typeof rec.api.hide === 'function') { rec.api.hide(); break; }
        }
        hideWindow('close');
        break;
      default: break;
    }
  }

  /* 全局动作代理：任何带 data-act 的元素被点击都会走到这里 */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.getAttribute('data-act');
    if (!act) return;
    if (el.tagName === 'A') e.preventDefault();
    doAction(act);
  });

  /* 点击空白处关闭菜单 / 开始菜单 */
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-item')) closeMenus();
    if (!e.target.closest('.startmenu') && !e.target.closest('.start-btn')) closeStart();
  });

  /* ======================================================================
     8. 滚动定位 / 视图模式 / 显示设置
     ====================================================================== */
  function scrollToEl(el) {
    if (!el || !workspace) return;
    let top = 0;
    let node = el;
    while (node && node !== workspace && node.offsetParent) {
      top += node.offsetTop;
      node = node.offsetParent;
    }
    workspace.scrollTop = Math.max(0, top - 8);
  }

  function setViewMode(mode) {
    if (!videoList) return;
    const isList = mode === 'list';
    videoList.classList.toggle('mode-list', isList);
    $('btnListMode').classList.toggle('is-pressed', isList);
    $('btnThumbMode').classList.toggle('is-pressed', !isList);
    $('miList').classList.toggle('is-checked', isList);
    $('miThumb').classList.toggle('is-checked', !isList);
    toast('视图', isList ? '已切换为「列表」视图。' : '已切换为「缩略图」视图。');
  }

  function applyIcons() {
    const show = $('optIcons').checked;
    if (deskIcons) deskIcons.style.display = show ? '' : 'none';
    const mi = $('miIcons');
    if (mi) mi.classList.toggle('is-checked', show);
  }

  function applyThumbs() {
    const show = $('optThumbs').checked;
    if (videoList) videoList.classList.toggle('no-thumb', !show);
    const mi = $('miThumbShow');
    if (mi) mi.classList.toggle('is-checked', show);
  }

  /* ---------- 桌面壁纸 ---------- */
  const WALLS = ['wall-img', 'wall-gray', 'wall-teal', 'wall-navy'];
  const FIT_MODES = ['wallfit-cover', 'wallfit-contain', 'wallfit-tile'];
  const WALL_MENU = {
    'wall-img':  'miWallImg',
    'wall-gray': 'miWallGray',
    'wall-teal': 'miWallTeal',
    'wall-navy': 'miWallNavy',
  };

  function setWall(cls) {
    WALLS.forEach((c) => desktop.classList.remove(c));
    desktop.classList.add(cls);
    /* 选择图片壁纸时才叠加网格纹理标记 */
    desktop.setAttribute('data-texture', cls === 'wall-img' ? '0' : '0');
    Object.entries(WALL_MENU).forEach((pair) => {
      const mi = $(pair[1]);
      if (mi) mi.classList.toggle('is-checked', pair[0] === cls);
    });
    toast('桌面背景', cls === 'wall-img' ? '已切换为壁纸图片。' : '已切换桌面背景。');
  }

  /* 壁纸适配模式：cover / contain / tile */
  function setWallFit(mode) {
    FIT_MODES.forEach((c) => desktop.classList.remove(c));
    desktop.classList.add('wallfit-' + mode);
    if (desktop.classList.contains('wall-gray')) {
      /* 经典灰自带点阵纹理，切到图片模式时才有意义 */
      toast('壁纸适配', '当前为纯色背景，「' + mode + '」将在切换到壁纸时生效。');
    } else {
      toast('壁纸适配', '已设为 ' + mode + ' 模式。');
    }
  }

  on('optIcons', 'change', applyIcons);
  on('optThumbs', 'change', applyThumbs);
  on('optAnim', 'change', (e) => {
    toast('显示设置', e.target.checked ? '已开启窗口动画效果。' : '已关闭窗口动画效果。');
  });
  on('btnThumbMode', 'click', () => setViewMode('thumb'));
  on('btnListMode', 'click', () => setViewMode('list'));

  document.querySelectorAll('[data-wall]').forEach((btn) => {
    btn.addEventListener('click', () => setWall(btn.getAttribute('data-wall')));
  });
  document.querySelectorAll('[data-wallfit]').forEach((btn) => {
    btn.addEventListener('click', () => setWallFit(btn.getAttribute('data-wallfit')));
  });

  /* ======================================================================
     9. 工具栏按钮
     ====================================================================== */
  const openSpace = () => window.open(SPACE_URL, '_blank');
  on('tbRefresh', 'click', loadData);
  on('btnRefresh2', 'click', loadData);
  on('btnReload', 'click', loadData);
  on('btnRetry', 'click', loadData);
  on('tbHome', 'click', openSpace);
  on('btnOpenSpace', 'click', openSpace);
  on('btnGo', 'click', openSpace);
  on('tbVideos', 'click', () => scrollToEl($('postsGroup')));
  on('tbFeed', 'click', () => scrollToEl($('feedGroup')));
  on('tbRaw', 'click', () => window.open(DATA_URL, '_blank'));
  on('tbSettings', 'click', () => scrollToEl($('optIcons').closest('.group')));
  on('tbHelp', 'click', dialogAbout);
  on('btnAbout', 'click', dialogAbout);

  /* ======================================================================
     10. 提示条 / 消息框
     ====================================================================== */
  let toastTimer = null;

  function toast(title, body) {
    setHTML('toastTitle', esc(title));
    setHTML('toastBody', esc(body));
    $('toast').classList.add('is-open');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 5000);
  }
  function hideToast() { $('toast').classList.remove('is-open'); }

  const ICON_INFO =
    '<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">' +
    '<circle cx="16" cy="16" r="14" fill="#000080" stroke="#000000"/>' +
    '<path d="M16 13v11" stroke="#ffffff" stroke-width="3"/>' +
    '<rect x="14.6" y="7" width="2.8" height="3" fill="#ffffff"/></svg>';
  const ICON_WARN =
    '<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">' +
    '<path d="M16 4l14 24H2z" fill="#ffff00" stroke="#000000"/>' +
    '<path d="M16 12v9" stroke="#000000" stroke-width="2.6"/>' +
    '<rect x="14.8" y="23" width="2.6" height="2.6" fill="#000000"/></svg>';
  const ICON_ERR =
    '<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">' +
    '<circle cx="16" cy="16" r="14" fill="#e8443a" stroke="#000000"/>' +
    '<path d="M11 11l10 10M21 11L11 21" stroke="#ffffff" stroke-width="3.2"/></svg>';

  let dlgOnOk = null;
  /* 对话框拖动状态（页面级共享：所有 showDialog 调用者共用同一个对话框元素） */
  let dlgOwner = null;      // 触发对话框的「父窗口」元素（可空）
  let dlgDragging = false;
  let dlgOffX = 0, dlgOffY = 0;
  let dlgBaseX = 0, dlgBaseY = 0;
  let dlgPlaced = false;    // 是否已把默认居中固化为像素坐标

  /* 把对话框从「left:50% + margin-left:-W/2」的居中态，
     固化为明确的像素 left/top。每次打开都重做：
     先清掉上一次的像素 left/top 与 dialog--placed，让 CSS 的居中规则重新生效，
     再把居中结果固化。否则重开时会把「上次被拖到的位置」当成居中基准。 */
  function placeDialogOnce() {
    const dlg = $('dialog');
    if (!dlg) return;
    /* 先复位到 CSS 居中态（清内联 left/top + 去掉 placed 类） */
    dlg.classList.remove('dialog--placed');
    dlg.style.left = '';
    dlg.style.top = '';

    /* 测量前先显示，否则 rect 全为 0 */
    const wasOpen = dlg.classList.contains('is-open');
    if (!wasOpen) {
      dlg.style.visibility = 'hidden';
      dlg.classList.add('is-open');
    }
    const r = dlg.getBoundingClientRect();
    dlg.style.left = r.left + 'px';
    dlg.style.top = r.top + 'px';
    dlg.classList.add('dialog--placed');
    if (!wasOpen) {
      dlg.classList.remove('is-open');
      dlg.style.visibility = '';
    }
    dlgPlaced = true;
  }

  /* 把对话框位置夹在视口内，保证标题栏（拖拽把手）始终可及。
     这是「拖出屏幕找不回」的唯一防线，拖动中与父窗口变化时都要调用。 */
  function clampDialog() {
    const dlg = $('dialog');
    if (!dlg || !dlg.classList.contains('is-open')) return;
    const r = dlg.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const MARGIN = 24;          // 至少露出这么多像素
    let left = parseFloat(dlg.style.left);
    let top = parseFloat(dlg.style.top);
    if (!isFinite(left)) left = r.left;
    if (!isFinite(top)) top = r.top;

    /* 水平：完全飞出左/右就拉回；垂直：标题栏至少要留 MARGIN 可见 */
    const minLeft = -(r.width - MARGIN);
    const maxLeft = vw - MARGIN;
    const minTop = 0;
    const maxTop = vh - MARGIN;
    left = Math.min(Math.max(left, minLeft), maxLeft);
    top = Math.min(Math.max(top, minTop), maxTop);

    dlg.style.left = left + 'px';
    dlg.style.top = top + 'px';
  }

  /* 父窗口的最小化 / 最大化 / 移动都会走这里。
     语义：对话框始终「跟随父窗口」——
       · 父窗口不可见（最小化 / 关闭）→ 对话框也隐藏（连带关闭，不留孤儿）
       · 父窗口可见 → 重新夹回视口，保证不会被父窗口变化挤出屏幕 */
  function syncDialogWithOwner() {
    const dlg = $('dialog');
    if (!dlg || !dlg.classList.contains('is-open')) return;
    if (!dlgOwner) return;

    /* 父窗口不可见 → 连同对话框一起收起 */
    const visible =
      dlgOwner.offsetWidth > 0 &&
      dlgOwner.offsetHeight > 0 &&
      !dlgOwner.classList.contains('is-hidden');
    if (!visible) { hideDialog(); return; }
    clampDialog();
  }

  /* 观察父窗口的 class 变化（is-hidden / is-maxed / is-inactive）。
     必要性：播放器的「最小化」在开启动画时延后约 240ms 才加上 is-hidden，
     仅靠调用点同步检查会误判为「仍可见」，从而留下孤儿对话框。
     MutationObserver 能在状态真正落地的那一刻捕获，与动画时长解耦。 */
  let dlgOwnerObserver = null;
  function watchDialogOwner(ownerEl) {
    if (dlgOwnerObserver) { dlgOwnerObserver.disconnect(); dlgOwnerObserver = null; }
    if (!ownerEl || !window.MutationObserver) return;
    dlgOwnerObserver = new MutationObserver(() => { syncDialogWithOwner(); });
    dlgOwnerObserver.observe(ownerEl, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  const dlgGetPoint = (e) => {
    if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  };

  const dlgDragMove = (e) => {
    if (!dlgDragging) return;
    const dlg = $('dialog');
    const p = dlgGetPoint(e);
    /* 固定定位：left/top 直接就是视口坐标，无需减去任何容器原点 */
    dlg.style.left = (p.x - dlgOffX - dlgBaseX) + 'px';
    dlg.style.top  = (p.y - dlgOffY - dlgBaseY) + 'px';
    clampDialog();
    if (e.cancelable) e.preventDefault();
  };

  const dlgDragEnd = () => {
    if (!dlgDragging) return;
    dlgDragging = false;
    $('dialog').classList.remove('is-dragging');
    document.removeEventListener('mousemove', dlgDragMove);
    document.removeEventListener('mouseup', dlgDragEnd);
    document.removeEventListener('touchmove', dlgDragMove);
    document.removeEventListener('touchend', dlgDragEnd);
  };

  const dlgDragStart = (e) => {
    const dlg = $('dialog');
    if (!dlg.classList.contains('is-open')) return;
    /* 标题栏是唯一把手；点在标题栏按钮上不触发拖动 */
    if (e.target.closest('button')) return;

    placeDialogOnce();
    const p = dlgGetPoint(e);
    const r = dlg.getBoundingClientRect();
    dlgBaseX = 0;
    dlgBaseY = 0;
    dlgOffX  = p.x - r.left;
    dlgOffY  = p.y - r.top;
    dlgDragging = true;
    dlg.classList.add('is-dragging');
    document.addEventListener('mousemove', dlgDragMove);
    document.addEventListener('mouseup', dlgDragEnd);
    document.addEventListener('touchmove', dlgDragMove, { passive: false });
    document.addEventListener('touchend', dlgDragEnd);
    if (e.cancelable) e.preventDefault();
  };

  /* 把标题栏绑定成拖拽把手（绑定一次即可，元素是复用的） */
  (function bindDialogDrag() {
    const dlg = $('dialog');
    const bar = dlg && dlg.querySelector('.dialog__title');
    if (!bar) return;
    bar.addEventListener('mousedown', dlgDragStart);
    bar.addEventListener('touchstart', dlgDragStart, { passive: false });
    /* 父窗口尺寸/位置/显隐变化时同步（捕获阶段，能收到任意来源的变化） */
    window.addEventListener('resize', () => { if (dlgOwner) syncDialogWithOwner(); });
  })();

  function showDialog(opts) {
    const o = opts || {};
    $('dlgTitle').textContent = o.title || '消息';
    $('dlgIcon').innerHTML = o.icon || ICON_INFO;
    $('dlgText').innerHTML = o.html || '';
    $('dlgOk').textContent = o.okText || '确定';
    $('dlgCancel').style.display = o.cancelText ? '' : 'none';
    if (o.cancelText) $('dlgCancel').textContent = o.cancelText;
    dlgOnOk = o.onOk || null;
    /* 记录父窗口：用于最小化/最大化/移动时的联动 */
    dlgOwner = o.owner || null;
    dlgPlaced = false;                 // 每次打开都重新落位

    $('modalMask').classList.add('is-open');
    $('dialog').classList.add('is-open');
    placeDialogOnce();
    clampDialog();
    watchDialogOwner(dlgOwner);
    $('dlgOk').focus();
  }

  function hideDialog() {
    $('modalMask').classList.remove('is-open');
    $('dialog').classList.remove('is-open');
    /* 立刻结束可能进行中的拖动，避免隐藏后仍残留全局监听 */
    dlgDragEnd();
    watchDialogOwner(null);
    dlgOnOk = null;
    dlgOwner = null;
    dlgPlaced = false;
  }

  window.WinDialog = window.WinDialog || {
    /* 供其他模块（notepad.js 等自带开框逻辑者）复用的落位入口：
       固化居中为像素坐标 + 记录父窗口 + 夹回视口。 */
    place: (dlgEl, ownerEl) => {
      dlgOwner = ownerEl || null;
      dlgPlaced = false;
      placeDialogOnce();
      clampDialog();
      watchDialogOwner(dlgOwner);
    },
    syncOwner: syncDialogWithOwner,
    isOpen: () => $('dialog').classList.contains('is-open'),
    getRect: () => {
      const d = $('dialog');
      const r = d.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    },
    getOwner: () => dlgOwner,
  };

  on('dlgOk', 'click', () => {
    const fn = dlgOnOk;
    hideDialog();
    if (typeof fn === 'function') fn();
  });
  on('dlgCancel', 'click', hideDialog);
  on('modalMask', 'click', hideDialog);

  /* ---------- 各类对话框内容 ---------- */
  function dialogAbout() {
    showDialog({
      title: '关于本页',
      html:
        '<p><b>Windows Classic 风格 · 哔哩哔哩信息主页</b></p>' +
        '<p style="margin-top:6px;">以 Windows 3.1 – 2000 的经典界面为蓝本，' +
        '用 HTML5 + 现代 JavaScript 手工复刻凹凸立体边框、标题栏按钮、菜单栏、' +
        '工具栏、状态栏与任务栏。</p>' +
        '<p style="margin-top:6px;">数据来自 <code>' + DATA_URL + '</code>，' +
        '由 GitHub Actions 每 6 小时抓取一次。</p>' +
        '<p style="margin-top:6px;">目标账号：UID ' + UID + '</p>',
    });
  }

  function dialogCompat() {
    showDialog({
      title: '兼容性说明',
      html:
        '<p><b>浏览器支持基线：EdgeHTML 18（Edge 18 / Windows 10 1809）</b></p>' +
        '<ul style="margin:6px 0 0 0;">' +
        '<li>脚本使用 ES2017 语法与 <code>fetch</code> + <code>AbortController</code>。</li>' +
        '<li>样式使用 CSS 自定义属性、Flexbox 与 CSS Grid。</li>' +
        '<li>立体边框由 <code>border</code> 双色 + <code>box-shadow: inset</code> 模拟。</li>' +
        '<li>进度条为纯 CSS 关键帧动画，无需 JS 驱动。</li>' +
        '<li>自定义滚动条在 Chromium 内核下生效，EdgeHTML 回退为系统原生样式。</li>' +
        '</ul>',
    });
  }

  function dialogAboutJson() {
    const d = state.data;
    if (!d) {
      showDialog({ title: '关于 bili.json', icon: ICON_WARN, html: '尚未成功读取数据文件，暂无信息。' });
      return;
    }
    showDialog({
      title: '关于 bili.json',
      html:
        '<p>抓取方式：B 站 WBI 签名接口（<code>x/space/wbi/arc/search</code> 等）</p>' +
        '<p>生成时间：<code>' + esc(d.generated_at || '-') + '</code></p>' +
        '<p>数据状态：<code>' + (d.ok ? '正常' : '降级（保留旧数据）') + '</code>' +
        (d.stale ? ' · <b>当前为缓存版本</b>' : '') + '</p>' +
        '<p>投稿条数：<code>' + ((d.videos && d.videos.length) || 0) + '</code></p>' +
        (d.errors && d.errors.length
          ? '<p style="margin-top:6px;color:#a00;">最近错误：' + esc(d.errors.join('；')) + '</p>'
          : ''),
    });
  }

  function dialogCheckSource() {
    const url = new URL(DATA_URL, location.href).href;
    showDialog({
      title: '检查数据源',
      html:
        '<p>请求地址：</p>' +
        '<p><code style="word-break:break-all;">' + esc(url) + '</code></p>' +
        '<p style="margin-top:6px;">当前协议：<code>' + esc(location.protocol) + '</code></p>' +
        '<p>最近状态：<code>' + esc(state.lastStatus) + '</code></p>' +
        '<p>尝试次数：<code>' + state.attempt + '</code></p>',
    });
  }

  /* ---------- 播放器：当前曲目标题（供「复制曲目」使用） ---------- */
  function playerNowTitle() {
    const el = $('mpCoverTitle');
    if (el && el.textContent) return el.textContent;
    const st = $('mpStatusTrack');
    if (st && st.textContent) return st.textContent;
    return '媒体播放机';
  }

  /* ---------- 播放器：关于本站媒体播放机 ---------- */
  function dialogPlayerHelp() {
    showDialog({
      title: '关于媒体播放机',
      icon: ICON_INFO,
      okText: '知道了',
      /* 父窗口：播放器窗口。用于最小化/最大化/移动时的联动（见 syncDialogWithOwner） */
      owner: document.getElementById('winMp'),
      html:
        '<p><b>这是一个完全自包含的经典风格播放器。</b></p>' +
        '<p style="margin-top:6px;">音频来自本仓库自带的 <code>assets/audio/dreamy-noise.mp3</code>，' +
        '与页面同源，因此<b>不存在跨域限制</b>，所有控件都作用于真实播放状态。</p>' +
        '<p style="margin-top:8px;"><b>真实（非模拟）的部分：</b></p>' +
        '<ul style="margin:6px 0 0 0;">' +
        '<li><b>进度刻度</b>：直接映射 <code>&lt;audio&gt;</code> 的 <code>currentTime / duration</code>，可拖动跳转。</li>' +
        '<li><b>时间读数</b>：播放中每秒刷新，格式 <code>mm:ss</code>。</li>' +
        '<li><b>音量</b>：「设备 → 音量」面板内的滑杆，实时写入 <code>volume</code>；静音按钮切换 <code>muted</code>。</li>' +
        '<li><b>循环</b>：传输按钮排最右侧，切换 <code>loop</code>，单曲可无缝重复。</li>' +
        '</ul>' +
        '<p style="margin-top:8px;"><b>键盘快捷键：</b></p>' +
        '<ul style="margin:6px 0 0 0;">' +
        '<li><code>空格</code> — 播放 / 暂停</li>' +
        '<li><code>←</code> / <code>→</code> — 后退 / 前进 5 秒</li>' +
        '<li><code>Home</code> / <code>End</code> — 回到开头 / 跳到结尾</li>' +
        '<li><code>Esc</code> — 最小化窗口</li>' +
        '</ul>' +
        '<p style="margin-top:8px; color:#404040;">' +
        '提示：若以 <code>file://</code> 方式直接打开页面，部分浏览器会拦截本地音频加载，' +
        '请改用本地 HTTP 服务（例如 <code>python -m http.server 8000</code>）。</p>',
    });
  }

  function dialogLoadError(reason) {
    const isFile = location.protocol === 'file:';
    showDialog({
      title: '无法加载数据源',
      icon: ICON_ERR,
      okText: '重试',
      cancelText: '关闭',
      onOk: loadData,
      html:
        '<p><b>未能读取 ' + (isFile ? '<code>' + FALLBACK_URL + '</code>' : '<code>' + DATA_URL + '</code>') + '。</b></p>' +
        '<p style="margin-top:6px;">原因：' + esc(reason) + '</p>' +
        '<p style="margin-top:8px;">排查方向：</p>' +
        '<ul style="margin:4px 0 0 0;">' +
        (isFile
          ? '<li>当前是 <code>file://</code> 协议，数据应由同级的 <code>bili.data.js</code> 提供。' +
            '请先运行 <code>python scripts/fetch_bili.py</code> 生成该文件。</li>' +
            '<li>若只需预览布局，可改用本地 HTTP 服务：<code>python -m http.server 8000</code>。</li>'
          : '<li>文件尚未生成：请先运行 <code>python scripts/fetch_bili.py</code>。</li>') +
        '<li>确认数据文件与 <code>index.html</code> 处于同一目录。</li>' +
        '</ul>',
    });
  }

  /* ======================================================================
     11. 剪贴板 / 全选
     ====================================================================== */
  async function copyText(text, label) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        /* 旧内核兜底：临时 textarea + execCommand */
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (!ok) throw new Error('execCommand 失败');
      }
      toast('已复制', label + ' 已复制到剪贴板。');
    } catch (err) {
      window.prompt('当前浏览器不允许自动复制，请手动复制：', text);
    }
  }

  function selectWorkspace() {
    const range = document.createRange();
    range.selectNodeContents(workspace);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    toast('全选', '已选中工作区内容。');
  }

  /* ======================================================================
     12. 数据加载
     ----------------------------------------------------------------------
     优先 fetch(./bili.json)；file:// 协议下 fetch 必然被拦截，
     改为注入 <script src="bili.data.js"> 读取全局变量。
     ====================================================================== */
  const state = { data: null, attempt: 0, lastStatus: '未发起' };

  /** 用 <script> 标签加载数据（不受 CORS 限制，file:// 下同样可用） */
  function loadViaScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url + '?v=' + Date.now();
      script.onload = () => {
        const data = window[GLOBAL_KEY];
        script.remove();
        if (data && typeof data === 'object') resolve(data);
        else reject(new Error(url + ' 已加载，但未导出 window.' + GLOBAL_KEY));
      };
      script.onerror = () => {
        script.remove();
        reject(new Error('无法加载 ' + url));
      };
      document.head.appendChild(script);
    });
  }

  /** fetch 读取 JSON，带超时；错误对象附带 nonRetryable 标记 */
  async function fetchJSON(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      state.lastStatus = 'HTTP ' + res.status;
      if (!res.ok) {
        const err = new Error(('HTTP ' + res.status + ' ' + res.statusText).trim());
        err.nonRetryable = [400, 403, 404].indexOf(res.status) > -1;
        throw err;
      }
      try {
        return await res.json();
      } catch (parseErr) {
        const err = new Error('数据不是合法的 JSON（' + parseErr.message + '）');
        err.nonRetryable = true;
        throw err;
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('请求超时（' + (TIMEOUT_MS / 1000) + ' 秒无响应）');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 取得数据：http 走 fetch，file:// 直接走 script 回退 */
  async function fetchData() {
    if (location.protocol === 'file:') {
      state.lastStatus = 'file:// 协议 → ' + FALLBACK_URL;
      return loadViaScript(FALLBACK_URL);
    }
    try {
      return await fetchJSON(DATA_URL + '?v=' + Date.now());
    } catch (err) {
      /* fetch 失败时再试一次 script 方式（例如本地服务器未开放 CORS） */
      state.lastStatus = err.message + ' → 回退 ' + FALLBACK_URL;
      return loadViaScript(FALLBACK_URL);
    }
  }

  async function loadData() {
    /* 进入加载态 */
    $('postsLoading').style.display = '';
    $('postsError').style.display = 'none';
    videoList.style.display = 'none';
    setHTML('feedList', '<div class="empty">正在读取…</div>');
    setText('statusMain', '正在读取…');
    setText('statusHint', '正在请求数据文件…');

    let lastErr = null;

    for (let attempt = 1; attempt <= MAX_RETRY + 1; attempt++) {
      state.attempt = attempt;
      try {
        const data = await fetchData();
        state.attempt = 0;
        render(data);
        return;
      } catch (err) {
        lastErr = err;
        if (err.nonRetryable || attempt > MAX_RETRY) break;
        setText('statusHint', '第 ' + attempt + ' 次尝试失败，正在重试…');
        await sleep(900 * attempt);
      }
    }

    showLoadError((lastErr && lastErr.message) || '未知错误');
  }

  function showLoadError(reason) {
    $('postsLoading').style.display = 'none';
    videoList.style.display = 'none';
    $('postsError').style.display = '';
    setHTML('errDesc', '未能读取 <code>' + esc(DATA_URL) + '</code>。原因：' + esc(reason));
    setHTML('feedList',
      '<div class="empty"><span class="empty__big">数据不可用</span>' +
      '无法读取数据文件，动态列表暂时无法显示。</div>');

    setText('statusMain', '加载失败');
    setText('statusHint', '请检查数据文件是否存在，或点击「重试」');
    setText('kvState', '加载失败：' + reason);
    setText('listInfo', '数据源不可用');

    dialogLoadError(reason);
  }

  /* ======================================================================
     13. 渲染
     ====================================================================== */
  function render(data) {
    if (!data || typeof data !== 'object') {
      showLoadError('数据内容为空或格式不正确。');
      return;
    }
    state.data = data;

    $('postsLoading').style.display = 'none';
    $('postsError').style.display = 'none';
    videoList.style.display = '';

    renderProfile(data.user || {}, data.stat || {});
    renderVideos(data.videos);
    renderFeed(data.dynamics);
    renderPartitions(data.partitions);
    renderMeta(data);
  }

  function renderProfile(user, stat) {
    const name = user.name || '（未知 UP 主）';
    setHTML('userName',
      esc(name) + '<span class="profile__uid">UID ' + esc(user.mid || UID) + '</span>');
    setText('sideName', name);

    setText('userSign', user.sign || '这个 UP 主很神秘，什么都没有写。');
    setText('userLevel', 'Lv.' + (user.level != null ? user.level : '-'));
    setText('userFans', '粉丝 ' + (user.fans != null ? fmtNum(user.fans) : '-'));
    setText('userFollow', '关注 ' + (user.following != null ? fmtNum(user.following) : '-'));
    setText('sideLevel', 'Lv.' + (user.level != null ? user.level : '-'));
    setText('sideFans', user.fans != null ? fmtNum(user.fans) : '-');
    setText('sideFollow', user.following != null ? fmtNum(user.following) : '-');

    const avatar = $('avatarImg');
    if (avatar && user.face) {
      avatar.addEventListener('error', () => {
        avatar.src = 'data:image/svg+xml;charset=utf-8,' +
          '%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'82\' height=\'82\'%3E' +
          '%3Crect width=\'82\' height=\'82\' fill=\'%23ffffff\'/%3E' +
          '%3Ccircle cx=\'41\' cy=\'31\' r=\'14\' fill=\'%23c0c0c0\'/%3E' +
          '%3Cpath d=\'M13 82c0-16 12.6-25 28-25s28 9 28 25z\' fill=\'%23c0c0c0\'/%3E%3C/svg%3E';
      }, { once: true });
      avatar.src = user.face;
    }

    /* upstat 对游客返回空对象，因此播放/获赞可能长期为空，用 — 明确表示「无数据」 */
    setText('statPlay', stat.play != null ? fmtNum(stat.play) : '—');
    setText('statLike', stat.like != null ? fmtNum(stat.like) : '—');
    setText('statVideo', stat.video_count != null ? fmtNum(stat.video_count) : '—');
    setText('statFans', user.fans != null ? fmtNum(user.fans) : '—');
  }

  function renderVideos(list) {
    if (!list || !list.length) {
      videoList.innerHTML =
        '<div class="empty"><span class="empty__big">暂无投稿</span>' +
        '数据文件中的 videos 数组为空，或该账号尚未发布公开投稿。</div>';
      setText('postsTag', '0 条');
      setText('statusCount', '投稿 0 条');
      return;
    }

    videoList.innerHTML = list.map((v, i) => {
      const url = v.url || (v.bvid ? 'https://www.bilibili.com/video/' + v.bvid : SPACE_URL);
      const title = v.title || '（无标题）';
      if (i === 0) lastBvid = v.bvid || '';

      const thumb = v.cover
        ? '<img src="' + esc(v.cover) + '" alt="' + esc(title) +
          '" width="164" height="91" referrerpolicy="no-referrer">'
        : '<span class="thumb-ph">无封面</span>';

      return '' +
        '<div class="video">' +
          '<a class="video__thumb" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(title) + '">' + thumb + '</a>' +
          '<div class="video__body">' +
            '<a class="btn btn--sm video__go" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">观看</a>' +
            '<p class="video__title"><span class="video__idx">' + (i + 1) + '</span>' +
              '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(title) + '</a></p>' +
            '<p class="video__meta">' +
              '<span>播放 ' + esc(fmtNum(v.play)) + '</span>' +
              (v.comment != null ? '<span>评论 ' + esc(fmtNum(v.comment)) + '</span>' : '') +
              (v.duration ? '<span>时长 ' + esc(v.duration) + '</span>' : '') +
              '<span>发布 ' + esc(v.pubdate_text || fmtTime(v.pubdate)) + '</span>' +
            '</p>' +
            (v.bvid ? '<span class="video__bvid">' + esc(v.bvid) + '</span>' : '') +
          '</div>' +
        '</div>';
    }).join('');

    /* 封面加载失败 → 换成斜纹占位块 */
    videoList.querySelectorAll('img').forEach((img) => {
      img.addEventListener('error', () => {
        const holder = document.createElement('span');
        holder.className = 'thumb-ph';
        holder.textContent = '封面加载失败';
        img.replaceWith(holder);
      }, { once: true });
    });

    setText('postsTag', list.length + ' 条');
    setText('statusCount', '投稿 ' + list.length + ' 条');
  }

  function renderFeed(list) {
    if (!list || !list.length) {
      setHTML('feedList', '<div class="empty">暂无动态数据。</div>');
      setText('feedTag', '0 条');
      return;
    }

    setHTML('feedList', list.map((it) => {
      const item = it || {};
      const isVideo   = item.type === 'video';
      const isProfile = item.type === 'profile';
      const cls = 'feed__item' +
        (isVideo ? ' feed__item--video' : '') +
        (isProfile ? ' feed__item--profile' : '');
      const kind = item.kind || (isVideo ? '投稿' : (isProfile ? '资料' : '动态'));
      const body = item.url
        ? '<a href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer">' + esc(item.text || '') + '</a>'
        : esc(item.text || '');
      const rel = item.ts ? fmtRel(item.ts) : '';
      const time = [item.time_text || fmtTime(item.ts), rel].filter(Boolean).join(' · ');

      return '' +
        '<div class="' + cls + '">' +
          '<span class="feed__dot"></span>' +
          '<div class="feed__body">' +
            '<p class="feed__text"><span class="feed__kind">' + esc(kind) + '</span>' + body + '</p>' +
            '<p class="feed__time">' + esc(time) + '</p>' +
          '</div>' +
        '</div>';
    }).join(''));

    setText('feedTag', list.length + ' 条');
    setHTML('feedInfo', '按时间倒序，共 ' + list.length + ' 条。数据来自 <code>' + DATA_URL + '</code>。');
  }

  function renderPartitions(list) {
    const box = $('partList');
    if (!box) return;
    if (!list || !list.length) {
      box.innerHTML = '<div class="empty" style="padding:12px;">暂无分区数据。</div>';
      return;
    }

    const counts = list.map((p) => (p && Number(p.count)) || 0);
    const max = Math.max.apply(null, counts.concat([0]));

    box.innerHTML = list.map((p) => {
      const item = p || {};
      const count = Number(item.count) || 0;
      const pct = Math.max(max > 0 ? Math.round((count / max) * 100) : 0, 3);
      return '' +
        '<div class="bar-row">' +
          '<span class="bar-row__name" title="' + esc(item.name || '') + '">' + esc(item.name || '未分类') + '</span>' +
          '<span class="bar"><span class="bar__fill" style="width:' + pct + '%"></span></span>' +
          '<span class="bar-row__num">' + count + ' 个</span>' +
        '</div>';
    }).join('');
  }

  function renderMeta(data) {
    const ts = data.generated_at || fmtTime(data.generated_at_ts);
    const short = ts ? String(ts).replace('T', ' ').slice(0, 16) : '-';

    setText('kvFile', DATA_URL + '（' + (data.source || '未知来源') + '）');
    setText('kvTime', ts || '-');
    setText('kvState', data.ok ? ('正常' + (data.stale ? '（缓存）' : '')) : '降级：保留旧数据');

    setText('statusTime', '数据时间 ' + short);
    setText('listInfo', '数据源：' + DATA_URL + ' · 更新于 ' + short);

    /* 降级提示条 */
    const old = $('staleNotice');
    if (old) old.remove();

    if (!data.ok || data.stale) {
      const notice = document.createElement('div');
      notice.id = 'staleNotice';
      notice.className = 'notice notice--warn';
      notice.innerHTML = '<b>数据为缓存版本。</b> 最近一次抓取未成功' +
        (data.errors && data.errors.length ? '（' + esc(data.errors.join('；')) + '）' : '') +
        '，页面展示的是上一次成功抓取的结果。';
      videoList.before(notice);
    }

    setText('statusMain', data.ok ? '就绪' : '降级');
    setText('statusHint', data.ok
      ? '数据加载完成 · 共 ' + ((data.videos && data.videos.length) || 0) + ' 条投稿'
      : '数据抓取失败，已保留上一次结果');
  }

  /* ======================================================================
     14. 任务栏时钟
     ====================================================================== */
  function tick() {
    const d = new Date();
    setText('clockTime', pad2(d.getHours()) + ':' + pad2(d.getMinutes()));
    setText('clockDate', d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()));
  }
  tick();
  setInterval(tick, 1000);

  /* ======================================================================
     15. 状态栏缩放百分比 / 视口变化
     ====================================================================== */
  function updateZoom() {
    const el = $('statusZoom');
    if (!el) return;
    const ratio = Math.min(Math.max(Math.round((win.offsetWidth / 1020) * 100), 60), 200);
    el.textContent = ratio + '%';
  }

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (isMaxed) {
        win.style.width = desktop.clientWidth + 'px';
        win.style.left = '0px';
        win.style.top = '0px';
      } else if (win.style.position === 'absolute') {
        const w = win.offsetWidth;
        const left = parseFloat(win.style.left) || 0;
        const top = parseFloat(win.style.top) || 0;
        const maxLeft = desktop.clientWidth - 140;
        const maxTop = window.innerHeight - 62;
        win.style.left = Math.min(Math.max(left, -(w - 140)), maxLeft) + 'px';
        win.style.top = Math.min(Math.max(top, -6), maxTop) + 'px';
        /* 视口变化后重 clamp 的结果也纳入位置记忆 */
        WM.captureRect('win');
        WM.persist('win');
      }
      /* 通知其它窗口模块重新夹取（统一调度，避免各自监听 resize 漂移） */
      WM.order.forEach((wid) => {
        if (wid === 'win') return;
        const rec = WM.reg[wid];
        if (rec && rec.api && typeof rec.api.relayout === 'function') rec.api.relayout();
      });
      updateZoom();
      if (dlgOwner) syncDialogWithOwner();
    }, 120);
  });

  /* ======================================================================
     16. 键盘快捷键
     ====================================================================== */
  document.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    const tag = active ? active.tagName : '';

    /* Esc：关闭对话框 → 关闭菜单 → 最小化窗口 */
    if (e.key === 'Escape') {
      if ($('dialog').classList.contains('is-open')) { hideDialog(); return; }
      if (openMenuItem || startMenu.classList.contains('is-open')) {
        closeMenus();
        closeStart();
        return;
      }
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (!hidden) hideWindow('min');
      return;
    }

    /* F5：重新读取数据（不刷新整页） */
    if (e.key === 'F5') {
      e.preventDefault();
      loadData();
      return;
    }

    /* Ctrl+A：仅在焦点位于工作区内时全选工作区内容 */
    if (e.key.toLowerCase() === 'a' && (e.ctrlKey || e.metaKey) &&
        tag !== 'INPUT' && tag !== 'TEXTAREA' && active && active.closest('.workspace')) {
      e.preventDefault();
      selectWorkspace();
    }
  });

  /* 工作区滚动到底部时，状态栏给出反馈 */
  workspace.addEventListener('scroll', () => {
    const atBottom = workspace.scrollTop + workspace.clientHeight >= workspace.scrollHeight - 4;
    setText('statusMain', atBottom ? '已到底部' : (hidden ? '已最小化' : '就绪'));
  }, { passive: true });

  /* ======================================================================
     17. 启动
     ====================================================================== */
  /* 把主窗口的通用对话框借给其它窗口模块使用（player.js 的「说明」按钮）。
     只暴露必要的函数，不泄漏内部状态。 */
  window.WinMainDialogs = {
    playerHelp: dialogPlayerHelp,
    about: dialogAbout,
    compat: dialogCompat,
  };

  updateZoom();
  applyIcons();
  applyThumbs();

  /* 恢复历史几何（位置记忆）：页面加载时读回上次的 rect，
     窗口在首次 open() 时由 WinWM.applyRect 套用。 */
  WM.recallAll();

  setTimeout(() => {
    toast('欢迎', '正在读取数据并渲染 UID ' + UID + ' 的投稿与动态。');
  }, 400);

  loadData();
})();
