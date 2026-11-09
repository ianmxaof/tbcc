/**
 * Hostile Site Shield — shared scoring, registry, and detection helpers.
 * Operator counter-intelligence: active blocks + real-time threat feed.
 */
(function (root) {
  "use strict";

  const STORAGE_KEY = "tbccHostileShield";
  const EVENT_RING_MAX = 200;

  const SCORE_WEIGHTS = {
    fp_canvas: 8,
    fp_webgl: 8,
    fp_webrtc: 10,
    fp_audio: 6,
    fingerprint_blocked: 5,
    request_blocked: 3,
    honeypot_click_target: 15,
    honeypot_form: 12,
    session_leak_url: 20,
    pastejack_attempt: 25,
    canary_trip: 18,
    cookie_surge: 10,
    download_offer: 5,
    login_submit: 5,
    third_party_script: 2,
    soft_block_suspect: 8,
    link_sanitized: 1,
    geolocation_blocked: 2,
  };

  /** Event types logged to the feed on any host, even outside the registry/tier gate. */
  const ALWAYS_LOG_EVENT_TYPES = ["link_sanitized", "geolocation_blocked"];

  function isAlwaysLogEventType(type) {
    return ALWAYS_LOG_EVENT_TYPES.indexOf(String(type || "")) !== -1;
  }

  const DEFAULT_STATE = {
    enabled: true,
    globalWatch: true,
    hudVisible: false,
    hudCollapsed: true,
    hudDismissed: true,
    hudPos: { x: null, y: null },
    defaultTier: "watch",
    registry: {},
    fingerprinterDomains: [],
    trackerBlocklist: [],
    nukeOnTabClose: true,
  };

  function normalizeHudUi(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const pos = src.hudPos && typeof src.hudPos === "object" ? src.hudPos : {};
    const x = Number(pos.x);
    const y = Number(pos.y);
    return {
      hudVisible: src.hudVisible !== false,
      hudCollapsed: !!src.hudCollapsed,
      hudDismissed: !!src.hudDismissed,
      hudPos: {
        x: Number.isFinite(x) ? x : null,
        y: Number.isFinite(y) ? y : null,
      },
    };
  }

  function applyHudUiPatch(state, patch) {
    const base = state && typeof state === "object" ? Object.assign({}, state) : Object.assign({}, DEFAULT_STATE);
    const merged = normalizeHudUi(Object.assign({}, normalizeHudUi(base), patch && typeof patch === "object" ? patch : {}));
    base.hudVisible = merged.hudVisible;
    base.hudCollapsed = merged.hudCollapsed;
    base.hudDismissed = merged.hudDismissed;
    base.hudPos = merged.hudPos;
    return base;
  }

  function normalizeHost(host) {
    return String(host || "")
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/:\d+$/, "");
  }

  function hostMatchesPattern(host, pattern) {
    const h = normalizeHost(host);
    const p = normalizeHost(pattern);
    if (!h || !p) return false;
    if (p.startsWith("*.")) return h === p.slice(2) || h.endsWith(p.slice(1));
    return h === p || h.endsWith("." + p);
  }

  function mergeRegistry(base, override) {
    const out = Object.assign({}, base && base.hosts ? base.hosts : {}, override || {});
    return out;
  }

  function resolveHostTier(host, state, registryDoc) {
    const h = normalizeHost(host);
    if (!h) return null;
    const reg = Object.assign(
      {},
      (registryDoc && registryDoc.hosts) || {},
      (state && state.registry) || {}
    );
    for (const [key, cfg] of Object.entries(reg)) {
      if (hostMatchesPattern(h, key)) return (cfg && cfg.tier) || state.defaultTier || "watch";
    }
    if (state && state.globalWatch) return state.defaultTier || "watch";
    return null;
  }

  function tierConfig(tier, registryDoc) {
    const defs = (registryDoc && registryDoc.defaults) || {};
    return defs[tier] || defs.watch || { fingerprint: "log", blockThirdParty: false, activeCounter: false };
  }

  function scoreForEventType(type) {
    return SCORE_WEIGHTS[String(type || "")] || 1;
  }

  function computeScore(events) {
    let total = 0;
    (events || []).forEach((ev) => {
      total += Number(ev.score || scoreForEventType(ev.type));
    });
    return total;
  }

  function scoreBand(score) {
    const s = Number(score) || 0;
    if (s >= 51) return "red";
    if (s >= 26) return "yellow";
    return "green";
  }

  function urlHasSessionLeak(url) {
    const u = String(url || "");
    if (!u) return false;
    return /[?&](?:sid|PHPSESSID|session_id|sessid)=/i.test(u);
  }

  function domainInList(host, list) {
    const h = normalizeHost(host);
    if (!h || !list || !list.length) return false;
    return list.some((entry) => {
      const d = normalizeHost(entry).replace(/^\*\./, "");
      return h === d || h.endsWith("." + d) || hostMatchesPattern(h, entry);
    });
  }

  function classifyRequestUrl(url, state, registryDoc) {
    try {
      const host = normalizeHost(new URL(String(url)).hostname);
      const fp = (state && state.fingerprinterDomains) || (registryDoc && registryDoc.fingerprinterDomains) || [];
      const tr = (state && state.trackerBlocklist) || (registryDoc && registryDoc.trackerBlocklist) || [];
      if (domainInList(host, fp)) return "fingerprinter";
      if (domainInList(host, tr)) return "tracker";
    } catch (_) {}
    return null;
  }

  /** Honeypot heuristics — zero-size or invisible click targets. */
  function honeypotElementScore(el) {
    if (!el || el.nodeType !== 1) return 0;
    const tag = String(el.tagName || "").toLowerCase();
    if (tag !== "a" && tag !== "button" && tag !== "input") return 0;
    const rect = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null;
    if (!rect) return 0;
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    const style = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
    const opacity = style ? parseFloat(style.opacity) : 1;
    const display = style ? style.display : "";
    const visibility = style ? style.visibility : "";
    if (display === "none" || visibility === "hidden") return 20;
    if (area <= 4 && opacity < 0.05) return 18;
    if (area <= 16 && opacity < 0.15) return 14;
    return 0;
  }

  function sanitizeEvent(ev) {
    const o = ev && typeof ev === "object" ? ev : {};
    const type = String(o.type || "unknown").slice(0, 64);
    return {
      type,
      detail: String(o.detail || "").slice(0, 240),
      ts: Number(o.ts) || Date.now(),
      url: String(o.url || "").slice(0, 512),
      host: normalizeHost(o.host),
      score: Number(o.score) || scoreForEventType(type),
    };
  }

  function appendEvent(ring, ev) {
    const list = Array.isArray(ring) ? ring.slice() : [];
    list.push(sanitizeEvent(ev));
    while (list.length > EVENT_RING_MAX) list.shift();
    return list;
  }

  function cookieNamesSummary(cookies) {
    return (cookies || [])
      .map((c) => String(c.name || ""))
      .filter(Boolean)
      .sort();
  }

  function sensitiveCookieNames(names) {
    const re = /(?:session|auth|token|sid|login|jwt|remember|phpsessid)/i;
    return (names || []).filter((n) => re.test(n));
  }

  const api = {
    STORAGE_KEY,
    EVENT_RING_MAX,
    SCORE_WEIGHTS,
    ALWAYS_LOG_EVENT_TYPES,
    isAlwaysLogEventType,
    DEFAULT_STATE,
    normalizeHost,
    hostMatchesPattern,
    mergeRegistry,
    resolveHostTier,
    tierConfig,
    scoreForEventType,
    computeScore,
    scoreBand,
    urlHasSessionLeak,
    domainInList,
    classifyRequestUrl,
    honeypotElementScore,
    sanitizeEvent,
    appendEvent,
    cookieNamesSummary,
    sensitiveCookieNames,
    normalizeHudUi,
    applyHudUiPatch,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { TbccHostileShieldLib: api };
    return;
  }
  root.TbccHostileShieldLib = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
