/**
 * Hostile Site Shield — background: event bus, request firewall, cookie intel, session nuke.
 * importScripts from background.js after hostile-site-shield-lib.js
 */
(function (root) {
  "use strict";

  const lib = root.TbccHostileShieldLib;
  if (!lib) return;

  const { STORAGE_KEY, DEFAULT_STATE, appendEvent, computeScore, resolveHostTier, tierConfig, classifyRequestUrl, normalizeHost, sensitiveCookieNames, cookieNamesSummary, isAlwaysLogEventType } = lib;

  let registryDoc = null;
  /** @type {Map<number, { host: string, tier: string, events: object[], score: number, cookieBaseline: string[] }>} */
  const tabIntel = new Map();

  function chromeReady() {
    return typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;
  }

  if (!chromeReady()) return;

  async function loadRegistryDoc() {
    if (registryDoc) return registryDoc;
    try {
      const url = chrome.runtime.getURL("hostile-site-registry.json");
      const resp = await fetch(url);
      registryDoc = await resp.json();
    } catch (e) {
      registryDoc = { hosts: {}, defaults: {}, fingerprinterDomains: [], trackerBlocklist: [] };
      console.warn("TBCC hostile shield: registry load failed", e);
    }
    return registryDoc;
  }

  async function loadState() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const raw = data && data[STORAGE_KEY];
    const doc = await loadRegistryDoc();
    const merged = Object.assign({}, DEFAULT_STATE, raw && typeof raw === "object" ? raw : {});
    const hud = lib.normalizeHudUi(merged);
    merged.hudVisible = hud.hudVisible;
    merged.hudCollapsed = hud.hudCollapsed;
    merged.hudDismissed = hud.hudDismissed;
    merged.hudPos = hud.hudPos;
    if (!merged.threatMonitorMigratedV2) {
      merged.globalWatch = true;
      merged.enabled = merged.enabled !== false;
      merged.threatMonitorMigratedV2 = true;
      await chrome.storage.local.set({ [STORAGE_KEY]: merged });
    }
    if (!merged.threatMonitorInKitV1) {
      // Phase 1: Threat UI lives in TBCC kit — dismiss standalone HUD by default.
      merged.hudDismissed = true;
      merged.hudVisible = false;
      merged.threatMonitorInKitV1 = true;
      await chrome.storage.local.set({ [STORAGE_KEY]: merged });
    }
    if (!merged.fingerprinterDomains || !merged.fingerprinterDomains.length) {
      merged.fingerprinterDomains = (doc && doc.fingerprinterDomains) || [];
    }
    if (!merged.trackerBlocklist || !merged.trackerBlocklist.length) {
      merged.trackerBlocklist = (doc && doc.trackerBlocklist) || [];
    }
    return merged;
  }

  async function saveState(state) {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  function getTabRecord(tabId) {
    if (!tabIntel.has(tabId)) {
      tabIntel.set(tabId, { host: "", tier: "", events: [], score: 0, cookieBaseline: [] });
    }
    return tabIntel.get(tabId);
  }

  async function pushEvent(tabId, ev, sender) {
    const state = await loadState();
    if (!state.enabled) return { ok: false, reason: "disabled" };
    const host = normalizeHost(ev.host || (sender && sender.tab && sender.tab.url ? new URL(sender.tab.url).hostname : ""));
    let tier = resolveHostTier(host, state, await loadRegistryDoc());
    if (!tier && isAlwaysLogEventType(ev.type)) tier = state.defaultTier || "watch";
    if (!tier) return { ok: false, reason: "not_hostile" };

    const rec = getTabRecord(tabId);
    rec.host = host;
    rec.tier = tier;
    rec.events = appendEvent(rec.events, Object.assign({}, ev, { host }));
    rec.score = computeScore(rec.events);

    try {
      chrome.tabs.sendMessage(tabId, {
        action: "tbcc-hostile-intel-push",
        tabId,
        snapshot: publicSnapshot(rec, tier, state),
      });
    } catch (_) {}

    return { ok: true, score: rec.score, tier };
  }

  function publicSnapshot(rec, tier, state) {
    const cfg = tierConfig(tier, registryDoc);
    return {
      ok: true,
      enabled: !!state.enabled,
      host: rec.host,
      tier,
      score: rec.score,
      band: lib.scoreBand(rec.score),
      activeCounter: !!cfg.activeCounter,
      blockThirdParty: !!cfg.blockThirdParty,
      events: rec.events.slice(-24).reverse(),
      cookieBaseline: rec.cookieBaseline.length,
      sensitiveCookies: sensitiveCookieNames(rec.cookieBaseline),
    };
  }

  async function snapshotForTab(tabId) {
    const state = await loadState();
    const rec = tabIntel.get(tabId) || { host: "", tier: "", events: [], score: 0, cookieBaseline: [] };
    let host = rec.host;
    if (!host && tabId != null) {
      try {
        const tab = await chrome.tabs.get(tabId);
        host = normalizeHost(new URL(String(tab.url || "")).hostname);
      } catch (_) {}
    }
    const doc = await loadRegistryDoc();
    const tier = rec.tier || resolveHostTier(host, state, doc) || state.defaultTier || "watch";
    if (host && !rec.host) rec.host = host;
    return publicSnapshot(rec, tier, state);
  }

  async function scanCookiesForTab(tabId, pageUrl) {
    const state = await loadState();
    if (!state.enabled || !pageUrl) return { ok: false };
    let url = String(pageUrl);
    try {
      const cookies = await chrome.cookies.getAll({ url });
      const names = cookieNamesSummary(cookies);
      const rec = getTabRecord(tabId);
      const before = new Set(rec.cookieBaseline || []);
      rec.cookieBaseline = names;
      const newNames = names.filter((n) => !before.has(n));
      if (before.size && newNames.length >= 3) {
        await pushEvent(tabId, {
          type: "cookie_surge",
          detail: "+" + newNames.length + " cookies: " + newNames.slice(0, 5).join(", "),
          url,
          host: normalizeHost(new URL(url).hostname),
        });
      }
      return { ok: true, count: names.length, sensitive: sensitiveCookieNames(names), newNames };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async function nukeSessionForUrl(pageUrl) {
    const u = String(pageUrl || "");
    if (!u) return { ok: false, error: "no url" };
    let origin;
    try {
      origin = new URL(u).origin;
    } catch (_) {
      return { ok: false, error: "bad url" };
    }
    const host = normalizeHost(new URL(u).hostname);
    const removed = [];
    try {
      const cookies = await chrome.cookies.getAll({ url: origin });
      for (const c of cookies) {
        const proto = c.secure ? "https:" : "http:";
        const domain = c.domain && c.domain.charAt(0) === "." ? c.domain.slice(1) : c.domain || host;
        const cookieUrl = proto + "//" + domain + (c.path || "/");
        await chrome.cookies.remove({ url: cookieUrl, name: c.name });
        removed.push(c.name);
      }
    } catch (e) {
      return { ok: false, error: String(e) };
    }
    return { ok: true, removed: removed.length, names: removed.slice(0, 40) };
  }

  async function shouldBlockRequest(url, tabId) {
    const state = await loadState();
    if (!state.enabled) return false;
    const rec = tabIntel.get(tabId);
    const host = rec && rec.host;
    const tier = (rec && rec.tier) || (host ? resolveHostTier(host, state, await loadRegistryDoc()) : null);
    if (!tier) return false;
    const cfg = tierConfig(tier, registryDoc || (await loadRegistryDoc()));
    if (!cfg.blockThirdParty) return false;
    return !!classifyRequestUrl(url, state, registryDoc || (await loadRegistryDoc()));
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const action = msg && msg.action;
    if (!action || String(action).indexOf("tbcc-hostile-") !== 0) return;

    const run = async () => {
      if (action === "tbcc-hostile-event") {
        const tabId = (sender && sender.tab && sender.tab.id) || msg.tabId;
        if (tabId == null) return { ok: false, error: "no tab" };
        return pushEvent(tabId, msg, sender);
      }
      if (action === "tbcc-hostile-intel-snapshot") {
        const tabId = msg.tabId != null ? msg.tabId : sender && sender.tab && sender.tab.id;
        return snapshotForTab(tabId);
      }
      if (action === "tbcc-hostile-cookie-scan") {
        const tabId = msg.tabId != null ? msg.tabId : sender && sender.tab && sender.tab.id;
        return scanCookiesForTab(tabId, msg.url);
      }
      if (action === "tbcc-hostile-session-nuke") {
        return nukeSessionForUrl(msg.url);
      }
      if (action === "tbcc-hostile-add-host") {
        const state = await loadState();
        const host = normalizeHost(msg.host);
        const tier = String(msg.tier || "resist");
        if (!host) return { ok: false, error: "host required" };
        state.registry = Object.assign({}, state.registry || {}, { [host]: { tier, notes: msg.notes || "operator added" } });
        await saveState(state);
        return { ok: true, host, tier };
      }
      if (action === "tbcc-hostile-config") {
        const state = await loadState();
        const doc = await loadRegistryDoc();
        const host = normalizeHost(msg.host);
        const tier = host ? resolveHostTier(host, state, doc) : null;
        const tabId = sender && sender.tab && sender.tab.id;
        if (tabId != null && host && tier) {
          const rec = getTabRecord(tabId);
          rec.host = host;
          rec.tier = tier;
        }
        return { ok: true, state, tier, cfg: tier ? tierConfig(tier, doc) : null };
      }
      if (action === "tbcc-hostile-inject-main") {
        const tabId = sender && sender.tab && sender.tab.id;
        if (tabId == null) return { ok: false, error: "no tab" };
        if (!chrome.scripting || typeof chrome.scripting.executeScript !== "function") {
          return { ok: false, error: "no scripting" };
        }
        const blockDomains = Array.isArray(msg.blockDomains) ? msg.blockDomains : [];
        const cfg = msg.cfg && typeof msg.cfg === "object" ? msg.cfg : {};
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            files: ["hostile-site-shield-main.js"],
          });
          await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            args: [
              {
                blockDomains,
                activeCounter: !!cfg.activeCounter,
                fingerprint: cfg.fingerprint || "log",
              },
            ],
            func: (payload) => {
              try {
                if (typeof window.__tbccHostileShieldConfigure === "function") {
                  window.__tbccHostileShieldConfigure(payload);
                }
              } catch (_) {}
            },
          });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) };
        }
      }
      if (action === "tbcc-hostile-tracking-params") {
        const doc = await loadRegistryDoc();
        const params = (doc && Array.isArray(doc.trackingParams) && doc.trackingParams) || [];
        return { ok: true, trackingParams: params };
      }
      if (action === "tbcc-hostile-export") {
        const tabId = msg.tabId != null ? msg.tabId : sender && sender.tab && sender.tab.id;
        const snap = await snapshotForTab(tabId);
        return { ok: true, jsonl: JSON.stringify(snap) + "\n" };
      }
      return { ok: false, error: "unknown action" };
    };

    run()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  });

  if (chrome.webRequest && chrome.webRequest.onBeforeRequest) {
    chrome.webRequest.onBeforeRequest.addListener(
      (details) => {
        if (details.tabId < 0) return;
        void (async () => {
          const state = await loadState();
          if (!state.enabled) return;
          const kind = classifyRequestUrl(details.url, state, registryDoc || (await loadRegistryDoc()));
          if (!kind) return;
          const rec = tabIntel.get(details.tabId);
          const pageHost = rec && rec.host;
          const tier = (rec && rec.tier) || (pageHost ? resolveHostTier(pageHost, state, await loadRegistryDoc()) : null);
          if (!tier) return;
          const cfg = tierConfig(tier, registryDoc || (await loadRegistryDoc()));
          if (!cfg.blockThirdParty) return;
          await pushEvent(details.tabId, {
            type: "request_blocked",
            detail: kind + " " + String(details.url || "").slice(0, 120),
            url: details.url,
            host: pageHost || normalizeHost(new URL(details.url).hostname),
          });
        })();
      },
      { urls: ["<all_urls>"] },
      []
    );
  }

  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const state = await loadState();
      const rec = tabIntel.get(tabId);
      tabIntel.delete(tabId);
      if (!state.nukeOnTabClose || !rec || !rec.host) return;
      const tier = rec.tier || resolveHostTier(rec.host, state, await loadRegistryDoc());
      if (!tier || tier === "watch") return;
      try {
        const tabs = await chrome.tabs.query({});
        const stillOpen = (tabs || []).some((t) => {
          try {
            return normalizeHost(new URL(String(t.url || "")).hostname) === rec.host;
          } catch (_) {
            return false;
          }
        });
        if (stillOpen) return;
        await nukeSessionForUrl("https://" + rec.host + "/");
      } catch (_) {}
    })();
  });

  root.TbccHostileShieldBg = {
    loadState,
    loadRegistryDoc,
    snapshotForTab,
    nukeSessionForUrl,
  };
})(typeof self !== "undefined" ? self : globalThis);
