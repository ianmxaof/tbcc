let API_BASE = "http://localhost:8000";
(async () => {
  try {
    const d = await chrome.storage.local.get("tbccApiBase");
    const custom = String(d.tbccApiBase || "").trim().replace(/\/+$/, "");
    if (custom && /^https?:\/\//i.test(custom)) API_BASE = custom;
  } catch (_) {}
})();

const inGalleryPanel = typeof window !== "undefined" && window.parent !== window;

async function loadPools() {
  const sel = document.getElementById("poolId");
  try {
    const res = await fetch(`${API_BASE}/pools`);
    const pools = await res.json();
    sel.innerHTML = "";
    if (!pools.length) {
      sel.innerHTML = '<option value="">No pools</option>';
      return;
    }
    for (const p of pools) {
      const opt = document.createElement("option");
      opt.value = String(p.id);
      opt.textContent = p.name || `Pool ${p.id}`;
      sel.appendChild(opt);
    }
    chrome.storage.local.get("tbccPoolId", (data) => {
      if (data.tbccPoolId && pools.some((x) => x.id === data.tbccPoolId)) {
        sel.value = String(data.tbccPoolId);
      } else if (pools.length) {
        sel.value = String(pools[0].id);
        chrome.storage.local.set({ tbccPoolId: pools[0].id });
      }
    });
  } catch (e) {
    sel.innerHTML = '<option value="">Backend offline</option>';
  }
}

function setBackendStatus(ok, text) {
  const dot = document.getElementById("backendDot");
  const el = document.getElementById("backendStatus");
  if (dot) {
    dot.classList.remove("ok", "bad");
    dot.classList.add(ok ? "ok" : "bad");
  }
  if (el) el.textContent = text;
}

async function pingBackend() {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 4000);
  try {
    const r = await fetch(`${API_BASE}/health`, { signal: ac.signal });
    clearTimeout(t);
    if (r.ok) setBackendStatus(true, "Backend connected (localhost:8000)");
    else setBackendStatus(false, "Backend returned " + r.status);
  } catch (_) {
    clearTimeout(t);
    setBackendStatus(false, "Backend offline");
  }
}

document.getElementById("poolId").addEventListener("change", (e) => {
  const v = e.target.value;
  if (v) chrome.storage.local.set({ tbccPoolId: parseInt(v, 10) });
});

if (!inGalleryPanel) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) chrome.storage.local.set({ tbccGalleryTabId: tabs[0].id });
  });
}

document.getElementById("openGallery").addEventListener("click", (e) => {
  if (inGalleryPanel) {
    e.preventDefault();
    window.parent.postMessage({ type: "tbcc-panel-view", view: "main" }, "*");
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (tabId) chrome.storage.local.set({ tbccGalleryTabId: tabId });
    chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
  });
});

const popOutBtn = document.getElementById("openGalleryPopOut");
if (popOutBtn) {
  popOutBtn.addEventListener("click", () => {
    if (inGalleryPanel) {
      window.parent.postMessage({ type: "tbcc-open-gallery-popout" }, "*");
      return;
    }
    chrome.windows.create({
      url: chrome.runtime.getURL("gallery.html"),
      type: "popup",
      width: 560,
      height: 920,
      focused: true,
    });
  });
}

(function bindEromeProxyKill() {
  const btn = document.getElementById("btnEromeProxyKill");
  const status = document.getElementById("eromeProxyKillStatus");
  if (!btn || !chrome.runtime || !chrome.runtime.sendMessage) return;
  const refresh = async () => {
    try {
      const st = await chrome.runtime.sendMessage({ action: "tbcc-erome-proxy-status" });
      const on = !!(st && st.enabled);
      btn.textContent = on ? "Site proxy on — click to clear" : "Site proxy off";
      if (status) {
        status.textContent = on
          ? "A rotating proxy is on for erome.com. Click to clear without loading the site."
          : "Site proxy already off.";
      }
    } catch (_) {}
  };
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await chrome.runtime.sendMessage({ action: "tbcc-erome-proxy-kill" });
    } catch (_) {}
    await refresh();
    btn.disabled = false;
  });
  void refresh();
})();

document.getElementById("openExtensionOptions").addEventListener("click", (e) => {
  if (inGalleryPanel) {
    e.preventDefault();
    window.parent.postMessage({ type: "tbcc-panel-view", view: "options" }, "*");
    return;
  }
  chrome.runtime.openOptionsPage();
});

document.getElementById("openSnippetLibrary").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("snippet-library.html") });
});

document.getElementById("openDownloadRouting").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("download-routing.html") });
});

document.getElementById("openContextMenuEditor").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("context-menu-editor.html") });
});

async function loadScreenshotUploadPages() {
  const r = await fetch(chrome.runtime.getURL("screenshot-upload-pages.json"));
  if (!r.ok) throw new Error("screenshot-upload-pages.json");
  return r.json();
}

async function openReverseUploadTabs() {
  const j = await loadScreenshotUploadPages();
  const pages = j.pages || [];
  let first = true;
  for (const p of pages) {
    await chrome.tabs.create({ url: p.url, active: first });
    first = false;
  }
}

document.getElementById("btnCaptureReverse").addEventListener("click", async () => {
  const st = document.getElementById("captureStatus");
  st.textContent = "";
  st.className = "";
  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
  } catch (e) {
    st.className = "err";
    st.textContent =
      "Could not capture (restricted pages like chrome:// won't work). " + String(e.message || e);
    return;
  }
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const type = blob.type || "image/png";
    await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
    const clip = globalThis.TbccClipboard;
    if (clip && clip.showCopied) clip.showCopied();
  } catch (e) {
    st.className = "err";
    st.textContent = "Could not copy to clipboard: " + String(e.message || e);
    return;
  }
  try {
    await openReverseUploadTabs();
  } catch (e) {
    st.className = "err";
    st.textContent = "Copied, but could not open tabs: " + String(e.message || e);
    return;
  }
  st.textContent = "Copied — paste (Ctrl+V) in each new tab.";
});

if (inGalleryPanel) {
  document.body.classList.add("tbcc-in-panel");
  const og = document.getElementById("openGallery");
  if (og) og.textContent = "Back to gallery";
}

const liteCb = document.getElementById("tbccLiteMode");
if (liteCb) {
  chrome.storage.local.get("tbccLiteMode", (o) => {
    liteCb.checked = !!o.tbccLiteMode;
  });
  liteCb.addEventListener("change", () => {
    chrome.storage.local.set({ tbccLiteMode: !!liteCb.checked });
  });
}

const btnLaunchFull = document.getElementById("btnLaunchFullStack");
if (btnLaunchFull && typeof globalThis.tbccLaunchFullStack === "function") {
  btnLaunchFull.addEventListener("click", () => {
    globalThis.tbccLaunchFullStack();
  });
}

const btnLaunchSup = document.getElementById("btnLaunchSupervisor");
if (btnLaunchSup && typeof globalThis.tbccLaunchSupervisor === "function") {
  btnLaunchSup.addEventListener("click", () => {
    globalThis.tbccLaunchSupervisor();
  });
}

(function bindOperatorKit() {
  const lib = globalThis.TbccOperatorKitLib;
  const visCb = document.getElementById("tbccKitVisible");
  const pinEditor = document.getElementById("tbccKitPinEditor");
  if (!lib || !visCb) return;

  let kitState = lib.normalizeKitState({});

  async function refreshKitUi() {
    try {
      const data = await chrome.storage.local.get(lib.STORAGE_KEY);
      kitState = lib.normalizeKitState(data[lib.STORAGE_KEY]);
    } catch (_) {}
    visCb.checked = !!kitState.visible;
    if (!pinEditor) return;
    pinEditor.innerHTML = "";
    Object.keys(lib.PIN_CATALOG).forEach((id) => {
      const meta = lib.PIN_CATALOG[id];
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "kit-pin-chip" + (kitState.pins.includes(id) ? " on" : "");
      chip.textContent = meta.icon + " " + meta.label;
      chip.title = kitState.pins.includes(id) ? "Pinned — click to remove" : "Click to pin on overlay";
      chip.addEventListener("click", async () => {
        kitState = lib.togglePin(kitState, id);
        await chrome.storage.local.set({ [lib.STORAGE_KEY]: kitState });
        await refreshKitUi();
      });
      pinEditor.appendChild(chip);
    });
  }

  visCb.addEventListener("change", async () => {
    kitState = lib.normalizeKitState(Object.assign({}, kitState, { visible: !!visCb.checked }));
    await chrome.storage.local.set({ [lib.STORAGE_KEY]: kitState });
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[lib.STORAGE_KEY]) void refreshKitUi();
    });
  } catch (_) {}

  void refreshKitUi();
})();

loadPools();
pingBackend();
setInterval(pingBackend, 20000);
