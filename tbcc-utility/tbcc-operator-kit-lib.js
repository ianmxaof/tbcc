/**
 * Operator kit — favorites overlay state, pin catalog, quick-add helpers.
 * Shell geometry lives in TbccOverlayShellLib; kit state embeds shell fields.
 */
(function (root) {
  const STORAGE_KEY = "tbccOperatorKit";
  const STORAGE_SNIPPETS = "tbccSnippets";

  const KIT_TABS = [
    { id: "tools", label: "Tools" },
    { id: "threat", label: "Threat" },
    { id: "inbox", label: "Inbox", disabled: true },
    { id: "archive", label: "Archive", disabled: true },
    { id: "crawl", label: "Crawl", disabled: true },
  ];

  /** @type {Record<string, { label: string, icon: string, kind?: string }>} */
  const PIN_CATALOG = {
    reverse_search: { label: "Reverse search", icon: "🔍" },
    threat_monitor: { label: "Threat Monitor", icon: "🛡" },
    image_dclick: { label: "Dbl-click save", icon: "🖼", kind: "toggle" },
    image_convert: { label: "Save as JPEG", icon: "⇄", kind: "cycle" },
    link_sanitizer: { label: "Strip trackers", icon: "🔗", kind: "toggle" },
    snippet_library: { label: "Snippets", icon: "⌘" },
    gallery: { label: "Gallery", icon: "⊞" },
    extension_options: { label: "Options", icon: "⚙" },
  };

  const PIN_ALIASES = {
    erome_proxy_kill: "threat_monitor",
  };

  const DROPPED_PINS = new Set(["download_routing", "context_menu"]);

  const DEFAULT_PINS = [
    "reverse_search",
    "threat_monitor",
    "image_dclick",
    "image_convert",
    "link_sanitizer",
  ];

  const DEFAULT_STATE = {
    visible: true,
    collapsed: true,
    mode: "docked",
    edge: "right",
    offset: 72,
    widthMode: "slim",
    floatPos: { x: null, y: null },
    tabId: "tools",
    sections: {},
    quickAddCollapsed: true,
    threatPopout: false,
    kitRailAlwaysV1: true,
    pos: { x: null, y: null },
    pins: DEFAULT_PINS.slice(),
  };

  function shellLib() {
    return root.TbccOverlayShellLib || (typeof globalThis !== "undefined" ? globalThis.TbccOverlayShellLib : null);
  }

  function sanitizePins(raw) {
    const list = Array.isArray(raw) ? raw : DEFAULT_PINS;
    const out = [];
    list.forEach((id) => {
      let key = String(id || "").trim();
      if (PIN_ALIASES[key]) key = PIN_ALIASES[key];
      if (!key || DROPPED_PINS.has(key) || !PIN_CATALOG[key] || out.includes(key)) return;
      out.push(key);
    });
    return out.length ? out : DEFAULT_PINS.slice();
  }

  function normalizeTabId(raw) {
    const id = String(raw || "").trim() || "tools";
    const hit = KIT_TABS.find((t) => t.id === id && !t.disabled);
    return hit ? hit.id : "tools";
  }

  function normalizeKitState(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const pos = src.pos && typeof src.pos === "object" ? src.pos : {};
    const sh = shellLib();
    const shellPart = sh
      ? sh.normalizeShellState(
          {
            visible: src.visible !== undefined ? src.visible : DEFAULT_STATE.visible,
            collapsed: src.collapsed !== undefined ? src.collapsed : DEFAULT_STATE.collapsed,
            mode: src.mode,
            edge: src.edge,
            offset: src.offset,
            widthMode: src.widthMode,
            floatPos: src.floatPos,
            floatSize: src.floatSize,
            tabId: src.tabId,
            sections: src.sections,
          },
          { w: 1280, h: 720 }
        )
      : {
          visible: src.visible !== undefined ? !!src.visible : true,
          collapsed: src.collapsed !== false,
          mode: src.mode === "float" ? "float" : "docked",
          edge: "right",
          offset: 72,
          widthMode: src.widthMode === "wide" ? "wide" : "slim",
          floatPos: { x: null, y: null },
          floatSize: { w: null, h: null },
          tabId: "tools",
          sections: {},
        };

    // Legacy free-float pos → float mode once if no shell edge saved yet.
    // Never float while collapsed (chevron is display:none in float CSS).
    if (
      !src.mode &&
      !src.edge &&
      pos.x != null &&
      pos.y != null &&
      Number.isFinite(Number(pos.x)) &&
      Number.isFinite(Number(pos.y)) &&
      !shellPart.collapsed
    ) {
      shellPart.mode = "float";
      shellPart.floatPos = { x: Number(pos.x), y: Number(pos.y) };
    }
    // Legacy heal: the rail can never persist as hidden (old "Hide kit rail" wrote visible:false).
    // Come back as the edge chevron, never as a removed root.
    if (src.visible === false || shellPart.visible === false) {
      shellPart.visible = true;
      shellPart.collapsed = true;
    }
    if (shellPart.collapsed) shellPart.mode = "docked";

    return Object.assign({}, shellPart, {
      tabId: normalizeTabId(src.tabId || shellPart.tabId),
      quickAddCollapsed: src.quickAddCollapsed !== false,
      threatPopout: !!src.threatPopout,
      threatPopoutLayout: normalizeThreatPopoutLayout(src.threatPopoutLayout),
      kitRailAlwaysV1: !!src.kitRailAlwaysV1,
      pos: {
        x: Number.isFinite(Number(pos.x)) ? Number(pos.x) : null,
        y: Number.isFinite(Number(pos.y)) ? Number(pos.y) : null,
      },
      pins: sanitizePins(src.pins),
    });
  }

  function normalizeThreatPopoutLayout(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const fp = src.floatPos && typeof src.floatPos === "object" ? src.floatPos : {};
    const fs = src.floatSize && typeof src.floatSize === "object" ? src.floatSize : {};
    const w = Number(fs.w);
    const h = Number(fs.h);
    return {
      floatPos: {
        x: Number.isFinite(Number(fp.x)) ? Number(fp.x) : 16,
        y: Number.isFinite(Number(fp.y)) ? Number(fp.y) : 96,
      },
      floatSize: {
        w: Number.isFinite(w) && w > 0 ? w : null,
        h: Number.isFinite(h) && h > 0 ? h : null,
      },
      widthMode: src.widthMode === "wide" ? "wide" : "slim",
    };
  }

  /**
   * Alt+K: never hides the rail. Chevron (or legacy-hidden) → expand; expanded → collapse to chevron.
   * visible:false is unreachable, so there is always on-page recovery chrome.
   */
  function toggleVisible(state) {
    const next = normalizeKitState(state);
    if (next.collapsed) {
      next.collapsed = false;
    } else {
      next.collapsed = true;
      next.mode = "docked";
    }
    next.visible = true;
    return next;
  }

  /** ✕: collapse to the edge chevron (docked so KIT ▸ stays clickable). */
  function closeKit(state) {
    const next = normalizeKitState(state);
    next.visible = true;
    next.collapsed = true;
    next.mode = "docked";
    return next;
  }

  /** ▾: same landing as ✕ — edge chevron, never hidden. */
  function collapseKit(state) {
    return closeKit(state);
  }

  /** Collapse ↔ expand while keeping the edge chevron. */
  function toggleCollapsed(state) {
    const next = normalizeKitState(state);
    next.visible = true;
    next.collapsed = !next.collapsed;
    if (next.collapsed) next.mode = "docked";
    return next;
  }

  const HUD_UNAVAILABLE_TEXT = "Shield HUD unavailable — module off or page not eligible";

  /** Message for the result of globalThis.__tbccForceThreatMonitor (undefined = helper missing). */
  function describeHudShowResult(r) {
    if (r && r.ok === true) return { ok: true, text: "Shield HUD opened.", err: false };
    return { ok: false, text: HUD_UNAVAILABLE_TEXT, err: true };
  }

  function openKitTab(state, tabId) {
    const next = normalizeKitState(state);
    next.visible = true;
    next.collapsed = false;
    next.tabId = normalizeTabId(tabId);
    return next;
  }

  function setThreatPopout(state, on) {
    const next = normalizeKitState(state);
    next.threatPopout = !!on;
    if (on) {
      next.visible = true;
    }
    return next;
  }

  function togglePin(state, pinId) {
    const next = normalizeKitState(state);
    const id = String(pinId || "").trim();
    if (!PIN_CATALOG[id]) return next;
    const set = new Set(next.pins);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    next.pins = sanitizePins(Array.from(set));
    return next;
  }

  function normalizeTrigger(raw) {
    let t = String(raw || "").trim();
    if (!t) return "";
    if (!t.startsWith("/")) t = "/" + t;
    return t;
  }

  function makeSnippetEntry(opts) {
    const o = opts || {};
    const trigger = normalizeTrigger(o.trigger);
    const body = String(o.body || "").trim();
    if (!trigger || !body) return { ok: false, error: "trigger and body required" };
    const now = Date.now();
    const kind = o.kind === "prompt" ? "prompt" : "snippet";
    return {
      ok: true,
      entry: {
        id: "s_" + now.toString(36) + "_" + Math.random().toString(36).slice(2, 8),
        kind,
        trigger,
        label: String(o.label || "").trim() || trigger,
        body,
        enabled: true,
        useCount: 0,
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    };
  }

  function appendSnippet(existing, entry) {
    const list = Array.isArray(existing) ? existing.slice() : [];
    const dupe = list.find((s) => s && s.trigger === entry.trigger);
    if (dupe) return { ok: false, error: "trigger already exists: " + entry.trigger };
    list.push(entry);
    return { ok: true, snippets: list };
  }

  const api = {
    STORAGE_KEY,
    STORAGE_SNIPPETS,
    KIT_TABS,
    PIN_CATALOG,
    PIN_ALIASES,
    DROPPED_PINS,
    DEFAULT_PINS,
    DEFAULT_STATE,
    normalizeKitState,
    normalizeTabId,
    toggleVisible,
    toggleCollapsed,
    closeKit,
    collapseKit,
    describeHudShowResult,
    openKitTab,
    setThreatPopout,
    togglePin,
    sanitizePins,
    normalizeTrigger,
    makeSnippetEntry,
    appendSnippet,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { TbccOperatorKitLib: api };
    return;
  }
  root.TbccOperatorKitLib = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
