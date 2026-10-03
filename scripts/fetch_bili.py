#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_bili.py — 抓取哔哩哔哩指定 UID 的账号信息、信息动态与最新投稿，生成 bili.json
=====================================================================================

设计目标（面向 GitHub Pages 的完全静态方案）
  1. 纯标准库实现：urllib / hashlib / json / time / random / http.cookiejar / argparse，
     不依赖任何第三方包，GitHub Actions 中无需 pip install，降低失败面。
  2. 完整实现 B 站 WBI 签名：
       nav 接口取 img_key / sub_key  →  按固定置换表混洗拼接  →  取前 32 位得 mixin_key
       参数按 key 排序 → 过滤 !'()* → urlencode → 追加 mixin_key → MD5 → w_rid
  3. 分层降级：
       账号信息：x/space/wbi/acc/info  →  x/web-interface/card
       投稿列表：x/space/wbi/arc/search →  x/space/arc/search
     任一接口失败都会自动切换到备用接口。
  4. 失败重试：指数退避 + 随机抖动；单接口失败不影响其它接口。
  5. 旧数据保留：任一环节彻底失败时，沿用旧 bili.json 中的对应字段，
     并写入 ok=false / stale=true / errors[]，前端据此显示"缓存版本"提示。
     因此本脚本永远不会产出"空数据"文件。
  6. 退出码：只要最终写出了合法的 bili.json 就返回 0，避免定时任务频繁报红。
     仅当连读写文件都失败时才返回非 0。

用法
  python scripts/fetch_bili.py                     # 默认 UID 11897608，输出 ./bili.json + ./bili.data.js
  python scripts/fetch_bili.py --mid 11897608 --out bili.json
  python scripts/fetch_bili.py --pretty            # 缩进输出，便于人工查看 diff
  python scripts/fetch_bili.py --no-js             # 只生成 bili.json
  BILI_COOKIE="SESSDATA=xxx; bili_jct=yyy" python scripts/fetch_bili.py

产出文件
  bili.json      主数据源，前端在 http(s) 下用 fetch 读取
  bili.data.js   同内容，以 window.BILI_DATA 全局变量暴露；前端在 file:// 下
                 回退读取它，使「双击打开 index.html」也能正常渲染

环境变量
  BILI_COOKIE   可选。携带登录态 Cookie（至少含 SESSDATA）可显著降低被风控
                （返回 -352 / -412）的概率。GitHub Actions 中配置为仓库 Secret。
  BILI_MID      可选。默认 11897608。
"""

import argparse
import hashlib
import http.cookiejar
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

# =============================================================================
# 常量
# =============================================================================

DEFAULT_MID = 11897608

# B 站 WBI 混洗置换表（官方前端固定值，64 位）
MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
    26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
    20, 34, 44, 52,
]

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# 用于绕过风控的"无害"占位参数（B 站 Web 端会带上，缺失反而更容易触发 -352）
DM_PARAMS = {
    "dm_img_list": "[]",
    "dm_img_str": "V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ",
    "dm_cover_img_str": "QU5HTEUgKEludGVsLCBJbnRlbChSKSBVSEQgR3JhcGhpY3Mp",
    "dm_img_inter": '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}',
}

CST = timezone(timedelta(hours=8))


# =============================================================================
# 日志
# =============================================================================

def log(msg):
    sys.stdout.write("[%s] %s\n" % (datetime.now(CST).strftime("%H:%M:%S"), msg))
    sys.stdout.flush()


# =============================================================================
# 异常
# =============================================================================

class BiliError(Exception):
    """接口返回 code != 0 或网络层错误。"""

    def __init__(self, message, code=None, retryable=True):
        Exception.__init__(self, message)
        self.code = code
        self.retryable = retryable


# =============================================================================
# HTTP 客户端
# =============================================================================

class BiliClient(object):
    def __init__(self, cookie=""):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )
        self.img_key = ""
        self.sub_key = ""
        self.cookie = (cookie or "").strip()
        if self.cookie:
            self._seed_cookie(self.cookie)

    # ---------- Cookie ----------

    def _seed_cookie(self, raw):
        """把 'k=v; k2=v2' 形式的 Cookie 写入 jar。"""
        for part in raw.split(";"):
            part = part.strip()
            if not part or "=" not in part:
                continue
            k, v = part.split("=", 1)
            try:
                c = http.cookiejar.Cookie(
                    version=0, name=k.strip(), value=v.strip(),
                    port=None, port_specified=False,
                    domain=".bilibili.com", domain_specified=True,
                    domain_initial_dot=True, path="/", path_specified=True,
                    secure=False, expires=None, discard=False,
                    comment=None, comment_url=None, rest={}, rfc2109=False,
                )
                self.jar.set_cookie(c)
            except Exception:
                pass

    def _cookie_header(self):
        items = []
        for c in self.jar:
            items.append("%s=%s" % (c.name, c.value))
        if self.cookie:
            items.append(self.cookie)
        return "; ".join(items)

    # ---------- 请求 ----------

    def _headers(self, referer="https://www.bilibili.com/"):
        h = {
            "User-Agent": UA,
            "Referer": referer,
            "Origin": "https://www.bilibili.com",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Connection": "close",
        }
        ck = self._cookie_header()
        if ck:
            h["Cookie"] = ck
        return h

    def fetch_json(self, url, params=None, referer="https://www.bilibili.com/", timeout=15):
        if params:
            url = url + "?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote, safe="")
        req = urllib.request.Request(url, headers=self._headers(referer))
        try:
            with self.opener.open(req, timeout=timeout) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", "replace")[:200]
            except Exception:
                pass
            # 412 = 风控拦截；429 = 限流；5xx = 服务端抖动 —— 都值得重试
            retryable = e.code in (412, 429, 500, 502, 503, 504)
            raise BiliError("HTTP %s %s %s" % (e.code, e.reason, body), code=e.code,
                            retryable=retryable)
        except urllib.error.URLError as e:
            raise BiliError("网络错误：%s" % (e.reason,), retryable=True)
        except Exception as e:
            raise BiliError("请求异常：%s" % (e,), retryable=True)

        try:
            return json.loads(raw.decode("utf-8", "replace"))
        except ValueError as e:
            raise BiliError("响应不是合法 JSON：%s" % (e,), retryable=True)

    def api(self, url, params=None, referer="https://www.bilibili.com/", timeout=15,
            allow_codes=()):
        """调用 B 站 JSON 接口并校验 code 字段。"""
        data = self.fetch_json(url, params, referer, timeout)
        code = data.get("code")
        if code != 0 and code not in allow_codes:
            msg = data.get("message") or data.get("msg") or "未知错误"
            # -352 风控 / -412 拦截 / -509 限流：可重试；-404 用户不存在：不可重试
            retryable = code not in (-404, -400)
            raise BiliError("接口返回 code=%s message=%s" % (code, msg), code=code,
                            retryable=retryable)
        return data

    # ---------- WBI ----------

    def init_wbi(self):
        """
        获取 img_key / sub_key（来自 nav 接口的 wbi_img 字段）。

        重要：未登录时 nav 会返回 code=-101（账号未登录），但 data.wbi_img
        依然包含有效的 img_url / sub_url —— 这是 WBI 签名的正常获取路径，
        因此必须放行 -101，不能当成失败。
        """
        if self.img_key and self.sub_key:
            return
        data = self.api("https://api.bilibili.com/x/web-interface/nav",
                        allow_codes=(-101,))
        wbi = (data.get("data") or {}).get("wbi_img") or {}
        img_url = wbi.get("img_url") or ""
        sub_url = wbi.get("sub_url") or ""
        img_key = img_url.rsplit("/", 1)[-1].split(".")[0]
        sub_key = sub_url.rsplit("/", 1)[-1].split(".")[0]
        if not img_key or not sub_key:
            raise BiliError("无法从 nav 接口解析 WBI 密钥（data.wbi_img 缺失）", retryable=True)
        self.img_key, self.sub_key = img_key, sub_key
        log("WBI 密钥获取成功：img_key=%s… sub_key=%s…" % (img_key[:8], sub_key[:8]))

    def init_cookies(self):
        """先访问一次首页/指纹接口，让服务端下发 buvid3 / buvid4，降低风控概率。"""
        try:
            self.api("https://api.bilibili.com/x/frontend/finger/spi", allow_codes=(-352,))
            log("已获取设备指纹 Cookie（buvid）")
        except Exception as e:
            log("设备指纹获取失败（忽略）：%s" % (e,))

    def sign(self, params):
        """对参数做 WBI 签名，返回含 wts / w_rid 的新字典。"""
        if not self.img_key or not self.sub_key:
            raise BiliError("WBI 密钥尚未初始化", retryable=False)

        mixin_key = "".join(
            (self.img_key + self.sub_key)[i] for i in MIXIN_KEY_ENC_TAB
        )[:32]

        signed = {}
        for k, v in params.items():
            if v is None:
                continue
            signed[str(k)] = str(v)

        signed["wts"] = str(int(time.time()))

        # 过滤 !'()* —— 与浏览器端 encodeURIComponent 的行为对齐
        filtered = {}
        for k, v in signed.items():
            filtered[k] = "".join(ch for ch in v if ch not in "!'()*")

        query = urllib.parse.urlencode(
            sorted(filtered.items()), quote_via=urllib.parse.quote, safe=""
        )
        signed["w_rid"] = hashlib.md5((query + mixin_key).encode("utf-8")).hexdigest()
        return signed


# =============================================================================
# 重试
# =============================================================================

def with_retry(fn, name, attempts=4, base=1.6, errors=None):
    """指数退避重试。返回 (结果, 异常)；成功时异常为 None。"""
    last = None
    for i in range(attempts):
        try:
            return fn(), None
        except BiliError as e:
            last = e
            if not e.retryable:
                log("[跳过] %s 不可重试：%s" % (name, e))
                break
            log("[警告] %s 第 %d/%d 次失败：%s" % (name, i + 1, attempts, e))
        except Exception as e:
            last = e
            log("[警告] %s 第 %d/%d 次异常：%s" % (name, i + 1, attempts, e))

        if i < attempts - 1:
            wait = base ** i + random.random()
            log("        %.1fs 后重试…" % wait)
            time.sleep(wait)

    if errors is not None and last is not None:
        errors.append("%s：%s" % (name, last))
    return None, last


# =============================================================================
# 数据抓取
# =============================================================================

def fetch_user(client, mid, errors):
    """账号信息：wbi/acc/info 为主，web-interface/card 为备。"""

    def primary():
        client.init_wbi()
        params = dict(DM_PARAMS)
        params.update({"mid": mid, "token": "", "platform": "web", "web_location": "1550101"})
        signed = client.sign(params)
        return client.api(
            "https://api.bilibili.com/x/space/wbi/acc/info",
            signed,
            referer="https://space.bilibili.com/%s" % mid,
        )

    def fallback():
        return client.api(
            "https://api.bilibili.com/x/web-interface/card",
            {"mid": mid, "photo": "true"},
            referer="https://space.bilibili.com/%s" % mid,
        )

    data, err = with_retry(primary, "账号信息(acc/info)", errors=errors)
    if data and data.get("data"):
        d = data["data"]
        return {
            "mid": d.get("mid", mid),
            "name": d.get("name") or "",
            "face": _https(d.get("face") or ""),
            "sign": d.get("sign") or "",
            "level": d.get("level"),
            "sex": d.get("sex") or "",
            "fans": None,
            "following": None,
        }

    log("主接口失败，切换备用接口 card…")
    data, err2 = with_retry(fallback, "账号信息(card)", attempts=3, errors=errors)
    if data and data.get("data"):
        card = data["data"].get("card") or {}
        return {
            "mid": card.get("mid", mid),
            "name": card.get("name") or "",
            "face": _https(card.get("face") or ""),
            "sign": card.get("sign") or "",
            "level": card.get("level_info", {}).get("current_level"),
            "sex": card.get("sex") or "",
            "fans": data["data"].get("follower"),
            "following": None,
        }
    return None


def fetch_relation(client, mid, errors):
    """粉丝 / 关注数。"""
    data, _ = with_retry(
        lambda: client.api("https://api.bilibili.com/x/relation/stat", {"vmid": mid},
                           referer="https://space.bilibili.com/%s" % mid),
        "关系数(relation/stat)", attempts=3, errors=errors,
    )
    if data and data.get("data"):
        d = data["data"]
        return {"fans": d.get("follower"), "following": d.get("following")}
    return None


def fetch_upstat(client, mid, errors):
    """累计播放 / 获赞。"""
    data, _ = with_retry(
        lambda: client.api("https://api.bilibili.com/x/space/upstat", {"mid": mid},
                           referer="https://space.bilibili.com/%s" % mid),
        "累计数据(upstat)", attempts=3, errors=errors,
    )
    if data and data.get("data"):
        d = data["data"]
        arch = d.get("archive") or {}
        likes = d.get("likes") or {}
        return {
            "play": arch.get("view"),
            "like": likes.get("likes") if isinstance(likes, dict) else likes,
        }
    return None


def fetch_videos(client, mid, limit, errors):
    """最新投稿：wbi/arc/search 为主，arc/search 为备。"""

    def primary():
        client.init_wbi()
        params = dict(DM_PARAMS)
        params.update({
            "mid": mid, "ps": limit, "pn": 1, "order": "pubdate",
            "tid": 0, "keyword": "", "platform": "web", "web_location": "1550101",
        })
        signed = client.sign(params)
        return client.api(
            "https://api.bilibili.com/x/space/wbi/arc/search",
            signed,
            referer="https://space.bilibili.com/%s/video" % mid,
        )

    def fallback():
        return client.api(
            "https://api.bilibili.com/x/space/arc/search",
            {"mid": mid, "ps": limit, "pn": 1, "order": "pubdate", "tid": 0, "keyword": ""},
            referer="https://space.bilibili.com/%s/video" % mid,
        )

    data, _ = with_retry(primary, "投稿列表(arc/search)", errors=errors)
    if not (data and data.get("data")):
        log("主接口失败，切换备用接口 arc/search…")
        data, _ = with_retry(fallback, "投稿列表(arc/search 旧版)", attempts=3, errors=errors)

    if not (data and data.get("data")):
        return None, None, None

    d = data["data"]
    lst = d.get("list") or {}
    vlist = lst.get("vlist") or []
    total = (d.get("page") or {}).get("count")

    videos = []
    for v in vlist[:limit]:
        bvid = v.get("bvid") or ""
        videos.append({
            "bvid": bvid,
            "aid": v.get("aid"),
            "title": _clean(v.get("title") or ""),
            "cover": _https(v.get("pic") or ""),
            "url": ("https://www.bilibili.com/video/%s" % bvid) if bvid else "",
            "pubdate": v.get("created"),
            "pubdate_text": _fmt_ts(v.get("created")),
            "play": v.get("play"),
            "comment": v.get("comment"),
            "duration": v.get("length") or "",
        })

    # 分区分布：arc/search 会返回该 UP 主的分区统计（tlist 可能是 list 或 dict）
    tlist = lst.get("tlist")
    if isinstance(tlist, dict):
        seq = list(tlist.values())
    elif isinstance(tlist, list):
        seq = tlist
    else:
        seq = []

    partitions = []
    for t in seq:
        if not isinstance(t, dict):
            continue
        partitions.append({
            "tid": t.get("tid"),
            "name": t.get("name"),
            "count": t.get("count"),
        })
    partitions.sort(key=lambda x: -(x.get("count") or 0))

    return videos, total, partitions


def fetch_dynamics(client, mid, limit, errors):
    """
    信息动态。
    说明：B 站动态接口（polymer/web-dynamic/v1/feed/space）自 2023 年起基本要求登录态，
    未携带 SESSDATA 时通常返回 -352。因此这里做两级处理：
      1) 尝试真实接口（若配置了 BILI_COOKIE 成功率较高）；
      2) 失败则由投稿数据合成"投稿了视频"动态，保证前端始终有动态可展示。
    """
    try:
        data = client.api(
            "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space",
            {"host_mid": mid, "offset": "", "timezone_offset": -480,
             "platform": "web", "features": "itemOpusStyle"},
            referer="https://space.bilibili.com/%s/dynamic" % mid,
            allow_codes=(-352, -412),
        )
    except Exception as e:
        log("动态接口不可用（将使用投稿合成动态）：%s" % (e,))
        return None

    items = ((data.get("data") or {}).get("items")) or []
    if not items:
        return None

    out = []
    for it in items[:limit]:
        try:
            modules = it.get("modules") or {}
            author = modules.get("module_author") or {}
            dyn = modules.get("module_dynamic") or {}
            desc = (dyn.get("desc") or {}).get("text") or ""
            major = dyn.get("major") or {}
            archive = major.get("archive") or {}
            ts = author.get("pub_ts")
            url = ""
            text = desc
            if archive:
                title = archive.get("title") or ""
                bvid = archive.get("bvid") or ""
                text = ("投稿了视频《%s》" % title) if title else (desc or "投稿了视频")
                if bvid:
                    url = "https://www.bilibili.com/video/%s" % bvid
            elif not text:
                text = "发布了一条动态"
            if it.get("id_str"):
                url = url or ("https://t.bilibili.com/%s" % it["id_str"])
            out.append({
                "type": "video" if archive else "dynamic",
                "kind": "投稿" if archive else "动态",
                "text": _clean(text),
                "url": url,
                "ts": ts,
                "time_text": _fmt_ts(ts),
            })
        except Exception:
            continue
    return out or None


def synth_dynamics(videos, user):
    """由投稿数据合成信息动态，作为动态接口不可用时的兜底。"""
    out = []
    for v in (videos or [])[:5]:
        out.append({
            "type": "video",
            "kind": "投稿",
            "text": "投稿了视频《%s》" % (v.get("title") or ""),
            "url": v.get("url") or "",
            "ts": v.get("pubdate"),
            "time_text": v.get("pubdate_text") or "",
        })
    if user:
        out.append({
            "type": "profile",
            "kind": "资料",
            "text": "账号资料快照：%s（Lv.%s）· 签名：%s" % (
                user.get("name") or "-",
                user.get("level") if user.get("level") is not None else "-",
                (user.get("sign") or "（未填写）"),
            ),
            "url": "https://space.bilibili.com/%s" % (user.get("mid") or ""),
            "ts": None,
            "time_text": "",
        })
    return out


# =============================================================================
# 工具
# =============================================================================

def _https(url):
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("http://"):
        return "https://" + url[7:]
    return url


def _clean(text):
    """压缩空白并去掉多余换行，避免 JSON 中出现大量转义字符。"""
    return " ".join(str(text).split())


def _fmt_ts(ts):
    try:
        ts = int(ts)
    except (TypeError, ValueError):
        return ""
    if ts <= 0:
        return ""
    return datetime.fromtimestamp(ts, CST).strftime("%Y-%m-%d %H:%M")


def _now_iso():
    return datetime.now(CST).strftime("%Y-%m-%dT%H:%M:%S+08:00")


def load_old(path):
    """读取旧 bili.json；失败返回空字典。"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def write_json(path, obj, pretty=False):
    """原子写入：先写临时文件再替换，避免中断产生半截文件。"""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        if pretty:
            json.dump(obj, f, ensure_ascii=False, indent=2)
        else:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    os.replace(tmp, path)


JS_HEADER = """/* ==========================================================================
 * bili.data.js —— 由 scripts/fetch_bili.py 自动生成，请勿手工编辑
 * --------------------------------------------------------------------------
 * 内容与 bili.json 完全一致，但以 <script> 可加载的全局变量形式提供。
 *
 * 为什么需要它：
 *   浏览器在 file:// 协议下会拦截 fetch / XMLHttpRequest 的同源请求，
 *   导致直接双击 index.html 时读不到 bili.json。而传统 <script> 标签
 *   不受 CORS 限制，因此前端在 file:// 场景会自动回退读取本文件，
 *   实现「双击即可离线预览」。
 *
 * HTTP(S) 环境下前端仍优先使用 fetch 读取 bili.json，本文件不会被请求。
 *
 * 生成时间：%s
 * ========================================================================== */
window.%s = """


def write_js(path, obj, global_name="BILI_DATA"):
    """
    生成 bili.data.js（与 bili.json 同源的 <script> 版本）。

    注意：JSON 中的 U+2028 / U+2029 是合法 JSON 字符，但在 ES2019 之前的
    JavaScript 字符串字面量中属于非法行终止符，直接内联会导致语法错误。
    EdgeHTML 18 属于 ES2017 实现，因此这里统一转义为 \\u2028 / \\u2029。
    """
    tmp = path + ".tmp"
    body = json.dumps(obj, ensure_ascii=False, indent=2)
    body = body.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(JS_HEADER % (_now_iso(), global_name))
        f.write(body)
        f.write(";\n")
    os.replace(tmp, path)


# =============================================================================
# 主流程
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="抓取 B 站 UP 主信息并生成 bili.json")
    parser.add_argument("--mid", type=int, default=int(os.environ.get("BILI_MID") or DEFAULT_MID),
                        help="目标 UID，默认 %d" % DEFAULT_MID)
    parser.add_argument("--out", default="bili.json", help="输出文件路径，默认 ./bili.json")
    parser.add_argument("--js-out", default="", help="bili.data.js 输出路径，默认与 --out 同目录同名")
    parser.add_argument("--no-js", action="store_true", help="只生成 bili.json，不生成 bili.data.js")
    parser.add_argument("--limit", type=int, default=5, help="抓取投稿条数，默认 5")
    parser.add_argument("--pretty", action="store_true", help="缩进输出，便于查看 diff")
    parser.add_argument("--attempts", type=int, default=4, help="单接口最大尝试次数，默认 4")
    args = parser.parse_args()

    mid = args.mid
    out_path = os.path.abspath(args.out)
    errors = []

    log("=" * 68)
    log("目标 UID：%d" % mid)
    log("输出路径：%s" % out_path)

    old = load_old(out_path)
    if old:
        log("检测到旧数据：videos=%d，生成于 %s"
            % (len(old.get("videos") or []), old.get("generated_at") or "未知"))
    else:
        log("未检测到旧数据，本次为首次抓取")

    cookie = os.environ.get("BILI_COOKIE", "")
    if cookie:
        log("已读取 BILI_COOKIE（%d 字符），将携带登录态请求" % len(cookie))
    else:
        log("未配置 BILI_COOKIE，将以游客身份请求（可能触发风控 -352）")

    client = BiliClient(cookie)
    with_retry(client.init_cookies, "设备指纹", attempts=2)
    with_retry(client.init_wbi, "WBI 密钥", attempts=args.attempts)

    # ---------------- 逐项抓取 ----------------
    user = fetch_user(client, mid, errors)
    relation = fetch_relation(client, mid, errors)
    upstat = fetch_upstat(client, mid, errors)
    videos, total, partitions = fetch_videos(client, mid, args.limit, errors)
    dynamics = fetch_dynamics(client, mid, args.limit, errors)

    # ---------------- 合并旧数据（失败保留） ----------------
    fresh_ok = bool(videos)

    if not user:
        user = old.get("user")
        log("账号信息抓取失败，沿用旧数据" if user else "账号信息抓取失败，且无旧数据")
    if not relation:
        relation = old.get("relation") or {}
        log("关系数抓取失败，沿用旧数据")
    if not upstat:
        upstat = old.get("upstat") or {}
        log("累计数据抓取失败，沿用旧数据")
    if not videos:
        videos = old.get("videos") or []
        log("投稿抓取失败，沿用旧数据（%d 条）" % len(videos))
    if partitions is None:
        partitions = old.get("partitions") or []
    if not dynamics:
        # 动态接口不可用：优先用"本次抓到的投稿"合成动态（时效性更好），
        # 只有在没有新投稿时才退回旧动态，避免展示过期的动态列表。
        if videos:
            dynamics = synth_dynamics(videos, user)
            log("动态接口不可用，已用本次投稿合成动态（%d 条）" % len(dynamics))
        else:
            dynamics = old.get("dynamics") or []
            log("动态接口不可用且无新投稿，沿用旧动态（%d 条）" % len(dynamics))

    # 用户信息与关系数合并
    if user:
        if relation:
            user["fans"] = relation.get("fans", user.get("fans"))
            user["following"] = relation.get("following", user.get("following"))
    else:
        user = {"mid": mid, "name": "（未知）", "face": "", "sign": "",
                "level": None, "fans": None, "following": None}

    stat = {
        "play": (upstat or {}).get("play"),
        "like": (upstat or {}).get("like"),
        "video_count": total if total is not None else (old.get("stat") or {}).get("video_count"),
    }

    # 若动态仍为空，用投稿兜底
    if not dynamics:
        dynamics = synth_dynamics(videos, user)

    result = {
        "uid": mid,
        "ok": fresh_ok,
        "stale": not fresh_ok,
        "generated_at": _now_iso(),
        "generated_at_ts": int(time.time()),
        "source": "bilibili-wbi",
        "limit": args.limit,
        "user": user,
        "stat": stat,
        "partitions": partitions,
        "videos": videos,
        "dynamics": dynamics,
        "errors": errors,
    }

    try:
        write_json(out_path, result, pretty=args.pretty)
    except Exception as e:
        log("[致命] 写入 %s 失败：%s" % (out_path, e))
        return 1

    js_path = ""
    if not args.no_js:
        js_path = args.js_out or os.path.join(
            os.path.dirname(out_path) or ".", "bili.data.js"
        )
        try:
            write_js(js_path, result)
        except Exception as e:
            log("[警告] 写入 %s 失败（不影响 bili.json）：%s" % (js_path, e))
            js_path = ""

    # ---------------- 结果摘要 ----------------
    log("-" * 68)
    log("写入完成：%s" % out_path)
    if js_path:
        log("           %s（供 file:// 场景降级读取）" % js_path)
    log("  ok=%s  stale=%s  投稿=%d 条  动态=%d 条  分区=%d 项"
        % (result["ok"], result["stale"], len(videos), len(dynamics), len(partitions)))
    log("  UP 主：%s（Lv.%s，粉丝 %s）"
        % (user.get("name"), user.get("level"), user.get("fans")))
    for i, v in enumerate(videos[:5]):
        log("  [%d] %s | %s | 播放 %s" % (i + 1, v.get("bvid"), v.get("title"), v.get("play")))
    if errors:
        log("本次共 %d 条错误记录：" % len(errors))
        for e in errors:
            log("  - %s" % e)
    log("=" * 68)

    # 只要产出了合法文件就返回 0，避免定时任务因风控频繁报红
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log("已中断")
        sys.exit(130)
    except Exception as exc:
        log("[致命] 未捕获异常：%s" % exc)
        sys.exit(1)
