/* Shared XVideos friend-request helpers (service worker + tests). */
(function (root) {
  const XV_BASE = 'https://www.xvideos.com';

  function parseXvConf(html) {
    const text = String(html || '');
    const marker = 'window.xv.conf=';
    const start = text.indexOf(marker);
    if (start === -1) return null;
    const jsonStart = start + marker.length;
    let depth = 0;
    let inString = false;
    let esc = false;
    for (let i = jsonStart; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(jsonStart, i + 1));
          } catch (_) {
            return null;
          }
        }
      }
    }
    return null;
  }

  function readLoginInfo(conf) {
    return conf?.dyn?.login_info || conf?.login_info || null;
  }

  function friendMetaFromConf(conf) {
    const data = conf?.data;
    const user = data?.user;
    const friends = data?.friends;
    if (!user || !friends) return null;
    const basePath = String(user.url || '').replace(/\/$/, '');
    if (!basePath) return null;
    return {
      basePath,
      username: user.username || '',
      display: user.display || user.username || '',
      isFriend: !!friends.isFriend,
      askedByVisitor: !!friends.askedByVisitor,
      askedByOwner: !!friends.askedByOwner,
      visitorCanAsk: !!friends.visitorCanAsk,
      csrf: friends.csrf?.addFriendRequest || '',
      userId: user.id_user,
    };
  }

  function friendResponseOk(data) {
    if (data && data.result === true) return true;
    const msg = String(data?.message || '').toLowerCase();
    if (!msg) return false;
    if (msg.includes('already') && (msg.includes('friend') || msg.includes('pending') || msg.includes('request'))) {
      return true;
    }
    if (msg.includes('invitation') && (msg.includes('sent') || msg.includes('already'))) return true;
    return false;
  }

  function normalizeProfilePath(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) {
      try {
        const u = new URL(raw);
        const m = u.pathname.match(/^\/(profiles|channels|amateurs)\/([^/?#]+)/i);
        return m ? `/${m[1]}/${m[2]}` : '';
      } catch (_) {
        return '';
      }
    }
    const m = raw.match(/^\/?(profiles|channels|amateurs)\/([^/?#]+)/i);
    return m ? `/${m[1]}/${m[2]}` : '';
  }

  function collectProfilesFromListingHtml(html) {
    const seen = new Set();
    const out = [];
    const re = /href="\/(profiles|channels|amateurs)\/([^"?#/]+)"/gi;
    let m;
    while ((m = re.exec(String(html || '')))) {
      const path = `/${m[1]}/${m[2]}`;
      if (seen.has(path)) continue;
      seen.add(path);
      out.push({ path, label: m[2] });
    }
    return out;
  }

  function buildXvUrl(pathOrUrl) {
    const raw = String(pathOrUrl || '').trim();
    if (/^https?:\/\//i.test(raw)) return raw;
    return `${XV_BASE}${raw.startsWith('/') ? raw : `/${raw}`}`;
  }

  async function xvFetch(pathOrUrl, opts) {
    const cookie = (opts && opts.cookie) || '';
    const method = (opts && opts.method) || 'GET';
    const body = opts && opts.body;
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: method === 'GET' ? 'text/html,application/json,*/*' : 'application/json, text/javascript, */*; q=0.01',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(method === 'POST'
        ? {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          }
        : {}),
    };
    return fetch(buildXvUrl(pathOrUrl), { method, headers, body, redirect: 'follow' });
  }

  async function checkLoggedIn(cookie) {
    const res = await xvFetch('/', { cookie });
    const html = await res.text();
    const conf = parseXvConf(html);
    return !!readLoginInfo(conf)?.is_logged;
  }

  async function fetchProfileFriendMeta(profilePath, cookie) {
    const path = normalizeProfilePath(profilePath);
    if (!path) return { ok: false, reason: 'no-path' };
    const res = await xvFetch(path, { cookie });
    const html = await res.text();
    const conf = parseXvConf(html);
    if (!conf) return { ok: false, reason: 'no-conf' };
    const meta = friendMetaFromConf(conf);
    if (!meta) return { ok: false, reason: 'no-meta' };
    return { ok: true, meta, path };
  }

  async function postFriendRequest(meta, cookie) {
    const csrf = String(meta?.csrf || '').trim();
    const basePath = String(meta?.basePath || '').trim();
    if (!basePath || !csrf) {
      return { ok: false, status: 0, data: null, reason: 'missing-csrf' };
    }
    const res = await xvFetch(`${basePath}/friends/requests/ask`, {
      cookie,
      method: 'POST',
      body: new URLSearchParams({ csrf }).toString(),
    });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    return {
      ok: friendResponseOk(data),
      status: res.status,
      data,
      reason: data?.message || '',
    };
  }

  async function sendFriendRequestForProfile(profilePath, cookie, sentSet) {
    const path = normalizeProfilePath(profilePath);
    if (!path) return { path: profilePath, ok: false, skipped: true, reason: 'bad-path' };
    if (sentSet && sentSet.has(path)) {
      return { path, ok: false, skipped: true, reason: 'cached' };
    }

    const fetched = await fetchProfileFriendMeta(path, cookie);
    if (!fetched.ok || !fetched.meta) {
      return { path, ok: false, skipped: false, reason: fetched.reason || 'fetch-failed' };
    }
    const meta = fetched.meta;

    if (meta.isFriend || meta.askedByVisitor) {
      if (sentSet) sentSet.add(path);
      return {
        path,
        username: meta.display,
        ok: false,
        skipped: true,
        reason: meta.isFriend ? 'already-friend' : 'already-asked',
      };
    }
    if (!meta.visitorCanAsk || !meta.csrf) {
      return {
        path,
        username: meta.display,
        ok: false,
        skipped: true,
        reason: meta.visitorCanAsk ? 'no-csrf' : 'cannot-ask',
      };
    }

    const res = await postFriendRequest(meta, cookie);
    if (res.ok && sentSet) sentSet.add(path);
    return {
      path,
      username: meta.display,
      ok: !!res.ok,
      skipped: false,
      reason: res.ok ? '' : String(res.reason || res.status || 'failed'),
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function tbccXvCollectCookieHeader() {
    const urls = ['https://www.xvideos.com/', 'https://xvideos.com/'];
    const domains = ['xvideos.com', '.xvideos.com', 'www.xvideos.com'];
    const seen = new Map();
    for (const url of urls) {
      try {
        const cookies = await chrome.cookies.getAll({ url });
        for (const c of cookies || []) {
          if (!seen.has(c.name)) seen.set(c.name, c.value);
        }
      } catch (_) {}
    }
    for (const domain of domains) {
      try {
        const cookies = await chrome.cookies.getAll({ domain });
        for (const c of cookies || []) {
          if (!seen.has(c.name)) seen.set(c.name, c.value);
        }
      } catch (_) {}
    }
    const header = Array.from(seen.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    return { header, count: seen.size, exportedAt: Date.now() };
  }

  async function listingTargets(listingUrl, pages, cookie) {
    const base = new URL(listingUrl);
    const targets = [];
    const seen = new Set();
    for (let page = 1; page <= pages; page++) {
      const u = new URL(base);
      if (page > 1) u.searchParams.set('p', String(page));
      const res = await xvFetch(u.toString(), { cookie });
      const html = await res.text();
      for (const item of collectProfilesFromListingHtml(html)) {
        if (seen.has(item.path)) continue;
        seen.add(item.path);
        targets.push(item.path);
      }
    }
    return targets;
  }

  async function runFriendBatch(opts) {
    const listingUrl = String(opts?.listingUrl || '').trim();
    const pages = Math.max(1, Number(opts?.pages) || 1);
    const delayMs = Math.max(0, Number(opts?.delayMs) || 650);
    let cookie = String(opts?.cookie || '').trim();
    if (!cookie) {
      const exported = await tbccXvCollectCookieHeader();
      cookie = exported.header;
    }
    if (!cookie) return { ok: false, error: 'no-cookies' };
    const loggedIn = await checkLoggedIn(cookie);
    if (!loggedIn) return { ok: false, error: 'not-logged-in' };

    let targets = [];
    if (listingUrl) {
      targets = await listingTargets(listingUrl, pages, cookie);
    } else if (Array.isArray(opts?.profiles)) {
      targets = opts.profiles.map((p) => normalizeProfilePath(p)).filter(Boolean);
    }
    if (!targets.length) return { ok: false, error: 'no-targets' };

    const sentSet = new Set(Array.isArray(opts?.sent) ? opts.sent : []);
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const profilePath of targets) {
      const result = await sendFriendRequestForProfile(profilePath, cookie, sentSet);
      if (result.ok) sent += 1;
      else if (result.skipped) skipped += 1;
      else failed += 1;
      if (delayMs > 0) await sleep(delayMs);
    }
    return { ok: true, sent, skipped, failed, targets: targets.length, sentPaths: [...sentSet] };
  }

  root.TbccXvFriendCore = {
    parseXvConf,
    readLoginInfo,
    friendMetaFromConf,
    friendResponseOk,
    normalizeProfilePath,
    collectProfilesFromListingHtml,
    buildXvUrl,
    xvFetch,
    checkLoggedIn,
    fetchProfileFriendMeta,
    postFriendRequest,
    sendFriendRequestForProfile,
    sleep,
    tbccXvCollectCookieHeader,
    listingTargets,
    runFriendBatch,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
