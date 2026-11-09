/**
 * TBCC Utility — extension-only plugin runtime.
 * Plugins are local packages (plugin.json + main.js) or .user.js ports.
 * No remote code fetch. Inject via chrome.scripting on matching tabs.
 */
(function (root) {
  "use strict";

  const STORAGE_KEY = "tbccPluginsV1";
  const LEGACY_USERSCRIPT_KEY = "tbccUploadedUserscriptsV1";
  const MENU_PREFIX = "tbccPlugin__";

  function slugId(raw, fallback) {
    const s = String(raw || fallback || "plugin")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    return s || "plugin";
  }

  function parseUserscriptMeta(source) {
    const head = String(source || "").slice(0, 8000);
    const block = head.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/i);
    const body = block ? block[1] : head;
    const pick = (key) => {
      const re = new RegExp("@" + key + "\\s+(.+)$", "im");
      const m = body.match(re);
      return m ? m[1].trim() : "";
    };
    const matches = [];
    const matchRe = /@match\s+(\S+)/gi;
    let mm;
    while ((mm = matchRe.exec(body))) matches.push(mm[1].trim());
    const includes = [];
    const incRe = /@include\s+(\S+)/gi;
    while ((mm = incRe.exec(body))) includes.push(mm[1].trim());
    return {
      name: pick("name") || "",
      version: pick("version") || "0.0.0",
      matches: matches.length ? matches : includes.length ? includes : ["http://*/*", "https://*/*"],
      runAt: (pick("run-at") || "document-idle").replace(/_/g, "-"),
    };
  }

  function normalizePlugin(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = slugId(raw.id || raw.name, "plugin");
    const matches = Array.isArray(raw.matches)
      ? raw.matches.map((m) => String(m || "").trim()).filter(Boolean)
      : [];
    const source = String(raw.source || "");
    if (!source) return null;
    return {
      id,
      name: String(raw.name || id).trim() || id,
      version: String(raw.version || "0.0.0").trim() || "0.0.0",
      matches: matches.length ? matches : ["http://*/*", "https://*/*"],
      runAt: String(raw.runAt || raw.run_at || "document_idle").replace(/-/g, "_"),
      world: String(raw.world || "ISOLATED").toUpperCase() === "MAIN" ? "MAIN" : "ISOLATED",
      gmShim: raw.gmShim !== false,
      source,
      enabled: raw.enabled !== false,
      addedAt: raw.addedAt || new Date().toISOString(),
      sourceKind: raw.sourceKind === "userscript" ? "userscript" : "plugin",
    };
  }

  function fromPluginJson(manifest, mainSource) {
    const m = manifest && typeof manifest === "object" ? manifest : {};
    return normalizePlugin({
      id: m.id,
      name: m.name,
      version: m.version,
      matches: m.matches || m.match,
      runAt: m.runAt || m.run_at,
      world: m.world,
      gmShim: m.gmShim !== false && m.gm_shim !== false,
      source: mainSource,
      enabled: false,
      sourceKind: "plugin",
    });
  }

  function fromUserscriptSource(source, filename) {
    const meta = parseUserscriptMeta(source);
    return normalizePlugin({
      id: slugId(meta.name || filename, filename || "userscript"),
      name: meta.name || filename || "userscript",
      version: meta.version,
      matches: meta.matches,
      runAt: meta.runAt,
      gmShim: true,
      source,
      enabled: false,
      sourceKind: "userscript",
    });
  }

  /** Convert Chrome match pattern to RegExp (subset). */
  function matchPatternToRe(pattern) {
    const p = String(pattern || "").trim();
    if (!p || p === "<all_urls>") return /^https?:\/\//i;
    // file:// etc ignored
    let scheme = "*";
    let rest = p;
    const sch = p.match(/^([a-z*]+):\/\//i);
    if (sch) {
      scheme = sch[1];
      rest = p.slice(sch[0].length);
    }
    const slash = rest.indexOf("/");
    const host = slash >= 0 ? rest.slice(0, slash) : rest;
    const path = slash >= 0 ? rest.slice(slash) : "/*";
    const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const hostRe = esc(host).replace(/\\\*/g, "[^/]*");
    const pathRe = esc(path).replace(/\\\*/g, ".*");
    const schemeRe = scheme === "*" ? "https?" : esc(scheme);
    return new RegExp("^" + schemeRe + "://" + hostRe + pathRe + "$", "i");
  }

  function urlMatchesPlugin(url, plugin) {
    const u = String(url || "");
    if (!/^https?:/i.test(u)) return false;
    const list = (plugin && plugin.matches) || [];
    for (const pat of list) {
      try {
        if (matchPatternToRe(pat).test(u)) return true;
      } catch (_) {}
    }
    return false;
  }

  async function listPlugins() {
    const data = await chrome.storage.local.get([STORAGE_KEY, LEGACY_USERSCRIPT_KEY]);
    let list = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY].map(normalizePlugin).filter(Boolean) : [];
    const legacy = Array.isArray(data[LEGACY_USERSCRIPT_KEY]) ? data[LEGACY_USERSCRIPT_KEY] : [];
    if (legacy.length && !list.length) {
      list = legacy
        .map((row) =>
          normalizePlugin({
            id: row.id,
            name: row.name,
            version: "0.0.0",
            matches: ["http://*/*", "https://*/*"],
            source: row.source,
            enabled: !!row.enabled,
            addedAt: row.addedAt,
            sourceKind: "userscript",
            gmShim: true,
          })
        )
        .filter(Boolean);
      await chrome.storage.local.set({ [STORAGE_KEY]: list });
    }
    return list;
  }

  async function savePlugins(list) {
    const next = (Array.isArray(list) ? list : []).map(normalizePlugin).filter(Boolean);
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return next;
  }

  async function upsertPlugin(plugin) {
    const row = normalizePlugin(plugin);
    if (!row) throw new Error("Invalid plugin");
    const list = await listPlugins();
    const idx = list.findIndex((p) => p.id === row.id);
    if (idx >= 0) list[idx] = Object.assign({}, list[idx], row, { addedAt: list[idx].addedAt || row.addedAt });
    else list.push(row);
    await savePlugins(list);
    return row;
  }

  async function setEnabled(id, enabled) {
    const list = await listPlugins();
    const row = list.find((p) => p.id === id);
    if (!row) return null;
    row.enabled = !!enabled;
    await savePlugins(list);
    return row;
  }

  async function removePlugin(id) {
    const list = await listPlugins();
    const next = list.filter((p) => p.id !== id);
    await savePlugins(next);
    return next;
  }

  async function clearAll() {
    await savePlugins([]);
  }

  function injectFunc(source, pluginId) {
    try {
      const g = typeof globalThis !== "undefined" ? globalThis : window;
      g.__tbccPluginRan = g.__tbccPluginRan || {};
      if (g.__tbccPluginRan[pluginId]) return { ok: true, skipped: true };
      g.__tbccPluginRan[pluginId] = true;
      // eslint-disable-next-line no-eval
      (0, eval)(source);
      return { ok: true };
    } catch (e) {
      console.error("[TBCC plugin]", pluginId, e);
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  async function injectPluginIntoTab(tabId, plugin) {
    if (!plugin || !plugin.enabled || tabId == null) return { ok: false };
    const world = plugin.world === "MAIN" ? "MAIN" : "ISOLATED";
    try {
      if (plugin.gmShim && world === "ISOLATED") {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ["tbcc-userscript-gm-shim.js"],
            world: "ISOLATED",
          });
        } catch (_) {}
      }
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world,
        func: injectFunc,
        args: [plugin.source, plugin.id],
      });
      const r = results && results[0] && results[0].result;
      return r || { ok: true };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  async function injectMatchingPlugins(tabId, url) {
    const list = await listPlugins();
    const hits = list.filter((p) => p.enabled && urlMatchesPlugin(url, p));
    const out = [];
    for (const p of hits) {
      out.push({ id: p.id, ...(await injectPluginIntoTab(tabId, p)) });
    }
    return out;
  }

  function installNavigationHook() {
    if (!chrome.tabs || !chrome.tabs.onUpdated) return;
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status !== "complete") return;
      const url = (tab && tab.url) || changeInfo.url || "";
      if (!/^https?:/i.test(url)) return;
      void injectMatchingPlugins(tabId, url);
    });
  }

  /** Append plugin toggles under Site tools (or Plugins root). */
  async function installPluginMenus(mac, parentId) {
    const list = await listPlugins();
    for (const p of list) {
      mac({
        id: MENU_PREFIX + p.id,
        parentId,
        title: (p.enabled ? "[on] " : "[off] ") + p.name,
        contexts: ["action"],
      });
    }
  }

  async function refreshPluginMenuLabels() {
    const list = await listPlugins();
    for (const p of list) {
      try {
        await chrome.contextMenus.update(MENU_PREFIX + p.id, {
          title: (p.enabled ? "[on] " : "[off] ") + p.name,
        });
      } catch (_) {}
    }
  }

  async function handlePluginMenuClick(info) {
    const id = String(info.menuItemId || "");
    if (!id.startsWith(MENU_PREFIX)) return false;
    const pluginId = id.slice(MENU_PREFIX.length);
    const list = await listPlugins();
    const row = list.find((p) => p.id === pluginId);
    if (!row) return false;
    row.enabled = !row.enabled;
    await savePlugins(list);
    await refreshPluginMenuLabels();
    return { ok: true, action: "toggle", pluginId, title: row.name, enabled: row.enabled };
  }

  root.TbccPluginRuntime = {
    STORAGE_KEY,
    MENU_PREFIX,
    parseUserscriptMeta,
    normalizePlugin,
    fromPluginJson,
    fromUserscriptSource,
    urlMatchesPlugin,
    listPlugins,
    savePlugins,
    upsertPlugin,
    setEnabled,
    removePlugin,
    clearAll,
    injectMatchingPlugins,
    installNavigationHook,
    installPluginMenus,
    refreshPluginMenuLabels,
    handlePluginMenuClick,
  };
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
