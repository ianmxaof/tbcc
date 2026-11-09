/**
 * Per-route download watermark — text + optional image overlay (images only).
 */
(function (root) {
  const POSITIONS = ["bottom_right", "upper_right", "upper_left", "bottom_left", "center_diagonal"];

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function normalizeRouteWatermark(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const opacity = Number(src.opacity);
    const sizeRatio = Number(src.sizeRatio != null ? src.sizeRatio : src.size_ratio);
    const imageOpacity = Number(src.imageOpacity != null ? src.imageOpacity : src.image_opacity);
    const imageSizeRatio = Number(src.imageSizeRatio != null ? src.imageSizeRatio : src.image_size_ratio);
    const position = String(src.position || "bottom_right").toLowerCase();
    const hasImage = !!String(src.imageDataUrl || src.image_data_url || "").trim();
    const modeRaw = String(src.mode || "text").toLowerCase();
    return {
      enabled: !!src.enabled,
      mode: modeRaw === "image" && hasImage ? "image" : "text",
      text: String(src.text || "telegram.me/aofmainhub").trim(),
      color: String(src.color || "#ffffff").trim() || "#ffffff",
      opacity: Number.isFinite(opacity) ? clamp(opacity, 0.1, 1) : 0.58,
      sizeRatio: Number.isFinite(sizeRatio) ? clamp(sizeRatio, 0.012, 0.12) : 0.045,
      fontFamily: String(src.fontFamily || src.font_family || "system-ui, Segoe UI, sans-serif").trim(),
      position: POSITIONS.includes(position) ? position : "bottom_right",
      imageDataUrl: String(src.imageDataUrl || src.image_data_url || "").trim(),
      imageOpacity: Number.isFinite(imageOpacity) ? clamp(imageOpacity, 0.1, 1) : 0.7,
      imageSizeRatio: Number.isFinite(imageSizeRatio) ? clamp(imageSizeRatio, 0.05, 0.45) : 0.15,
    };
  }

  function routeHasWatermark(route) {
    const wm = normalizeRouteWatermark(route && route.watermark);
    return wm.enabled && (wm.mode === "image" ? !!wm.imageDataUrl : !!wm.text);
  }

  function promoConfigFromRouteWatermark(wmRaw) {
    const wm = normalizeRouteWatermark(wmRaw);
    return {
      enabled: true,
      text: wm.text,
      textSecondary: "",
      textTertiary: "",
      opacity: wm.opacity,
      color: wm.color,
      position: wm.position,
      mode: "fixed",
      sizeRatio: wm.sizeRatio,
      stripPrevious: false,
      fontFamily: wm.fontFamily,
    };
  }

  function marginPx(w, h) {
    return clamp(Math.round(Math.min(w, h) * 0.012), 4, 80);
  }

  function anchorXY(position, w, h, tw, th, m) {
    if (position === "upper_left") return [m, m];
    if (position === "upper_right") return [w - tw - m, m];
    if (position === "bottom_left") return [m, h - th - m];
    if (position === "center_diagonal") return [(w - tw) / 2, (h - th) / 2];
    return [w - tw - m, h - th - m];
  }

  async function loadImageBitmapFromDataUrl(dataUrl) {
    const res = await fetch(String(dataUrl));
    const blob = await res.blob();
    return createImageBitmap(blob);
  }

  async function drawImageOverlay(ctx, w, h, wm) {
    if (!wm.imageDataUrl) return;
    const bmp = await loadImageBitmapFromDataUrl(wm.imageDataUrl);
    try {
      const side = Math.round(Math.min(w, h) * wm.imageSizeRatio);
      const m = marginPx(w, h);
      const [x, y] = anchorXY(wm.position, w, h, side, side, m);
      ctx.save();
      ctx.globalAlpha = wm.imageOpacity;
      ctx.drawImage(bmp, x, y, side, side);
      ctx.restore();
    } finally {
      try {
        bmp.close();
      } catch (_) {}
    }
  }

  async function applyRouteWatermarkArrayBuffer(arrayBuffer, mimeHint, wmRaw) {
    const wm = normalizeRouteWatermark(wmRaw);
    if (!wm.enabled) return arrayBuffer;
    const mime = String(mimeHint || "image/jpeg").split(";")[0] || "image/jpeg";
    if (!mime.startsWith("image/")) return arrayBuffer;
    if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") {
      return arrayBuffer;
    }

    const blob = new Blob([arrayBuffer], { type: mime });
    const bmp = await createImageBitmap(blob);
    try {
      const w = bmp.width || 1;
      const h = bmp.height || 1;
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      if (!ctx) return arrayBuffer;
      ctx.drawImage(bmp, 0, 0);

      if (wm.mode === "text" && wm.text) {
        const promo =
          typeof root.TbccPromoWatermark !== "undefined" ? root.TbccPromoWatermark : null;
        const cfg = promoConfigFromRouteWatermark(wm);
        if (promo && promo.drawWatermarkOnCanvas) {
          promo.drawWatermarkOnCanvas(ctx, w, h, cfg);
        } else {
          const fs = clamp(Math.round(Math.min(w, h) * wm.sizeRatio), 9, 28);
          ctx.font = `700 ${fs}px ${wm.fontFamily}`;
          ctx.textBaseline = "top";
          const tw = ctx.measureText(wm.text).width;
          const th = fs * 1.15;
          const m = marginPx(w, h);
          const [x, y] = anchorXY(wm.position, w, h, tw, th, m);
          ctx.lineWidth = Math.max(2, Math.round(fs / 8));
          ctx.strokeStyle = `rgba(0,0,0,${Math.min(0.85, wm.opacity + 0.15)})`;
          ctx.fillStyle = wm.color.startsWith("#")
            ? wm.color
            : "#ffffff";
          ctx.globalAlpha = wm.opacity;
          ctx.strokeText(wm.text, x, y);
          ctx.fillText(wm.text, x, y);
          ctx.globalAlpha = 1;
        }
      }

      if (wm.mode === "image" && wm.imageDataUrl) {
        await drawImageOverlay(ctx, w, h, wm);
      } else if (wm.imageDataUrl && wm.mode === "text") {
        await drawImageOverlay(ctx, w, h, wm);
      }

      const outType = mime.includes("png") ? "image/png" : "image/jpeg";
      const outBlob = await canvas.convertToBlob(
        outType === "image/png" ? { type: outType } : { type: "image/jpeg", quality: 0.92 }
      );
      return await outBlob.arrayBuffer();
    } finally {
      try {
        bmp.close();
      } catch (_) {}
    }
  }

  const api = {
    POSITIONS,
    normalizeRouteWatermark,
    routeHasWatermark,
    promoConfigFromRouteWatermark,
    applyRouteWatermarkArrayBuffer,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { TbccDownloadRouteWatermark: api };
    return;
  }
  root.TbccDownloadRouteWatermark = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
