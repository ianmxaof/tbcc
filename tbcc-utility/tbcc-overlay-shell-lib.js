/**
 * TBCC overlay shell — pure geometry + state helpers (no DOM).
 * Shared by operator kit (Phase 1) and later ER/TV/FL/ML menus.
 *
 * Design: tbcc/docs/overlay-shell-scheme.md
 */
(function (root) {
  "use strict";

  const EDGES = ["left", "right", "top", "bottom"];
  const WIDTH_MODES = ["slim", "wide"];
  const WIDTH_PX = { slim: 220, wide: 320 };
  const CORNER_PX = 56;
  const PAD = 8;
  const CHEVRON_ALONG = 120;
  const FLOAT_MIN_W = 220;
  const FLOAT_MIN_H = 180;
  const FLOAT_DEFAULT_H = 420;

  const DEFAULT_SHELL = {
    visible: false,
    collapsed: true,
    mode: "docked",
    edge: "right",
    offset: 72,
    widthMode: "slim",
    floatPos: { x: null, y: null },
    floatSize: { w: null, h: null },
    tabId: "tools",
    sections: {},
  };

  function clamp(n, lo, hi) {
    const v = Number(n);
    if (!Number.isFinite(v)) return lo;
    return Math.min(hi, Math.max(lo, v));
  }

  function normalizeEdge(raw) {
    const e = String(raw || "").toLowerCase();
    return EDGES.indexOf(e) >= 0 ? e : "right";
  }

  function normalizeWidthMode(raw) {
    const w = String(raw || "").toLowerCase();
    return WIDTH_MODES.indexOf(w) >= 0 ? w : "slim";
  }

  function normalizeMode(raw) {
    return String(raw || "").toLowerCase() === "float" ? "float" : "docked";
  }

  function panelWidth(widthMode) {
    return WIDTH_PX[normalizeWidthMode(widthMode)] || WIDTH_PX.slim;
  }

  function normalizeFloatSize(raw, viewport, widthMode) {
    const src = raw && typeof raw === "object" ? raw : {};
    const vp = viewport && viewport.w > 0 ? viewport : { w: 1280, h: 720 };
    const maxW = Math.max(FLOAT_MIN_W, vp.w - PAD * 2);
    const maxH = Math.max(FLOAT_MIN_H, vp.h - PAD * 2);
    let w = Number(src.w);
    let h = Number(src.h);
    if (!Number.isFinite(w) || w <= 0) w = null;
    else w = clamp(w, FLOAT_MIN_W, maxW);
    if (!Number.isFinite(h) || h <= 0) h = null;
    else h = clamp(h, FLOAT_MIN_H, maxH);
    return { w, h, widthModeFallback: panelWidth(widthMode) };
  }

  /**
   * Apply a pointer resize delta to a float panel origin rect.
   * @param {{x:number,y:number,w:number,h:number}} origin
   * @param {string} dir n|s|e|w|ne|nw|se|sw
   * @param {number} dx
   * @param {number} dy
   * @param {{w:number,h:number}} viewport
   */
  function computeFloatResize(origin, dir, dx, dy, viewport) {
    const d = String(dir || "se").toLowerCase();
    const vp = viewport && viewport.w > 0 ? viewport : { w: 1280, h: 720 };
    const maxW = Math.max(FLOAT_MIN_W, vp.w - PAD * 2);
    const maxH = Math.max(FLOAT_MIN_H, vp.h - PAD * 2);
    let x = Number(origin.x) || 0;
    let y = Number(origin.y) || 0;
    let w = Number(origin.w) || FLOAT_MIN_W;
    let h = Number(origin.h) || FLOAT_MIN_H;
    const right = x + w;
    const bottom = y + h;

    if (d.indexOf("e") >= 0) w = origin.w + dx;
    if (d.indexOf("s") >= 0) h = origin.h + dy;
    if (d.indexOf("w") >= 0) {
      w = origin.w - dx;
      x = origin.x + dx;
    }
    if (d.indexOf("n") >= 0) {
      h = origin.h - dy;
      y = origin.y + dy;
    }

    w = clamp(w, FLOAT_MIN_W, maxW);
    h = clamp(h, FLOAT_MIN_H, maxH);

    if (d.indexOf("w") >= 0) x = right - w;
    if (d.indexOf("n") >= 0) y = bottom - h;

    x = clamp(x, PAD, Math.max(PAD, vp.w - w - PAD));
    y = clamp(y, PAD, Math.max(PAD, vp.h - h - PAD));

    return {
      floatPos: { x: Math.round(x), y: Math.round(y) },
      floatSize: { w: Math.round(w), h: Math.round(h) },
    };
  }

  function maxOffset(edge, viewport) {
    const vw = viewport && viewport.w > 0 ? viewport.w : 1280;
    const vh = viewport && viewport.h > 0 ? viewport.h : 720;
    const e = normalizeEdge(edge);
    if (e === "left" || e === "right") return Math.max(PAD, vh - CHEVRON_ALONG);
    return Math.max(PAD, vw - CHEVRON_ALONG);
  }

  function clampOffset(edge, offset, viewport) {
    return clamp(offset, PAD, maxOffset(edge, viewport));
  }

  /**
   * Pick nearest window edge from a pointer, with corner bias.
   * @param {number} x
   * @param {number} y
   * @param {{w:number,h:number}} viewport
   * @param {string} [preferEdge] keep current edge until corner zone if still close
   */
  function nearestEdge(x, y, viewport, preferEdge) {
    const vw = viewport.w;
    const vh = viewport.h;
    const dist = {
      left: x,
      right: vw - x,
      top: y,
      bottom: vh - y,
    };
    let edge = "right";
    let best = dist.right;
    EDGES.forEach((e) => {
      if (dist[e] < best) {
        best = dist[e];
        edge = e;
      }
    });

    const pref = preferEdge ? normalizeEdge(preferEdge) : null;
    if (pref && dist[pref] <= CORNER_PX + 24) {
      // Stay on preferred edge until deep into a corner of another edge.
      const atCorner =
        (pref === "left" || pref === "right") && (y < CORNER_PX || y > vh - CORNER_PX)
          ? true
          : (pref === "top" || pref === "bottom") && (x < CORNER_PX || x > vw - CORNER_PX);
      if (!atCorner || dist[pref] <= best + 8) return pref;
    }
    return edge;
  }

  /**
   * Project pointer → docked { edge, offset }.
   */
  function projectDock(x, y, viewport, preferEdge) {
    const vw = viewport.w;
    const vh = viewport.h;
    const edge = nearestEdge(x, y, viewport, preferEdge);
    let offset;
    if (edge === "left" || edge === "right") {
      offset = clampOffset(edge, y - 40, viewport);
    } else {
      offset = clampOffset(edge, x - 40, viewport);
    }
    return { edge, offset, viewport: { w: vw, h: vh } };
  }

  /**
   * CSS-ish placement for docked or float mode.
   * Returns { position styles as plain object, railClass }.
   */
  function placementStyles(state, viewport) {
    const st = normalizeShellState(state, viewport);
    const size = normalizeFloatSize(st.floatSize, viewport, st.widthMode);
    const w = st.mode === "float" && size.w != null ? size.w : panelWidth(st.widthMode);
    if (st.mode === "float") {
      const h = size.h != null ? size.h : FLOAT_DEFAULT_H;
      const x =
        st.floatPos.x != null
          ? clamp(st.floatPos.x, PAD, Math.max(PAD, viewport.w - w - PAD))
          : Math.max(PAD, viewport.w - w - PAD);
      const y =
        st.floatPos.y != null
          ? clamp(st.floatPos.y, PAD, Math.max(PAD, viewport.h - Math.min(h, 120) - PAD))
          : PAD + 48;
      return {
        left: x + "px",
        top: y + "px",
        right: "auto",
        bottom: "auto",
        width: w + "px",
        height: size.h != null ? h + "px" : "auto",
        panelW: w,
        panelH: size.h,
        railClass: "float",
      };
    }
    const off = clampOffset(st.edge, st.offset, viewport);
    if (st.edge === "right") {
      return {
        left: "auto",
        right: "0px",
        top: off + "px",
        bottom: "auto",
        width: "auto",
        height: "auto",
        panelW: w,
        panelH: null,
        railClass: "edge-right",
      };
    }
    if (st.edge === "left") {
      return {
        left: "0px",
        right: "auto",
        top: off + "px",
        bottom: "auto",
        width: "auto",
        height: "auto",
        panelW: w,
        panelH: null,
        railClass: "edge-left",
      };
    }
    if (st.edge === "top") {
      return {
        left: off + "px",
        right: "auto",
        top: "0px",
        bottom: "auto",
        width: "auto",
        height: "auto",
        panelW: w,
        panelH: null,
        railClass: "edge-top",
      };
    }
    return {
      left: off + "px",
      right: "auto",
      top: "auto",
      bottom: "0px",
      width: "auto",
      height: "auto",
      panelW: w,
      panelH: null,
      railClass: "edge-bottom",
    };
  }

  function normalizeSections(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const out = {};
    Object.keys(src).forEach((k) => {
      out[String(k)] = !!src[k];
    });
    return out;
  }

  function normalizeShellState(raw, viewport) {
    const src = raw && typeof raw === "object" ? raw : {};
    const fp = src.floatPos && typeof src.floatPos === "object" ? src.floatPos : {};
    const vp = viewport && viewport.w > 0 ? viewport : { w: 1280, h: 720 };
    const edge = normalizeEdge(src.edge != null ? src.edge : DEFAULT_SHELL.edge);
    // Collapsed + float hides panel and chevron (CSS) — nothing left to reopen.
    const collapsed = src.collapsed !== false;
    const widthMode = normalizeWidthMode(src.widthMode != null ? src.widthMode : DEFAULT_SHELL.widthMode);
    const fs = normalizeFloatSize(src.floatSize, vp, widthMode);
    return {
      visible: !!src.visible,
      collapsed,
      mode: collapsed ? "docked" : normalizeMode(src.mode != null ? src.mode : DEFAULT_SHELL.mode),
      edge,
      offset: clampOffset(edge, src.offset != null ? src.offset : DEFAULT_SHELL.offset, vp),
      widthMode,
      floatPos: {
        x: Number.isFinite(Number(fp.x)) ? Number(fp.x) : null,
        y: Number.isFinite(Number(fp.y)) ? Number(fp.y) : null,
      },
      floatSize: { w: fs.w, h: fs.h },
      tabId: String(src.tabId || DEFAULT_SHELL.tabId || "tools").trim() || "tools",
      sections: normalizeSections(src.sections),
    };
  }

  function cycleWidthMode(mode) {
    return normalizeWidthMode(mode) === "slim" ? "wide" : "slim";
  }

  function applyShellPatch(state, patch, viewport) {
    const base = normalizeShellState(state, viewport);
    const p = patch && typeof patch === "object" ? patch : {};
    return normalizeShellState(
      Object.assign({}, base, p, {
        floatPos: p.floatPos !== undefined ? p.floatPos : base.floatPos,
        floatSize: p.floatSize !== undefined ? p.floatSize : base.floatSize,
        sections: p.sections !== undefined ? Object.assign({}, base.sections, p.sections) : base.sections,
      }),
      viewport
    );
  }

  const api = {
    EDGES,
    WIDTH_MODES,
    WIDTH_PX,
    CORNER_PX,
    PAD,
    FLOAT_MIN_W,
    FLOAT_MIN_H,
    FLOAT_DEFAULT_H,
    DEFAULT_SHELL,
    clamp,
    normalizeEdge,
    normalizeWidthMode,
    normalizeMode,
    panelWidth,
    normalizeFloatSize,
    computeFloatResize,
    maxOffset,
    clampOffset,
    nearestEdge,
    projectDock,
    placementStyles,
    normalizeShellState,
    normalizeSections,
    cycleWidthMode,
    applyShellPatch,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { TbccOverlayShellLib: api };
    return;
  }
  root.TbccOverlayShellLib = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
