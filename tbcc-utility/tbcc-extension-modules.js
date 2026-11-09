/**
 * Extension site-tool modules — tray-supervisor-style toggles on the pinned icon menu.
 * Storage: tbccExtensionModuleEnabled { [moduleId]: boolean } (missing = enabled).
 */
(function (root) {
  const STORAGE_KEY = "tbccExtensionModuleEnabled";
  const MENU_PREFIX = "tbccExtMod__";
  const ROOT_MENU = "tbccActionSiteTools";

  /**
   * Core-only Site tools. Site enhancers ship as Options → Plugins (plugin.json).
   * @type {Array<{ id: string, title: string, urlPatterns?: string[], backgroundOnly?: boolean, description?: string }>}
   */
  const MODULES = [
    {
      id: "context_menus",
      title: "Right-click TBCC menus",
      description: "Context-menu actions for gallery / lookup / inbox",
      backgroundOnly: true,
    },
    {
      id: "send_saved",
      title: "Saved Messages send",
      description: "Background send-to-Saved path when API is configured",
      backgroundOnly: true,
    },
  ];

  async function getEnabledMap() {
    try {
      const d = await chrome.storage.local.get(STORAGE_KEY);
      const raw = d[STORAGE_KEY];
      return raw && typeof raw === "object" ? raw : {};
    } catch (_) {
      return {};
    }
  }

  function isEnabled(map, id) {
    return map[id] !== false;
  }

  async function moduleEnabled(id) {
    const map = await getEnabledMap();
    return isEnabled(map, id);
  }

  function menuLabel(title, enabled) {
    return (enabled ? "[on] " : "[off] ") + title;
  }

  async function queryModuleTabs(mod) {
    if (!mod || !mod.urlPatterns || !mod.urlPatterns.length) return [];
    try {
      return await chrome.tabs.query({ url: mod.urlPatterns });
    } catch (_) {
      return [];
    }
  }

  async function notifyTabsModuleDisabled(mod) {
    const tabs = await queryModuleTabs(mod);
    for (const tab of tabs) {
      if (tab.id == null) continue;
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: "tbcc-extension-module-disabled",
          moduleId: mod.id,
        });
      } catch (_) {}
    }
  }

  async function reloadModuleTabs(mod) {
    const tabs = await queryModuleTabs(mod);
    let n = 0;
    for (const tab of tabs) {
      if (tab.id == null) continue;
      try {
        await chrome.tabs.reload(tab.id);
        n++;
      } catch (_) {}
    }
    return n;
  }

  async function toggleModule(id) {
    const mod = MODULES.find((m) => m.id === id);
    if (!mod) return null;
    const map = await getEnabledMap();
    const next = !isEnabled(map, id);
    map[id] = next;
    await chrome.storage.local.set({ [STORAGE_KEY]: map });
    if (!next && !mod.backgroundOnly) await notifyTabsModuleDisabled(mod);
    if (!mod.backgroundOnly && mod.urlPatterns && mod.urlPatterns.length) {
      await reloadModuleTabs(mod);
    }
    return next;
  }

  async function restartModule(id) {
    const mod = MODULES.find((m) => m.id === id);
    if (!mod) return 0;
    if (mod.backgroundOnly) {
      try {
        chrome.runtime.reload();
      } catch (_) {}
      return 1;
    }
    return reloadModuleTabs(mod);
  }

  async function installActionMenus(mac) {
    mac({
      id: ROOT_MENU,
      title: "TBCC: Site tools",
      contexts: ["action"],
    });
    for (const mod of MODULES) {
      mac({
        id: MENU_PREFIX + mod.id,
        parentId: ROOT_MENU,
        title: menuLabel(mod.title, true),
        contexts: ["action"],
      });
    }
    mac({
      id: "tbccActionSiteToolsPluginsHint",
      parentId: ROOT_MENU,
      title: "— Plugins (Options) —",
      contexts: ["action"],
      enabled: false,
    });
    const rt = typeof TbccPluginRuntime !== "undefined" ? TbccPluginRuntime : null;
    if (rt && typeof rt.installPluginMenus === "function") {
      await rt.installPluginMenus(mac, ROOT_MENU);
    }
    mac({
      id: "tbccActionSiteToolsHint",
      parentId: ROOT_MENU,
      title: "Click toggle · install via Options → Plugins",
      contexts: ["action"],
      enabled: false,
    });
  }

  async function refreshMenuLabels() {
    const map = await getEnabledMap();
    for (const mod of MODULES) {
      try {
        await chrome.contextMenus.update(MENU_PREFIX + mod.id, {
          title: menuLabel(mod.title, isEnabled(map, mod.id)),
        });
      } catch (_) {}
    }
    const rt = typeof TbccPluginRuntime !== "undefined" ? TbccPluginRuntime : null;
    if (rt && typeof rt.refreshPluginMenuLabels === "function") {
      await rt.refreshPluginMenuLabels();
    }
  }

  async function handleActionClick(info) {
    const id = String(info.menuItemId || "");
    const rt = typeof TbccPluginRuntime !== "undefined" ? TbccPluginRuntime : null;
    if (rt && typeof rt.handlePluginMenuClick === "function") {
      const pluginHit = await rt.handlePluginMenuClick(info);
      if (pluginHit) return pluginHit;
    }
    if (!id.startsWith(MENU_PREFIX)) return false;
    const modId = id.slice(MENU_PREFIX.length);
    const mod = MODULES.find((m) => m.id === modId);
    if (!mod) return false;
    const ctrl = Array.isArray(info.modifiers) && info.modifiers.includes("Ctrl");
    if (ctrl) {
      const n = await restartModule(modId);
      return { ok: true, action: "restart", moduleId: modId, title: mod.title, count: n };
    }
    const on = await toggleModule(modId);
    await refreshMenuLabels();
    return { ok: true, action: "toggle", moduleId: modId, title: mod.title, enabled: on };
  }

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[STORAGE_KEY]) void refreshMenuLabels();
    });
  }

  root.TBCC_EXT_MODULES = {
    STORAGE_KEY,
    MENU_PREFIX,
    MODULES,
    moduleEnabled,
    getEnabledMap,
    isEnabled,
    installActionMenus,
    refreshMenuLabels,
    handleActionClick,
    toggleModule,
    restartModule,
  };
})(typeof self !== "undefined" ? self : globalThis);
