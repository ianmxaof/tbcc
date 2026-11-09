/**
 * Raster export conversion for TBCC (sidebar downloads, imports, Saved Messages, ZIP).
 * Browser canvas decode — no ImageMagick in the extension.
 *
 * Set export format in Extension options → Capture → Image conversion.
 */
(function (root) {
  const STORAGE_SETTINGS = "tbcc_gallery_settings";
  const DEFAULT_QUALITY = 0.92;
  const MAX_EDGE = 16384;
  const EXPORT_FORMATS = new Set(["jpeg", "png", "webp"]);

  let _formatCache = null;

  function tbccResetWebpSettingsCache() {
    _formatCache = null;
  }

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[STORAGE_SETTINGS]) tbccResetWebpSettingsCache();
    });
  }

  async function tbccExportFormatFromSettings() {
    if (_formatCache !== null) return _formatCache;
    try {
      const o = await chrome.storage.local.get(STORAGE_SETTINGS);
      const s = o[STORAGE_SETTINGS] && typeof o[STORAGE_SETTINGS] === "object" ? o[STORAGE_SETTINGS] : {};
      const f = String(s.format || "original").toLowerCase();
      _formatCache = EXPORT_FORMATS.has(f) ? f : "original";
    } catch (_) {
      _formatCache = "original";
    }
    return _formatCache;
  }

  async function tbccWebpToJpgEnabled() {
    return (await tbccExportFormatFromSettings()) === "jpeg";
  }

  function tbccMimeForExportFormat(format) {
    if (format === "jpeg") return "image/jpeg";
    if (format === "png") return "image/png";
    if (format === "webp") return "image/webp";
    return "";
  }

  function tbccExtForExportFormat(format) {
    if (format === "jpeg") return ".jpg";
    if (format === "png") return ".png";
    if (format === "webp") return ".webp";
    return "";
  }

  function tbccSniffMatchesExportFormat(sniffed, format) {
    if (!format || format === "original") return true;
    if (format === "jpeg") return sniffed === "jpeg";
    if (format === "png") return sniffed === "png";
    if (format === "webp") return sniffed === "webp";
    return false;
  }

  function tbccResolveExportFormat(opts) {
    const force = opts && opts.force;
    if (force === true || force === "jpeg" || force === "jpg") return "jpeg";
    if (typeof force === "string" && EXPORT_FORMATS.has(force.toLowerCase())) return force.toLowerCase();
    return null;
  }

  function tbccUrlLooksLikeWebp(url) {
    const u = String(url || "").toLowerCase();
    if (!u) return false;
    if (/\.webp(\?|#|$)/i.test(u)) return true;
    try {
      const p = new URL(u).pathname.toLowerCase();
      if (p.endsWith(".webp")) return true;
      if (/-webp\.\d+\/?$/i.test(p)) return true;
    } catch (_) {}
    return false;
  }

  /**
   * Sniff container from the first bytes (ignores wrong Content-Type / .jpg names).
   * @returns {"jpeg"|"png"|"gif"|"webp"|"avif"|"unknown"}
   */
  function tbccSniffImageKindFromBytes(u8) {
    if (!u8 || u8.length < 12) return "unknown";
    // JPEG
    if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return "jpeg";
    // PNG
    if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return "png";
    // GIF
    if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return "gif";
    // WEBP: RIFF....WEBP
    if (
      u8[0] === 0x52 &&
      u8[1] === 0x49 &&
      u8[2] === 0x46 &&
      u8[3] === 0x46 &&
      u8[8] === 0x57 &&
      u8[9] === 0x45 &&
      u8[10] === 0x42 &&
      u8[11] === 0x50
    ) {
      return "webp";
    }
    // AVIF / HEIF: ftyp....avif|avis|heic
    if (u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) {
      const brand = String.fromCharCode(u8[8], u8[9], u8[10], u8[11]).toLowerCase();
      if (brand === "avif" || brand === "avis" || brand === "mif1" || brand === "heic" || brand === "heix") {
        return "avif";
      }
    }
    return "unknown";
  }

  async function tbccSniffImageKind(blob) {
    if (!blob || !blob.size) return "unknown";
    try {
      const buf = await blob.slice(0, 16).arrayBuffer();
      return tbccSniffImageKindFromBytes(new Uint8Array(buf));
    } catch (_) {
      return "unknown";
    }
  }

  function tbccExtForKind(kind) {
    if (kind === "jpeg") return ".jpg";
    if (kind === "png") return ".png";
    if (kind === "gif") return ".gif";
    if (kind === "webp") return ".webp";
    if (kind === "avif") return ".avif";
    return "";
  }

  function tbccBlobLooksLikeWebp(blob, url, name, sniffed) {
    if (sniffed === "webp" || sniffed === "avif") return true;
    if (!blob) return false;
    const mime = String(blob.type || "").toLowerCase();
    if (mime === "image/webp" || mime === "image/avif") return true;
    const n = String(name || "").toLowerCase();
    if (/\.webp$/i.test(n) || /\.avif$/i.test(n)) return true;
    return tbccUrlLooksLikeWebp(url);
  }

  function tbccReplaceExtToJpg(filename) {
    const n = String(filename || "media").trim() || "media";
    if (/\.jpe?g$/i.test(n)) return n;
    const base = n.replace(/\.[^.\\/]+$/, "") || "media";
    return base + ".jpg";
  }

  function tbccReplaceExt(filename, extWithDot) {
    const n = String(filename || "media").trim() || "media";
    const ext = extWithDot.startsWith(".") ? extWithDot : "." + extWithDot;
    const base = n.replace(/\.[^.\\/]+$/, "") || "media";
    return base + ext;
  }

  /**
   * Align filename extension with real bytes. Never claim .jpg for WebP payload.
   */
  async function tbccAlignFilenameToBlob(blob, filename) {
    const kind = await tbccSniffImageKind(blob);
    const ext = tbccExtForKind(kind);
    if (!ext) return String(filename || "media.bin");
    return tbccReplaceExt(filename || "media", ext);
  }

  function tbccCreateCanvas(w, h) {
    if (typeof OffscreenCanvas !== "undefined") {
      return new OffscreenCanvas(w, h);
    }
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c;
    }
    return null;
  }

  async function tbccCanvasToFormatBlob(canvas, format, quality) {
    const q = typeof quality === "number" ? quality : DEFAULT_QUALITY;
    const mime = tbccMimeForExportFormat(format);
    if (!mime) throw new Error("Unsupported export format");
    if (canvas.convertToBlob) {
      return canvas.convertToBlob({ type: mime, quality: q });
    }
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Raster encode failed"))),
        mime,
        q
      );
    });
  }

  async function tbccCanvasToJpegBlob(canvas, quality) {
    return tbccCanvasToFormatBlob(canvas, "jpeg", quality);
  }

  async function tbccConvertRasterBlobToFormat(blob, format, quality) {
    if (!blob || !blob.size) throw new Error("Empty image blob");
    if (!EXPORT_FORMATS.has(format)) throw new Error("Unsupported export format");
    const bmp = await createImageBitmap(blob);
    try {
      const w = bmp.width;
      const h = bmp.height;
      if (!w || !h || w > MAX_EDGE || h > MAX_EDGE) {
        throw new Error("Image dimensions out of range");
      }
      const canvas = tbccCreateCanvas(w, h);
      if (!canvas) throw new Error("Canvas not available");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2d context unavailable");
      if (format === "jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(bmp, 0, 0, w, h);
      return await tbccCanvasToFormatBlob(canvas, format, quality);
    } finally {
      bmp.close();
    }
  }

  async function tbccConvertWebpBlobToJpeg(blob, quality) {
    return tbccConvertRasterBlobToFormat(blob, "jpeg", quality);
  }

  /**
   * Apply gallery export format (original / jpeg / png / webp). On failure keep bytes + real extension.
   */
  async function tbccEnsureExportFormatBlob(blob, opts) {
    const url = opts && opts.url;
    let name = (opts && opts.name) || "media.webp";
    const forced = tbccResolveExportFormat(opts);
    const target = forced || (await tbccExportFormatFromSettings());
    const sniffed = await tbccSniffImageKind(blob);

    if (!target || target === "original") {
      const aligned = await tbccAlignFilenameToBlob(blob, name);
      return { blob, name: aligned, converted: false, kind: sniffed, format: "original" };
    }

    const ext = tbccExtForExportFormat(target);
    if (tbccSniffMatchesExportFormat(sniffed, target)) {
      return {
        blob,
        name: tbccReplaceExt(name, ext),
        converted: false,
        kind: sniffed,
        format: target,
      };
    }

    try {
      const out = await tbccConvertRasterBlobToFormat(blob, target, opts && opts.quality);
      const kind2 = await tbccSniffImageKind(out);
      const expectKind = target === "jpeg" ? "jpeg" : target;
      if (kind2 !== expectKind) {
        throw new Error("Encode produced unexpected bytes");
      }
      return {
        blob: new Blob([await out.arrayBuffer()], { type: tbccMimeForExportFormat(target) }),
        name: tbccReplaceExt(name, ext),
        converted: true,
        kind: kind2,
        format: target,
      };
    } catch (e) {
      console.warn("[TBCC] Image export conversion failed, keeping original bytes:", e);
      const aligned = await tbccAlignFilenameToBlob(blob, name);
      return { blob, name: aligned, converted: false, kind: sniffed, format: "original" };
    }
  }

  /**
   * Legacy alias — jpeg export or explicit force.
   */
  async function tbccEnsureJpegBlob(blob, opts) {
    const o = Object.assign({}, opts || {});
    if (o.force) o.force = "jpeg";
    return tbccEnsureExportFormatBlob(blob, o);
  }

  async function tbccEnsureJpegArrayBuffer(arrayBuffer, url, name) {
    const sniff = tbccSniffImageKindFromBytes(new Uint8Array(arrayBuffer.slice(0, 16)));
    const type =
      sniff === "webp"
        ? "image/webp"
        : sniff === "jpeg"
          ? "image/jpeg"
          : sniff === "png"
            ? "image/png"
            : "application/octet-stream";
    const blob = new Blob([arrayBuffer], { type });
    const r = await tbccEnsureJpegBlob(blob, { url, name });
    if (!r.converted) return { buffer: arrayBuffer, name: r.name, converted: false };
    return { buffer: await r.blob.arrayBuffer(), name: r.name, converted: true };
  }

  const api = {
    tbccWebpToJpgEnabled,
    tbccExportFormatFromSettings,
    tbccUrlLooksLikeWebp,
    tbccBlobLooksLikeWebp,
    tbccReplaceExtToJpg,
    tbccReplaceExt,
    tbccSniffImageKind,
    tbccSniffImageKindFromBytes,
    tbccAlignFilenameToBlob,
    tbccExtForKind,
    tbccExtForExportFormat,
    tbccConvertWebpBlobToJpeg,
    tbccConvertRasterBlobToFormat,
    tbccEnsureExportFormatBlob,
    tbccEnsureJpegBlob,
    tbccEnsureJpegArrayBuffer,
    tbccResetWebpSettingsCache,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.TbccWebp = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
