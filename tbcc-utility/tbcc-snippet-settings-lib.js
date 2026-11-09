/**
 * Snippet library UI settings — tooltip delay normalization.
 */
(function (root) {
  const DEFAULT_TOOLTIP_DELAY_MS = 700;
  const MIN_TOOLTIP_DELAY_MS = 200;
  const MAX_TOOLTIP_DELAY_MS = 2000;

  function normalizeTooltipDelayMs(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_TOOLTIP_DELAY_MS;
    return Math.max(MIN_TOOLTIP_DELAY_MS, Math.min(MAX_TOOLTIP_DELAY_MS, Math.round(n)));
  }

  const api = {
    DEFAULT_TOOLTIP_DELAY_MS,
    MIN_TOOLTIP_DELAY_MS,
    MAX_TOOLTIP_DELAY_MS,
    normalizeTooltipDelayMs,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { TbccSnippetSettingsLib: api };
    return;
  }
  root.TbccSnippetSettingsLib = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
