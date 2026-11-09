/**
 * Minimal GM_* shims for TBCC extension content scripts (ported userscripts).
 * Tampermonkey builds use real GM APIs from the manager.
 */
(function (root) {
  'use strict';
  if (root.__TBCC_GM_SHIM__) return;
  root.__TBCC_GM_SHIM__ = true;

  const LS_PREFIX = 'tbcc_gm_';

  function lsGet(key, fallback) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function lsSet(key, value) {
    try {
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    } catch (_) {}
  }

  if (typeof root.GM_getValue !== 'function') {
    root.GM_getValue = (key, fallback) => lsGet(key, fallback);
    root.GM_setValue = (key, value) => lsSet(key, value);
    root.GM_deleteValue = (key) => {
      try {
        localStorage.removeItem(LS_PREFIX + key);
      } catch (_) {}
    };
  }

  if (typeof root.GM !== 'object' || root.GM === null) root.GM = {};
  if (typeof root.GM.getValue !== 'function') root.GM.getValue = (key, def) => root.GM_getValue(key, def);
  if (typeof root.GM.setValue !== 'function') root.GM.setValue = (key, val) => root.GM_setValue(key, val);
  if (typeof root.GM.deleteValue !== 'function') root.GM.deleteValue = (key) => root.GM_deleteValue(key);

  if (typeof root.GM_addStyle !== 'function') {
    root.GM_addStyle = (css) => {
      const s = document.createElement('style');
      s.textContent = String(css || '');
      (document.head || document.documentElement).appendChild(s);
      return s;
    };
  }
  if (typeof root.GM.addStyle !== 'function') root.GM.addStyle = root.GM_addStyle;

  // Tampermonkey/Firefox APIs used by some inbox ports (e.g. RedGifs Autohd).
  // In isolated content scripts these are no-ops / identity — enough to stop hard throws.
  if (typeof root.unsafeWindow === 'undefined') root.unsafeWindow = root;
  if (typeof root.exportFunction !== 'function') {
    root.exportFunction = function exportFunction(fn) {
      return fn;
    };
  }

  if (typeof root.GM_setClipboard !== 'function') {
    root.GM_setClipboard = (text) => {
      const t = String(text ?? '');
      if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(t);
      const ta = document.createElement('textarea');
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    };
  }

  if (typeof root.GM_download !== 'function') {
    root.GM_download = (details) => {
      const d = typeof details === 'string' ? { url: details } : details || {};
      const url = String(d.url || '');
      if (!url) return;
      const name = d.name || '';
      const a = document.createElement('a');
      a.href = url;
      if (name) a.download = name;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
  }

  function b64ToBytes(b64) {
    const bin = atob(String(b64 || ''));
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function decodeXhrBody(payload, responseType) {
    if (responseType === 'blob') {
      return new Blob([b64ToBytes(payload.responseB64)]);
    }
    if (responseType === 'arraybuffer') {
      return b64ToBytes(payload.responseB64).buffer;
    }
    return payload.response;
  }

  function xhrViaPageFetch(o) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutMs = Number(o.timeout) || 0;
    const timer = timeoutMs && ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    return fetch(o.url, {
      method: o.method || 'GET',
      headers: o.headers || {},
      body: o.data,
      credentials: o.anonymous ? 'omit' : 'include',
      signal: ctrl ? ctrl.signal : undefined,
    }).then(async (res) => {
      if (timer) clearTimeout(timer);
      const responseType = String(o.responseType || 'text');
      let response;
      if (responseType === 'json') response = await res.json();
      else if (responseType === 'blob') response = await res.blob();
      else if (responseType === 'arraybuffer') response = await res.arrayBuffer();
      else response = await res.text();
      o.onload?.({
        status: res.status,
        statusText: res.statusText,
        responseText: typeof response === 'string' ? response : '',
        response,
        finalUrl: res.url,
      });
    });
  }

  if (typeof root.GM_xmlhttpRequest !== 'function') {
    root.GM_xmlhttpRequest = (opts) => {
      const o = opts || {};
      const responseType = String(o.responseType || 'text');
      const sendBg = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage;
      if (sendBg) {
        try {
          chrome.runtime.sendMessage(
            {
              action: 'tbcc-gm-xhr',
              url: o.url,
              method: o.method || 'GET',
              headers: o.headers || {},
              data: o.data,
              timeout: o.timeout || 15000,
              responseType,
            },
            (payload) => {
              const lastErr = chrome.runtime.lastError;
              if (lastErr || !payload || payload.ok === false) {
                xhrViaPageFetch(o).catch((err) => o.onerror?.(err));
                return;
              }
              try {
                o.onload?.({
                  status: payload.status,
                  statusText: payload.statusText,
                  responseText: typeof payload.response === 'string' ? payload.response : '',
                  response: decodeXhrBody(payload, responseType),
                  finalUrl: payload.finalUrl,
                });
              } catch (err) {
                o.onerror?.(err);
              }
            }
          );
          return;
        } catch (_) {}
      }
      xhrViaPageFetch(o).catch((err) => o.onerror?.(err));
    };
  }
  if (typeof root.GM.xmlHttpRequest !== 'function') {
    root.GM.xmlHttpRequest = root.GM_xmlhttpRequest;
  }

  const menuCommands = [];
  if (typeof root.GM_registerMenuCommand !== 'function') {
    root.GM_registerMenuCommand = (caption, fn) => {
      const id = menuCommands.length;
      menuCommands.push({ caption, fn });
      return id;
    };
    root.GM_unregisterMenuCommand = () => {};
    root.GM.registerMenuCommand = root.GM_registerMenuCommand;
  }

  if (typeof root.GM_openInTab !== 'function') {
    root.GM_openInTab = (url) => window.open(url, '_blank', 'noopener,noreferrer');
  }

  if (typeof root.unsafeWindow === 'undefined') {
    root.unsafeWindow = root;
  }

  if (typeof root.GM_addValueChangeListener !== 'function') {
    root.GM_addValueChangeListener = () => 0;
    if (root.GM) root.GM.addValueChangeListener = root.GM_addValueChangeListener;
  }

  if (typeof root.GM_getResourceText !== 'function') {
    root.GM_getResourceText = () => '';
  }

  if (typeof root.GM_info === 'undefined') {
    root.GM_info = {
      script: { version: '1.0.0', namespace: 'https://t.me/aofmainhub', name: 'TBCC' },
      scriptHandler: 'TBCC',
      scriptWillUpdate: false,
      uuid: 'tbcc-extension-userscript-port',
    };
  }
  if (!root.GM.info) root.GM.info = root.GM_info;

  if (typeof root.VM === 'undefined') {
    root.VM = { shortcut: { register() {} } };
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
