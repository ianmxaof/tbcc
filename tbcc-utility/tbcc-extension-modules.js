/**
 * Extension site-tool modules — tray-supervisor-style toggles on the pinned icon menu.
 * Storage: tbccExtensionModuleEnabled { [moduleId]: boolean } (missing = enabled).
 */
(function (root) {
  const STORAGE_KEY = "tbccExtensionModuleEnabled";
  const MENU_PREFIX = "tbccExtMod__";
  const ROOT_MENU = "tbccActionSiteTools";

  /** @type {Array<{ id: string, title: string, urlPatterns?: string[], backgroundOnly?: boolean }>} */
  const MODULES = [
    {
      id: "page_overlay",
      title: "Page overlay",
      urlPatterns: ["http://*/*", "https://*/*"],
    },
    {
      id: "operator_kit",
      title: "Operator kit overlay",
      description:
        "Border-dock kit — Alt+K toggle rail; slim/wide; Threat tab + pop-out; Phase 2 page tool chips",
      urlPatterns: ["http://*/*", "https://*/*"],
    },
    {
      id: "x_profile_gallery",
      title: "X overlay + feed download",
      urlPatterns: ["*://x.com/*", "*://twitter.com/*"],
    },
    {
      id: "x_auto_follow",
      title: "X list auto-follow",
      description:
        "Following/Followers list panel: walk Follow buttons with optional skip-male bio filter",
      urlPatterns: ["*://x.com/*", "*://twitter.com/*"],
    },
    {
      id: "erome_enhancer",
      title: "Erome enhancer",
      urlPatterns: ["*://erome.com/*", "*://*.erome.com/*"],
    },
    {
      id: "motherless_enhancer",
      title: "Motherless enhancer",
      description: "Chevron overlay: bulk friend, gallery ZIP, capped infinite scroll; ♥ favorite + 📣 shout on thumbs",
      urlPatterns: [
        "*://motherless.com/*",
        "*://*.motherless.com/*",
        "*://motherless.xxx/*",
        "*://*.motherless.xxx/*",
      ],
    },
    {
      id: "thisvid_enhancer",
      title: "ThisVid enhancer",
      description:
        "Title/privacy filters, duration·views sort, No Gay, mass friend, infinite scroll, download, Erome→ThisVid fill",
      urlPatterns: ["*://thisvid.com/*", "*://*.thisvid.com/*"],
    },
    {
      id: "bunkr_enhancer",
      title: "Bunkr enhancer",
      description:
        "Gallery view + favorites, auto-sort, quality scan, bunkr-albums.io infinite scroll + balbums.st hearts",
      urlPatterns: [
        "*://bunkr.ac/*",
        "*://*.bunkr.ac/*",
        "*://bunkr.ci/*",
        "*://*.bunkr.ci/*",
        "*://bunkr.cr/*",
        "*://*.bunkr.cr/*",
        "*://bunkr.fi/*",
        "*://*.bunkr.fi/*",
        "*://bunkr.ph/*",
        "*://*.bunkr.ph/*",
        "*://bunkr.pk/*",
        "*://*.bunkr.pk/*",
        "*://bunkr.ps/*",
        "*://*.bunkr.ps/*",
        "*://bunkr.si/*",
        "*://*.bunkr.si/*",
        "*://bunkr.sk/*",
        "*://*.bunkr.sk/*",
        "*://bunkr.ws/*",
        "*://*.bunkr.ws/*",
        "*://bunkr.black/*",
        "*://*.bunkr.black/*",
        "*://bunkr.red/*",
        "*://*.bunkr.red/*",
        "*://bunkr.media/*",
        "*://*.bunkr.media/*",
        "*://bunkr.site/*",
        "*://*.bunkr.site/*",
        "*://bunkr.ax/*",
        "*://*.bunkr.ax/*",
        "*://bunkr.cat/*",
        "*://*.bunkr.cat/*",
        "*://bunkr.ru/*",
        "*://*.bunkr.ru/*",
        "*://bunkr.su/*",
        "*://*.bunkr.su/*",
        "*://bunkr.la/*",
        "*://*.bunkr.la/*",
        "*://bunkr.is/*",
        "*://*.bunkr.is/*",
        "*://bunkr.to/*",
        "*://*.bunkr.to/*",
        "*://bunkrr.ru/*",
        "*://*.bunkrr.ru/*",
        "*://bunkrr.su/*",
        "*://*.bunkrr.su/*",
        "*://bunkrr.cr/*",
        "*://*.bunkrr.cr/*",
        "*://bunkrr.la/*",
        "*://*.bunkrr.la/*",
        "*://bunkrr.fi/*",
        "*://*.bunkrr.fi/*",
        "*://bunkrr.si/*",
        "*://*.bunkrr.si/*",
        "*://bunkrr.ph/*",
        "*://*.bunkrr.ph/*",
        "*://bunkrr.is/*",
        "*://*.bunkrr.is/*",
        "*://bunkrr.to/*",
        "*://*.bunkrr.to/*",
        "*://bunkrr.site/*",
        "*://*.bunkrr.site/*",
        "*://bunkrr.media/*",
        "*://*.bunkrr.media/*",
        "*://bunkrr.black/*",
        "*://*.bunkrr.black/*",
        "*://bunkr-albums.io/*",
        "*://*.bunkr-albums.io/*",
        "*://balbums.st/*",
        "*://*.balbums.st/*",
      ],
    },
    {
      id: "fetlife_suite",
      title: "FetLife suite",
      urlPatterns: ["*://fetlife.com/*", "*://www.fetlife.com/*"],
    },
    {
      id: "perchance_suite",
      title: "Perchance suite (prompt library)",
      description: "ChatGPT-style Perchat, persistent Chats sidebar, copy on each reply, no browser alerts",
      urlPatterns: [
        "*://perchance.org/*",
        "*://*.perchance.org/*",
        "*://image-generation.perchance.org/*",
      ],
    },
    {
      id: "onlyfans_enhancer",
      title: "OnlyFans enhancer suite",
      description:
        "Feed cleanup, hide video controls, full-size avatars, one-click download, user-list collector, free-sub filter",
      urlPatterns: ["*://onlyfans.com/*", "*://*.onlyfans.com/*"],
    },
    {
      id: "onlyfans_gallery",
      title: "OnlyFans gallery overlay",
      description:
        "FAB gallery — ZIP all / ZIP selected / download each; uses API harvest bag (full-res)",
      urlPatterns: ["*://onlyfans.com/*", "*://*.onlyfans.com/*"],
    },
    {
      id: "camwhores_enhancer",
      title: "CamWhores.tv enhancer suite",
      description:
        "Utilities mod + redirect kill + screenshot bypass + browse filters/infinite scroll (mirror TLDs)",
      urlPatterns: [
        "*://*.camwhores.tv/*",
        "*://camwhores.tv/*",
        "*://*.camwhores.video/*",
        "*://camwhores.video/*",
        "*://*.camwhores.online/*",
        "*://camwhores.online/*",
        "*://*.camwhores.porn/*",
        "*://camwhores.porn/*",
        "*://*.camwhores.one/*",
        "*://camwhores.one/*",
        "*://*.camwhores.media/*",
        "*://camwhores.media/*",
        "*://*.camwhores.love/*",
        "*://camwhores.love/*",
        "*://*.camwhores.lol/*",
        "*://camwhores.lol/*",
      ],
    },
    {
      id: "chaturbate_enhancer",
      title: "Chaturbate live tools",
      description: "Copy/open HLS URL + capped segment recorder on room pages",
      urlPatterns: ["*://chaturbate.com/*", "*://*.chaturbate.com/*"],
    },
    {
      id: "stripchat_enhancer",
      title: "Stripchat live tools",
      description: "Copy/open HLS URL + capped segment recorder (incl. xhamsterlive mirrors)",
      urlPatterns: [
        "*://stripchat.com/*",
        "*://*.stripchat.com/*",
        "*://xhamsterlive.com/*",
        "*://*.xhamsterlive.com/*",
        "*://instantfapcams.com/*",
        "*://*.instantfapcams.com/*",
      ],
    },
    {
      id: "xrares_enhancer",
      title: "Xrares enhancer suite",
      description: "Private video view + private video finder",
      urlPatterns: ["*://*.xrares.com/*"],
    },
    {
      id: "xvideos_enhancer",
      title: "XVIDEOS enhancer suite",
      description: "Grid filterer + customised features (download, favorites, thumb preview)",
      urlPatterns: [
        "https://www.xvideos.com/*",
        "https://xvideos.com/*",
        "https://*.xvideos.com/*",
        "http://www.xvideos.com/*",
        "http://xvideos.com/*",
        "http://*.xvideos.com/*",
      ],
    },
    {
      id: "coomer_enhancer",
      title: "Coomer enhancer suite",
      description: "Explore (search, trending, mixer) + image download buttons",
      urlPatterns: ["https://coomer.st/*", "https://*.coomer.st/*"],
    },
    {
      id: "redgifs_enhancer",
      title: "RedGifs enhancer suite",
      description: "HD, volume/quality, CPU saver, hashtags/niches, download, auto-follow",
      urlPatterns: [
        "*://*.redgifs.com/*",
        "*://redgifs.com/*",
        "*://*.gifdeliverynetwork.com/*",
      ],
    },
    {
      id: "bypass_it_enhancer",
      title: "Omni Bypass — shortlinks & hosters",
      description:
        "Auto-skip shortener timers / continue walls (Codeberg debloated + extras). Injected only on allowlisted hosts — leave Tampermonkey off.",
      urlPatterns: ["http://*/*", "https://*/*"],
      backgroundOnly: true,
    },
    {
      id: "doublelist_enhancer",
      title: "DoubleList enhancer suite",
      description: "Listing thumbnails + filter options on city pages",
      urlPatterns: [
        "*://doublelist.com/city/*",
        "*://www.doublelist.com/city/*",
      ],
    },
    {
      id: "fapello_enhancer",
      title: "Fapello gallery lightbox",
      description: "Profile grids open in a tri-display lightbox instead of a new tab",
      urlPatterns: ["https://fapello.com/*", "https://*.fapello.com/*"],
    },
    {
      id: "stashdb_enhancer",
      title: "StashDB backlog highlights",
      description:
        "Highlights pending scene/performer edits from the community backlog, with fill-in helpers on edit forms",
      urlPatterns: ["https://stashdb.org/*", "https://*.stashdb.org/*"],
    },
    {
      id: "hostile_site_shield",
      title: "Threat Monitor",
      description:
        "Floating Threat Monitor — kit Threat tab (Phase 1); fingerprint blocks, honeypots, session leaks, cookie intel, nuke",
      urlPatterns: ["http://*/*", "https://*/*"],
    },
    {
      id: "link_sanitizer",
      title: "Strip tracker params",
      description: "Rewrites clicked links in real time to drop utm_/fbclid/gclid and similar tracking params",
      urlPatterns: ["http://*/*", "https://*/*"],
    },
    {
      id: "image_dclick_download",
      title: "Double-click image save",
      description: "Double-click any image to download it (uses gallery convert format when set)",
      urlPatterns: ["http://*/*", "https://*/*"],
    },
    {
      id: "onlyfans_harvest",
      title: "OnlyFans harvest",
      urlPatterns: ["*://onlyfans.com/*", "*://*.onlyfans.com/*"],
    },
    {
      id: "madeporn_harvest",
      title: "made.porn harvest",
      description: "Bulk gallery crawl: embedded mp4/jpeg CDN URLs, scroll lazy-load, Crawl tab adapter",
      urlPatterns: ["*://made.porn/*", "*://*.made.porn/*"],
    },
    {
      id: "username_search_overlay",
      title: "Username search overlay",
      urlPatterns: [
        "*://stripchat.com/*",
        "*://*.stripchat.com/*",
        "*://chaturbate.com/*",
        "*://*.chaturbate.com/*",
        "*://onlyfans.com/*",
        "*://*.onlyfans.com/*",
        "*://fansly.com/*",
        "*://*.fansly.com/*",
        "*://instagram.com/*",
        "*://*.instagram.com/*",
        "*://x.com/*",
        "*://twitter.com/*",
        "*://xhamsterlive.com/*",
        "*://*.xhamsterlive.com/*",
        "*://cambb.xxx/*",
        "*://*.cambb.xxx/*",
        "*://nudecams.xxx/*",
        "*://*.nudecams.xxx/*",
      ],
    },
    {
      id: "send_saved",
      title: "Saved Messages send",
      backgroundOnly: true,
    },
    {
      id: "context_menus",
      title: "Right-click TBCC menus",
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

  function installActionMenus(mac) {
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
      id: "tbccActionSiteToolsHint",
      parentId: ROOT_MENU,
      title: "Click toggle · Ctrl+restart",
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
  }

  async function handleActionClick(info) {
    const id = String(info.menuItemId || "");
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
