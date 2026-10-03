/* ==========================================================================
   markdown.js — 轻量 Markdown 解析器（无第三方依赖）  v1
   --------------------------------------------------------------------------
   兼容目标：EdgeHTML 18（Edge 18 / Windows 10 1809）及以上

   设计原则
     1. 单遍扫描、行驱动：先按行归组为「块」，再对块内文本做行内解析。
     2. 输出前统一转义 HTML，杜绝 Markdown 文本注入标签。
     3. 只依赖 ES2017 能力，刻意规避 ?. / ?? / catch{} / 对象展开 / flat /
        replaceAll / Array.at / matchAll / String.replaceAll 等新语法，
        否则 EdgeHTML 18 会直接语法报错。

   支持的语法
     块级：ATX 标题 #~###### · 段落 · 有序/无序列表（支持嵌套与任务清单）
           引用块（可嵌套、可含其他块）· 分隔线 · 缩进/围栏代码块（带语言标识）
           表格（附加支持）
     行内：加粗 ** ** / __ __ · 斜体 * * / _ _ · 删除线 ~~ ~~ · 行内代码 ` `
           链接 [文本](url "标题") · 图片 ![alt](src "标题") · 自动链接 <url>
           硬换行（行尾两个空格或反斜杠）

   对外接口（挂到 window.WinMD）
     WinMD.render(mdText)   -> 渲染后的 HTML 字符串
     WinMD.escape(html)     -> HTML 转义（供外部复用）
     WinMD.toPlain(html)    -> 粗略提取纯文本（用于「复制为纯文本」）
   ========================================================================== */
(function (global) {
  'use strict';

  /* ======================================================================
     1. HTML 转义
     ----------------------------------------------------------------------
     先转义再拼接标签，任何来自 Markdown 的原文都不可能变成可执行标记。
     ====================================================================== */
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* 属性值转义（href / src / title） */
  function escapeAttr(value) {
    return escapeHtml(value);
  }

  /* ======================================================================
     2. URL 安全过滤
     ----------------------------------------------------------------------
     仅拦截具有执行风险的协议，保留 http/https/mailto/tel/相对路径/锚点。
     javascript: data:text/html 等一律降级为普通文本。
     ====================================================================== */
  function safeUrl(url) {
    var raw = String(url == null ? '' : url).trim();
    if (!raw) return '';
    /* 去掉用于绕过检测的控制字符 */
    var probe = raw.replace(/[\u0000-\u0020]/g, '').toLowerCase();
    if (probe.indexOf('javascript:') === 0) return '';
    if (probe.indexOf('vbscript:') === 0) return '';
    if (probe.indexOf('data:') === 0 && probe.indexOf('data:image/') !== 0) return '';
    return raw;
  }

  /* ======================================================================
     3. 行内解析
     ----------------------------------------------------------------------
     顺序很关键：先摘出行内代码（其内部不参与任何其他解析），
     再依次处理图片 → 链接 → 加粗 → 斜体 → 删除线 → 自动链接。
     全程在「转义后」的文本上操作，因此不会二次解释用户输入的标签。
     ====================================================================== */

  /* 占位符容器：避免已解析片段被后续规则重复处理 */
  function makeStore() {
    var items = [];
    return {
      put: function (html) {
        items.push(html);
        /* 使用私用区字符包裹序号，正常文本几乎不可能出现 */
        return '\uE000' + (items.length - 1) + '\uE001';
      },
      restore: function (text) {
        return text.replace(/\uE000(\d+)\uE001/g, function (whole, idx) {
          var i = Number(idx);
          return items[i] != null ? items[i] : whole;
        });
      },
    };
  }

  function parseInline(src) {
    if (src == null || src === '') return '';

    var store = makeStore();
    var text = escapeHtml(src);

    /* ---------- 3.1 行内代码 `code` ---------- */
    text = text.replace(/(`+)([\s\S]*?)\1/g, function (whole, ticks, body) {
      /* 去除首尾各一个空格：` code ` → code（CommonMark 规则） */
      var content = body;
      if (content.length >= 2 && content.charAt(0) === ' ' && content.charAt(content.length - 1) === ' ') {
        content = content.slice(1, -1);
      }
      return store.put('<code>' + content + '</code>');
    });

    /* ---------- 3.2 图片 ![alt](src "title") ---------- */
    text = text.replace(
      /!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+&quot;([^&]*?)&quot;|\s+'([^']*?)')?\s*\)/g,
      function (whole, alt, url, titleDq, titleSq) {
        var href = safeUrl(url);
        var title = titleDq != null ? titleDq : titleSq;
        if (!href) return store.put(escapeHtml(whole));
        return store.put(
          '<img src="' + escapeAttr(href) + '" alt="' + escapeAttr(alt) + '"' +
          (title ? ' title="' + escapeAttr(title) + '"' : '') +
          ' data-md-img="1">'
        );
      }
    );

    /* ---------- 3.3 链接 [text](url "title") ---------- */
    text = text.replace(
      /\[([^\]]*)\]\(\s*([^\s)]*)(?:\s+&quot;([^&]*?)&quot;|\s+'([^']*?)')?\s*\)/g,
      function (whole, label, url, titleDq, titleSq) {
        var href = safeUrl(url);
        var title = titleDq != null ? titleDq : titleSq;
        if (!href) return store.put(escapeHtml(whole));
        return store.put(
          '<a href="' + escapeAttr(href) + '"' +
          (title ? ' title="' + escapeAttr(title) + '"' : '') +
          ' target="_blank" rel="noopener noreferrer">' + parseInline(label) + '</a>'
        );
      }
    );

    /* ---------- 3.4 自动链接 <url> ---------- */
    /* 注：< > 已在转义阶段变为 &lt; &gt; */
    text = text.replace(/(^|[\s(])(https?:\/\/[^\s<&]+)/g, function (whole, pre, url) {
      var href = safeUrl(url);
      if (!href) return whole;
      return pre + store.put(
        '<a href="' + escapeAttr(href) + '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(url) + '</a>'
      );
    });

    /* ---------- 3.5 加粗 ** / __ ---------- */
    text = text.replace(/\*\*([\s\S]+?)\*\*/g, function (whole, body) {
      return store.put('<strong>' + parseInline(body) + '</strong>');
    });
    text = text.replace(/__([\s\S]+?)__/g, function (whole, body) {
      return store.put('<strong>' + parseInline(body) + '</strong>');
    });

    /* ---------- 3.6 斜体 * / _ ----------
       负向回顾确保不吞掉已用于加粗的星号；
       同时要求内容首尾非空白，避免把「a * b * c」误判为斜体。 */
    text = text.replace(/(^|[^*])\*([^\s*][\s\S]*?)\*(?!\*)/g, function (whole, pre, body) {
      return pre + store.put('<em>' + parseInline(body) + '</em>');
    });
    text = text.replace(/(^|[^_\w])_([^\s_][\s\S]*?)_(?![\w_])/g, function (whole, pre, body) {
      return pre + store.put('<em>' + parseInline(body) + '</em>');
    });

    /* ---------- 3.7 删除线 ~~ ---------- */
    text = text.replace(/~~([\s\S]+?)~~/g, function (whole, body) {
      return store.put('<del>' + parseInline(body) + '</del>');
    });

    /* ---------- 3.8 硬换行：行尾两个空格 或 反斜杠 ---------- */
    text = text.replace(/(?: {2,}|\\)\n/g, '<br>');

    return store.restore(text);
  }

  /* ======================================================================
     4. 列表解析
     ----------------------------------------------------------------------
     支持：
       - 无序：- * +      有序：1. 1)
       - 嵌套：2 空格 / 4 空格 / 1 个 Tab 视为一级缩进（取最小缩进为基准）
       - 任务清单：[ ] / [x]
     返回 { html, next }，next 为未消费的行号。
     ====================================================================== */
  var RE_UL = /^(\s*)([-*+])\s+(.*)$/;
  var RE_OL = /^(\s*)(\d{1,9})([.)])\s+(.*)$/;

  /* 判断某行是否可作为列表项 */
  function matchListItem(line) {
    var m = line.match(RE_OL);
    if (m) {
      return {
        indent: expandIndent(m[1]),
        ordered: true,
        start: Number(m[2]),
        text: m[4],
        /* marker 原文宽度：如 "12. " → 4 */
        markerWidth: (m[2] + m[3]).length,
      };
    }
    m = line.match(RE_UL);
    if (m) {
      return {
        indent: expandIndent(m[1]),
        ordered: false,
        start: 1,
        text: m[3],
        markerWidth: 1,
      };
    }
    return null;
  }

  /* 计算 tab 宽度：1 个 tab 记 2 空格（与正文缩进习惯一致） */
  function expandIndent(s) {
    return s.replace(/\t/g, '  ').length;
  }

  function parseList(lines, start) {
    var first = lines[start];
    var firstItem = matchListItem(first);
    var firstIndent = firstItem.indent;
    var ordered = firstItem.ordered;

    /* 列表项收集：{ indent, ordered, start, lines[] } */
    var items = [];
    var cur = null;
    var i = start;

    for (; i < lines.length; i++) {
      var line = lines[i];

      /* ---------- 空行 ---------- */
      /* 向后看：若下一非空行仍是本级/更深的列表项或续行，则视为列表内空行。
         注意：判断依据必须是「不小于首项缩进」，而不是「任意更深」，
         否则缩进代码块会被误吞。 */
      if (/^\s*$/.test(line)) {
        var j = i + 1;
        while (j < lines.length && /^\s*$/.test(lines[j])) j++;
        if (j < lines.length) {
          var nxtIndent = expandIndent(lines[j].match(/^(\s*)/)[1]);
          var nxtItem = matchListItem(lines[j]);
          if (nxtIndent >= firstIndent && (nxtItem || nxtIndent > firstIndent)) {
            if (cur) cur.lines.push('');
            i = j - 1;
            continue;
          }
        }
        break;
      }

      var indent = expandIndent(line.match(/^(\s*)/)[1]);
      var item = matchListItem(line);

      /* ---------- 缩进不足 → 本级列表结束 ---------- */
      if (indent < firstIndent) break;

      /* ---------- 严格等于本级缩进 → 新条目 ---------- */
      if (indent === firstIndent) {
        /* 同阶但符号类型不同（无序列表里出现有序项）→ 视为新块，交上层处理 */
        if (!item || item.ordered !== ordered) break;
        cur = {
          indent: item.indent,
          ordered: item.ordered,
          start: item.start,
          markerWidth: item.markerWidth,
          lines: [item.text],
        };
        items.push(cur);
        continue;
      }

      /* ---------- 缩进更深 → 归入当前条目的续行 ----------
         关键点：即使它是「同类型列表项」，也必须作为续行下沉，
         由 renderBlocks 递归产生嵌套 <ul>/<ol>，而不是并列成兄弟项。 */
      if (cur) {
        /* 保留原始缩进（含制表符），反缩进在渲染阶段按 marker 宽度处理 */
        cur.lines.push(line);
        continue;
      }

      /* 更深缩进但还没有当前条目（非法的悬空缩进）→ 交上层处理 */
      break;
    }

    /* 统一子项缩进：把每个条目的续行按「本级 marker 宽度」反缩进，
       使嵌套块在 renderBlocks 中成为零缩进的独立块。 */
    var html = items.map(function (it) {
      var body = it.lines.join('\n');
      var task = '';
      var mTask = body.match(/^\[([ xX])\]\s+([\s\S]*)$/);
      if (mTask) {
        var checked = mTask[1].toLowerCase() === 'x';
        task = '<input type="checkbox" class="check" disabled' +
               (checked ? ' checked' : '') + '>';
        body = mTask[2];
      }

      /* 本级条目内容的缩进基准 =
         首行 marker 之后正文所在列 ≈ 缩进 + marker 宽（"- " 或 "1. "） + 1 空格 */
      var markerWidth = it.markerWidth != null ? it.markerWidth : 2;
      var baseCol = it.indent + markerWidth + 1;

      var dedented = body.split('\n').map(function (l, idx) {
        if (idx === 0) return l.replace(/^\s+/, '');
        if (/^\s*$/.test(l)) return '';
        var lead = l.match(/^(\s*)/)[1];
        /* 先按「Tab 展开长度」跟基准列比较，再决定实际切掉多少原始字符 */
        var n = expandIndent(lead);
        if (n <= baseCol) return l.slice(lead.length);
        /* 需要切掉：按原始字符逐字累加，直到达到基准列 */
        var col = 0;
        var cut = 0;
        while (cut < lead.length && col < baseCol) {
          col += lead.charAt(cut) === '\t' ? 2 : 1;
          cut++;
        }
        return l.slice(cut);
      }).join('\n');

      var inner = renderBlocks(trimBlank(dedented.split('\n')));
      /* 单段落时去掉 <p> 包裹，保持列表紧凑 */
      var single = inner.match(/^<p>([\s\S]*)<\/p>$/);
      if (single) inner = single[1];

      return '<li' + (task ? ' class="md-task"' : '') + '>' + task + inner + '</li>';
    }).join('');

    var tag = ordered ? 'ol' : 'ul';
    var attr = '';
    if (ordered && items.length && items[0].start !== 1) {
      attr = ' start="' + items[0].start + '"';
    }

    return {
      html: '<' + tag + attr + '>' + html + '</' + tag + '>',
      next: i,
    };
  }

  /* ======================================================================
     5. 代码块解析
     ====================================================================== */
  /* 围栏代码块：```lang 或 ~~~lang */
  function parseFence(lines, start) {
    var open = lines[start].match(/^\s*(`{3,}|~{3,})\s*([^`\s]*)/);
    var fence = open[1];
    var lang = (open[2] || '').trim();
    var body = [];
    var i = start + 1;

    for (; i < lines.length; i++) {
      if (new RegExp('^\\s*' + fence.charAt(0) + '{' + fence.length + ',}\\s*$').test(lines[i])) {
        i++;
        break;
      }
      body.push(lines[i]);
    }

    return {
      html: buildCodeBlock(body.join('\n'), lang),
      next: i,
    };
  }

  function buildCodeBlock(code, lang) {
    var attr = lang ? ' data-lang="' + escapeAttr(lang) + '"' : '';
    return '<pre' + attr + '><code>' + escapeHtml(code) + '</code></pre>';
  }

  /* 缩进代码块：连续 4 空格缩进的行（且不是列表续行） */
  function parseIndentedCode(lines, start) {
    var body = [];
    var i = start;
    for (; i < lines.length; i++) {
      var line = lines[i];
      if (/^\s*$/.test(line)) {
        body.push('');
        continue;
      }
      if (!/^(\t| {4})/.test(line)) break;
      body.push(line.replace(/^(\t| {4})/, ''));
    }
    /* 去掉尾部空行 */
    while (body.length && /^\s*$/.test(body[body.length - 1])) body.pop();
    return { html: buildCodeBlock(body.join('\n'), ''), next: i };
  }

  /* ======================================================================
     6. 引用块解析
     ----------------------------------------------------------------------
     剥掉每行的 "> " 前缀后递归渲染，因此引用内可含标题/列表/代码块。
     ====================================================================== */
  function parseBlockquote(lines, start) {
    var body = [];
    var i = start;

    for (; i < lines.length; i++) {
      var line = lines[i];
      if (/^\s*>/.test(line)) {
        body.push(line.replace(/^\s*>\s?/, ''));
        continue;
      }
      /* 引用内的惰性续行：非空且不是新的块起始 */
      if (!/^\s*$/.test(line) && body.length &&
          !/^\s*(#{1,6}\s|```|~~~|([-*+]|\d{1,9}[.)])\s|>\s*)/.test(line) &&
          !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        body.push(line);
        continue;
      }
      break;
    }

    return {
      html: '<blockquote>' + renderBlocks(trimBlank(body)) + '</blockquote>',
      next: i,
    };
  }

  /* ======================================================================
     7. 表格解析（附加支持）
     ----------------------------------------------------------------------
     形如：
       | a | b |
       | --- | :--: |
       | 1 | 2 |
     分隔行决定列数与对齐方式。
     ====================================================================== */
  var RE_TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

  function splitRow(line) {
    var s = line.trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
    return s.split('|').map(function (c) { return c.trim(); });
  }

  function tryParseTable(lines, start) {
    if (start + 1 >= lines.length) return null;
    var head = lines[start];
    var sep = lines[start + 1];
    if (head.indexOf('|') < 0) return null;
    if (!RE_TABLE_SEP.test(sep) || sep.indexOf('-') < 0) return null;

    var aligns = splitRow(sep).map(function (c) {
      var left = c.charAt(0) === ':';
      var right = c.charAt(c.length - 1) === ':';
      if (left && right) return 'center';
      if (right) return 'right';
      if (left) return 'left';
      return '';
    });

    var rows = [];
    var i = start + 2;
    while (i < lines.length && lines[i].indexOf('|') >= 0 && !/^\s*$/.test(lines[i])) {
      rows.push(splitRow(lines[i]));
      i++;
    }

    var thead = '<tr>' + splitRow(head).map(function (c, idx) {
      var a = aligns[idx] ? ' style="text-align:' + aligns[idx] + '"' : '';
      return '<th' + a + '>' + parseInline(c) + '</th>';
    }).join('') + '</tr>';

    var tbody = rows.length
      ? '<tbody>' + rows.map(function (r) {
          return '<tr>' + r.map(function (c, idx) {
            var a = aligns[idx] ? ' style="text-align:' + aligns[idx] + '"' : '';
            return '<td' + a + '>' + parseInline(c) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody>'
      : '';

    return {
      html: '<div class="md-tablewrap"><table><thead>' + thead + '</thead>' + tbody + '</table></div>',
      next: i,
    };
  }

  /* ======================================================================
     8. 块级解析主循环
     ====================================================================== */
  var RE_ATX     = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/;
  var RE_HR      = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
  var RE_FENCE   = /^\s*(`{3,}|~{3,})/;
  var RE_QUOTE   = /^\s*>/;

  function renderBlocks(lines) {
    var out = [];
    var i = 0;
    var para = [];

    function flushPara() {
      if (!para.length) return;
      var text = para.join('\n');
      /* 软换行：单换行渲染为空格（CommonMark 行为），硬换行已在行内处理 */
      out.push('<p>' + parseInline(text) + '</p>');
      para = [];
    }

    while (i < lines.length) {
      var line = lines[i];

      /* 空行 → 段落边界 */
      if (/^\s*$/.test(line)) { flushPara(); i++; continue; }

      /* 标题 */
      var mAtx = line.match(RE_ATX);
      if (mAtx) {
        flushPara();
        var lvl = mAtx[1].length;
        out.push('<h' + lvl + '>' + parseInline(mAtx[2]) + '</h' + lvl + '>');
        i++;
        continue;
      }

      /* 分隔线 */
      if (RE_HR.test(line)) { flushPara(); out.push('<hr>'); i++; continue; }

      /* 围栏代码块 */
      if (RE_FENCE.test(line)) {
        flushPara();
        var f = parseFence(lines, i);
        out.push(f.html);
        i = f.next;
        continue;
      }

      /* 表格（须在段落之前判断） */
      var tb = tryParseTable(lines, i);
      if (tb) { flushPara(); out.push(tb.html); i = tb.next; continue; }

      /* 引用块 */
      if (RE_QUOTE.test(line)) {
        flushPara();
        var q = parseBlockquote(lines, i);
        out.push(q.html);
        i = q.next;
        continue;
      }

      /* 列表 */
      if (matchListItem(line)) {
        flushPara();
        /* 一级列表项用「零缩进」判断，避免被上层反缩进影响 */
        var lst = parseList(lines, i);
        out.push(lst.html);
        i = lst.next;
        continue;
      }

      /* 缩进代码块（4 空格）；列表已在上方优先处理 */
      if (/^(\t| {4})/.test(line)) {
        flushPara();
        var ic = parseIndentedCode(lines, i);
        out.push(ic.html);
        i = ic.next;
        continue;
      }

      /* 普通段落行 */
      para.push(line);
      i++;
    }

    flushPara();
    return out.join('\n');
  }

  /* 去掉首尾空行 */
  function trimBlank(lines) {
    var a = 0;
    var b = lines.length;
    while (a < b && /^\s*$/.test(lines[a])) a++;
    while (b > a && /^\s*$/.test(lines[b - 1])) b--;
    return lines.slice(a, b);
  }

  /* ======================================================================
     9. 对外接口
     ====================================================================== */
  function render(mdText) {
    var text = String(mdText == null ? '' : mdText);
    /* 统一换行符，并转义 U+2028/U+2029（合法 JSON，但在旧内核 JS 里需谨慎） */
    text = text.replace(/\r\n?/g, '\n').replace(/\u2028/g, '\n').replace(/\u2029/g, '\n');
    return renderBlocks(text.split('\n'));
  }

  /* 粗略提取纯文本（用于「复制渲染后纯文本」） */
  function toPlain(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = String(html == null ? '' : html);
    /* 块级元素后补换行，保持可读性 */
    var blocks = tmp.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,tr');
    for (var i = 0; i < blocks.length; i++) {
      blocks[i].appendChild(document.createTextNode('\n'));
    }
    var txt = tmp.textContent || '';
    return txt.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  }

  global.WinMD = {
    render: render,
    escape: escapeHtml,
    safeUrl: safeUrl,
    toPlain: toPlain,
  };
})(window);
