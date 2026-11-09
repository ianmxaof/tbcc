/**
 * Default TBCC download-routing rules → Google Drive Daemon/Inbox under AOF NETWORK.
 * Covers Brave/default browser saves, X overlay, TBCC extension exports, and cloud hosts.
 * Folder paths are relative to Chrome's Downloads directory.
 */
(function (root) {
  const AOF_ROOT = "Porn/tbcc/AOF NETWORK";
  const AOF_GD_INBOX = AOF_ROOT + "/Google Drive Daemon/Inbox";
  const DEFAULT_WATCH_INBOX_PREFIX = AOF_GD_INBOX;

  const TBCC_SOURCE_RULES = [
    {
      id: "aof_gd_src_chrome_extension",
      enabled: true,
      matchType: "urlRegex",
      matchValue: "^chrome-extension://",
      folder: AOF_GD_INBOX + "/Extension",
      filenameTemplate: "ext_{filename}_{YYYY}{MM}{DD}.{ext}",
      label: "TBCC extension origin",
    },
    {
      id: "aof_gd_src_data_image",
      enabled: true,
      matchType: "urlRegex",
      matchValue: "^data:image/",
      folder: AOF_GD_INBOX + "/Images/screenshots",
      filenameTemplate: "screenshot_{YYYY}{MM}{DD}_{HH}{mm}{ss}.{ext}",
      label: "Screenshot / clipboard capture (data URL)",
    },
  ];

  /** Site-specific lanes (domain rules — after extension/MIME so type rules win). */
  const SOURCE_DOMAINS = [
    { id: "aof_gd_src_x", domain: "x.com", folder: AOF_GD_INBOX + "/Social/X", label: "X / Twitter overlay" },
    { id: "aof_gd_src_twitter", domain: "twitter.com", folder: AOF_GD_INBOX + "/Social/X", label: "Twitter (legacy host)" },
    { id: "aof_gd_src_erome", domain: "erome.com", folder: AOF_GD_INBOX + "/Erome/{ext}", label: "Erome" },
    { id: "aof_gd_src_reddit", domain: "reddit.com", folder: AOF_GD_INBOX + "/Reddit/{ext}", label: "Reddit" },
    { id: "aof_gd_src_redgifs", domain: "redgifs.com", folder: AOF_GD_INBOX + "/Redgifs/{ext}", label: "Redgifs" },
    { id: "aof_gd_src_bunkr_ru", domain: "bunkr.ru", folder: AOF_GD_INBOX + "/Bunkr/{ext}", label: "Bunkr" },
    { id: "aof_gd_src_bunkr_site", domain: "bunkr.site", folder: AOF_GD_INBOX + "/Bunkr/{ext}", label: "Bunkr (.site)" },
    { id: "aof_gd_src_simpcity", domain: "simpcity.cr", folder: AOF_GD_INBOX + "/SimpCity/{ext}", label: "SimpCity" },
    { id: "aof_gd_src_coomer", domain: "coomer.st", folder: AOF_GD_INBOX + "/Coomer/{ext}", label: "Coomer" },
    { id: "aof_gd_src_kemono", domain: "kemono.cr", folder: AOF_GD_INBOX + "/Coomer/{ext}", label: "Kemono" },
    { id: "aof_gd_src_onlyfans", domain: "onlyfans.com", folder: AOF_GD_INBOX + "/OnlyFans/{ext}", label: "OnlyFans" },
    { id: "aof_gd_src_fansly", domain: "fansly.com", folder: AOF_GD_INBOX + "/Fansly/{ext}", label: "Fansly" },
  ];

  /** Per-extension subfolders (mp4, jpg, etc.). */
  const EXTENSION_RULES = [
    { id: "aof_gd_ext_mp4", ext: "mp4", folder: AOF_GD_INBOX + "/Videos/mp4", label: "MP4 video" },
    { id: "aof_gd_ext_mkv", ext: "mkv", folder: AOF_GD_INBOX + "/Videos/mkv", label: "MKV video" },
    { id: "aof_gd_ext_webm", ext: "webm", folder: AOF_GD_INBOX + "/Videos/webm", label: "WebM video" },
    { id: "aof_gd_ext_mov", ext: "mov", folder: AOF_GD_INBOX + "/Videos/mov", label: "MOV video" },
    { id: "aof_gd_ext_m4v", ext: "m4v", folder: AOF_GD_INBOX + "/Videos/m4v", label: "M4V video" },
    { id: "aof_gd_ext_avi", ext: "avi", folder: AOF_GD_INBOX + "/Videos/avi", label: "AVI video" },
    { id: "aof_gd_ext_wmv", ext: "wmv", folder: AOF_GD_INBOX + "/Videos/wmv", label: "WMV video" },
    { id: "aof_gd_ext_flv", ext: "flv", folder: AOF_GD_INBOX + "/Videos/flv", label: "FLV video" },
    { id: "aof_gd_ext_jpg", ext: "jpg", folder: AOF_GD_INBOX + "/Images/jpg", label: "JPG images" },
    { id: "aof_gd_ext_jpeg", ext: "jpeg", folder: AOF_GD_INBOX + "/Images/jpeg", label: "JPEG images" },
    { id: "aof_gd_ext_png", ext: "png", folder: AOF_GD_INBOX + "/Images/png", label: "PNG images" },
    { id: "aof_gd_ext_webp", ext: "webp", folder: AOF_GD_INBOX + "/Images/webp", label: "WebP images" },
    { id: "aof_gd_ext_gif", ext: "gif", folder: AOF_GD_INBOX + "/Images/gif", label: "GIF images" },
    { id: "aof_gd_ext_avif", ext: "avif", folder: AOF_GD_INBOX + "/Images/avif", label: "AVIF images" },
    { id: "aof_gd_ext_heic", ext: "heic", folder: AOF_GD_INBOX + "/Images/heic", label: "HEIC images" },
    { id: "aof_gd_ext_zip", ext: "zip", folder: AOF_GD_INBOX + "/Archives/zip", label: "ZIP archives" },
    { id: "aof_gd_ext_rar", ext: "rar", folder: AOF_GD_INBOX + "/Archives/rar", label: "RAR archives" },
    { id: "aof_gd_ext_7z", ext: "7z", folder: AOF_GD_INBOX + "/Archives/7z", label: "7z archives" },
  ];

  const CLOUD_DOMAINS = [
    "mega.nz",
    "mega.co.nz",
    "drive.google.com",
    "docs.google.com",
    "dropbox.com",
    "dl.dropboxusercontent.com",
    "terabox.com",
    "1024terabox.com",
    "terabox.app",
    "4funbox.com",
    "mirrobox.com",
    "bunkr.ru",
    "bunkr.site",
    "gofile.io",
    "mediafire.com",
  ];

  const SEED_IDS = new Set([
    ...SOURCE_DOMAINS.map((s) => s.id),
    ...EXTENSION_RULES.map((e) => e.id),
    "aof_gd_mime_video",
    "aof_gd_mime_image",
    "aof_gd_mime_audio",
    "aof_gd_catch_http",
    "aof_gd_src_chrome_extension",
    "aof_gd_src_data_image",
    "aof_gd_x_twimg_image",
    "aof_gd_x_twimg_video",
    ...CLOUD_DOMAINS.map((d) => "aof_gd_cloud_" + d.replace(/\./g, "_")),
    // legacy ids kept in sync
    "aof_stash_video_mime",
    "aof_stash_image_mime",
    "aof_stash_video_ext",
    ...CLOUD_DOMAINS.map((d) => "aof_stash_cloud_" + d.replace(/\./g, "_")),
  ]);

  function buildAofStashDownloadRoutes() {
    const now = Date.now();
    const routes = [];

    TBCC_SOURCE_RULES.forEach((s) => {
      routes.push(Object.assign({}, s, { seededAt: now, label: (s.label || "TBCC source") + " -> GDrive Inbox" }));
    });

    routes.push(
      {
        id: "aof_gd_x_twimg_image",
        enabled: true,
        matchType: "urlRegex",
        matchValue: "(?:twimg\\.com|video\\.twimg\\.com).*\\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)",
        folder: AOF_GD_INBOX + "/Images/x",
        label: "X / twimg images -> GDrive Inbox",
        seededAt: now,
      },
      {
        id: "aof_gd_x_twimg_video",
        enabled: true,
        matchType: "urlRegex",
        matchValue: "(?:twimg\\.com|video\\.twimg\\.com).*(?:\\.(?:mp4|webm|mov)|/vid/)(?:[?#]|$)",
        folder: AOF_GD_INBOX + "/Videos/x",
        label: "X / twimg video -> GDrive Inbox",
        seededAt: now,
      }
    );

    EXTENSION_RULES.forEach((e) => {
      routes.push({
        id: e.id,
        enabled: true,
        matchType: "extension",
        matchValue: e.ext,
        folder: e.folder,
        label: e.label + " -> GDrive Inbox",
        seededAt: now,
      });
    });

    routes.push(
      {
        id: "aof_gd_mime_video",
        enabled: true,
        matchType: "mimePrefix",
        matchValue: "video/",
        folder: AOF_GD_INBOX + "/Videos/{ext}",
        label: "Video MIME -> GDrive Inbox",
        seededAt: now,
      },
      {
        id: "aof_gd_mime_image",
        enabled: true,
        matchType: "mimePrefix",
        matchValue: "image/",
        folder: AOF_GD_INBOX + "/Images/{ext}",
        label: "Image MIME -> GDrive Inbox",
        seededAt: now,
      },
      {
        id: "aof_gd_mime_audio",
        enabled: true,
        matchType: "mimePrefix",
        matchValue: "audio/",
        folder: AOF_GD_INBOX + "/Audio/{ext}",
        label: "Audio MIME -> GDrive Inbox",
        seededAt: now,
      }
    );

    SOURCE_DOMAINS.forEach((s) => {
      routes.push({
        id: s.id,
        enabled: true,
        matchType: "domain",
        matchValue: s.domain,
        folder: s.folder,
        label: s.label + " -> GDrive Inbox",
        seededAt: now,
      });
    });

    CLOUD_DOMAINS.forEach((domain) => {
      routes.push({
        id: "aof_gd_cloud_" + domain.replace(/\./g, "_"),
        enabled: true,
        matchType: "domain",
        matchValue: domain,
        folder: AOF_GD_INBOX + "/Cloud/{domain}",
        label: "Cloud host " + domain,
        seededAt: now,
      });
    });

    routes.push(
      {
        id: "aof_gd_catch_http",
        enabled: true,
        matchType: "urlRegex",
        matchValue: "^https?://",
        folder: AOF_GD_INBOX + "/Browser/{domain}/{ext}",
        label: "Brave / browser downloads (catch-all)",
        seededAt: now,
      }
    );

    // Legacy rule ids (same folders — merge refreshes these for older installs)
    routes.push(
      {
        id: "aof_stash_video_mime",
        enabled: true,
        matchType: "mimePrefix",
        matchValue: "video/",
        folder: AOF_GD_INBOX + "/Videos/{ext}",
        label: "Video MIME (legacy id)",
        seededAt: now,
      },
      {
        id: "aof_stash_image_mime",
        enabled: true,
        matchType: "mimePrefix",
        matchValue: "image/",
        folder: AOF_GD_INBOX + "/Images/{ext}",
        label: "Image MIME (legacy id)",
        seededAt: now,
      },
      {
        id: "aof_stash_video_ext",
        enabled: true,
        matchType: "extension",
        matchValue: "mp4,mkv,avi,mov,webm,m4v,wmv,flv",
        folder: AOF_GD_INBOX + "/Videos/{ext}",
        label: "Video extensions batch (legacy id)",
        seededAt: now,
      }
    );
    CLOUD_DOMAINS.forEach((domain) => {
      routes.push({
        id: "aof_stash_cloud_" + domain.replace(/\./g, "_"),
        enabled: true,
        matchType: "domain",
        matchValue: domain,
        folder: AOF_GD_INBOX + "/Cloud/{domain}",
        label: "Cloud host " + domain + " (legacy id)",
        seededAt: now,
      });
    });

    return routes;
  }

  /**
   * Merge seed routes. Adds missing ids; optionally refreshes folder/label on known seed ids.
   * @param {any[]} existing
   * @param {{ refreshPaths?: boolean }} [opts]
   */
  function mergeAofStashDownloadRoutes(existing, opts) {
    const seeds = buildAofStashDownloadRoutes();
    const seedById = new Map(seeds.map((s) => [s.id, s]));
    const out = [];
    const have = new Set();

    for (const row of Array.isArray(existing) ? existing : []) {
      if (!row || !row.id) {
        out.push(row);
        continue;
      }
      const seed = seedById.get(row.id);
      if (seed && opts && opts.refreshPaths && SEED_IDS.has(row.id)) {
        out.push(
          Object.assign({}, row, {
            folder: seed.folder,
            label: seed.label,
            matchType: seed.matchType,
            matchValue: seed.matchValue,
            seededAt: seed.seededAt,
          })
        );
      } else {
        out.push(row);
      }
      have.add(row.id);
    }

    for (const seed of seeds) {
      if (!have.has(seed.id)) {
        out.push(seed);
        have.add(seed.id);
      }
    }
    return out;
  }

  const api = {
    buildAofStashDownloadRoutes,
    mergeAofStashDownloadRoutes,
    AOF_GD_INBOX,
    AOF_JD_INBOX: AOF_GD_INBOX,
    DEFAULT_WATCH_INBOX_PREFIX,
    SEED_IDS,
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.TbccAofDownloadRouteSeeds = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
