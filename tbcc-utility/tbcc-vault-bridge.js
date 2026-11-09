/**
 * PowerCore Vault bridge for TBCC — pairing token + dual-origin fetch.
 * Mirrors powercore-browser-hub/extension/vault-bridge.js (pair once, send X-PowerCore-Pair).
 * Shared by service worker (importScripts) and node:test.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { TbccVaultBridge: api };
  }
  root.TbccVaultBridge = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function () {
  const VAULT_BASES = ["http://127.0.0.1:18792", "http://localhost:18792"];
  const PAIR_KEY = "tbccVaultPair";
  const PAIR_HEADER = "X-PowerCore-Pair";
  const PAIR_POLL_MS = 1500;
  const PAIR_MAX_MS = 300000;
  const VAULT_TIMEOUT_MS = 2500;
  const ROTATOR_ASK_TIMEOUT_MS = 120000;
  const CLIENT_NAME = "TBCC Importer";

  const PAIR_FAIL = {
    denied: "Vault said no. Click Ask again to retry pairing.",
    expired: "No answer from Vault in time. Click Ask again to retry pairing.",
    offline: "Vault isn't reachable. Start PowerCore Vault, then try again.",
    old_vault: "This Vault is too old to pair. Update Vault, then try again.",
    refused: "Vault refused the pair request. Try again in a moment.",
  };

  /** @type {string|null} */
  let pairToken = null;
  let pairLoaded = false;

  function isHubNotPaired(status, data) {
    if (status === 401) return true;
    const err = data && (data.error || data.detail);
    if (err === "hub_not_paired") return true;
    if (err && typeof err === "object" && err.error === "hub_not_paired") return true;
    return false;
  }

  function withPairHeaders(options, token) {
    const opts = { ...(options || {}) };
    const headers = { ...(opts.headers || {}) };
    if (token) headers[PAIR_HEADER] = token;
    opts.headers = headers;
    return opts;
  }

  function pairFailMessage(reason) {
    return PAIR_FAIL[reason] || PAIR_FAIL.refused;
  }

  function storageLocal() {
    try {
      return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local ? chrome.storage.local : null;
    } catch (_) {
      return null;
    }
  }

  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes[PAIR_KEY]) {
          const v = changes[PAIR_KEY].newValue;
          pairToken = typeof v === "string" && v ? v : null;
          pairLoaded = true;
        }
      });
    }
  } catch (_) {
    /* no storage events */
  }

  function pairTokenGet() {
    if (pairLoaded) return Promise.resolve(pairToken);
    const store = storageLocal();
    if (!store) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        store.get(PAIR_KEY, (r) => {
          const v = r && r[PAIR_KEY];
          pairToken = typeof v === "string" && v ? v : null;
          pairLoaded = true;
          resolve(pairToken);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function pairTokenSet(token) {
    pairToken = token || null;
    pairLoaded = true;
    const store = storageLocal();
    if (!store) return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        if (token) store.set({ [PAIR_KEY]: token }, () => resolve(true));
        else store.remove(PAIR_KEY, () => resolve(true));
      } catch (_) {
        resolve(false);
      }
    });
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try {
        controller.abort(new Error(`Vault request timed out after ${Math.round(timeoutMs / 1000)}s`));
      } catch (_) {
        controller.abort();
      }
    }, timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (e) {
      const name = e && e.name;
      const msg = (e && e.message) || "";
      if (name === "AbortError" || /aborted/i.test(msg)) {
        const reason =
          (controller.signal && controller.signal.reason && controller.signal.reason.message) ||
          (typeof controller.signal.reason === "string" ? controller.signal.reason : "") ||
          `Vault request timed out after ${Math.round(timeoutMs / 1000)}s`;
        throw new Error(reason);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async function vaultFetch(path, options, timeoutMs) {
    const budget = typeof timeoutMs === "number" ? timeoutMs : VAULT_TIMEOUT_MS;
    const token = await pairTokenGet();
    const sent = withPairHeaders(options, token);
    let lastErr = null;
    for (const base of VAULT_BASES) {
      try {
        return await fetchWithTimeout(base + path, sent, budget);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Vault service unreachable");
  }

  /** Raise Vault tray so the Allow prompt is visible (best-effort). */
  async function showVault(tab) {
    try {
      const q = tab ? `?tab=${encodeURIComponent(tab)}` : "";
      await vaultFetch(`/v1/ui/show-vault${q}`, { method: "POST" }, VAULT_TIMEOUT_MS);
    } catch (_) {
      /* ignore */
    }
  }

  /**
   * Start a pair request. Returns { ok, code, request_id } or { ok:false, reason }.
   * Does not wait for Allow — caller polls via pairWait.
   */
  async function pairRequest() {
    let req;
    try {
      const res = await vaultFetch("/v1/bridge/pair/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: CLIENT_NAME }),
      });
      if (res.status === 404) return { ok: false, reason: "old_vault" };
      if (!res.ok) return { ok: false, reason: "refused" };
      req = await res.json();
    } catch (_) {
      return { ok: false, reason: "offline" };
    }
    if (!req || !req.request_id) return { ok: false, reason: "refused" };
    void showVault();
    return {
      ok: true,
      request_id: String(req.request_id),
      code: String(req.code || ""),
    };
  }

  /**
   * Poll until approved/denied/expired. On approve, stores the token.
   * ``wait`` is injectable for tests.
   */
  async function pairWait(requestId, wait) {
    const sleep = wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const rid = String(requestId || "").trim();
    if (!rid) return { ok: false, reason: "refused" };
    for (let waited = 0; waited < PAIR_MAX_MS; waited += PAIR_POLL_MS) {
      await sleep(PAIR_POLL_MS);
      let st;
      try {
        const res = await vaultFetch("/v1/bridge/pair/status/" + encodeURIComponent(rid), {});
        st = await res.json();
      } catch (_) {
        continue;
      }
      if (st && st.state === "approved" && st.token) {
        await pairTokenSet(st.token);
        return { ok: true };
      }
      if (st && (st.state === "denied" || st.state === "expired")) {
        return { ok: false, reason: st.state };
      }
    }
    return { ok: false, reason: "expired" };
  }

  return {
    PAIR_KEY,
    PAIR_HEADER,
    CLIENT_NAME,
    ROTATOR_ASK_TIMEOUT_MS,
    PAIR_FAIL,
    isHubNotPaired,
    withPairHeaders,
    pairFailMessage,
    pairTokenGet,
    pairTokenSet,
    vaultFetch,
    showVault,
    pairRequest,
    pairWait,
  };
});
