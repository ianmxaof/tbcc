/**
 * Download-routing "circuit board": ordered rules that route ANY browser
 * download (not just TBCC's own) into a Downloads subfolder by file
 * extension, source domain, MIME prefix, or URL pattern.
 *
 * chrome.downloads.onDeterminingFilename only accepts a filename relative to
 * the default Downloads directory — no absolute paths, no "..". Routing is
 * therefore always a subfolder under Downloads, never an arbitrary disk path.
 */
(function (root) {
  function sanitizeSegment(s) {
    return String(s || "")
      .trim()
      .replace(/[<>:"|?*\x00-\x1f]+/g, "_")
      .replace(/\.\.+/g, ".")
      .replace(/^[\\/]+|[\\/]+$/g, "")
      .slice(0, 80);
  }

  function extOf(filename) {
    const base = String(filename || "").split(/[\\/]/).pop() || "";
    const dot = base.lastIndexOf(".");
    return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : "";
  }

  function hostnameOf(url) {
    try {
      return new URL(String(url || "")).hostname.toLowerCase().replace(/^www\./, "");
    } catch (_) {
      return "";
    }
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  const IMAGE_EXTENSIONS = new Set([
    "jpg",
    "jpeg",
    "png",
    "webp",
    "gif",
    "avif",
    "heic",
    "bmp",
    "tif",
    "tiff",
  ]);

  function sanitizeFilenameLeaf(name) {
    return String(name || "file")
      .trim()
      .replace(/[<>:"|?*\x00-\x1f\\/]+/g, "_")
      .replace(/\.\.+/g, ".")
      .slice(0, 120);
  }

  function isImageDownloadItem(item) {
    const mime = String((item && item.mime) || "").toLowerCase();
    if (mime.startsWith("image/")) return true;
    const ext = extOf(item && item.filename);
    return IMAGE_EXTENSIONS.has(ext);
  }

  function matchesDomain(host, matchValue) {
    const want = String(matchValue || "").trim().toLowerCase().replace(/^www\./, "");
    if (!want || !host) return false;
    return host === want || host.endsWith("." + want);
  }

  /**
   * @param {import("./tbcc-download-router").Route} route
   * @param {{ url?: string, referrer?: string, mime?: string, filename?: string }} item
   */
  function routeMatches(route, item) {
    if (!route || route.enabled === false) return false;
    const type = String(route.matchType || "").trim();
    const value = route.matchValue;
    if (type === "extension") {
      const ext = extOf(item && item.filename);
      const list = String(value || "")
        .split(",")
        .map((s) => s.trim().toLowerCase().replace(/^\./, ""))
        .filter(Boolean);
      return !!ext && list.includes(ext);
    }
    if (type === "domain") {
      const host = routingDomainHost(item);
      return matchesDomain(host, value);
    }
    if (type === "mimePrefix") {
      const mime = String((item && item.mime) || "").toLowerCase();
      const want = String(value || "").toLowerCase();
      return !!want && mime.startsWith(want);
    }
    if (type === "urlRegex") {
      try {
        const re = new RegExp(String(value || ""), "i");
        return re.test((item && (item.finalUrl || item.url)) || "");
      } catch (_) {
        return false;
      }
    }
    return false;
  }

  /**
   * First enabled route (in list order) whose match condition is satisfied.
   * @param {Route[]} routes
   * @param {object} item
   * @returns Route|null
   */
  function matchRoute(routes, item) {
    for (const r of Array.isArray(routes) ? routes : []) {
      if (routeMatches(r, item)) return r;
    }
    return null;
  }

  const ROUTE_FOLDER_PROBE_LEAF = "tbcc-route-folder-probe.txt";
  const ROUTE_FOLDER_PROBE_LEAF_LEGACY = ".tbcc-route-folder-probe.txt";

  /**
   * Strip a Windows/macOS absolute path to the Downloads-relative subfolder.
   * Accepts a probe file path or a folder path pasted from Explorer.
   * @returns {string|null}
   */
  function downloadsRelativeFolderFromAbsolute(absPath) {
    let norm = String(absPath || "")
      .trim()
      .replace(/\\/g, "/")
      .replace(/\/+$/, "");
    if (!norm) return null;
    const lower = norm.toLowerCase();
    if (lower.endsWith(ROUTE_FOLDER_PROBE_LEAF_LEGACY.toLowerCase())) {
      norm = norm.slice(0, -ROUTE_FOLDER_PROBE_LEAF_LEGACY.length).replace(/\/+$/, "");
    } else if (lower.endsWith(ROUTE_FOLDER_PROBE_LEAF.toLowerCase())) {
      norm = norm.slice(0, -ROUTE_FOLDER_PROBE_LEAF.length).replace(/\/+$/, "");
    } else {
      const last = (norm.split("/").pop() || "").trim();
      if (last && last.includes(".") && !last.startsWith(".")) {
        norm = norm.slice(0, norm.lastIndexOf("/"));
      }
    }
    const idx = norm.toLowerCase().indexOf("/downloads/");
    if (idx === -1) return null;
    const rel = norm.slice(idx + "/downloads/".length).replace(/^\/+/, "").replace(/\/+$/, "");
    return rel || null;
  }

  /**
   * Normalize manual input or picker output for route.folder storage.
   * @returns {{ ok: true, folder: string } | { ok: false, error: string }}
   */
  function normalizeRouteFolderInput(input) {
    let s = String(input || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
    if (!s) return { ok: false, error: "Destination subfolder is required." };
    if (/^[a-zA-Z]:\//.test(s) || s.startsWith("//") || s.startsWith("/Users/") || s.startsWith("/home/")) {
      const rel = downloadsRelativeFolderFromAbsolute(s);
      if (!rel) {
        return {
          ok: false,
          error: "Path must be inside your Chrome Downloads folder (e.g. Porn/tbcc/Videos — not C:\\Users\\…).",
        };
      }
      s = rel;
    }
    if (/^[a-zA-Z]:/.test(s) || /\/[a-zA-Z]:/.test(s)) {
      return { ok: false, error: "Use a subfolder under Downloads, not a drive path." };
    }
    s = s.replace(/^\/+/, "");
    if (!s) {
      return { ok: false, error: "Pick a folder inside Downloads, not the Downloads root itself." };
    }
    return { ok: true, folder: s };
  }

  /** Prefer X/Twitter page host when the asset URL is a twimg CDN link. */
  function routingDomainHost(item) {
    const urlHost = hostnameOf((item && item.url) || "");
    const refHost = hostnameOf((item && item.referrer) || "");
    if (urlHost && /\.twimg\.com$/i.test(urlHost) && refHost) return refHost;
    return urlHost || refHost || "";
  }

  /** True when a download item originates from X/Twitter (overlay, feed buttons, twimg CDN). */
  function isXMediaDownloadItem(item) {
    const urls = [
      item && item.url,
      item && item.finalUrl,
      item && item.referrer,
    ].filter(Boolean);
    for (const raw of urls) {
      const s = String(raw);
      try {
        const h = new URL(s).hostname.toLowerCase();
        if (h === "x.com" || h === "twitter.com" || h === "twimg.com" || h.endsWith(".twimg.com")) return true;
      } catch (_) {
        if (/twimg\.com|(?:^|\.)x\.com|(?:^|\.)twitter\.com/i.test(s)) return true;
      }
    }
    return false;
  }

  function isRouteFolderProbeLeaf(filename) {
    const leaf = String(filename || "").split(/[\\/]/).pop() || "";
    const lower = leaf.toLowerCase();
    return lower === ROUTE_FOLDER_PROBE_LEAF.toLowerCase() || lower === ROUTE_FOLDER_PROBE_LEAF_LEGACY.toLowerCase();
  }

  /**
   * Apply enabled download-routing rules to an item; returns relative Downloads path or null.
   * @param {Route[]} routes
   * @param {{ enabled?: boolean }} settings
   * @param {object} item
   * @returns {string|null}
   */
  function resolveRoutedFilename(routes, settings, item) {
    if (!item || settings.enabled === false) return null;
    const route = matchRoute(routes, item);
    if (!route) return null;
    return buildRoutedFilename(route, item);
  }

  /** Expand route template tokens ({ext} {domain} {filename} {original} {YYYY} {MM} {DD} {HH} {mm} {ss}). */
  function expandRouteTokens(template, item) {
    const now = new Date();
    const ext = extOf(item && item.filename);
    const host = routingDomainHost(item);
    const originalBase = String((item && item.filename) || "file").split(/[\\/]/).pop() || "file";
    const dot = originalBase.lastIndexOf(".");
    const baseNoExt = dot > 0 ? originalBase.slice(0, dot) : originalBase;
    return String(template || "")
      .replace(/\{ext\}/gi, ext || "misc")
      .replace(/\{domain\}/gi, host || "unknown")
      .replace(/\{original\}/gi, originalBase || "file")
      .replace(/\{filename\}/gi, baseNoExt || "file")
      .replace(/\{YYYY\}/g, String(now.getFullYear()))
      .replace(/\{MM\}/g, pad2(now.getMonth() + 1))
      .replace(/\{DD\}/g, pad2(now.getDate()))
      .replace(/\{HH\}/g, pad2(now.getHours()))
      .replace(/\{mm\}/g, pad2(now.getMinutes()))
      .replace(/\{ss\}/g, pad2(now.getSeconds()));
  }

  /** @deprecated alias */
  function expandFolderTemplate(template, item) {
    return expandRouteTokens(template, item);
  }

  /**
   * Build the routed relative filename for chrome.downloads suggest().
   * @param {Route} route
   * @param {object} item
   * @returns {string|null} relative path, or null if the route has no folder to apply
   */
  function buildRoutedFilename(route, item) {
    const originalBase = String((item && item.filename) || "file").split(/[\\/]/).pop() || "file";
    const folderTpl = String((route && route.folder) || "").trim();
    if (!folderTpl) return null;
    const expandedFolder = expandRouteTokens(folderTpl, item);
    const segments = expandedFolder
      .split("/")
      .map(sanitizeSegment)
      .filter(Boolean);
    if (!segments.length) return null;

    const nameTpl = String((route && (route.filenameTemplate || route.nameTemplate)) || "").trim();
    let leaf;
    if (nameTpl) {
      leaf = sanitizeFilenameLeaf(expandRouteTokens(nameTpl, item));
      const ext = extOf(originalBase);
      if (leaf && ext && !extOf(leaf)) leaf = leaf + "." + ext;
    } else {
      leaf = sanitizeFilenameLeaf(originalBase);
    }
    if (!leaf) leaf = "file";
    return segments.join("/") + "/" + leaf;
  }

  const api = {
    ROUTE_FOLDER_PROBE_LEAF,
    ROUTE_FOLDER_PROBE_LEAF_LEGACY,
    extOf,
    hostnameOf,
    routingDomainHost,
    matchesDomain,
    routeMatches,
    matchRoute,
    isXMediaDownloadItem,
    isRouteFolderProbeLeaf,
    resolveRoutedFilename,
    downloadsRelativeFolderFromAbsolute,
    normalizeRouteFolderInput,
    expandFolderTemplate,
    expandRouteTokens,
    sanitizeFilenameLeaf,
    isImageDownloadItem,
    IMAGE_EXTENSIONS,
    buildRoutedFilename,
    sanitizeSegment,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { TbccDownloadRouter: api };
  } else {
    root.TbccDownloadRouter = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
