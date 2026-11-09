/**
 * Erome-only rotating PAC proxy for TBCC Importer.
 *
 * Chrome's proxy API is profile-wide (not per-tab), so this installs a PAC
 * that returns DIRECT for every host except erome.com. Lists come from
 * ProxyScrape + Proxifly public feeds. Default OFF — those endpoints are
 * untrusted volunteers (see ProxyScrape FAQ).
 *
 * Content scripts cannot set chrome.proxy; this module is importScripts'd
 * from the service worker.
 */
(function (root) {
  "use strict";

  const STORAGE_KEY = "tbccEromeProxyRotate";
  const ALARM_NAME = "tbcc-erome-proxy-refresh";
  const MAX_LIST = 400;
  const REFRESH_MS = 5 * 60 * 1000;
  const SKIP_COOLDOWN_MS = 8000;
  const FETCH_TIMEOUT_MS = 15000;

  /** Chrome network errors on erome.com that mean the current hop is dead — rotate away. */
  const EROME_PROXY_FAILURE_ERRORS = {
    "net::ERR_PROXY_CONNECTION_FAILED": 1,
    "net::ERR_TUNNEL_CONNECTION_FAILED": 1,
    "net::ERR_SOCKS_CONNECTION_FAILED": 1,
    "net::ERR_PROXY_AUTH_REQUESTED": 1,
    "net::ERR_PROXY_CERTIFICATE_INVALID": 1,
    "net::ERR_PROXY_HTTP_1_1_REQUIRED": 1,
    "net::ERR_CONNECTION_CLOSED": 1,
    "net::ERR_CONNECTION_RESET": 1,
    "net::ERR_CONNECTION_REFUSED": 1,
    "net::ERR_EMPTY_RESPONSE": 1,
    "net::ERR_SSL_PROTOCOL_ERROR": 1,
  };

  function isEromeProxyFailureError(code) {
    return !!EROME_PROXY_FAILURE_ERRORS[String(code || "")];
  }

  const SOURCE_URLS = [
    {
      id: "proxyscrape_http",
      group: "proxyscrape",
      protocol: "http",
      url: "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=http&proxy_format=protocolipport&format=text&timeout=5000",
    },
    {
      id: "proxyscrape_socks5",
      group: "proxyscrape",
      protocol: "socks5",
      url: "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=socks5&proxy_format=protocolipport&format=text&timeout=5000",
    },
    {
      id: "proxifly_http",
      group: "proxifly",
      protocol: "http",
      url: "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt",
    },
    {
      id: "proxifly_https",
      group: "proxifly",
      protocol: "http",
      url: "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/https/data.txt",
    },
    {
      id: "proxifly_socks5",
      group: "proxifly",
      protocol: "socks5",
      url: "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/socks5/data.txt",
    },
  ];

  const DEFAULT_STATE = {
    enabled: false,
    sources: { proxyscrape: true, proxifly: true },
    protocols: { http: true, socks5: false },
    list: [],
    index: 0,
    failedKeys: [],
    lastRefresh: 0,
    lastError: "",
    lastApplied: null,
    pendingArm: true,
    skipUntil: 0,
  };

  /** Toolbar (any site) — PAC is profile-wide; this must work without loading erome.com. */
  const MENU_KILL_ID = "tbccEromeProxyKill";
  /** Page context (google, gallery, chrome-extension pages excluded by Chrome) — same kill. */
  const MENU_PAGE_KILL_ID = "tbccEromeProxyPageKill";

  function killMenuTitle(enabled) {
    return enabled ? "Site proxy: ON — click to disable" : "Site proxy: OFF";
  }

  function pageKillMenuTitle() {
    return "TBCC: Disable site proxy";
  }

  function isKillMenuId(id) {
    const s = String(id || "");
    return s === MENU_KILL_ID || s === MENU_PAGE_KILL_ID;
  }

  function killMenuSpecs(enabled) {
    const on = !!enabled;
    return [
      {
        id: MENU_KILL_ID,
        title: killMenuTitle(on),
        contexts: ["action"],
      },
      {
        id: MENU_PAGE_KILL_ID,
        title: pageKillMenuTitle(),
        contexts: ["page"],
      },
    ];
  }

  function isPrivateOrReserved(host) {
    const h = String(host || "").toLowerCase();
    if (!h || h === "localhost" || h === "::1" || h === "0.0.0.0") return true;
    if (h.indexOf(":") >= 0) return true;
    const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  function parseProxyLine(line, source) {
    const raw = String(line || "").trim();
    if (!raw || raw.charAt(0) === "#" || raw.charAt(0) === "/") return null;
    const m = raw.match(
      /^(?:(https?|socks4|socks5):\/\/)?(?:[^@\s/]+@)?(\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9.-]+):(\d{1,5})\s*$/i
    );
    if (!m) return null;
    const scheme = (m[1] || "http").toLowerCase();
    const host = m[2].toLowerCase();
    const port = Number(m[3]);
    if (!port || port > 65535) return null;
    if (isPrivateOrReserved(host)) return null;
    const normalized = scheme === "https" || scheme === "http" ? "http" : scheme === "socks4" ? "socks4" : "socks5";
    return {
      scheme: normalized,
      host,
      port,
      source: source || "",
      key: host + ":" + port,
    };
  }

  function parseProxyList(text, source) {
    const out = [];
    String(text || "")
      .split(/\r?\n/)
      .forEach((line) => {
        const entry = parseProxyLine(line, source);
        if (entry) out.push(entry);
      });
    return out;
  }

  function portRank(port) {
    const p = Number(port);
    if (p === 8080 || p === 3128 || p === 3129 || p === 8888 || p === 8118) return 0;
    if (p === 999 || p === 1080 || p === 4145 || p === 8000 || p === 8081) return 1;
    if (p === 80 || p === 443) return 9;
    return 2;
  }

  function mergeAndDedupe(batches, opts) {
    const protocols = (opts && opts.protocols) || { http: true, socks5: true };
    const seen = Object.create(null);
    const merged = [];
    batches.forEach((batch) => {
      (batch || []).forEach((entry) => {
        if (!entry || !entry.key || seen[entry.key]) return;
        const proto = entry.scheme === "socks5" || entry.scheme === "socks4" ? "socks5" : "http";
        if (protocols[proto] === false) return;
        seen[entry.key] = 1;
        merged.push(entry);
      });
    });
    merged.sort((a, b) => portRank(a.port) - portRank(b.port) || a.key.localeCompare(b.key));
    return merged.slice(0, MAX_LIST);
  }

  function pacDirective(entry) {
    if (!entry) return "DIRECT";
    const host = String(entry.host);
    const port = Number(entry.port);
    if (entry.scheme === "socks5") return "SOCKS5 " + host + ":" + port;
    if (entry.scheme === "socks4") return "SOCKS " + host + ":" + port;
    return "PROXY " + host + ":" + port;
  }

  function buildPacScript(entry) {
    const dir = pacDirective(entry).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return (
      "function FindProxyForURL(url, host) {\n" +
      '  host = (host || "").toLowerCase();\n' +
      '  if (host === "erome.com" || shExpMatch(host, "*.erome.com")) {\n' +
      '    return "' +
      dir +
      '";\n' +
      "  }\n" +
      '  return "DIRECT";\n' +
      "}\n"
    );
  }

  function isEromeHost(host) {
    const h = String(host || "")
      .toLowerCase()
      .replace(/\.$/, "");
    return h === "erome.com" || h.endsWith(".erome.com");
  }

  function hostOfUrl(url) {
    try {
      return new URL(String(url || "")).hostname.toLowerCase();
    } catch (_) {
      return "";
    }
  }

  function nextIndex(index, length) {
    const len = Math.max(0, Number(length) || 0);
    if (len <= 0) return 0;
    return (Math.max(0, Number(index) || 0) + 1) % len;
  }

  function pickLive(state) {
    const list = (state && state.list) || [];
    if (!list.length) return { entry: null, index: 0 };
    const failed = new Set(state.failedKeys || []);
    const start = Math.max(0, Number(state.index) || 0) % list.length;
    for (let i = 0; i < list.length; i++) {
      const idx = (start + i) % list.length;
      const entry = list[idx];
      if (entry && !failed.has(entry.key)) return { entry, index: idx };
    }
    return { entry: null, index: start };
  }

  function allProxiesFailed(state) {
    const list = (state && state.list) || [];
    if (!list.length) return false;
    const failed = new Set(state.failedKeys || []);
    return list.every((entry) => entry && failed.has(entry.key));
  }

  function publicStatus(state) {
    const pick = pickLive(state);
    const current = pick.entry;
    return {
      ok: true,
      enabled: !!state.enabled,
      sources: Object.assign({ proxyscrape: true, proxifly: true }, state.sources || {}),
      protocols: Object.assign({ http: true, socks5: false }, state.protocols || {}),
      listCount: (state.list || []).length,
      failedCount: (state.failedKeys || []).length,
      index: pick.index,
      current: current
        ? { scheme: current.scheme, host: current.host, port: current.port, source: current.source, key: current.key }
        : null,
      lastRefresh: state.lastRefresh || 0,
      lastError: state.lastError || "",
      display: current ? current.scheme + "://" + current.host + ":" + current.port : "none",
    };
  }

  const api = {
    STORAGE_KEY,
    SOURCE_URLS,
    DEFAULT_STATE,
    MENU_KILL_ID,
    MENU_PAGE_KILL_ID,
    isPrivateOrReserved,
    parseProxyLine,
    parseProxyList,
    mergeAndDedupe,
    portRank,
    pacDirective,
    buildPacScript,
    isEromeHost,
    hostOfUrl,
    nextIndex,
    pickLive,
    allProxiesFailed,
    isEromeProxyFailureError,
    EROME_PROXY_FAILURE_ERRORS,
    publicStatus,
    killMenuTitle,
    pageKillMenuTitle,
    isKillMenuId,
    killMenuSpecs,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { TbccEromeProxyRotate: api };
    return;
  }

  root.TbccEromeProxyRotate = api;

  function chromeBackgroundReady() {
    return (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      chrome.runtime.id &&
      chrome.proxy &&
      chrome.proxy.settings
    );
  }

  if (!chromeBackgroundReady()) return;

  const eromeTabs = new Set();
  let applying = false;
  let leaveRotateAt = 0;

  async function rotateOnSessionEnd() {
    const now = Date.now();
    if (now - leaveRotateAt < 1500) return;
    leaveRotateAt = now;
    const state = await loadState();
    if (!state.enabled) return;
    await rotate({ reload: false });
  }

  function loadState() {
    return chrome.storage.local.get(STORAGE_KEY).then((data) => {
      const raw = data && data[STORAGE_KEY];
      return Object.assign({}, DEFAULT_STATE, raw && typeof raw === "object" ? raw : {});
    });
  }

  function saveState(state) {
    return chrome.storage.local.set({ [STORAGE_KEY]: state }).then(() => state);
  }

  function fetchText(url) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    return fetch(url, { signal: ac.signal, cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
        return res.text();
      })
      .finally(() => clearTimeout(timer));
  }

  function applyPac(entry) {
    return new Promise((resolve) => {
      if (!entry) {
        chrome.proxy.settings.clear({ scope: "regular" }, () => {
          const err = chrome.runtime.lastError;
          resolve(err ? { ok: false, error: err.message } : { ok: true, cleared: true });
        });
        return;
      }
      chrome.proxy.settings.set(
        {
          value: { mode: "pac_script", pacScript: { data: buildPacScript(entry), mandatory: false } },
          scope: "regular",
        },
        () => {
          const err = chrome.runtime.lastError;
          resolve(err ? { ok: false, error: err.message } : { ok: true });
        }
      );
    });
  }

  function reloadEromeTabs() {
    return chrome.tabs
      .query({ url: ["*://erome.com/*", "*://*.erome.com/*"] })
      .then((tabs) =>
        Promise.all(
          (tabs || []).map((t) => {
            if (!t.id) return null;
            return chrome.tabs.reload(t.id).catch(() => null);
          })
        )
      )
      .catch(() => null);
  }

  async function refreshLists(state) {
    const sources = Object.assign({ proxyscrape: true, proxifly: true }, state.sources || {});
    const protocols = Object.assign({ http: true, socks5: false }, state.protocols || {});
    const wanted = SOURCE_URLS.filter((s) => sources[s.group] !== false && protocols[s.protocol] !== false);
    const batches = [];
    const errors = [];
    const settled = await Promise.allSettled(
      wanted.map((s) =>
        fetchText(s.url).then((text) => ({ source: s.id, entries: parseProxyList(text, s.id) }))
      )
    );
    settled.forEach((item, i) => {
      if (item.status === "fulfilled") batches.push(item.value.entries);
      else errors.push((wanted[i] && wanted[i].id) + ": " + (item.reason && item.reason.message ? item.reason.message : String(item.reason)));
    });
    const list = mergeAndDedupe(batches, { protocols });
    state.list = list;
    state.failedKeys = [];
    state.lastRefresh = Date.now();
    if (!list.length) {
      state.lastError = errors.length ? errors.join("; ") : "no proxies from selected sources";
    } else if (errors.length) {
      state.lastError = "partial: " + errors.join("; ");
    } else {
      state.lastError = "";
    }
    if (state.index >= list.length) state.index = 0;
    return state;
  }

  async function disablePacExhausted(state, reason) {
    state.enabled = false;
    state.lastError = reason || "no working proxy — PAC off";
    state.lastApplied = null;
    state.pendingArm = true;
    const cleared = await applyPac(null);
    if (!cleared.ok) state.lastError = cleared.error || state.lastError;
    await saveState(state);
    await chrome.alarms.clear(ALARM_NAME);
    await refreshKillMenuTitles();
    try {
      chrome.notifications.create("tbcc-erome-proxy-exhausted", {
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "TBCC Erome proxy",
        message: state.lastError + " Reload erome.com.",
      });
    } catch (_) {}
    return publicStatus(state);
  }

  async function applyCurrent(state, opts) {
    const o = opts || {};
    if (!state.enabled) {
      const cleared = await applyPac(null);
      state.lastApplied = null;
      if (!cleared.ok) state.lastError = cleared.error || "proxy clear failed";
      await saveState(state);
      return publicStatus(state);
    }
    if (!state.list.length || (o.forceRefresh && Date.now() - (state.lastRefresh || 0) > REFRESH_MS)) {
      await refreshLists(state);
    }
    const pick = pickLive(state);
    if (!pick.entry) {
      if (allProxiesFailed(state)) {
        return disablePacExhausted(state, "all public proxies failed for erome.com — PAC off");
      }
      return Object.assign(publicStatus(state), { ok: false, error: state.lastError || "empty list" });
    }
    state.index = pick.index;
    const applied = await applyPac(pick.entry);
    if (!applied.ok) {
      state.lastError = applied.error || "proxy set failed";
      state.lastApplied = null;
    } else {
      state.lastApplied = pick.entry ? pick.entry.key : null;
      if (!state.lastError || state.lastError.indexOf("partial:") !== 0) {
        if (pick.entry) state.lastError = "";
      }
    }
    await saveState(state);
    const status = publicStatus(state);
    status.applyOk = !!applied.ok;
    if (!applied.ok) status.error = applied.error;
    return status;
  }

  async function rotate(opts) {
    const o = opts || {};
    let state = await loadState();
    if (!state.enabled && !o.force) {
      return Object.assign(publicStatus(state), { ok: true, skipped: "disabled" });
    }
    if (!state.list.length) await refreshLists(state);
    if (!state.list.length) {
      await saveState(state);
      return Object.assign(publicStatus(state), { ok: false, error: state.lastError || "empty list" });
    }
    if (o.markFailed && state.list[state.index]) {
      const key = state.list[state.index].key;
      if (key && (state.failedKeys || []).indexOf(key) < 0) {
        state.failedKeys = (state.failedKeys || []).concat([key]).slice(-MAX_LIST);
      }
    }
    state.index = nextIndex(state.index, state.list.length);
    state.pendingArm = true;
    const status = await applyCurrent(state, {});
    if (o.reload !== false) await reloadEromeTabs();
    return status;
  }

  async function setEnabled(enabled, extra) {
    const state = await loadState();
    const next = Object.assign({}, state, extra || {});
    next.enabled = !!enabled;
    if (extra && extra.sources) next.sources = Object.assign({}, state.sources, extra.sources);
    if (extra && extra.protocols) next.protocols = Object.assign({}, state.protocols, extra.protocols);
    if (next.enabled) {
      next.pendingArm = true;
      await refreshLists(next);
      const status = await applyCurrent(next, {});
      await ensureAlarm();
      await reloadEromeTabs();
      return status;
    }
    await chrome.alarms.clear(ALARM_NAME);
    return applyCurrent(next, {});
  }

  async function ensureAlarm() {
    const state = await loadState();
    if (!state.enabled) {
      await chrome.alarms.clear(ALARM_NAME);
      return;
    }
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 5 });
  }

  async function restoreOnStartup() {
    const tabs = await chrome.tabs.query({ url: ["*://erome.com/*", "*://*.erome.com/*"] }).catch(() => []);
    eromeTabs.clear();
    (tabs || []).forEach((t) => {
      if (t.id) eromeTabs.add(t.id);
    });
    const state = await loadState();
    if (state.enabled) {
      await applyCurrent(state, { forceRefresh: Date.now() - (state.lastRefresh || 0) > REFRESH_MS });
      await ensureAlarm();
    }
  }

  function syncTabErome(tabId, url) {
    if (!tabId || !url) return;
    const on = isEromeHost(hostOfUrl(url));
    const was = eromeTabs.has(tabId);
    if (on && !was) {
      const first = eromeTabs.size === 0;
      eromeTabs.add(tabId);
      if (first) {
        void (async () => {
          const state = await loadState();
          if (!state.enabled) return;
          if (state.pendingArm) {
            state.pendingArm = false;
            await applyCurrent(state, {});
            return;
          }
          await rotate({ reload: false });
        })();
      }
      return;
    }
    if (!on && was) {
      eromeTabs.delete(tabId);
      if (eromeTabs.size === 0) void rotateOnSessionEnd();
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const action = msg && msg.action;
    if (!action || String(action).indexOf("tbcc-erome-proxy-") !== 0) return;
    const run = async () => {
      if (action === "tbcc-erome-proxy-status") return publicStatus(await loadState());
      if (action === "tbcc-erome-proxy-enable") {
        const st = await setEnabled(!!msg.enabled, {
          sources: msg.sources,
          protocols: msg.protocols,
        });
        await refreshKillMenuTitles();
        return st;
      }
      if (action === "tbcc-erome-proxy-kill") {
        const st = await setEnabled(false);
        await refreshKillMenuTitles();
        return st;
      }
      if (action === "tbcc-erome-proxy-options") {
        const state = await loadState();
        if (msg.sources) state.sources = Object.assign({}, state.sources, msg.sources);
        if (msg.protocols) state.protocols = Object.assign({}, state.protocols, msg.protocols);
        if (state.enabled) await refreshLists(state);
        else await saveState(state);
        if (state.enabled) return applyCurrent(state, {});
        return publicStatus(state);
      }
      if (action === "tbcc-erome-proxy-refresh") {
        const state = await loadState();
        await refreshLists(state);
        if (state.enabled) return applyCurrent(state, {});
        await saveState(state);
        return publicStatus(state);
      }
      if (action === "tbcc-erome-proxy-rotate") {
        return rotate({ reload: msg.reload !== false, markFailed: !!msg.markFailed });
      }
      return { ok: false, error: "unknown action" };
    };
    run()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo.url || (changeInfo.status === "loading" ? tab && tab.url : "");
    if (!url) return;
    syncTabErome(tabId, url);
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (!eromeTabs.has(tabId)) return;
    eromeTabs.delete(tabId);
    if (eromeTabs.size === 0) void rotateOnSessionEnd();
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm || alarm.name !== ALARM_NAME) return;
    void (async () => {
      const state = await loadState();
      if (!state.enabled) return;
      await refreshLists(state);
      await applyCurrent(state, {});
    })();
  });

  if (chrome.webRequest && chrome.webRequest.onErrorOccurred) {
    chrome.webRequest.onErrorOccurred.addListener(
      (details) => {
        if (details.tabId < 0) return;
        if (!isEromeProxyFailureError(details.error)) return;
        if (!isEromeHost(hostOfUrl(details.url))) return;
        void (async () => {
          if (applying) return;
          const state = await loadState();
          if (!state.enabled) return;
          const now = Date.now();
          if (now < (state.skipUntil || 0)) return;
          applying = true;
          state.skipUntil = now + SKIP_COOLDOWN_MS;
          await saveState(state);
          try {
            const afterMark = await loadState();
            if (afterMark.list[afterMark.index]) {
              const key = afterMark.list[afterMark.index].key;
              if (key && (afterMark.failedKeys || []).indexOf(key) < 0) {
                afterMark.failedKeys = (afterMark.failedKeys || []).concat([key]).slice(-MAX_LIST);
                await saveState(afterMark);
              }
            }
            if (allProxiesFailed(await loadState())) {
              await disablePacExhausted(await loadState(), "all public proxies failed for erome.com — PAC off");
              await reloadEromeTabs();
              return;
            }
            await rotate({ reload: true, markFailed: false });
          } finally {
            applying = false;
          }
        })();
      },
      { urls: ["*://erome.com/*", "*://*.erome.com/*"] }
    );
  }

  async function refreshKillMenuTitles() {
    const state = await loadState();
    try {
      await chrome.contextMenus.update(MENU_KILL_ID, { title: killMenuTitle(!!state.enabled) });
    } catch (_) {}
  }

  function installKillMenus(mac) {
    const create =
      typeof mac === "function"
        ? mac
        : (props) => {
            chrome.contextMenus.create(props, () => {
              void chrome.runtime.lastError;
            });
          };
    killMenuSpecs(false).forEach(create);
    void refreshKillMenuTitles();
  }

  if (chrome.contextMenus && chrome.contextMenus.onClicked) {
    chrome.contextMenus.onClicked.addListener((info) => {
      if (!isKillMenuId(info && info.menuItemId)) return;
      void (async () => {
        const st = await setEnabled(false);
        await refreshKillMenuTitles();
        try {
          chrome.notifications.create("tbcc-erome-proxy-kill", {
            type: "basic",
            iconUrl: "icons/icon48.png",
            title: "TBCC",
            message:
              st && st.enabled
                ? "Erome proxy still on."
                : "Erome proxy off — PAC cleared. Reload erome.com.",
          });
        } catch (_) {}
      })();
    });
  }

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[STORAGE_KEY]) void refreshKillMenuTitles();
    });
  }

  api.installKillMenus = installKillMenus;

  void restoreOnStartup();
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
