/**
 * Snippet/prompt library: trigger matching + dynamic token expansion.
 * Pure module (no chrome.* / DOM deps) so it is unit-testable like tbcc-zip-naming.js.
 */
(function (root) {
  const MAX_TRIGGER_LEN = 40;
  const CURSOR_TOKEN = "{{cursor}}";
  const CURSOR_MARKER = "\0TBCC_CURSOR\0";

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  /** date/time formatting: YYYY MM DD HH mm ss tokens against a Date. */
  function formatDate(date, fmt) {
    const d = date instanceof Date ? date : new Date();
    const map = {
      YYYY: String(d.getFullYear()),
      MM: pad2(d.getMonth() + 1),
      DD: pad2(d.getDate()),
      HH: pad2(d.getHours()),
      mm: pad2(d.getMinutes()),
      ss: pad2(d.getSeconds()),
    };
    const pattern = String(fmt || "YYYY-MM-DD");
    return pattern.replace(/YYYY|MM|DD|HH|mm|ss/g, (tok) => map[tok]);
  }

  /**
   * Find the longest snippet trigger that the text ending at the cursor terminates with.
   * @param {Array<{trigger:string}>} snippets
   * @param {string} textBeforeCursor
   * @returns snippet or null
   */
  function findTriggerMatch(snippets, textBeforeCursor) {
    const hay = String(textBeforeCursor || "").slice(-MAX_TRIGGER_LEN);
    if (!hay) return null;
    let best = null;
    for (const s of Array.isArray(snippets) ? snippets : []) {
      if (!s || s.enabled === false) continue;
      const trig = String(s.trigger || "").trim();
      if (!trig) continue;
      if (!hay.endsWith(trig)) continue;
      if (!best || trig.length > best.trigger.length) best = s;
    }
    return best;
  }

  /**
   * How many characters of `trigger` are already present as a suffix of text
   * before the caret. Used when the completing keystroke was intercepted and
   * is not in the field yet (hostile email inputs that reject "/").
   * If the full trigger is already in the field, returns trigger.length.
   */
  function triggerPrefixInField(textBeforeCaret, trigger) {
    const before = String(textBeforeCaret || "");
    const trig = String(trigger || "");
    if (!trig) return 0;
    if (before.endsWith(trig)) return trig.length;
    const max = Math.min(before.length, Math.max(0, trig.length - 1));
    for (let n = max; n >= 1; n--) {
      if (before.endsWith(trig.slice(0, n))) return n;
    }
    return 0;
  }

  /**
   * Expand a snippet body's dynamic tokens.
   * Supported: {{date}}, {{date:FMT}}, {{time}}, {{datetime}}, {{clipboard}}, {{cursor}}
   * @param {string} body
   * @param {{ now?: Date, clipboardText?: string }} ctx
   * @returns {{ text: string, cursorOffset: number|null }}
   */
  function expandTokens(body, ctx) {
    const opts = ctx && typeof ctx === "object" ? ctx : {};
    const now = opts.now instanceof Date ? opts.now : new Date();
    const clip = opts.clipboardText != null ? String(opts.clipboardText) : "";

    let out = String(body || "")
      .replace(/\{\{date(?::([^}]+))?\}\}/gi, (_m, fmt) => formatDate(now, fmt || "YYYY-MM-DD"))
      .replace(/\{\{time(?::([^}]+))?\}\}/gi, (_m, fmt) => formatDate(now, fmt || "HH:mm"))
      .replace(/\{\{datetime\}\}/gi, () => formatDate(now, "YYYY-MM-DD HH:mm"))
      .replace(/\{\{clipboard\}\}/gi, () => clip);

    const cursorIdx = out.indexOf(CURSOR_TOKEN);
    let cursorOffset = null;
    if (cursorIdx >= 0) {
      out = out.slice(0, cursorIdx) + out.slice(cursorIdx + CURSOR_TOKEN.length);
      cursorOffset = cursorIdx;
    }
    return { text: out, cursorOffset };
  }

  /** True if body references {{clipboard}} - callers can skip the clipboard read otherwise. */
  function needsClipboard(body) {
    return /\{\{clipboard\}\}/i.test(String(body || ""));
  }

  const api = {
    MAX_TRIGGER_LEN,
    CURSOR_TOKEN,
    CURSOR_MARKER,
    formatDate,
    findTriggerMatch,
    triggerPrefixInField,
    expandTokens,
    needsClipboard,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { TbccSnippetLib: api };
  } else {
    root.TbccSnippetLib = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
