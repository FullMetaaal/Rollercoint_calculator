const { app, BrowserWindow, Menu, ipcMain, session } = require("electron");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");

let mainWindow;
let autoUpdater = null;
let autoUpdaterConfigured = false;
let autoUpdaterLoadFailed = false;
let autoUpdateCheckInFlight = null;
const DEV_PROFILE_SUFFIX = "v2";
const ROLLERCOIN_PARTITION = "persist:rollercoin-auth";
const ENABLE_INTERACTIVE_MARKET_SCANNER = true;
const MARKET_PAGE_LIMIT = 100;
const MARKET_MAX_PAGES = 250;
const MARKET_PAGE_BATCH_SIZE = 2;
const MARKET_DIRECT_PAGE_BATCH_SIZE = 4;
const MARKET_REQUEST_TIMEOUT_MS = 12000;
const MARKET_PROBE_TIMEOUT_MS = 6000;
const MARKET_PAGE_RETRY_LIMIT = 3;
const MARKET_ATTEMPTS_PREVIEW_LIMIT = 160;
const MARKET_PROGRESS_INFO_THROTTLE_MS = 180;
const MARKET_HTTPS_AGENT = new https.Agent({
  keepAlive: true,
  maxSockets: Math.max(MARKET_DIRECT_PAGE_BATCH_SIZE * 2, 8),
  maxFreeSockets: Math.max(MARKET_DIRECT_PAGE_BATCH_SIZE, 4),
});
const STARTUP_LOG_PATH = path.join(os.tmpdir(), "roller-coin-calculator-startup.log");
const marketProgressState = new Map();

function normalizeMarketRefreshMode(value) {
  return value === "quick" ? "quick" : "full";
}

function normalizeMarketFetchOptions(options = {}) {
  const refreshMode = normalizeMarketRefreshMode(options?.refreshMode);
  const parsedMaxPages = Number(options?.maxPages);
  const maxPages =
    Number.isFinite(parsedMaxPages) && parsedMaxPages > 0
      ? Math.max(1, Math.min(MARKET_MAX_PAGES, Math.floor(parsedMaxPages)))
      : MARKET_MAX_PAGES;

  return {
    refreshMode,
    maxPages,
    includeAttempts: options?.includeAttempts !== false,
  };
}

function finalizeMarketFetchResult(result, options = {}) {
  const normalizedOptions = normalizeMarketFetchOptions(options);
  if (!result || typeof result !== "object") {
    return result;
  }

  const finalized = {
    ...result,
    refreshMode: result.refreshMode || normalizedOptions.refreshMode,
    maxPages: Number.isFinite(Number(result.maxPages)) ? Number(result.maxPages) : normalizedOptions.maxPages,
  };

  if (!normalizedOptions.includeAttempts) {
    delete finalized.attempts;
  } else if (Array.isArray(finalized.attempts) && finalized.attempts.length > MARKET_ATTEMPTS_PREVIEW_LIMIT) {
    finalized.attemptCount = finalized.attempts.length;
    finalized.attempts = [
      ...finalized.attempts.slice(0, Math.floor(MARKET_ATTEMPTS_PREVIEW_LIMIT * 0.65)),
      ...finalized.attempts.slice(-(MARKET_ATTEMPTS_PREVIEW_LIMIT - Math.floor(MARKET_ATTEMPTS_PREVIEW_LIMIT * 0.65))),
    ];
  } else if (Array.isArray(finalized.attempts)) {
    finalized.attemptCount = finalized.attempts.length;
  }

  return finalized;
}

function writeStartupLog(message, extra = null) {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  try {
    fs.appendFileSync(
      STARTUP_LOG_PATH,
      `[${new Date().toISOString()}] ${message}${suffix}\n`,
      "utf8",
    );
  } catch {
    // Ignore logging failures.
  }
}

writeStartupLog("main.js loaded.");

function ensureDirSafe(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function getRoamingAppDataPath() {
  return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
}

function getDevUserDataPath() {
  return path.join(getRoamingAppDataPath(), `roller-coin-calculator-dev-${DEV_PROFILE_SUFFIX}`);
}

function configureStoragePaths() {
  try {
    const userDataPath = app.isPackaged
      ? path.join(getRoamingAppDataPath(), "roller-coin-calculator")
      : getDevUserDataPath();
    if (ensureDirSafe(userDataPath)) {
      app.setPath("userData", userDataPath);
      writeStartupLog("Configured userData path.", { userDataPath });
    }
  } catch {
    // Keep Electron defaults if custom path setup fails.
  }

  try {
    const cacheBasePath = app.isPackaged
      ? path.join(app.getPath("temp"), "roller-coin-calculator-cache")
      : path.join(app.getPath("temp"), `roller-coin-calculator-dev-cache-${DEV_PROFILE_SUFFIX}`);
    const httpCachePath = path.join(cacheBasePath, "http-cache");
    const gpuCachePath = path.join(cacheBasePath, "gpu-cache");

    if (ensureDirSafe(httpCachePath)) {
      app.commandLine.appendSwitch("disk-cache-dir", httpCachePath);
    }
    if (ensureDirSafe(gpuCachePath)) {
      app.commandLine.appendSwitch("gpu-shader-cache-path", gpuCachePath);
    }
    app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
  } catch {
    // Ignore cache path customization issues.
  }
}

// This app does not rely on GPU-heavy rendering, so prefer stability over hardware acceleration.
app.disableHardwareAcceleration();

function attachRollercoinAssetRequestHeaders(targetSession) {
  if (!targetSession || targetSession.__rollercoinAssetHeadersBound) return;
  targetSession.__rollercoinAssetHeadersBound = true;

  targetSession.webRequest.onBeforeSendHeaders(
    {
      urls: [
        "https://static.rollercoin.com/static/img/*",
        "https://rollercoin.com/static/img/*",
      ],
    },
    (details, callback) => {
      const requestHeaders = {
        ...details.requestHeaders,
        Referer:
          details.requestHeaders?.Referer ||
          details.requestHeaders?.referer ||
          "https://rollercoin.com/marketplace/buy?itemType=miner",
        Origin:
          details.requestHeaders?.Origin ||
          details.requestHeaders?.origin ||
          "https://rollercoin.com",
      };

      callback({ requestHeaders });
    },
  );
}

configureStoragePaths();

const shouldUseSingleInstanceLock = app.isPackaged;
const hasSingleInstanceLock = shouldUseSingleInstanceLock
  ? app.requestSingleInstanceLock()
  : true;
writeStartupLog("Single instance lock requested.", {
  enabled: shouldUseSingleInstanceLock,
  acquired: hasSingleInstanceLock,
});
if (!hasSingleInstanceLock) {
  app.quit();
}

function logAutoUpdate(message, extra = null) {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  console.info(`[auto-update] ${message}${suffix}`);
  writeStartupLog(`[auto-update] ${message}`, extra);
}

function getAutoUpdater() {
  if (autoUpdater) {
    return autoUpdater;
  }

  if (autoUpdaterLoadFailed) {
    return null;
  }

  try {
    const updaterModule = require("electron-updater");
    autoUpdater = updaterModule?.autoUpdater || null;

    if (!autoUpdater) {
      throw new Error("electron-updater did not expose autoUpdater.");
    }

    return autoUpdater;
  } catch (error) {
    autoUpdaterLoadFailed = true;
    logAutoUpdate("Auto-update module unavailable.", {
      message: error?.message || String(error),
    });
    return null;
  }
}

function setupAutoUpdater() {
  if (autoUpdaterConfigured || !app.isPackaged) {
    return;
  }

  const updater = getAutoUpdater();
  if (!updater) {
    return;
  }

  autoUpdaterConfigured = true;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = true;

  updater.on("checking-for-update", () => {
    logAutoUpdate("Checking for updates...");
  });

  updater.on("update-available", (info) => {
    logAutoUpdate("Update available.", {
      version: info?.version || null,
      files: Array.isArray(info?.files) ? info.files.length : 0,
    });
  });

  updater.on("update-not-available", (info) => {
    logAutoUpdate("No updates available.", {
      version: info?.version || app.getVersion(),
    });
  });

  updater.on("download-progress", (progress) => {
    logAutoUpdate("Download progress.", {
      percent: Number.isFinite(Number(progress?.percent)) ? Number(progress.percent).toFixed(1) : null,
      transferred: progress?.transferred || 0,
      total: progress?.total || 0,
    });
  });

  updater.on("error", (error) => {
    logAutoUpdate("Auto-update error.", {
      message: error?.message || String(error),
    });
  });

  updater.on("update-downloaded", async (info) => {
    logAutoUpdate("Update downloaded.", {
      version: info?.version || null,
    });

    const targetWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const { dialog } = require("electron");
    const dialogOptions = {
      type: "info",
      buttons: ["Restart and Install", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update Ready",
      message: `Version ${info?.version || "new"} has been downloaded.`,
      detail: "Restart the app now to install the update.",
    };

    try {
      const result = targetWindow
        ? await dialog.showMessageBox(targetWindow, dialogOptions)
        : await dialog.showMessageBox(dialogOptions);

      if (result.response === 0) {
        setImmediate(() => {
          updater.quitAndInstall(false, true);
        });
      }
    } catch (error) {
      logAutoUpdate("Failed to show update dialog.", {
        message: error?.message || String(error),
      });
    }
  });
}

function scheduleAutoUpdateCheck() {
  // Keep startup deterministic in packaged builds. Update checks are available
  // via the explicit UI action instead of running automatically on launch.
}

function triggerAutoUpdateCheck({ manual = false } = {}) {
  if (!app.isPackaged) {
    return Promise.resolve({
      started: false,
      status: "unavailable",
      message: "App updates are available only in packaged builds.",
    });
  }

  setupAutoUpdater();
  const updater = getAutoUpdater();
  if (!updater) {
    return Promise.resolve({
      started: false,
      status: "unavailable",
      message: "Auto-update is temporarily unavailable in this build.",
    });
  }

  if (autoUpdateCheckInFlight) {
    return Promise.resolve({
      started: false,
      status: "checking",
      message: "Update check is already in progress.",
    });
  }

  autoUpdateCheckInFlight = new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      updater.removeListener("update-available", onUpdateAvailable);
      updater.removeListener("update-not-available", onUpdateNotAvailable);
      updater.removeListener("error", onError);
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      autoUpdateCheckInFlight = null;
      resolve(result);
    };

    const onUpdateAvailable = (info) => {
      finish({
        started: true,
        status: "update-available",
        version: info?.version || null,
        message: `Update ${info?.version || "new"} found. Download started in the background.`,
      });
    };

    const onUpdateNotAvailable = (info) => {
      const resolvedVersion = info?.version || app.getVersion();
      finish({
        started: true,
        status: "up-to-date",
        version: resolvedVersion,
        message: `You're already using the latest version (${resolvedVersion}).`,
      });
    };

    const onError = (error) => {
      const message = error?.message || String(error);
      if (!manual) {
        logAutoUpdate("Failed to check for updates.", { message });
      }
      finish({
        started: true,
        status: "error",
        message: `Update check failed: ${message}`,
      });
    };

    updater.once("update-available", onUpdateAvailable);
    updater.once("update-not-available", onUpdateNotAvailable);
    updater.once("error", onError);

    Promise.resolve()
      .then(() => {
        if (manual) {
          logAutoUpdate("Manual update check requested.");
        }
      })
      .then(() => updater.checkForUpdates())
      .catch(onError);
  });

  return autoUpdateCheckInFlight;
}

function buildApplicationMenu() {
  const template = [];

  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push({
    label: "View",
    submenu: [
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  });

  template.push({
    label: "Help",
    submenu: [
      {
        label: "Check for Updates",
        click: async () => {
          const result = await triggerAutoUpdateCheck({ manual: true });
          const { dialog } = require("electron");
          const targetWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
          const title =
            result.status === "error"
              ? "Update Check Failed"
              : result.status === "update-available"
                ? "Update Found"
                : result.status === "checking"
                  ? "Update Check Running"
                  : result.status === "unavailable"
                    ? "Updates Unavailable"
                    : "No Updates Found";

          const dialogOptions = {
            type: result.status === "error" ? "error" : "info",
            buttons: ["OK"],
            defaultId: 0,
            title,
            message: result.message || "App update check finished.",
          };

          if (targetWindow) {
            await dialog.showMessageBox(targetWindow, dialogOptions);
          } else {
            await dialog.showMessageBox(dialogOptions);
          }
        },
      },
    ],
  });

  return Menu.buildFromTemplate(template);
}

function createWindow() {
  writeStartupLog("Creating main window.");
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    show: false,
    backgroundColor: "#eef3ff",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.on("closed", () => {
    writeStartupLog("Main window closed.");
  });

  mainWindow.on("close", () => {
    writeStartupLog("Main window close requested.", {
      destroyed: mainWindow?.isDestroyed?.() || false,
      visible: mainWindow?.isVisible?.() || false,
      minimized: mainWindow?.isMinimized?.() || false,
    });
  });

  mainWindow.webContents.on("did-finish-load", () => {
    writeStartupLog("Main window finished loading.");
  });

  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      writeStartupLog("Main window failed to load.", {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      });
    },
  );

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    writeStartupLog("Renderer process gone.", details);
  });

  mainWindow.webContents.on("destroyed", () => {
    writeStartupLog("Main window webContents destroyed.");
  });

  const rendererEntryPath = path.join(__dirname, "dist", "renderer", "index.html");
  if (!fs.existsSync(rendererEntryPath)) {
    const errorHtml = encodeURIComponent(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>Renderer build missing</title>
          <style>
            body {
              margin: 0;
              padding: 32px;
              font-family: Segoe UI, sans-serif;
              background: #eef3ff;
              color: #23304f;
            }
            .card {
              max-width: 760px;
              margin: 0 auto;
              padding: 24px 28px;
              border-radius: 18px;
              background: #fff;
              box-shadow: 0 12px 40px rgba(34, 58, 119, 0.14);
            }
            code {
              padding: 2px 6px;
              border-radius: 8px;
              background: #edf2ff;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Renderer build was not found</h1>
            <p>Run <code>npm run build:renderer</code> or start the app with <code>npm start</code>.</p>
          </div>
        </body>
      </html>
    `);
    mainWindow.loadURL(`data:text/html;charset=utf-8,${errorHtml}`).catch((error) => {
      writeStartupLog("loadURL fallback threw an error.", {
        message: error?.message || String(error),
      });
    });
    return;
  }

  mainWindow.loadFile(rendererEntryPath).catch((error) => {
    writeStartupLog("loadFile threw an error.", {
      message: error?.message || String(error),
      rendererEntryPath,
    });
  });
}

function createHiddenWorkerWindow(options = {}) {
  const workerDefaults = {
    show: false,
    width: 1180,
    height: 860,
    autoHideMenuBar: true,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: ROLLERCOIN_PARTITION,
    },
  };

  return new BrowserWindow({
    ...workerDefaults,
    ...options,
    webPreferences: {
      ...workerDefaults.webPreferences,
      ...(options.webPreferences || {}),
    },
  });
}

async function readRollercoinCookies(session) {
  const cookies = await session.cookies.get({ url: "https://rollercoin.com" });
  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

  return {
    cookieHeader,
    cookieCount: cookies.length,
    hasSessionCookie: cookies.some((cookie) =>
      /sid|session|token|auth|connect/i.test(cookie.name),
    ),
  };
}

async function readRollercoinAuthSessionInfo() {
  const authSession = session.fromPartition(ROLLERCOIN_PARTITION);
  return readRollercoinCookies(authSession);
}

function openRollercoinAuthWindow() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const authSession = session.fromPartition(ROLLERCOIN_PARTITION);
    attachRollercoinAssetRequestHeaders(authSession);

    const finishResolve = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const authWindow = new BrowserWindow({
      width: 1100,
      height: 800,
      show: true,
      autoHideMenuBar: true,
      title: "RollerCoin Login",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: ROLLERCOIN_PARTITION,
      },
    });

    authWindow.once("closed", async () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          }
          mainWindow.show();
          mainWindow.focus();
        } catch {
          // Ignore focus restoration issues.
        }
      }

      try {
        const sessionInfo = await readRollercoinCookies(authSession);
        writeStartupLog("Auth window closed.", {
          cookieCount: sessionInfo.cookieCount,
          hasSessionCookie: sessionInfo.hasSessionCookie,
        });
        finishResolve(sessionInfo);
      } catch (error) {
        writeStartupLog("Failed to read auth session cookies after closing login window.", {
          message: error?.message || String(error),
        });
        finishReject(error);
      }
    });

    authWindow.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        writeStartupLog("Auth window failed to load.", {
          errorCode,
          errorDescription,
          validatedURL,
        });
      },
    );

    authWindow.webContents.on("render-process-gone", (_event, details) => {
      writeStartupLog("Auth window render process gone.", details);
      finishReject(new Error(`Login window crashed: ${details?.reason || "unknown reason"}`));
      if (!authWindow.isDestroyed()) {
        authWindow.close();
      }
    });

    authWindow.loadURL("https://rollercoin.com/sign-in").catch((error) => {
      writeStartupLog("Auth window loadURL failed.", {
        message: error?.message || String(error),
      });
      finishReject(error);
      if (!authWindow.isDestroyed()) {
        authWindow.close();
      }
    });
  });
}

function parseWorkerResult(raw) {
  if (!raw || typeof raw !== "object") {
    return { success: false, error: "Worker returned empty response." };
  }
  return raw;
}

function runWithTimeout(promise, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    Promise.resolve(promise)
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

async function closeWindowGracefully(windowRef, timeoutMs = 1500) {
  if (!windowRef || windowRef.isDestroyed()) return;

  const closedPromise = new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    windowRef.once("closed", finish);
    setTimeout(finish, timeoutMs);
  });

  try {
    windowRef.close();
    await closedPromise;
  } catch {
    if (!windowRef.isDestroyed()) {
      windowRef.destroy();
    }
  }
}

function emitMarketProgress(sender, requestId, message, level = "info", extra = {}) {
  if (!sender || typeof sender.isDestroyed !== "function" || sender.isDestroyed()) {
    return;
  }

  const normalizedLevel = typeof level === "string" ? level : "info";
  const senderKey =
    typeof sender.id === "number"
      ? String(sender.id)
      : typeof sender.getOSProcessId === "function"
        ? String(sender.getOSProcessId())
        : "unknown";
  const progressKey = `${senderKey}:${requestId || "no-request"}`;
  const now = Date.now();
  if (normalizedLevel === "info") {
    const previous = marketProgressState.get(progressKey);
    if (previous && now - previous < MARKET_PROGRESS_INFO_THROTTLE_MS) {
      return;
    }
    marketProgressState.set(progressKey, now);
  }

  try {
    sender.send("rollercoin-market-progress", {
      requestId: requestId || null,
      level: normalizedLevel,
      message,
      timestamp: now,
      ...extra,
    });
  } catch {
    // Ignore renderer dispatch errors.
  }
}

function clearMarketProgressState(sender, requestId) {
  if (!requestId || !sender) return;

  const senderKey =
    typeof sender.id === "number"
      ? String(sender.id)
      : typeof sender.getOSProcessId === "function"
        ? String(sender.getOSProcessId())
        : "unknown";
  marketProgressState.delete(`${senderKey}:${requestId}`);
}

function parseMaybeNumber(value) {
  if (value === null || value === undefined) return NaN;
  const normalized = String(value).replaceAll(" ", "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function firstFiniteNumber(values) {
  for (const value of values) {
    const parsed = parseMaybeNumber(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return NaN;
}

function normalizeMarketplaceApiPrice(value) {
  if (!Number.isFinite(value) || value < 0) return NaN;
  return value / 1000000;
}

function extractMarketplaceApiBonus(row) {
  const directBonusPercent = firstFiniteNumber([
    row.miner_bonus,
    row.percent_bonus,
    row.bonus_percent,
    row.bonus,
    getByPath(row, "price.miner_bonus"),
    getByPath(row, "item.miner_bonus"),
    getByPath(row, "item.percent_bonus"),
    getByPath(row, "item.bonus_percent"),
    getByPath(row, "item_info.miner_bonus"),
    getByPath(row, "item_info.percent_bonus"),
    getByPath(row, "item_info.bonus_percent"),
    getByPath(row, "miner.miner_bonus"),
    getByPath(row, "miner.percent_bonus"),
    getByPath(row, "miner.bonus_percent"),
    getByPath(row, "sale.miner_bonus"),
    getByPath(row, "sale.percent_bonus"),
    getByPath(row, "sale.bonus_percent"),
    getByPath(row, "product.miner_bonus"),
    getByPath(row, "product.percent_bonus"),
    getByPath(row, "product.bonus_percent"),
  ]);
  if (Number.isFinite(directBonusPercent)) {
    return directBonusPercent / 100;
  }

  const nestedBonusPercent = firstFiniteNumber([
    getByPath(row, "bonus.power_percent"),
    getByPath(row, "item.bonus.power_percent"),
    getByPath(row, "item_info.bonus.power_percent"),
    getByPath(row, "miner.bonus.power_percent"),
    getByPath(row, "sale.bonus.power_percent"),
    getByPath(row, "product.bonus.power_percent"),
  ]);

  return Number.isFinite(nestedBonusPercent) ? nestedBonusPercent / 100 : 0;
}

function normalizeMarketplaceApiPower(value) {
  if (!Number.isFinite(value) || value < 0) return NaN;
  return value / 1000000;
}

function extractMarketplaceMinerWidth(row) {
  const directWidth = firstFiniteNumber([
    row.width,
    row.size,
    row.slotSize,
    row.slot_size,
    row.cell_width,
    row.slots,
    getByPath(row, "item.width"),
    getByPath(row, "item.size"),
    getByPath(row, "item.slotSize"),
    getByPath(row, "item.slot_size"),
    getByPath(row, "item_info.width"),
    getByPath(row, "item_info.size"),
    getByPath(row, "item_info.slotSize"),
    getByPath(row, "item_info.slot_size"),
    getByPath(row, "product.width"),
    getByPath(row, "product.size"),
    getByPath(row, "product.slotSize"),
    getByPath(row, "product.slot_size"),
    getByPath(row, "miner.width"),
    getByPath(row, "miner.size"),
    getByPath(row, "sale.width"),
    getByPath(row, "sale.size"),
  ]);
  if (Number.isFinite(directWidth) && directWidth > 0) {
    return Math.floor(directWidth);
  }

  const textualCandidates = [
    row.width,
    row.size,
    row.slotSize,
    row.slot_size,
    getByPath(row, "item.width"),
    getByPath(row, "item.size"),
    getByPath(row, "item_info.width"),
    getByPath(row, "item_info.size"),
    getByPath(row, "product.width"),
    getByPath(row, "product.size"),
  ];
  for (const candidate of textualCandidates) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.trim().toLowerCase();
    if (!normalized) continue;
    if (["small", "s", "1x1", "1"].includes(normalized)) return 1;
    if (["large", "l", "2x1", "2"].includes(normalized)) return 2;
  }

  return null;
}

function buildMinerImageKeyFromName(name) {
  const text = String(name || "").trim();
  if (!text) return "";

  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['`"]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function buildMarketImageUrlFromName(name, imgVer) {
  const imageKey = buildMinerImageKeyFromName(name);
  if (!imageKey) return "";

  const suffix = Number.isFinite(Number(imgVer)) ? `?v=${Number(imgVer)}` : "";
  return `https://static.rollercoin.com/static/img/market/miners/${encodeURIComponent(imageKey)}.gif${suffix}`;
}

function buildMarketImageUrlFromFilename(filename, imgVer, templateUrl = "") {
  if (typeof filename !== "string" || !filename.trim()) return "";
  const safeFilename = filename.trim();

  const directCandidates = [];
  const versions = Number.isFinite(Number(imgVer)) ? [`?v=${Number(imgVer)}`] : [""];
  const exts = [".gif", ".png", ".webp"];
  const bases = [
    "https://static.rollercoin.com/static/img/market/miners/",
    "https://static.rollercoin.com/static/img/storage/miners/",
    "https://static.rollercoin.com/static/img/collections/miners/",
  ];

  bases.forEach((base) => {
    exts.forEach((ext) => {
      versions.forEach((suffix) => {
        directCandidates.push(`${base}${safeFilename}${ext}${suffix}`);
      });
    });
  });

  if (templateUrl) {
    try {
      const parsed = new URL(templateUrl);
      const extMatch = parsed.pathname.match(/\.([a-zA-Z0-9]+)$/);
      const ext = extMatch ? `.${extMatch[1]}` : ".png";
      parsed.pathname = parsed.pathname.replace(/[^/]+\.[a-zA-Z0-9]+$/, `${safeFilename}${ext}`);
      if (Number.isFinite(Number(imgVer))) {
        parsed.searchParams.set("v", String(Number(imgVer)));
      }
      directCandidates.unshift(parsed.toString());
    } catch {
      // Ignore malformed template URLs.
    }
  }

  return directCandidates[0] || "";
}

function buildMarketLevelBadgeUrl(level) {
  const numericLevel = Number(level);
  if (!Number.isFinite(numericLevel) || numericLevel < 0) return "";
  const displayLevel = Math.floor(numericLevel) + 1;
  return `https://rollercoin.com/static/img/storage/rarity_icons/level_${displayLevel}.png?v=1.0.0`;
}

function getByPath(obj, pathName) {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = pathName.split(".");
  let current = obj;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function normalizeRollercoinBasePowerPhs(value) {
  const parsed = firstFiniteNumber([value]);
  if (!Number.isFinite(parsed) || parsed < 0) return NaN;
  if (parsed >= 100000) return parsed / 1000000;
  return parsed;
}

function normalizeRollercoinBonusPercent(value) {
  const parsed = firstFiniteNumber([value]);
  if (!Number.isFinite(parsed) || parsed < 0) return NaN;
  if (parsed >= 1000000) return parsed / 10000;
  if (parsed >= 1000) return parsed / 100;
  return parsed;
}

function extractRollercoinCurrentPowerPayload(payload) {
  const root = payload && typeof payload === "object" ? (payload.data ?? payload) : null;
  if (!root || typeof root !== "object") {
    throw new Error("RollerCoin power API returned an invalid payload.");
  }

  const basePowerPhs = normalizeRollercoinBasePowerPhs(
    firstFiniteNumber([
      root.miners,
      root.miners_power,
      root.minersPower,
      root.mining_power,
      root.miningPower,
      getByPath(root, "power.miners"),
      getByPath(root, "power.miners_power"),
      getByPath(root, "power.minersPower"),
      getByPath(root, "user_power.miners"),
      getByPath(root, "user_power.miners_power"),
      getByPath(root, "miners.value"),
    ]),
  );
  const bonusPercent = normalizeRollercoinBonusPercent(
    firstFiniteNumber([
      root.bonus_percent,
      root.bonusPercent,
      root.total_bonus_percent,
      root.totalBonusPercent,
      getByPath(root, "bonus.percent"),
      getByPath(root, "bonus.bonus_percent"),
      getByPath(root, "power.bonus_percent"),
      getByPath(root, "user_power.bonus_percent"),
      getByPath(root, "user_power.bonusPercent"),
    ]),
  );

  if (!Number.isFinite(basePowerPhs) || basePowerPhs < 0) {
    throw new Error("RollerCoin power API did not provide a valid miners base power.");
  }
  if (!Number.isFinite(bonusPercent) || bonusPercent < 0) {
    throw new Error("RollerCoin power API did not provide a valid bonus percent.");
  }

  return {
    basePowerPhs,
    bonusPercent,
  };
}

function parseRoomConfigReference(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    const segments = parsed.pathname.split("/").filter(Boolean);
    return segments[segments.length - 1] || "";
  } catch {
    return raw.replace(/^\/+|\/+$/g, "").split("/").pop() || "";
  }
}

function buildRollercoinRoomConfigEndpoint(roomConfigRef = "") {
  const roomConfigId = parseRoomConfigReference(roomConfigRef);
  return roomConfigId
    ? `https://rollercoin.com/api/game/room-config/${encodeURIComponent(roomConfigId)}`
    : "https://rollercoin.com/api/game/room-config/";
}

function extractRollercoinProfileId(payload) {
  const root = payload && typeof payload === "object" ? (payload.data ?? payload) : null;
  if (!root || typeof root !== "object") {
    throw new Error("RollerCoin profile API returned an invalid payload.");
  }

  const profileId = [
    root.id,
    root._id,
    root.user_id,
    root.userId,
    getByPath(root, "user.id"),
    getByPath(root, "user._id"),
    getByPath(root, "user.user_id"),
    getByPath(root, "profile.id"),
    getByPath(root, "profile._id"),
  ]
    .map((value) => (value === null || value === undefined ? "" : String(value).trim()))
    .find(Boolean) || "";

  if (!profileId) {
    throw new Error("RollerCoin profile API did not provide a valid profile id.");
  }

  return profileId;
}

function extractRollercoinRoomMinersPayload(payload) {
  const root = payload && typeof payload === "object" ? (payload.data ?? payload) : null;
  if (!root || typeof root !== "object") {
    throw new Error("RollerCoin room-config API returned an invalid payload.");
  }

  const miners =
    (Array.isArray(root.miners) && root.miners) ||
    (Array.isArray(getByPath(root, "room.miners")) && getByPath(root, "room.miners")) ||
    (Array.isArray(getByPath(root, "config.miners")) && getByPath(root, "config.miners")) ||
    [];

  if (miners.length === 0) {
    throw new Error("RollerCoin room-config API returned no miners.");
  }

  const detectedRoomConfigId = [
    root.id,
    root._id,
    root.room_id,
    root.roomId,
    root.config_id,
    root.configId,
    getByPath(root, "room.id"),
    getByPath(root, "room._id"),
    getByPath(root, "room.room_id"),
    getByPath(root, "room.roomId"),
    getByPath(root, "config.id"),
    getByPath(root, "config._id"),
    getByPath(root, "config.room_id"),
    getByPath(root, "config.roomId"),
  ]
    .map((value) => (value === null || value === undefined ? "" : String(value).trim()))
    .find(Boolean) || "";

  return {
    miners,
    roomConfigId: detectedRoomConfigId,
  };
}

function isMinerLike(entry) {
  if (!entry || typeof entry !== "object") return false;
  const tokens = [
    entry.type,
    entry.itemType,
    entry.item_type,
    entry.category,
    entry.group,
    entry.kind,
    entry.tags,
    entry?.item?.type,
    entry?.item?.item_type,
    entry?.item_info?.type,
    entry?.product?.type,
    entry?.product?.item_type,
    getByPath(entry, "item.name.en"),
    getByPath(entry, "item_info.name.en"),
    getByPath(entry, "product.name.en"),
    getByPath(entry, "name.en"),
    getByPath(entry, "item.name"),
    getByPath(entry, "item_info.name"),
    getByPath(entry, "product.name"),
    entry.name,
    entry.title,
  ]
    .flat()
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  return tokens.some((token) => token.includes("miner"));
}

function extractRows(payload) {
  const root = payload && typeof payload === "object" ? (payload.data ?? payload) : null;
  if (!root || typeof root !== "object") return [];

  const directCandidates = [
    root.items,
    root.rows,
    root.results,
    root.sale_orders,
    root.orders,
    root.list,
  ].filter(Array.isArray);

  for (const candidate of directCandidates) {
    if (candidate.length > 0 && candidate.every((entry) => entry && typeof entry === "object")) {
      return candidate;
    }
  }

  const queue = [root];
  const seen = new WeakSet();
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);

    if (Array.isArray(node)) {
      if (node.length > 0 && node.every((entry) => entry && typeof entry === "object")) {
        const hasPrice = node.some((entry) =>
          Number.isFinite(
            firstFiniteNumber([
              entry.price,
              entry.cost,
              entry.amount,
              entry?.item?.price,
              entry?.item_info?.price,
              entry?.product?.price,
            ]),
          ),
        );
        if (hasPrice) return node;
      }
      node.forEach((entry) => {
        if (entry && typeof entry === "object") queue.push(entry);
      });
      continue;
    }

    Object.values(node).forEach((entry) => {
      if (entry && typeof entry === "object") queue.push(entry);
    });
  }

  return [];
}

function extractRowsTotalCount(payload) {
  const root = payload && typeof payload === "object" ? (payload.data ?? payload) : null;
  if (!root || typeof root !== "object") return null;

  const directCandidates = [
    root.total,
    root.count,
    root.total_count,
    root.totalCount,
    getByPath(root, "meta.total"),
    getByPath(root, "meta.count"),
    getByPath(root, "pagination.total"),
    getByPath(root, "pagination.count"),
    getByPath(root, "pager.total"),
    getByPath(root, "pager.count"),
  ];

  for (const candidate of directCandidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }

  return null;
}

function normalizeFirstOffer(row) {
  const id =
    row.id ||
    row.item_id ||
    row.offer_id ||
    row.order_id ||
    getByPath(row, "item.id") ||
    getByPath(row, "item_info.id") ||
    getByPath(row, "product.id") ||
    "";

  const name =
    getByPath(row, "item.name.en") ||
    getByPath(row, "item_info.name.en") ||
    getByPath(row, "product.name.en") ||
    getByPath(row, "name.en") ||
    getByPath(row, "item.name") ||
    getByPath(row, "item_info.name") ||
    getByPath(row, "product.name") ||
    row.name ||
    row.title ||
    "Marketplace miner";

  const rawPrice = firstFiniteNumber([
    row.price,
    row.cost,
    row.amount,
    row.price_value,
    row.rlt_price,
    getByPath(row, "price.value"),
    getByPath(row, "item.price"),
    getByPath(row, "item_info.price"),
    getByPath(row, "product.price"),
  ]);
  const price = normalizeMarketplaceApiPrice(rawPrice);

  const rawPower = firstFiniteNumber([
    row.power,
    row.hashrate,
    row.hash_rate,
    getByPath(row, "item.power"),
    getByPath(row, "item_info.power"),
    getByPath(row, "product.power"),
  ]);
  const power = normalizeMarketplaceApiPower(rawPower);

  const bonusPercent = extractMarketplaceApiBonus(row);
  const filename =
    row.filename ||
    getByPath(row, "item.filename") ||
    getByPath(row, "item_info.filename") ||
    getByPath(row, "product.filename") ||
    "";
  const imgVer =
    row.img_ver ||
    getByPath(row, "item.img_ver") ||
    getByPath(row, "item_info.img_ver") ||
    getByPath(row, "product.img_ver") ||
    null;
  const level =
    row.level ||
    getByPath(row, "item.level") ||
    getByPath(row, "item_info.level") ||
    getByPath(row, "product.level") ||
    null;
  const sourceImageUrl =
    row.image_url ||
    row.image ||
    getByPath(row, "item.image") ||
    getByPath(row, "item_info.image") ||
    getByPath(row, "product.image") ||
    "";
  const preferredImageUrl =
    sourceImageUrl && !String(sourceImageUrl).toLowerCase().includes("one_horse_power")
      ? sourceImageUrl
      : buildMarketImageUrlFromFilename(filename, imgVer, sourceImageUrl) ||
        buildMarketImageUrlFromName(name, imgVer) ||
        sourceImageUrl;

  return {
    id: String(id || ""),
    name: String(name || "Marketplace miner"),
    price,
    power,
    bonus_percent: Number.isFinite(bonusPercent) ? bonusPercent : 0,
    level: Number.isFinite(Number(level)) ? Number(level) : null,
    width: extractMarketplaceMinerWidth(row),
    currency: row.currency || row.price_currency || getByPath(row, "price.currency") || "RLT",
    source: "marketplace-buy-first-offer",
    image_url: preferredImageUrl,
    level_badge_url: buildMarketLevelBadgeUrl(level),
    raw: row,
  };
}

function buildMarketplaceOfferIdentityKey(offer) {
  if (!offer || typeof offer !== "object") return "";
  const id = offer.id ? String(offer.id) : "";
  const name = String(offer.name || "").trim().toLowerCase();
  const price = Number.isFinite(Number(offer.price)) ? Number(offer.price) : "na";
  const power = Number.isFinite(Number(offer.power)) ? Number(offer.power) : "na";
  const width = Number.isFinite(Number(offer.width)) ? Math.floor(Number(offer.width)) : "na";
  const level = Number.isFinite(Number(offer.level)) ? Math.floor(Number(offer.level)) : "na";
  return id || `${name}:${price}:${power}:${width}:${level}`;
}

function choosePreferredMarketplaceOffer(existingOffer, nextOffer) {
  if (!existingOffer) return nextOffer;
  if (!nextOffer) return existingOffer;

  const existingBonus = Number(existingOffer.bonus_percent) || 0;
  const nextBonus = Number(nextOffer.bonus_percent) || 0;
  if (nextBonus !== existingBonus) {
    return nextBonus > existingBonus ? nextOffer : existingOffer;
  }

  const existingPrice = Number(existingOffer.price);
  const nextPrice = Number(nextOffer.price);
  if (Number.isFinite(nextPrice) && (!Number.isFinite(existingPrice) || nextPrice < existingPrice)) {
    return nextOffer;
  }

  const existingHasImage = Boolean(existingOffer.image_url);
  const nextHasImage = Boolean(nextOffer.image_url);
  if (nextHasImage && !existingHasImage) {
    return nextOffer;
  }

  return existingOffer;
}

function upsertMarketplaceOffer(offers, offerIndexByKey, offer) {
  const dedupeKey = buildMarketplaceOfferIdentityKey(offer);
  if (!dedupeKey) return false;

  const existingIndex = offerIndexByKey.get(dedupeKey);
  if (!Number.isFinite(existingIndex)) {
    offerIndexByKey.set(dedupeKey, offers.length);
    offers.push(offer);
    return true;
  }

  const preferredOffer = choosePreferredMarketplaceOffer(offers[existingIndex], offer);
  offers[existingIndex] = preferredOffer;
  return preferredOffer === offer;
}

function buildMarketplaceSaleOrdersUrl(page, profile = {}) {
  const limit =
    Number.isFinite(Number(profile.limit)) && Number(profile.limit) > 0
      ? Math.floor(Number(profile.limit))
      : MARKET_PAGE_LIMIT;
  const includeFilters = Boolean(profile.includeFilters);
  const params = new URLSearchParams();
  params.set("currency", "RLT");
  params.set("itemType", "miner");
  params.set("sort[field]", "date");
  params.set("sort[order]", "-1");
  params.set("skip", String((page - 1) * limit));
  params.set("limit", String(limit));
  if (includeFilters) {
    params.set("filter[0][name]", "price");
    params.set("filter[0][min]", "0");
    params.set("filter[0][max]", "3439000000");
    params.set("filter[1][name]", "power");
    params.set("filter[1][min]", "1");
    params.set("filter[1][max]", "1380000000");
    params.set("filter[2][name]", "miner_bonus");
    params.set("filter[2][min]", "0");
    params.set("filter[2][max]", "70");
  }
  return `https://rollercoin.com/api/marketplace/buy/sale-orders?${params.toString()}`;
}

function getMarketplaceQueryProfiles(defaultLimit = MARKET_PAGE_LIMIT) {
  return [
    { label: "basic-limit100", limit: defaultLimit, includeFilters: false },
    { label: "filtered-limit12", limit: 12, includeFilters: true },
    { label: "filtered-limit100", limit: defaultLimit, includeFilters: true },
    { label: "basic-limit12", limit: 12, includeFilters: false },
  ];
}

function normalizeAuthTokenValues(rawValue) {
  if (!rawValue) return [];

  const collected = [];
  const pushIfValid = (candidate) => {
    if (typeof candidate !== "string") return;
    const trimmed = candidate.trim().replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");
    if (!trimmed) return;
    if (/^Bearer\s+/i.test(trimmed)) {
      collected.push(trimmed);
      collected.push(trimmed.replace(/^Bearer\s+/i, ""));
      return;
    }
    collected.push(trimmed);
  };

  pushIfValid(rawValue);

  try {
    const parsed = JSON.parse(rawValue);
    const queue = [parsed];
    const seen = new WeakSet();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      if (typeof current === "string") {
        pushIfValid(current);
        continue;
      }
      if (Array.isArray(current)) {
        current.forEach((entry) => {
          if (typeof entry === "string") {
            pushIfValid(entry);
          } else if (entry && typeof entry === "object" && !seen.has(entry)) {
            seen.add(entry);
            queue.push(entry);
          }
        });
        continue;
      }
      if (typeof current === "object") {
        Object.entries(current).forEach(([key, entry]) => {
          if (/token|auth|jwt|access/i.test(String(key))) {
            if (typeof entry === "string") {
              pushIfValid(entry);
            } else if (entry && typeof entry === "object" && !seen.has(entry)) {
              seen.add(entry);
              queue.push(entry);
            }
          }
        });
      }
    }
  } catch {
    // Ignore non-JSON token payloads.
  }

  return [...new Set(collected)];
}

function buildAuthHeaderVariants(tokenValues = []) {
  const variants = [{ label: "cookie-only", headers: {} }];

  tokenValues.forEach((token) => {
    const clean = String(token || "").replace(/^Bearer\s+/i, "").trim();
    if (!clean) return;
    variants.push({ label: "authorization-bearer", headers: { Authorization: "Bearer " + clean } });
    variants.push({ label: "authorization-raw", headers: { Authorization: String(token) } });
    variants.push({ label: "x-access-token", headers: { "x-access-token": clean } });
    variants.push({ label: "x-auth-token", headers: { "x-auth-token": clean } });
    variants.push({ label: "token", headers: { token: clean } });
  });

  const uniqueVariants = [];
  const seen = new Set();
  variants.forEach((variant) => {
    const key = JSON.stringify(variant.headers || {});
    if (seen.has(key)) return;
    seen.add(key);
    uniqueVariants.push(variant);
  });

  return uniqueVariants.slice(0, 6);
}

async function readRollercoinAuthTokenValuesFromSession(authSession) {
  const worker = createHiddenWorkerWindow({
    width: 1180,
    height: 860,
    title: "RollerCoin Token Reader",
  });

  try {
    await runWithTimeout(
      worker.loadURL("https://rollercoin.com/marketplace/buy?itemType=miner"),
      10000,
      "Token reader bootstrap timeout (10s).",
    );

    const raw = await runWithTimeout(
      worker.webContents.executeJavaScript(
        `
        (() => {
          const tokenCandidates = [];
          const collect = (storageName, storage) => {
            try {
              for (let index = 0; index < storage.length; index += 1) {
                const key = storage.key(index);
                const value = storage.getItem(key);
                if (!value) continue;
                const lowerKey = String(key).toLowerCase();
                const looksLikeTokenKey = /token|auth|jwt|access/.test(lowerKey);
                const looksLikeJwt = /^eyJ[A-Za-z0-9_-]+\\./.test(value);
                if (looksLikeTokenKey || looksLikeJwt) {
                  tokenCandidates.push({ key, value, storage: storageName });
                }
              }
            } catch {
              // Ignore storage read failures.
            }
          };

          collect("localStorage", localStorage);
          collect("sessionStorage", sessionStorage);

          return {
            href: location.href,
            tokenCandidates,
          };
        })();
        `,
        true,
      ),
      5000,
      "Token reader executeJavaScript timeout (5s).",
    );

    const tokenValues = [];
    const seenTokens = new Set();
    const tokenCandidates =
      raw && typeof raw === "object" && Array.isArray(raw.tokenCandidates) ? raw.tokenCandidates : [];

    tokenCandidates.forEach((item) => {
      normalizeAuthTokenValues(item?.value).forEach((value) => {
        if (!value || seenTokens.has(value)) return;
        seenTokens.add(value);
        tokenValues.push(value);
      });
    });

    return {
      href: raw?.href || worker.webContents.getURL(),
      tokenValues,
    };
  } finally {
    await closeWindowGracefully(worker);
  }
}

function requestJsonWithCookieHeader(url, cookieHeader, options = {}) {
  const timeoutMs =
    Number.isFinite(Number(options?.timeoutMs)) && Number(options.timeoutMs) > 0
      ? Math.floor(Number(options.timeoutMs))
      : MARKET_REQUEST_TIMEOUT_MS;
  const extraHeaders =
    options && typeof options.headers === "object" && !Array.isArray(options.headers)
      ? options.headers
      : {};

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        agent: MARKET_HTTPS_AGENT,
        headers: {
          Accept: "application/json, text/plain, */*",
          Cookie: cookieHeader,
          "Cache-Control": "no-cache",
          Origin: "https://rollercoin.com",
          Pragma: "no-cache",
          Referer: "https://rollercoin.com/marketplace/buy?itemType=miner",
          "User-Agent": "Mozilla/5.0 RollerCoinCalculator",
          ...extraHeaders,
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(body);
          } catch {
            // Keep non-JSON payload as raw text.
          }

          resolve({
            statusCode: res.statusCode || 0,
            body,
            json,
          });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("Request timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

function parseCookieHeader(cookieHeader) {
  if (typeof cookieHeader !== "string" || !cookieHeader.trim()) return [];
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex <= 0) return null;
      const name = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (!name) return null;
      return { name, value };
    })
    .filter(Boolean);
}

async function syncCookieHeaderToSession(cookieHeader, targetSession) {
  const cookiePairs = parseCookieHeader(cookieHeader);
  for (const cookie of cookiePairs) {
    const cookiePayload = {
      url: "https://rollercoin.com",
      name: cookie.name,
      value: cookie.value,
      path: "/",
      secure: true,
    };

    if (!cookie.name.startsWith("__Host-")) {
      cookiePayload.domain = ".rollercoin.com";
    }

    try {
      await targetSession.cookies.set(cookiePayload);
    } catch {
      // Ignore individual cookie set failures, the browser session may already contain valid cookies.
    }
  }
}

async function fetchMarketMinersViaDirectApi(preferredCookieHeader = "", progress = null, options = {}) {
  const authSession = session.fromPartition(ROLLERCOIN_PARTITION);
  const sessionInfo = await readRollercoinCookies(authSession);
  const normalizedOptions = normalizeMarketFetchOptions(options);
  const effectiveMaxPages = normalizedOptions.maxPages;
  const cookieHeader =
    typeof preferredCookieHeader === "string" && preferredCookieHeader.trim()
      ? preferredCookieHeader.trim()
      : sessionInfo.cookieHeader;

  const attempts = [];
  if (progress) {
    progress(
      `Direct market API mode (${normalizedOptions.refreshMode}). Session cookies=${sessionInfo.cookieCount}, using cookie source=` +
        `${preferredCookieHeader && preferredCookieHeader.trim() ? "manual-input" : "auth-partition"}.`,
    );
  }

  if (!cookieHeader) {
    return {
      success: false,
      unauthorized: true,
      hardUnauthorized: true,
      error: "No RollerCoin session cookie available. Log in again or paste a fresh cookie.",
      attempts,
    };
  }

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const hasValidNormalizedOffer = (row) =>
    Number.isFinite(row?.price) &&
    row.price > 0 &&
    Number.isFinite(row?.power) &&
    row.power > 0;
  const queryProfiles = getMarketplaceQueryProfiles();
  let selectedProfile = null;
  let sawUnauthorizedStatus = false;
  let sawAnyProbeOk = false;
  let sawAnyProbeJson = false;
  let sawAnyProbeRows = false;
  for (const profile of queryProfiles) {
    const url = buildMarketplaceSaleOrdersUrl(1, profile);
    if (progress) {
      progress(`Direct API probe (${profile.label})...`);
    }

    let response;
    try {
      response = await requestJsonWithCookieHeader(url, cookieHeader, {
        timeoutMs: MARKET_PROBE_TIMEOUT_MS,
      });
    } catch (error) {
      attempts.push({
        step: "direct-probe-error",
        profile: profile.label,
        url,
        error: String(error),
      });
      continue;
    }

    const rows = response.json && typeof response.json === "object" ? extractRows(response.json) : [];
    attempts.push({
      step: "direct-probe-response",
      profile: profile.label,
      url,
      status: response.statusCode,
      rows: rows.length,
    });

    if (response.statusCode === 401 || response.statusCode === 403) {
      sawUnauthorizedStatus = true;
    }
    if (response.statusCode >= 200 && response.statusCode < 300) {
      sawAnyProbeOk = true;
    }
    if (response.json && typeof response.json === "object") {
      sawAnyProbeJson = true;
    }
    if (rows.length > 0) {
      sawAnyProbeRows = true;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      continue;
    }
    if (!response.json || typeof response.json !== "object" || rows.length === 0) {
      continue;
    }

    const minerRows = rows.filter((row) => isMinerLike(row));
    const candidateRows = minerRows.length > 0 ? minerRows : rows;
    const hasValidPreview = candidateRows
      .slice(0, 5)
      .some((row) => hasValidNormalizedOffer(normalizeFirstOffer(row)));

    if (!hasValidPreview) {
      continue;
    }

    selectedProfile = profile;
    break;
  }

  if (!selectedProfile) {
    return {
      success: false,
      unauthorized: sawUnauthorizedStatus,
      hardUnauthorized: sawUnauthorizedStatus,
      error: sawUnauthorizedStatus
        ? "RollerCoin rejected the direct market API request. Session is not authorized."
        : "Direct market API probe returned no parseable miner offers.",
      diagnostics: {
        sawUnauthorizedStatus,
        sawAnyProbeOk,
        sawAnyProbeJson,
        sawAnyProbeRows,
      },
      attempts,
    };
  }

  if (progress) {
    progress(`Direct API selected query profile: ${selectedProfile.label}.`);
  }

  const marketplaceOffers = [];
  const marketplaceOfferIndexByKey = new Map();
  const seenOfferKeys = new Set();
  const seenPageFirstKeys = new Set();
  const pageFailureCounts = new Map();
  let nextPage = 1;
  let pageBatchSize = MARKET_DIRECT_PAGE_BATCH_SIZE;
  let recoveryPagesRemaining = 0;
  let shouldStopPaging = false;
  let stagnantPageCount = 0;
  let partialSuccessWarning = "";

  const fetchPageWithRetries = async (page, url) => {
    for (let attempt = 1; attempt <= MARKET_PAGE_RETRY_LIMIT; attempt += 1) {
      const requestUrl = `${url}${url.includes("?") ? "&" : "?"}_=${page}-${attempt}-${Date.now()}`;

      try {
        const response = await requestJsonWithCookieHeader(requestUrl, cookieHeader, {
          timeoutMs: MARKET_REQUEST_TIMEOUT_MS + (attempt - 1) * 1500,
        });
        const shouldRetry =
          attempt < MARKET_PAGE_RETRY_LIMIT &&
          (
            response.statusCode === 429 ||
            response.statusCode >= 500 ||
            (response.statusCode >= 200 &&
              response.statusCode < 300 &&
              (!response.json || typeof response.json !== "object"))
          );

        attempts.push({
          step: shouldRetry ? "direct-page-retry-scheduled" : "direct-page-fetch-finished",
          page,
          attempt,
          url: requestUrl,
          status: response.statusCode,
        });

        if (shouldRetry) {
          await delay(350 * attempt + (page % 3) * 120);
          continue;
        }

        return { page, url: requestUrl, response };
      } catch (error) {
        attempts.push({
          step: "direct-page-request-attempt-error",
          page,
          attempt,
          url: requestUrl,
          error: String(error),
        });

        if (attempt < MARKET_PAGE_RETRY_LIMIT) {
          await delay(350 * attempt + (page % 3) * 120);
          continue;
        }

        return { page, url: requestUrl, error: String(error) };
      }
    }

    return { page, url, error: "Page retry limit exhausted." };
  };

  while (nextPage <= effectiveMaxPages && !shouldStopPaging) {
    const batchStartPage = nextPage;
    const batchPages = [];
    for (
      let page = batchStartPage;
      page < batchStartPage + pageBatchSize && page <= effectiveMaxPages;
      page += 1
    ) {
      batchPages.push({ page, url: buildMarketplaceSaleOrdersUrl(page, selectedProfile) });
    }

    if (batchPages.length === 0) {
      break;
    }

    if (progress) {
      const firstPage = batchPages[0].page;
      const lastPage = batchPages[batchPages.length - 1].page;
      progress(
        firstPage === lastPage
          ? `Direct API request for page ${firstPage}...`
          : `Direct API request for pages ${firstPage}-${lastPage}...`,
      );
    }

    const batchResults = await Promise.all(
      batchPages.map(({ page, url }) => fetchPageWithRetries(page, url)),
    );
    batchResults.sort((left, right) => left.page - right.page);

    const failedPages = [];

    for (const result of batchResults) {
      const { page, url, response, error } = result;
      if (error) {
        const failureCount = (pageFailureCounts.get(page) || 0) + 1;
        pageFailureCounts.set(page, failureCount);
        failedPages.push(page);
        attempts.push({
          step: "direct-page-request-error",
          page,
          url,
          error,
          failureCount,
          keptOffers: marketplaceOffers.length,
        });
        continue;
      }

      attempts.push({ step: "direct-page-response", page, url, status: response.statusCode });
      if (response.statusCode === 401 || response.statusCode === 403) {
        if (marketplaceOffers.length === 0) {
          return {
            success: false,
            unauthorized: true,
            hardUnauthorized: true,
            error: "RollerCoin rejected the market API request. Session is not authorized.",
            attempts,
          };
        }

        const failureCount = (pageFailureCounts.get(page) || 0) + 1;
        pageFailureCounts.set(page, failureCount);
        failedPages.push(page);
        attempts.push({
          step: "direct-page-response-deferred",
          page,
          status: response.statusCode,
          failureCount,
          keptOffers: marketplaceOffers.length,
        });
        continue;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        const failureCount = (pageFailureCounts.get(page) || 0) + 1;
        pageFailureCounts.set(page, failureCount);
        failedPages.push(page);
        attempts.push({
          step: "direct-page-non-ok-deferred",
          page,
          status: response.statusCode,
          failureCount,
          keptOffers: marketplaceOffers.length,
        });
        continue;
      }

      if (!response.json || typeof response.json !== "object") {
        const failureCount = (pageFailureCounts.get(page) || 0) + 1;
        pageFailureCounts.set(page, failureCount);
        failedPages.push(page);
        attempts.push({
          step: "direct-page-non-json-deferred",
          page,
          status: response.statusCode,
          failureCount,
          keptOffers: marketplaceOffers.length,
        });
        continue;
      }

      const rows = extractRows(response.json);
      attempts.push({ step: "direct-page-rows", page, rows: rows.length });
      if (rows.length === 0) {
        shouldStopPaging = true;
        break;
      }

      const minerRows = rows.filter((row) => isMinerLike(row));
      const candidateRows = minerRows.length > 0 ? minerRows : rows;
      const normalizedRows = candidateRows
        .map((row) => normalizeFirstOffer(row))
        .filter((row) => hasValidNormalizedOffer(row));
      const firstRow = normalizedRows[0] || null;
      const pageFirstKey = firstRow
        ? buildMarketplaceOfferIdentityKey(firstRow)
        : `page-${page}-empty`;

      if (seenPageFirstKeys.has(pageFirstKey)) {
        stagnantPageCount += 1;
        attempts.push({
          step: "direct-page-repeat",
          page,
          stagnantPageCount,
          totalOffers: marketplaceOffers.length,
        });

        if (stagnantPageCount >= 3) {
          shouldStopPaging = true;
          partialSuccessWarning =
            partialSuccessWarning ||
            "Direct market API stopped after several repeated pages; using the miners loaded successfully.";
          attempts.push({
            step: "direct-page-repeat-stop",
            page,
            stagnantPageCount,
            totalOffers: marketplaceOffers.length,
          });
          break;
        }

        continue;
      }

      seenPageFirstKeys.add(pageFirstKey);

      let addedRows = 0;
      normalizedRows.forEach((row) => {
        const normalizedRow = {
          ...row,
          source: "marketplace-buy-direct-api",
        };
        const dedupeKey = buildMarketplaceOfferIdentityKey(normalizedRow);
        if (!dedupeKey) return;
        const existedBefore = seenOfferKeys.has(dedupeKey);
        seenOfferKeys.add(dedupeKey);
        const insertedOrImproved = upsertMarketplaceOffer(
          marketplaceOffers,
          marketplaceOfferIndexByKey,
          normalizedRow,
        );
        if (!existedBefore || insertedOrImproved) {
          addedRows += 1;
        }
      });

      pageFailureCounts.delete(page);
      attempts.push({
        step: "direct-page-added",
        page,
        normalized: normalizedRows.length,
        added: addedRows,
        totalOffers: marketplaceOffers.length,
      });

      if (progress) {
        progress(
          `Direct API page ${page}: rows=${rows.length}, normalized=${normalizedRows.length}, added=${addedRows}, total=${marketplaceOffers.length}.`,
        );
      }

      stagnantPageCount = addedRows === 0 ? stagnantPageCount + 1 : 0;
      if (stagnantPageCount >= 3) {
        shouldStopPaging = true;
        partialSuccessWarning =
          partialSuccessWarning ||
          "Direct market API stopped after several pages without new miners; using the miners loaded successfully.";
        attempts.push({
          step: "direct-page-stagnant-stop",
          page,
          stagnantPageCount,
          totalOffers: marketplaceOffers.length,
        });
        break;
      }

      if (rows.length < selectedProfile.limit || candidateRows.length < selectedProfile.limit) {
        shouldStopPaging = true;
        break;
      }
    }

    if (!shouldStopPaging && failedPages.length > 0) {
      const uniqueFailedPages = [...new Set(failedPages)].sort((left, right) => left - right);
      const highestFailureCount = Math.max(
        ...uniqueFailedPages.map((page) => pageFailureCounts.get(page) || 0),
      );

      attempts.push({
        step: "direct-page-requeue",
        pages: uniqueFailedPages,
        highestFailureCount,
        nextBatchSize: 1,
        recoveryPagesRemaining: Math.max(2, 2 + highestFailureCount),
      });

      if (highestFailureCount >= MARKET_PAGE_RETRY_LIMIT + 1) {
        shouldStopPaging = true;
        partialSuccessWarning =
          partialSuccessWarning ||
          "Direct market API stopped after several page failures; using the miners loaded before the block.";
        attempts.push({
          step: "direct-page-requeue-stop",
          pages: uniqueFailedPages,
          keptOffers: marketplaceOffers.length,
        });
        break;
      }

      pageBatchSize = 1;
      recoveryPagesRemaining = Math.max(recoveryPagesRemaining, 2 + highestFailureCount);
      nextPage = uniqueFailedPages[0];
      await delay(400 + highestFailureCount * 150);
      continue;
    }

    if (pageBatchSize === 1) {
      recoveryPagesRemaining = Math.max(0, recoveryPagesRemaining - 1);
      if (recoveryPagesRemaining === 0) {
        pageBatchSize = MARKET_DIRECT_PAGE_BATCH_SIZE;
        attempts.push({
          step: "direct-page-batch-restored",
          restoredBatchSize: pageBatchSize,
          nextPage: batchStartPage + batchPages.length,
          totalOffers: marketplaceOffers.length,
        });
      }
    }

    nextPage = batchStartPage + batchPages.length;
  }

  if (marketplaceOffers.length === 0) {
    return {
      success: false,
      error: "Direct market API returned no parseable miner offers.",
      attempts,
    };
  }

  return {
    success: true,
    endpoint: "https://rollercoin.com/api/marketplace/buy/sale-orders",
    refreshMode: normalizedOptions.refreshMode,
    maxPages: effectiveMaxPages,
    mode: "direct-market-api",
    sourcePath: partialSuccessWarning ? "paged-sale-orders-api-partial" : "paged-sale-orders-api",
    sourceScore: marketplaceOffers.length,
    selectedQueryProfile: selectedProfile.label,
    partial: Boolean(partialSuccessWarning),
    warning: partialSuccessWarning,
    marketplaceOffers,
    attempts,
  };
}

async function fetchMarketMinersViaBrowserSession(preferredCookieHeader = "", progress = null, options = {}) {
  const authSession = session.fromPartition(ROLLERCOIN_PARTITION);
  const normalizedOptions = normalizeMarketFetchOptions(options);
  const effectiveMaxPages = normalizedOptions.maxPages;
  if (typeof preferredCookieHeader === "string" && preferredCookieHeader.trim()) {
    await syncCookieHeaderToSession(preferredCookieHeader, authSession);
  }

  const sessionInfo = await readRollercoinCookies(authSession);
  if (progress) {
    progress(
      `Browser-session API mode (${normalizedOptions.refreshMode}). Session cookies=${sessionInfo.cookieCount}, using cookie source=` +
        `${preferredCookieHeader && preferredCookieHeader.trim() ? "manual-input+partition-sync" : "auth-partition"}.`,
    );
  }

  const worker = createHiddenWorkerWindow({
    width: 1180,
    height: 860,
    title: "RollerCoin Market API Worker",
  });

  try {
    await runWithTimeout(
      worker.loadURL("https://rollercoin.com/marketplace/buy?itemType=miner"),
      15000,
      "Browser-session market bootstrap timeout (15s).",
    );
    if (progress) {
      progress(`Browser-session page loaded: ${worker.webContents.getURL()}`, "info");
    }

    try {
      const bootstrapInfo = await runWithTimeout(
        worker.webContents.executeJavaScript(
          `(() => ({
            href: location.href,
            title: document.title,
            readyState: document.readyState,
            cookieNames: document.cookie
              .split(";")
              .map((entry) => entry.trim().split("=")[0])
              .filter(Boolean)
              .slice(0, 12),
            localStorageKeys: Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
              .filter(Boolean)
              .slice(0, 12),
          }))();`,
          true,
        ),
        5000,
        "Browser-session bootstrap inspection timeout (5s).",
      );

      if (progress && bootstrapInfo && typeof bootstrapInfo === "object") {
        progress(
          `Browser-session bootstrap: href=${bootstrapInfo.href || "-"}, ready=${bootstrapInfo.readyState || "-"}, ` +
            `cookies=${Array.isArray(bootstrapInfo.cookieNames) ? bootstrapInfo.cookieNames.join(", ") || "-" : "-"}, ` +
            `storageKeys=${Array.isArray(bootstrapInfo.localStorageKeys) ? bootstrapInfo.localStorageKeys.join(", ") || "-" : "-"}.`,
          "info",
        );
      }
    } catch (error) {
      if (progress) {
        progress(`Browser-session bootstrap inspection failed: ${error.message}`, "warn");
      }
    }

    const raw = await runWithTimeout(
      worker.webContents.executeJavaScript(
        `
        (async () => {
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const REQUEST_TIMEOUT_MS = 5000;
          const SCRIPT_DEADLINE_MS = 300000;
          const PAGE_RETRY_LIMIT = 3;
          const startedAt = Date.now();
          await sleep(1200);

          const pageLimit = ${MARKET_PAGE_LIMIT};
          const maxPages = ${effectiveMaxPages};
          const attempts = [];
          const offers = [];
          const offerIndexByKey = new Map();
          const seenOfferKeys = new Set();
          const tokenCandidates = [];
          const queryProfiles = [
            { label: "basic-limit100", limit: ${MARKET_PAGE_LIMIT}, includeFilters: false },
            { label: "filtered-limit12", limit: 12, includeFilters: true },
            { label: "filtered-limit100", limit: ${MARKET_PAGE_LIMIT}, includeFilters: true },
            { label: "basic-limit12", limit: 12, includeFilters: false },
          ];
          const imageTemplateUrl = (() => {
            const images = [...document.querySelectorAll("img[src]")];
            const matching = images.find((image) => /miner|storage|market/i.test(String(image.src || "")));
            return matching ? String(matching.src || "") : "";
          })();

          const buildOfferIdentityKey = (offer) => {
            if (!offer || typeof offer !== "object") return "";
            const id = offer.id ? String(offer.id) : "";
            const name = String(offer.name || "").trim().toLowerCase();
            const price = Number.isFinite(Number(offer.price)) ? Number(offer.price) : "na";
            const power = Number.isFinite(Number(offer.power)) ? Number(offer.power) : "na";
            const width = Number.isFinite(Number(offer.width)) ? Math.floor(Number(offer.width)) : "na";
            const level = Number.isFinite(Number(offer.level)) ? Math.floor(Number(offer.level)) : "na";
            return id || (name + ":" + price + ":" + power + ":" + width + ":" + level);
          };

          const choosePreferredOffer = (existingOffer, nextOffer) => {
            if (!existingOffer) return nextOffer;
            if (!nextOffer) return existingOffer;

            const existingBonus = Number(existingOffer.bonus_percent) || 0;
            const nextBonus = Number(nextOffer.bonus_percent) || 0;
            if (nextBonus !== existingBonus) {
              return nextBonus > existingBonus ? nextOffer : existingOffer;
            }

            const existingPrice = Number(existingOffer.price);
            const nextPrice = Number(nextOffer.price);
            if (Number.isFinite(nextPrice) && (!Number.isFinite(existingPrice) || nextPrice < existingPrice)) {
              return nextOffer;
            }

            const existingHasImage = Boolean(existingOffer.image_url);
            const nextHasImage = Boolean(nextOffer.image_url);
            if (nextHasImage && !existingHasImage) {
              return nextOffer;
            }

            return existingOffer;
          };

          const upsertOffer = (offersList, offerMap, offer) => {
            const dedupeKey = buildOfferIdentityKey(offer);
            if (!dedupeKey) return false;

            const existingIndex = offerMap.get(dedupeKey);
            if (!Number.isFinite(existingIndex)) {
              offerMap.set(dedupeKey, offersList.length);
              offersList.push(offer);
              return true;
            }

            const preferredOffer = choosePreferredOffer(offersList[existingIndex], offer);
            offersList[existingIndex] = preferredOffer;
            return preferredOffer === offer;
          };

          const fetchWithTimeout = async (url, options, timeoutMs) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
              return await fetch(url, {
                ...options,
                signal: controller.signal,
              });
            } finally {
              clearTimeout(timer);
            }
          };

          const withCacheBust = (url, page, attempt) => {
            const busted = new URL(url);
            busted.searchParams.set("_", String(page) + "-" + String(attempt) + "-" + String(Date.now()));
            return busted.toString();
          };

          const getByPath = (obj, path) => {
            if (!obj || typeof obj !== "object") return undefined;
            const parts = path.split(".");
            let current = obj;
            for (const part of parts) {
              if (!current || typeof current !== "object" || !(part in current)) return undefined;
              current = current[part];
            }
            return current;
          };

          const firstFiniteNumber = (values) => {
            for (const value of values) {
              if (value === null || value === undefined) continue;
              const parsed = Number(String(value).replace(/\\s+/g, "").replace(",", "."));
              if (Number.isFinite(parsed)) return parsed;
            }
            return NaN;
          };

          const extractWidth = (row) => {
            const directWidth = firstFiniteNumber([
              row.width,
              row.size,
              row.slotSize,
              row.slot_size,
              row.cell_width,
              row.slots,
              getByPath(row, "item.width"),
              getByPath(row, "item.size"),
              getByPath(row, "item.slotSize"),
              getByPath(row, "item.slot_size"),
              getByPath(row, "item_info.width"),
              getByPath(row, "item_info.size"),
              getByPath(row, "item_info.slotSize"),
              getByPath(row, "item_info.slot_size"),
              getByPath(row, "product.width"),
              getByPath(row, "product.size"),
              getByPath(row, "product.slotSize"),
              getByPath(row, "product.slot_size"),
              getByPath(row, "miner.width"),
              getByPath(row, "miner.size"),
              getByPath(row, "sale.width"),
              getByPath(row, "sale.size"),
            ]);
            if (Number.isFinite(directWidth) && directWidth > 0) {
              return Math.floor(directWidth);
            }
            const textualCandidates = [
              row.width,
              row.size,
              row.slotSize,
              row.slot_size,
              getByPath(row, "item.width"),
              getByPath(row, "item.size"),
              getByPath(row, "item_info.width"),
              getByPath(row, "item_info.size"),
              getByPath(row, "product.width"),
              getByPath(row, "product.size"),
            ];
            for (const candidate of textualCandidates) {
              if (typeof candidate !== "string") continue;
              const normalized = candidate.trim().toLowerCase();
              if (!normalized) continue;
              if (["small", "s", "1x1", "1"].includes(normalized)) return 1;
              if (["large", "l", "2x1", "2"].includes(normalized)) return 2;
            }
            return null;
          };

          const isMinerLike = (entry) => {
            if (!entry || typeof entry !== "object") return false;
            const tokens = [
              entry.type,
              entry.itemType,
              entry.item_type,
              entry.category,
              entry.group,
              entry.kind,
              entry.tags,
              entry?.item?.type,
              entry?.item?.item_type,
              entry?.item_info?.type,
              entry?.product?.type,
              entry?.product?.item_type,
              getByPath(entry, "item.name.en"),
              getByPath(entry, "item_info.name.en"),
              getByPath(entry, "product.name.en"),
              getByPath(entry, "name.en"),
              getByPath(entry, "item.name"),
              getByPath(entry, "item_info.name"),
              getByPath(entry, "product.name"),
              entry.name,
              entry.title,
            ]
              .flat()
              .filter(Boolean)
              .map((value) => String(value).toLowerCase());

            return tokens.some((token) => token.includes("miner"));
          };

          const extractRows = (payload) => {
            const root = payload && typeof payload === "object" ? (payload.data ?? payload) : null;
            if (!root || typeof root !== "object") return [];

            const directCandidates = [
              root.items,
              root.rows,
              root.results,
              root.sale_orders,
              root.orders,
              root.list,
            ].filter(Array.isArray);

            for (const candidate of directCandidates) {
              if (candidate.length > 0 && candidate.every((entry) => entry && typeof entry === "object")) {
                return candidate;
              }
            }

            const queue = [root];
            const seen = new WeakSet();
            while (queue.length > 0) {
              const node = queue.shift();
              if (!node || typeof node !== "object") continue;
              if (seen.has(node)) continue;
              seen.add(node);

              if (Array.isArray(node)) {
                if (node.length > 0 && node.every((entry) => entry && typeof entry === "object")) {
                  return node;
                }
                node.forEach((entry) => {
                  if (entry && typeof entry === "object") queue.push(entry);
                });
                continue;
              }

              Object.values(node).forEach((entry) => {
                if (entry && typeof entry === "object") queue.push(entry);
              });
            }

            return [];
          };

          const normalizeOffer = (row) => {
            const id =
              row.id ||
              row.item_id ||
              row.offer_id ||
              row.order_id ||
              getByPath(row, "item.id") ||
              getByPath(row, "item_info.id") ||
              getByPath(row, "product.id") ||
              "";

            const name =
              getByPath(row, "item.name.en") ||
              getByPath(row, "item_info.name.en") ||
              getByPath(row, "product.name.en") ||
              getByPath(row, "name.en") ||
              getByPath(row, "item.name") ||
              getByPath(row, "item_info.name") ||
              getByPath(row, "product.name") ||
              row.name ||
              row.title ||
              "Marketplace miner";

            const rawPrice = firstFiniteNumber([
              row.price,
              row.cost,
              row.amount,
              row.price_value,
              row.rlt_price,
              getByPath(row, "price.value"),
              getByPath(row, "item.price"),
              getByPath(row, "item_info.price"),
              getByPath(row, "product.price"),
            ]);
            const price = Number.isFinite(rawPrice) ? rawPrice / 1000000 : NaN;

            const rawPower = firstFiniteNumber([
              row.power,
              row.hashrate,
              row.hash_rate,
              getByPath(row, "item.power"),
              getByPath(row, "item_info.power"),
              getByPath(row, "product.power"),
            ]);
            const power = Number.isFinite(rawPower) ? rawPower / 1000000 : NaN;

            const directBonusPercent = firstFiniteNumber([
              row.miner_bonus,
              row.percent_bonus,
              row.bonus_percent,
              row.bonus,
              getByPath(row, "price.miner_bonus"),
              getByPath(row, "item.miner_bonus"),
              getByPath(row, "item.percent_bonus"),
              getByPath(row, "item.bonus_percent"),
              getByPath(row, "item_info.miner_bonus"),
              getByPath(row, "item_info.percent_bonus"),
              getByPath(row, "item_info.bonus_percent"),
              getByPath(row, "miner.miner_bonus"),
              getByPath(row, "miner.percent_bonus"),
              getByPath(row, "miner.bonus_percent"),
              getByPath(row, "sale.miner_bonus"),
              getByPath(row, "sale.percent_bonus"),
              getByPath(row, "sale.bonus_percent"),
              getByPath(row, "product.miner_bonus"),
              getByPath(row, "product.percent_bonus"),
              getByPath(row, "product.bonus_percent"),
            ]);
            const nestedBonusPercent = firstFiniteNumber([
              getByPath(row, "bonus.power_percent"),
              getByPath(row, "item.bonus.power_percent"),
              getByPath(row, "item_info.bonus.power_percent"),
              getByPath(row, "miner.bonus.power_percent"),
              getByPath(row, "sale.bonus.power_percent"),
              getByPath(row, "product.bonus.power_percent"),
            ]);
            const bonusPercent = Number.isFinite(directBonusPercent)
              ? directBonusPercent / 100
              : (Number.isFinite(nestedBonusPercent) ? nestedBonusPercent / 100 : 0);
            const filename =
              row.filename ||
              getByPath(row, "item.filename") ||
              getByPath(row, "item_info.filename") ||
              getByPath(row, "product.filename") ||
              "";
            const imgVer =
              row.img_ver ||
              getByPath(row, "item.img_ver") ||
              getByPath(row, "item_info.img_ver") ||
              getByPath(row, "product.img_ver") ||
              null;
            const level =
              row.level ||
              getByPath(row, "item.level") ||
              getByPath(row, "item_info.level") ||
              getByPath(row, "product.level") ||
              null;
            const buildLevelBadgeUrl = (rawLevel) => {
              const numericLevel = Number(rawLevel);
              if (!Number.isFinite(numericLevel) || numericLevel < 0) return "";
              return "https://rollercoin.com/static/img/storage/rarity_icons/level_" + (Math.floor(numericLevel) + 1) + ".png?v=1.0.0";
            };
            const buildImageUrlFromFilename = (file, version, template) => {
              if (!file) return "";
              const versions = Number.isFinite(Number(version)) ? ["?v=" + Number(version)] : [""];
              const exts = [".gif", ".png", ".webp"];
              const bases = [
                "https://static.rollercoin.com/static/img/market/miners/",
                "https://static.rollercoin.com/static/img/storage/miners/",
                "https://static.rollercoin.com/static/img/collections/miners/",
              ];
              const urls = [];

              if (template) {
                try {
                  const parsed = new URL(template);
                  const extMatch = parsed.pathname.match(/\.([a-zA-Z0-9]+)$/);
                  const ext = extMatch ? "." + extMatch[1] : ".png";
                  parsed.pathname = parsed.pathname.replace(/[^/]+\.[a-zA-Z0-9]+$/, file + ext);
                  if (Number.isFinite(Number(version))) {
                    parsed.searchParams.set("v", String(Number(version)));
                  }
                  urls.push(parsed.toString());
                } catch {
                  // Ignore malformed template URLs.
                }
              }

              bases.forEach((base) => {
                exts.forEach((ext) => {
                  versions.forEach((suffix) => {
                    urls.push(base + file + ext + suffix);
                  });
                });
              });

              return urls[0] || "";
            };

            return {
              id: String(id || ""),
              name: String(name || "Marketplace miner"),
              price,
              power,
              bonus_percent: Number.isFinite(bonusPercent) ? bonusPercent : 0,
              level: Number.isFinite(Number(level)) ? Number(level) : null,
              width: extractWidth(row),
              currency: row.currency || row.price_currency || getByPath(row, "price.currency") || "RLT",
              image_url:
                row.image_url ||
                row.image ||
                getByPath(row, "item.image") ||
                getByPath(row, "item_info.image") ||
                getByPath(row, "product.image") ||
                buildImageUrlFromFilename(filename, imgVer, imageTemplateUrl),
              level_badge_url: buildLevelBadgeUrl(level),
              source: "marketplace-buy-browser-session-api",
            };
          };

          const buildUrl = (page, profile) => {
            const effectiveLimit =
              profile && Number.isFinite(Number(profile.limit)) && Number(profile.limit) > 0
                ? Math.floor(Number(profile.limit))
                : pageLimit;
            const params = new URLSearchParams();
            params.set("currency", "RLT");
            params.set("itemType", "miner");
            params.set("sort[field]", "date");
            params.set("sort[order]", "-1");
            params.set("skip", String((page - 1) * effectiveLimit));
            params.set("limit", String(effectiveLimit));
            if (profile && profile.includeFilters) {
              params.set("filter[0][name]", "price");
              params.set("filter[0][min]", "0");
              params.set("filter[0][max]", "3439000000");
              params.set("filter[1][name]", "power");
              params.set("filter[1][min]", "1");
              params.set("filter[1][max]", "1380000000");
              params.set("filter[2][name]", "miner_bonus");
              params.set("filter[2][min]", "0");
              params.set("filter[2][max]", "70");
            }
            return "https://rollercoin.com/api/marketplace/buy/sale-orders?" + params.toString();
          };

          try {
            for (let i = 0; i < localStorage.length; i += 1) {
              const key = localStorage.key(i);
              const value = localStorage.getItem(key);
              if (!value) continue;

              const lowerKey = String(key).toLowerCase();
              const looksLikeTokenKey = /token|auth|jwt|access/.test(lowerKey);
              const looksLikeJwt = /^eyJ[A-Za-z0-9_-]+\\./.test(value);
              if (looksLikeTokenKey || looksLikeJwt) {
                tokenCandidates.push({ key, value });
              }
            }
          } catch {
            // Ignore localStorage read failures.
          }

          const normalizeTokenValues = (value) => {
            if (!value) return [];
            const collected = [];
            const pushIfValid = (candidate) => {
              if (typeof candidate !== "string") return;
              const trimmed = candidate.trim().replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");
              if (!trimmed) return;
              if (/^Bearer\s+/i.test(trimmed)) {
                collected.push(trimmed);
                collected.push(trimmed.replace(/^Bearer\s+/i, ""));
                return;
              }
              collected.push(trimmed);
            };

            pushIfValid(value);

            try {
              const parsed = JSON.parse(value);
              const queue = [parsed];
              const seen = new WeakSet();
              while (queue.length > 0) {
                const current = queue.shift();
                if (!current) continue;
                if (typeof current === "string") {
                  pushIfValid(current);
                  continue;
                }
                if (Array.isArray(current)) {
                  current.forEach((entry) => {
                    if (typeof entry === "string") {
                      pushIfValid(entry);
                    } else if (entry && typeof entry === "object" && !seen.has(entry)) {
                      seen.add(entry);
                      queue.push(entry);
                    }
                  });
                  continue;
                }
                if (typeof current === "object") {
                  Object.entries(current).forEach(([key, entry]) => {
                    if (/token|auth|jwt|access/i.test(String(key))) {
                      if (typeof entry === "string") {
                        pushIfValid(entry);
                      } else if (entry && typeof entry === "object" && !seen.has(entry)) {
                        seen.add(entry);
                        queue.push(entry);
                      }
                    }
                  });
                }
              }
            } catch {
              // Ignore non-JSON token values.
            }

            return [...new Set(collected)];
          };

          const uniqueTokens = [];
          const seenTokens = new Set();
          for (const item of tokenCandidates) {
            const normalizedValues = normalizeTokenValues(item.value);
            normalizedValues.forEach((value) => {
              if (!value || seenTokens.has(value)) return;
              seenTokens.add(value);
              uniqueTokens.push(value);
            });
          }

          const headerVariants = [{ label: "cookie-only", headers: {} }];
          uniqueTokens.forEach((token) => {
            const clean = token.replace(/^Bearer\s+/i, "");
            headerVariants.push({
              label: "authorization-bearer",
              headers: { Authorization: "Bearer " + clean },
            });
            headerVariants.push({
              label: "authorization-raw",
              headers: { Authorization: token },
            });
            headerVariants.push({
              label: "x-access-token",
              headers: { "x-access-token": clean },
            });
            headerVariants.push({
              label: "x-auth-token",
              headers: { "x-auth-token": clean },
            });
            headerVariants.push({
              label: "token",
              headers: { token: clean },
            });
          });

          const uniqueHeaderVariants = [];
          const seenHeaderVariants = new Set();
          for (const variant of headerVariants) {
            const key = JSON.stringify(variant.headers);
            if (seenHeaderVariants.has(key)) continue;
            seenHeaderVariants.add(key);
            uniqueHeaderVariants.push(variant);
            if (uniqueHeaderVariants.length >= 6) break;
          }

          attempts.push({
            step: "bootstrap",
            href: location.href,
            tokenCount: uniqueTokens.length,
            headerVariants: uniqueHeaderVariants.map((variant) => variant.label),
            queryProfiles: queryProfiles.map((profile) => profile.label),
            cookieNames: document.cookie
              .split(";")
              .map((entry) => entry.trim().split("=")[0])
              .filter(Boolean)
              .slice(0, 20),
          });

          let selectedHeaderVariant = null;
          let selectedQueryProfile = null;
          for (let probePass = 1; probePass <= 3 && !selectedHeaderVariant; probePass += 1) {
            attempts.push({ step: "probe-pass", pass: probePass });
            for (const profile of queryProfiles) {
              for (const variant of uniqueHeaderVariants) {
                if (Date.now() - startedAt > SCRIPT_DEADLINE_MS) {
                  return {
                    success: false,
                    error: "Browser-session market API probe deadline exceeded.",
                    attempts,
                  };
                }
                const probeUrl = buildUrl(1, profile);
                let probeResponse;
                try {
                  probeResponse = await fetchWithTimeout(probeUrl, {
                    method: "GET",
                    credentials: "include",
                    headers: {
                      Accept: "application/json, text/plain, */*",
                      "Cache-Control": "no-cache",
                      Pragma: "no-cache",
                      ...variant.headers,
                    },
                  }, REQUEST_TIMEOUT_MS);
                } catch (error) {
                  attempts.push({
                    step: "probe-request-error",
                    pass: probePass,
                    profile: profile.label,
                    variant: variant.label,
                    url: probeUrl,
                    error: String(error),
                  });
                  continue;
                }

                const probeText = await probeResponse.text();
                let probeJson = null;
                try {
                  probeJson = JSON.parse(probeText);
                } catch {
                  // Keep non-JSON payload as text.
                }

                const probeRows = probeJson && typeof probeJson === "object" ? extractRows(probeJson) : [];
                attempts.push({
                  step: "probe-response",
                  pass: probePass,
                  profile: profile.label,
                  variant: variant.label,
                  url: probeUrl,
                  status: probeResponse.status,
                  rows: probeRows.length,
                });

                if (probeResponse.ok && probeRows.length > 0) {
                  selectedHeaderVariant = variant;
                  selectedQueryProfile = profile;
                  break;
                }
              }

              if (selectedHeaderVariant && selectedQueryProfile) {
                break;
              }
            }

            if (!selectedHeaderVariant) {
              await sleep(900 * probePass);
            }
          }

          if (!selectedHeaderVariant || !selectedQueryProfile) {
            return {
              success: false,
              unauthorized: true,
              hardUnauthorized: true,
              error: "RollerCoin rejected the browser-session market API request.",
              attempts,
            };
          }

          let shouldStopPaging = false;
          let partialSuccessWarning = "";
          let stagnantPageCount = 0;
          const pageFailureCounts = new Map();
          const defaultPageBatchSize = ${MARKET_PAGE_BATCH_SIZE};
          let pageBatchSize = defaultPageBatchSize;
          let recoveryPagesRemaining = 0;
          for (let batchStartPage = 1; batchStartPage <= maxPages && !shouldStopPaging; batchStartPage += pageBatchSize) {
            if (Date.now() - startedAt > SCRIPT_DEADLINE_MS) {
              attempts.push({ step: "page-deadline-exceeded", page: batchStartPage });
              break;
            }

            const batchPages = [];
            for (
              let page = batchStartPage;
              page < batchStartPage + pageBatchSize && page <= maxPages;
              page += 1
            ) {
              batchPages.push({ page, url: buildUrl(page, selectedQueryProfile) });
            }

            const batchResults = await Promise.all(
              batchPages.map(async ({ page, url }) => {
                for (let attempt = 1; attempt <= PAGE_RETRY_LIMIT; attempt += 1) {
                  const requestUrl = withCacheBust(url, page, attempt);
                  try {
                    const response = await fetchWithTimeout(requestUrl, {
                      method: "GET",
                      credentials: "include",
                      cache: "no-store",
                      headers: {
                        Accept: "application/json, text/plain, */*",
                        "Cache-Control": "no-cache",
                        Pragma: "no-cache",
                        ...selectedHeaderVariant.headers,
                      },
                    }, REQUEST_TIMEOUT_MS + (attempt - 1) * 1500);

                    const text = await response.text();
                    let json = null;
                    try {
                      json = JSON.parse(text);
                    } catch {
                      // Keep non-JSON payload as text.
                    }

                    const shouldRetry =
                      attempt < PAGE_RETRY_LIMIT &&
                      (
                        response.status === 403 ||
                        response.status === 429 ||
                        (!response.ok && response.status >= 500) ||
                        (response.ok && (!json || typeof json !== "object"))
                      );
                    attempts.push({
                      step: shouldRetry ? "page-retry-scheduled" : "page-fetch-finished",
                      page,
                      attempt,
                      url: requestUrl,
                      status: response.status,
                    });
                    if (shouldRetry) {
                      await sleep(450 * attempt + (page % 3) * 120);
                      continue;
                    }

                    return { page, url: requestUrl, response, json };
                  } catch (error) {
                    attempts.push({
                      step: "page-request-attempt-error",
                      page,
                      attempt,
                      url: requestUrl,
                      error: String(error),
                    });
                    if (attempt < PAGE_RETRY_LIMIT) {
                      await sleep(450 * attempt + (page % 3) * 120);
                      continue;
                    }
                    return { page, url: requestUrl, error: String(error) };
                  }
                }

                return { page, url, error: "Page retry limit exhausted." };
              }),
            );

            batchResults.sort((left, right) => left.page - right.page);
            const failedPages = [];

            for (const result of batchResults) {
              const { page, url, response, json, error } = result;
              if (error) {
                attempts.push({ step: "page-request-error", page, url, error });
                const failureCount = (pageFailureCounts.get(page) || 0) + 1;
                pageFailureCounts.set(page, failureCount);
                failedPages.push(page);
                attempts.push({ step: "page-request-error-deferred", page, failureCount, keptOffers: offers.length });
                continue;
              }

              attempts.push({ step: "page-response", page, url, status: response.status });
              if (response.status === 401 || response.status === 403) {
                const failureCount = (pageFailureCounts.get(page) || 0) + 1;
                pageFailureCounts.set(page, failureCount);
                if (response.status === 401 && offers.length === 0) {
                  return {
                    success: false,
                    unauthorized: true,
                    hardUnauthorized: true,
                    error: "RollerCoin rejected the browser-session market API request.",
                    attempts,
                  };
                }
                failedPages.push(page);
                attempts.push({ step: "page-response-deferred", page, status: response.status, failureCount, keptOffers: offers.length });
                continue;
              }

              if (!response.ok) {
                const failureCount = (pageFailureCounts.get(page) || 0) + 1;
                pageFailureCounts.set(page, failureCount);
                failedPages.push(page);
                attempts.push({ step: "page-non-ok-deferred", page, status: response.status, failureCount, keptOffers: offers.length });
                continue;
              }

              if (!json || typeof json !== "object") {
                const failureCount = (pageFailureCounts.get(page) || 0) + 1;
                pageFailureCounts.set(page, failureCount);
                failedPages.push(page);
                attempts.push({ step: "page-non-json-deferred", page, status: response.status, failureCount, keptOffers: offers.length });
                continue;
              }

              const rows = extractRows(json);
              attempts.push({ step: "page-rows", page, rows: rows.length });
              if (rows.length === 0) {
                shouldStopPaging = true;
                break;
              }

              const minerRows = rows.filter((row) => isMinerLike(row));
              const candidateRows = minerRows.length > 0 ? minerRows : rows;
              const normalizedRows = candidateRows
                .map((row) => normalizeOffer(row))
                .filter((row) => Number.isFinite(row.price) && row.price > 0 && Number.isFinite(row.power) && row.power > 0);

              let addedRows = 0;
              normalizedRows.forEach((row) => {
                const dedupeKey = buildOfferIdentityKey(row);
                if (!dedupeKey) return;
                const existedBefore = seenOfferKeys.has(dedupeKey);
                seenOfferKeys.add(dedupeKey);
                const insertedOrImproved = upsertOffer(offers, offerIndexByKey, row);
                if (!existedBefore || insertedOrImproved) {
                  addedRows += 1;
                }
              });
              pageFailureCounts.delete(page);
              attempts.push({ step: "page-added", page, added: addedRows, totalOffers: offers.length });

              if (addedRows === 0) {
                stagnantPageCount += 1;
                if (stagnantPageCount >= 3) {
                  shouldStopPaging = true;
                  partialSuccessWarning =
                    partialSuccessWarning ||
                    "Market refresh stopped after several repeated pages; using the miners that were loaded successfully.";
                  attempts.push({ step: "page-stagnant-stop", page, stagnantPageCount, totalOffers: offers.length });
                  break;
                }
              } else {
                stagnantPageCount = 0;
              }

              if (rows.length < selectedQueryProfile.limit || candidateRows.length < selectedQueryProfile.limit) {
                shouldStopPaging = true;
                break;
              }
            }

            if (!shouldStopPaging && failedPages.length > 0) {
              const uniqueFailedPages = [...new Set(failedPages)].sort((left, right) => left - right);
              const highestFailureCount = Math.max(
                ...uniqueFailedPages.map((page) => pageFailureCounts.get(page) || 0),
              );
              attempts.push({
                step: "page-requeue",
                pages: uniqueFailedPages,
                highestFailureCount,
                nextBatchSize: 1,
                recoveryPagesRemaining: Math.max(2, 3 + highestFailureCount),
              });

              if (highestFailureCount >= PAGE_RETRY_LIMIT + 2) {
                shouldStopPaging = true;
                partialSuccessWarning =
                  partialSuccessWarning ||
                  "Market refresh stopped after several pages kept getting rejected by RollerCoin; using the miners loaded before the block.";
                attempts.push({
                  step: "page-requeue-stop",
                  pages: uniqueFailedPages,
                  keptOffers: offers.length,
                });
                break;
              }

              pageBatchSize = 1;
              recoveryPagesRemaining = Math.max(recoveryPagesRemaining, 3 + highestFailureCount);
              batchStartPage = uniqueFailedPages[0] - 1;
              await sleep(450 + highestFailureCount * 180);
            } else if (pageBatchSize === 1) {
              recoveryPagesRemaining = Math.max(0, recoveryPagesRemaining - 1);
              if (recoveryPagesRemaining === 0) {
                pageBatchSize = defaultPageBatchSize;
                attempts.push({
                  step: "page-batch-restored",
                  restoredBatchSize: pageBatchSize,
                  nextPage: batchStartPage + 1,
                  totalOffers: offers.length,
                });
              }
            }
          }

          if (offers.length === 0) {
            return {
              success: false,
              error: "Browser-session market API returned no parseable miner offers.",
              attempts,
            };
          }

          return {
            success: true,
            endpoint: "https://rollercoin.com/api/marketplace/buy/sale-orders",
            refreshMode: ${JSON.stringify(normalizedOptions.refreshMode)},
            maxPages,
            sourcePath: partialSuccessWarning ? "browser-session-sale-orders-api-partial" : "browser-session-sale-orders-api",
            sourceScore: offers.length,
            selectedQueryProfile: selectedQueryProfile.label,
            selectedAuthVariant: selectedHeaderVariant.label,
            tokenCount: uniqueTokens.length,
            partial: Boolean(partialSuccessWarning),
            warning: partialSuccessWarning,
            marketplaceOffers: offers,
            attempts,
          };
        })();
        `,
        true,
      ),
      360000,
      "Browser-session market API executeJavaScript timeout (360s).",
    );

    return parseWorkerResult(raw);
  } finally {
    await closeWindowGracefully(worker);
  }
}

async function scanMarketplaceBuyFirstOffers(progress = null, options = {}) {
  const startedAt = Date.now();
  const showWindow = Boolean(options.showWindow);
  const waitForAuthMs = Number.isFinite(options.waitForAuthMs) ? Math.max(0, options.waitForAuthMs) : 0;
  const worker = new BrowserWindow({
    show: showWindow,
    width: 1180,
    height: 860,
    autoHideMenuBar: true,
    title: "RollerCoin Marketplace Scanner",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: ROLLERCOIN_PARTITION,
    },
  });

  try {
    if (progress) {
      progress("Opening https://rollercoin.com/marketplace/buy ...");
    }
    await worker.loadURL("https://rollercoin.com/marketplace/buy?itemType=miner");
    if (progress) {
      if (showWindow) {
        progress(
          "Interactive marketplace window opened. If needed, log in / solve captcha there. " +
            "Scanner will keep retrying authorization.",
          "warn",
        );
      }
      progress("Marketplace page opened, scanning sale-orders pages...");
    }

    const raw = await worker.webContents.executeJavaScript(
      `
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        await sleep(1200);
        const waitForAuthMs = ${waitForAuthMs};
        const authDeadline = Date.now() + waitForAuthMs;

        const isMinerLike = (entry) => {
          if (!entry || typeof entry !== "object") return false;
          const tokens = [
            entry.type,
            entry.itemType,
            entry.item_type,
            entry.category,
            entry.group,
            entry.kind,
            entry?.item?.type,
            entry?.item?.item_type,
            entry?.item_info?.type,
            entry?.product?.type,
            entry?.product?.item_type,
          ]
            .filter(Boolean)
            .map((value) => String(value).toLowerCase());

          return tokens.some((token) => token.includes("miner"));
        };

        const getByPath = (obj, path) => {
          const parts = path.split(".");
          let current = obj;
          for (const part of parts) {
            if (!current || typeof current !== "object" || !(part in current)) {
              return undefined;
            }
            current = current[part];
          }
          return current;
        };

        const firstFiniteNumber = (values) => {
          for (const value of values) {
            if (value === null || value === undefined) continue;
            const parsed = Number(String(value).replace(",", "."));
            if (Number.isFinite(parsed)) return parsed;
          }
          return NaN;
        };

        const extractWidth = (row) => {
          const directWidth = firstFiniteNumber([
            row.width,
            row.size,
            row.slotSize,
            row.slot_size,
            row.cell_width,
            row.slots,
            getByPath(row, "item.width"),
            getByPath(row, "item.size"),
            getByPath(row, "item.slotSize"),
            getByPath(row, "item.slot_size"),
            getByPath(row, "item_info.width"),
            getByPath(row, "item_info.size"),
            getByPath(row, "item_info.slotSize"),
            getByPath(row, "item_info.slot_size"),
            getByPath(row, "product.width"),
            getByPath(row, "product.size"),
            getByPath(row, "product.slotSize"),
            getByPath(row, "product.slot_size"),
            getByPath(row, "miner.width"),
            getByPath(row, "miner.size"),
            getByPath(row, "sale.width"),
            getByPath(row, "sale.size"),
          ]);
          if (Number.isFinite(directWidth) && directWidth > 0) {
            return Math.floor(directWidth);
          }
          const textualCandidates = [
            row.width,
            row.size,
            row.slotSize,
            row.slot_size,
            getByPath(row, "item.width"),
            getByPath(row, "item.size"),
            getByPath(row, "item_info.width"),
            getByPath(row, "item_info.size"),
            getByPath(row, "product.width"),
            getByPath(row, "product.size"),
          ];
          for (const candidate of textualCandidates) {
            if (typeof candidate !== "string") continue;
            const normalized = candidate.trim().toLowerCase();
            if (!normalized) continue;
            if (["small", "s", "1x1", "1"].includes(normalized)) return 1;
            if (["large", "l", "2x1", "2"].includes(normalized)) return 2;
          }
          return null;
        };

        const extractRows = (payload) => {
          const root = payload && typeof payload === "object" ? (payload.data ?? payload) : null;
          if (!root || typeof root !== "object") return [];

          const directCandidates = [
            root.items,
            root.rows,
            root.results,
            root.sale_orders,
            root.orders,
            root.list,
          ].filter(Array.isArray);

          for (const candidate of directCandidates) {
            if (candidate.length > 0 && candidate.every((entry) => entry && typeof entry === "object")) {
              return candidate;
            }
          }

          const queue = [root];
          const seen = new Set();
          while (queue.length > 0) {
            const node = queue.shift();
            if (!node || typeof node !== "object") continue;
            if (seen.has(node)) continue;
            seen.add(node);

            if (Array.isArray(node)) {
              if (node.length > 0 && node.every((entry) => entry && typeof entry === "object")) {
                const hasPrice = node.some((entry) =>
                  Number.isFinite(
                    firstFiniteNumber([
                      entry.price,
                      entry.cost,
                      entry.amount,
                      entry?.item?.price,
                      entry?.item_info?.price,
                      entry?.product?.price,
                    ]),
                  ),
                );
                if (hasPrice) return node;
              }
              node.forEach((entry) => {
                if (entry && typeof entry === "object") queue.push(entry);
              });
              continue;
            }

            Object.values(node).forEach((entry) => {
              if (entry && typeof entry === "object") queue.push(entry);
            });
          }

          return [];
        };

        const normalizeFirstOffer = (row) => {
          const id =
            row.id ||
            row.item_id ||
            row.offer_id ||
            row.order_id ||
            getByPath(row, "item.id") ||
            getByPath(row, "item_info.id") ||
            getByPath(row, "product.id") ||
            "";

          const name =
            getByPath(row, "item.name.en") ||
            getByPath(row, "item_info.name.en") ||
            getByPath(row, "product.name.en") ||
            getByPath(row, "name.en") ||
            getByPath(row, "item.name") ||
            getByPath(row, "item_info.name") ||
            getByPath(row, "product.name") ||
            row.name ||
            row.title ||
            "Marketplace miner";

          const price = firstFiniteNumber([
            row.price,
            row.cost,
            row.amount,
            row.price_value,
            row.rlt_price,
            getByPath(row, "price.value"),
            getByPath(row, "item.price"),
            getByPath(row, "item_info.price"),
            getByPath(row, "product.price"),
          ]);

          const power = firstFiniteNumber([
            row.power,
            row.hashrate,
            row.hash_rate,
            getByPath(row, "item.power"),
            getByPath(row, "item_info.power"),
            getByPath(row, "product.power"),
          ]);

          const directBonusPercent = firstFiniteNumber([
            row.miner_bonus,
            row.percent_bonus,
            row.bonus_percent,
            row.bonus,
            getByPath(row, "price.miner_bonus"),
            getByPath(row, "item.miner_bonus"),
            getByPath(row, "item.percent_bonus"),
            getByPath(row, "item.bonus_percent"),
            getByPath(row, "item_info.miner_bonus"),
            getByPath(row, "item_info.percent_bonus"),
            getByPath(row, "item_info.bonus_percent"),
            getByPath(row, "miner.miner_bonus"),
            getByPath(row, "miner.percent_bonus"),
            getByPath(row, "miner.bonus_percent"),
            getByPath(row, "sale.miner_bonus"),
            getByPath(row, "sale.percent_bonus"),
            getByPath(row, "sale.bonus_percent"),
            getByPath(row, "product.miner_bonus"),
            getByPath(row, "product.percent_bonus"),
            getByPath(row, "product.bonus_percent"),
          ]);
          const nestedBonusPercent = firstFiniteNumber([
            getByPath(row, "bonus.power_percent"),
            getByPath(row, "item.bonus.power_percent"),
            getByPath(row, "item_info.bonus.power_percent"),
            getByPath(row, "miner.bonus.power_percent"),
            getByPath(row, "sale.bonus.power_percent"),
            getByPath(row, "product.bonus.power_percent"),
          ]);
          const bonusPercent = Number.isFinite(directBonusPercent)
            ? directBonusPercent / 100
            : (Number.isFinite(nestedBonusPercent) ? nestedBonusPercent / 100 : 0);

          return {
            id: String(id || ""),
            name,
            price,
            power,
            bonus_percent: Number.isFinite(bonusPercent) ? bonusPercent : 0,
            width: extractWidth(row),
            currency:
              row.currency ||
              row.price_currency ||
              getByPath(row, "price.currency") ||
              "RLT",
            source: "marketplace-buy-first-offer",
            raw: row,
          };
        };

        const pageLimit = 12;
        const maxPages = 250;
        const firstOffers = [];
        const attempts = [];
        let sawUnauthorizedStatus = false;
        let sawAnyProbeOk = false;
        let sawAnyProbeJson = false;
        let sawAnyProbeRows = false;

        const buildSaleOrdersUrl = (page, minerParamKey = "itemType", minerParamValue = "miner") => {
          const params = new URLSearchParams();
          params.set("currency", "RLT");
          params.set(minerParamKey, minerParamValue);
          params.set("sort[field]", "date");
          params.set("sort[order]", "-1");
          params.set("skip", String((page - 1) * pageLimit));
          params.set("limit", String(pageLimit));

          params.set("filter[0][name]", "price");
          params.set("filter[0][min]", "0");
          params.set("filter[0][max]", "3439000000");

          params.set("filter[1][name]", "power");
          params.set("filter[1][min]", "1");
          params.set("filter[1][max]", "1380000000");

          params.set("filter[2][name]", "miner_bonus");
          params.set("filter[2][min]", "0");
          params.set("filter[2][max]", "70");

          return \`https://rollercoin.com/api/marketplace/buy/sale-orders?\${params.toString()}\`;
        };

        const builders = [
          (page) => buildSaleOrdersUrl(page, "itemType", "miner"),
          (page) => buildSaleOrdersUrl(page, "item_type", "miner"),
          (page) => buildSaleOrdersUrl(page, "type", "miner"),
          (page) => buildSaleOrdersUrl(page, "category", "miners"),
        ];

        let usedBuilder = null;
        while (!usedBuilder) {
          for (const builder of builders) {
            const probeUrl = builder(1);
            try {
              const probeResponse = await fetch(probeUrl, {
                method: "GET",
                credentials: "include",
                headers: { Accept: "application/json, text/plain, */*" },
              });

              const probeText = await probeResponse.text();
              let probeJson = null;
              try {
                probeJson = JSON.parse(probeText);
              } catch {
                // Keep non-json.
              }

              attempts.push({ step: "probe", url: probeUrl, status: probeResponse.status });
              if (probeResponse.status === 401 || probeResponse.status === 403) {
                sawUnauthorizedStatus = true;
              }
              if (probeResponse.ok) {
                sawAnyProbeOk = true;
              }
              if (!probeResponse.ok || !probeJson || typeof probeJson !== "object") {
                continue;
              }
              sawAnyProbeJson = true;

              const probeRows = extractRows(probeJson);
              if (probeRows.length === 0) {
                continue;
              }
              sawAnyProbeRows = true;

              const hasMinerSign = probeRows.some((row) => isMinerLike(row));
              const firstProbeOffer = normalizeFirstOffer(probeRows[0]);
              const hasPriceAndPower =
                Number.isFinite(firstProbeOffer.price) && Number.isFinite(firstProbeOffer.power);

              if (!hasMinerSign && !hasPriceAndPower) {
                continue;
              }

              usedBuilder = builder;
              attempts.push({
                step: "probe-selected",
                url: probeUrl,
                selectedBy: hasMinerSign ? "miner-signature" : "price-power-signature",
              });
              break;
            } catch (error) {
              attempts.push({ step: "probe-error", url: probeUrl, error: String(error) });
            }
          }

          if (usedBuilder) break;
          if (waitForAuthMs <= 0 || Date.now() > authDeadline) {
            break;
          }

          attempts.push({
            step: "wait-auth",
            waitRemainingMs: Math.max(0, authDeadline - Date.now()),
            path: location.pathname,
          });
          await sleep(2500);
        }

        if (!usedBuilder) {
          const reason = sawUnauthorizedStatus
            ? "Marketplace buy API rejected session authorization."
            : "Could not find parseable sale-orders responses from marketplace/buy.";
          return {
            success: false,
            unauthorized: sawUnauthorizedStatus,
            hardUnauthorized: sawUnauthorizedStatus,
            error: reason,
            diagnostics: {
              sawUnauthorizedStatus,
              sawAnyProbeOk,
              sawAnyProbeJson,
              sawAnyProbeRows,
            },
            attempts,
          };
        }

        const seenPageFirstIds = new Set();

        for (let page = 1; page <= maxPages; page += 1) {
          const url = usedBuilder(page);
          let response;
          try {
            response = await fetch(url, {
              method: "GET",
              credentials: "include",
              headers: { Accept: "application/json, text/plain, */*" },
            });
          } catch (error) {
            attempts.push({ step: "page-error", page, url, error: String(error) });
            break;
          }

          const text = await response.text();
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            attempts.push({ step: "page-non-json", page, url, status: response.status });
            break;
          }

          attempts.push({ step: "page", page, url, status: response.status });

          if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
              sawUnauthorizedStatus = true;
              if (waitForAuthMs > 0 && Date.now() <= authDeadline) {
                attempts.push({
                  step: "page-unauthorized-wait",
                  page,
                  waitRemainingMs: Math.max(0, authDeadline - Date.now()),
                });
                await sleep(2500);
                page -= 1;
                continue;
              }
              return {
                success: false,
                unauthorized: true,
                hardUnauthorized: true,
                error: "Marketplace buy API rejected session authorization.",
                attempts,
              };
            }
            break;
          }

          const rows = extractRows(json);
          if (rows.length === 0) {
            break;
          }

          const minerRows = rows.filter((row) => isMinerLike(row));
          const candidateRows = minerRows.length > 0 ? minerRows : rows;
          if (minerRows.length === 0) {
            attempts.push({
              step: "page-no-miner-signature",
              page,
              url,
              rows: rows.length,
            });
          }

          const firstOfferRow = candidateRows[0];
          const normalized = normalizeFirstOffer(firstOfferRow);

          if (!Number.isFinite(normalized.price) || !Number.isFinite(normalized.power)) {
            attempts.push({
              step: "page-first-offer-not-parseable",
              page,
              url,
              candidateRows: candidateRows.length,
            });
            if (candidateRows.length < pageLimit) break;
            continue;
          }

          const pageIdKey = normalized.id || \`page-\${page}-price-\${normalized.price}\`;
          if (seenPageFirstIds.has(pageIdKey)) {
            break;
          }
          seenPageFirstIds.add(pageIdKey);
          firstOffers.push(normalized);

          if (candidateRows.length < pageLimit) {
            break;
          }
        }

        if (firstOffers.length === 0) {
          const reason = sawUnauthorizedStatus
            ? "Marketplace buy API rejected session authorization."
            : "Marketplace scan finished, but no parseable miner offers were found.";
          return {
            success: false,
            unauthorized: sawUnauthorizedStatus,
            hardUnauthorized: sawUnauthorizedStatus,
            error: reason,
            attempts,
          };
        }

        return {
          success: true,
          endpoint: "https://rollercoin.com/marketplace/buy",
          status: 200,
          mode: waitForAuthMs > 0 ? "marketplace-buy-pages-interactive" : "marketplace-buy-pages",
          marketplaceOffers: firstOffers,
          attempts,
        };
      })();
      `,
      true,
    );

    const result = parseWorkerResult(raw);
    const elapsedMs = Date.now() - startedAt;

    if (progress) {
      if (result.success) {
        progress(
          `Marketplace scan success: ${result.marketplaceOffers?.length || 0} first offers, ` +
            `${result.attempts?.length || 0} attempts, ${elapsedMs} ms.`,
          "success",
        );
      } else if (result.unauthorized) {
        progress(
          `Marketplace scan unauthorized after ${elapsedMs} ms: ${result.error || "no details"}.`,
          "warn",
        );
      } else {
        progress(`Marketplace scan failed after ${elapsedMs} ms: ${result.error || "unknown error"}.`, "warn");
      }
    }

    return result;
  } catch (error) {
    if (progress) {
      progress(`Marketplace scan crashed: ${error.message}`, "error");
    }
    return {
      success: false,
      error: `Marketplace scan failed: ${error.message}`,
    };
  } finally {
    await closeWindowGracefully(worker);
  }
}

async function scanMarketplaceBuyInteractive(progress = null, options = {}) {
  const startedAt = Date.now();
  const maxWaitMs = Number.isFinite(options.maxWaitMs) ? Math.max(15000, options.maxWaitMs) : 90000;
  const maxAutoPages = Number.isFinite(options.maxAutoPages) ? Math.max(5, options.maxAutoPages) : 120;

  const worker = new BrowserWindow({
    show: true,
    width: 1180,
    height: 860,
    autoHideMenuBar: true,
    title: "RollerCoin Marketplace Scanner (Interactive)",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: ROLLERCOIN_PARTITION,
    },
  });

  const attempts = [];
  const firstOffers = [];
  const seenFirstOfferKeys = new Set();
  let authLikely = false;
  let captchaLikely = false;

  try {
    if (progress) {
      progress(
        "Opening interactive marketplace scanner. Please log in / solve captcha in that window if prompted.",
        "warn",
      );
    }

    await runWithTimeout(
      worker.loadURL("https://rollercoin.com/marketplace/buy?itemType=miner"),
      12000,
      "Interactive scanner: navigation timeout.",
    );

    if (progress) {
      progress(
        "Interactive window is open. Scanner will inspect page state/DOM and auto-switch pages.",
      );
    }

    const perCycleScript = `
      (async () => {
        const isVisible = (element) => {
          if (!element) return false;
          const style = getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const isDisabled = (element) => {
          if (!element) return true;
          if (element.disabled) return true;
          const ariaDisabled = String(element.getAttribute("aria-disabled") || "").toLowerCase();
          if (ariaDisabled === "true") return true;
          const className = String(element.className || "").toLowerCase();
          if (className.includes("disabled")) return true;
          const parentDisabled = element.closest("[aria-disabled='true'], .disabled, [class*='disabled']");
          return Boolean(parentDisabled && parentDisabled !== element);
        };

        const getByPath = (obj, path) => {
          if (!obj || typeof obj !== "object") return undefined;
          const parts = path.split(".");
          let current = obj;
          for (const part of parts) {
            if (!current || typeof current !== "object" || !(part in current)) return undefined;
            current = current[part];
          }
          return current;
        };

        const parseNumber = (value) => {
          if (value === null || value === undefined) return NaN;
          const normalized = String(value).replace(/\\s+/g, "").replace(",", ".");
          const parsed = Number(normalized);
          return Number.isFinite(parsed) ? parsed : NaN;
        };

        const firstFinite = (values) => {
          for (const value of values) {
            const parsed = parseNumber(value);
            if (Number.isFinite(parsed)) return parsed;
          }
          return NaN;
        };

        const powerUnitToThs = (value, unit) => {
          if (!Number.isFinite(value)) return NaN;
          const normalized = String(unit || "").toLowerCase();
          if (normalized.includes("th/s")) return value;
          if (normalized.includes("ph/s")) return value * 1000;
          if (normalized.includes("eh/s")) return value * 1000 * 1000;
          if (normalized.includes("zh/s")) return value * 1000 * 1000 * 1000;
          return NaN;
        };

        const parsePowerFromText = (text) => {
          if (!text) return NaN;
          const match = String(text).match(/(\\d[\\d\\s.,]*)\\s*(th\\/s|ph\\/s|eh\\/s|zh\\/s)/i);
          if (!match) return NaN;
          const value = parseNumber(match[1]);
          return powerUnitToThs(value, match[2]);
        };

        const parsePriceFromText = (text) => {
          if (!text) return NaN;
          const direct = String(text).match(/(\\d[\\d\\s.,]*)\\s*rlt/i);
          if (direct) {
            const parsed = parseNumber(direct[1]);
            if (Number.isFinite(parsed)) return parsed;
          }
          const reverse = String(text).match(/rlt\\s*(\\d[\\d\\s.,]*)/i);
          if (reverse) {
            const parsed = parseNumber(reverse[1]);
            if (Number.isFinite(parsed)) return parsed;
          }
          return NaN;
        };

        const parseBonusFromText = (text) => {
          if (!text) return NaN;
          const match = String(text).match(/(\\d[\\d\\s.,]*)\\s*%/i);
          if (!match) return NaN;
          return parseNumber(match[1]);
        };

        const normalizeImageUrl = (value) => {
          if (!value) return "";
          const src = String(value).trim();
          if (!src) return "";
          if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) return src;
          if (src.startsWith("//")) return "https:" + src;
          if (src.startsWith("/")) return "https://rollercoin.com" + src;
          return "";
        };

        const scoreImageCandidate = (img) => {
          if (!img) return -999999;
          const src = normalizeImageUrl(img.getAttribute("src") || img.getAttribute("data-src") || "");
          if (!src) return -999999;
          const naturalW = Number(img.naturalWidth || 0);
          const naturalH = Number(img.naturalHeight || 0);
          const rect = img.getBoundingClientRect ? img.getBoundingClientRect() : { width: 0, height: 0 };
          const area = Math.max(naturalW * naturalH, rect.width * rect.height);

          let penalty = 0;
          const signature = src.toLowerCase();
          if (
            signature.includes("level") ||
            signature.includes("rarity") ||
            signature.includes("badge") ||
            signature.includes("frame") ||
            signature.includes("star") ||
            signature.includes("rank")
          ) {
            penalty += 120000;
          }

          return area - penalty;
        };

        const pickBestImageFromElement = (element) => {
          if (!element || typeof element.querySelectorAll !== "function") return "";
          const images = [...element.querySelectorAll("img")].filter((img) => {
            if (!img) return false;
            const src = normalizeImageUrl(img.getAttribute("src") || img.getAttribute("data-src") || "");
            return Boolean(src);
          });
          if (images.length === 0) return "";

          images.sort((a, b) => scoreImageCandidate(b) - scoreImageCandidate(a));
          const best = images[0];
          return normalizeImageUrl(best.getAttribute("src") || best.getAttribute("data-src") || "");
        };

        const clickQuick = (element) => {
          if (!element) return false;
          try {
            if (typeof element.scrollIntoView === "function") {
              element.scrollIntoView({ block: "center", inline: "center" });
            }
          } catch {
            // Ignore.
          }
          try {
            ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
              element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
            });
          } catch {
            // Ignore.
          }
          try {
            if (typeof element.click === "function") {
              element.click();
            }
          } catch {
            return false;
          }
          return true;
        };

        const ensureMinersFilter = () => {
          const lowerHref = String(location.href || "").toLowerCase();
          if (lowerHref.includes("itemtype=miner") || lowerHref.includes("category=miners") || lowerHref.includes("type=miner")) {
            return { applied: false, strategy: "url-param" };
          }

          const selectors = [
            "[data-filter*='miner' i]",
            "[data-category*='miner' i]",
            "[data-type*='miner' i]",
            "[href*='miners' i]",
            "[class*='filter' i] button",
            "[class*='tab' i] button",
            "[class*='category' i] button",
            "[class*='filter' i] [role=button]",
            "[class*='tab' i] [role=button]",
            "[class*='category' i] [role=button]",
            "button",
            "a",
            "[role=button]",
            "label",
          ];

          const candidates = [];
          selectors.forEach((selector) => {
            document.querySelectorAll(selector).forEach((node) => {
              if (!node || candidates.includes(node)) return;
              if (!isVisible(node) || isDisabled(node)) return;
              candidates.push(node);
            });
          });

          const minerTab = candidates.find((node) => {
            const txt = String(node.innerText || node.textContent || "").trim().toLowerCase();
            const attrs = String(
              (node.getAttribute("aria-label") || "") +
                " " +
                (node.getAttribute("title") || "") +
                " " +
                (node.getAttribute("href") || "") +
                " " +
                (node.getAttribute("data-filter") || "") +
                " " +
                (node.getAttribute("data-category") || "") +
                " " +
                (node.getAttribute("data-type") || "")
            ).toLowerCase();
            const signature = txt + " " + attrs;
            return signature.includes("miner") || signature.includes("майнер");
          }) || null;

          if (!minerTab) {
            return { applied: false, strategy: "not-found" };
          }

          const activated = clickQuick(minerTab);
          return { applied: activated, strategy: activated ? "clicked-miners-filter" : "miners-filter-click-failed" };
        };

        const collectDomOffers = () => {
          const selectors = [
            "[class*='market'] [class*='card']",
            "[class*='market'] [class*='item']",
            "[class*='miner'] [class*='card']",
            "[class*='offer']",
            "[data-item-id]",
            "article",
            "li",
          ];

          const elements = [];
          selectors.forEach((selector) => {
            document.querySelectorAll(selector).forEach((element) => {
              if (!element || elements.includes(element)) return;
              if (!isVisible(element)) return;
              elements.push(element);
            });
          });

          const offers = [];
          const seen = new Set();
          elements.forEach((element, index) => {
            const text = String(element.innerText || element.textContent || "")
              .replace(/\\s+/g, " ")
              .trim();
            if (!text || text.length < 12) return;

            const power = parsePowerFromText(text);
            const price = parsePriceFromText(text);
            const bonusPercent = parseBonusFromText(text);
            if (!Number.isFinite(power) || !Number.isFinite(price) || power <= 0 || price <= 0) return;

            const nameCandidate =
              element.querySelector("[class*='name']")?.textContent ||
              element.querySelector("h1,h2,h3,h4,strong")?.textContent ||
              text.split(" ").slice(0, 6).join(" ");
            const name = String(nameCandidate || "Marketplace miner").trim();

            const id =
              element.getAttribute("data-item-id") ||
              element.getAttribute("data-id") ||
              element.getAttribute("id") ||
              ("dom-" + index);
            const key = String(id) + ":" + String(price) + ":" + String(power);
            if (seen.has(key)) return;
            seen.add(key);

            offers.push({
              id: String(id),
              name,
              price,
              power,
              bonus_percent: Number.isFinite(bonusPercent) ? bonusPercent : 0,
              currency: "RLT",
              image_url: pickBestImageFromElement(element),
              source: "marketplace-buy-interactive-dom",
            });
          });

          return offers.slice(0, 80);
        };

        const isMinerLike = (entry) => {
          if (!entry || typeof entry !== "object") return false;
          const tokens = [
            entry.type,
            entry.itemType,
            entry.item_type,
            entry.category,
            entry.group,
            entry.kind,
            entry.tags,
            entry?.item?.type,
            entry?.item?.item_type,
            entry?.item_info?.type,
            entry?.product?.type,
            entry?.product?.item_type,
            getByPath(entry, "item.name.en"),
            getByPath(entry, "item_info.name.en"),
            getByPath(entry, "product.name.en"),
            getByPath(entry, "name.en"),
            getByPath(entry, "item.name"),
            getByPath(entry, "item_info.name"),
            getByPath(entry, "product.name"),
            entry.name,
            entry.title,
          ]
            .flat()
            .filter(Boolean)
            .map((value) => String(value).toLowerCase());
          return tokens.some((token) => token.includes("miner"));
        };

        const extractRows = (payload) => {
          const root = payload && typeof payload === "object" ? (payload.data ?? payload) : null;
          if (!root || typeof root !== "object") return [];
          const direct = [root.items, root.rows, root.results, root.sale_orders, root.orders, root.list].filter(Array.isArray);
          for (const arr of direct) {
            if (arr.length > 0 && arr.every((entry) => entry && typeof entry === "object")) {
              return arr;
            }
          }
          return [];
        };

        const extractWidth = (row) => {
          const directWidth = firstFinite([
            row.width,
            row.size,
            row.slotSize,
            row.slot_size,
            row.cell_width,
            row.slots,
            getByPath(row, "item.width"),
            getByPath(row, "item.size"),
            getByPath(row, "item.slotSize"),
            getByPath(row, "item.slot_size"),
            getByPath(row, "item_info.width"),
            getByPath(row, "item_info.size"),
            getByPath(row, "item_info.slotSize"),
            getByPath(row, "item_info.slot_size"),
            getByPath(row, "product.width"),
            getByPath(row, "product.size"),
            getByPath(row, "product.slotSize"),
            getByPath(row, "product.slot_size"),
            getByPath(row, "miner.width"),
            getByPath(row, "miner.size"),
            getByPath(row, "sale.width"),
            getByPath(row, "sale.size"),
          ]);
          if (Number.isFinite(directWidth) && directWidth > 0) {
            return Math.floor(directWidth);
          }
          const textualCandidates = [
            row.width,
            row.size,
            row.slotSize,
            row.slot_size,
            getByPath(row, "item.width"),
            getByPath(row, "item.size"),
            getByPath(row, "item_info.width"),
            getByPath(row, "item_info.size"),
            getByPath(row, "product.width"),
            getByPath(row, "product.size"),
          ];
          for (const candidate of textualCandidates) {
            if (typeof candidate !== "string") continue;
            const normalized = candidate.trim().toLowerCase();
            if (!normalized) continue;
            if (["small", "s", "1x1", "1"].includes(normalized)) return 1;
            if (["large", "l", "2x1", "2"].includes(normalized)) return 2;
          }
          return null;
        };

        const normalizeFirst = (row) => {
          const id =
            row.id ||
            row.item_id ||
            row.offer_id ||
            row.order_id ||
            getByPath(row, "item.id") ||
            getByPath(row, "item_info.id") ||
            getByPath(row, "product.id") ||
            "";

          const name =
            getByPath(row, "item.name.en") ||
            getByPath(row, "item_info.name.en") ||
            getByPath(row, "product.name.en") ||
            getByPath(row, "name.en") ||
            getByPath(row, "item.name") ||
            getByPath(row, "item_info.name") ||
            getByPath(row, "product.name") ||
            row.name ||
            row.title ||
            "Marketplace miner";

          const price = firstFinite([
            row.price,
            row.cost,
            row.amount,
            row.price_value,
            row.rlt_price,
            getByPath(row, "price.value"),
            getByPath(row, "item.price"),
            getByPath(row, "item_info.price"),
            getByPath(row, "product.price"),
          ]);

          const power = firstFinite([
            row.power,
            row.hashrate,
            row.hash_rate,
            getByPath(row, "item.power"),
            getByPath(row, "item_info.power"),
            getByPath(row, "product.power"),
          ]);

          const directBonusPercent = firstFinite([
            row.miner_bonus,
            row.percent_bonus,
            row.bonus_percent,
            row.bonus,
            getByPath(row, "price.miner_bonus"),
            getByPath(row, "item.miner_bonus"),
            getByPath(row, "item.percent_bonus"),
            getByPath(row, "item.bonus_percent"),
            getByPath(row, "item_info.miner_bonus"),
            getByPath(row, "item_info.percent_bonus"),
            getByPath(row, "item_info.bonus_percent"),
            getByPath(row, "miner.miner_bonus"),
            getByPath(row, "miner.percent_bonus"),
            getByPath(row, "miner.bonus_percent"),
            getByPath(row, "sale.miner_bonus"),
            getByPath(row, "sale.percent_bonus"),
            getByPath(row, "sale.bonus_percent"),
            getByPath(row, "product.miner_bonus"),
            getByPath(row, "product.percent_bonus"),
            getByPath(row, "product.bonus_percent"),
          ]);
          const nestedBonusPercent = firstFinite([
            getByPath(row, "bonus.power_percent"),
            getByPath(row, "item.bonus.power_percent"),
            getByPath(row, "item_info.bonus.power_percent"),
            getByPath(row, "miner.bonus.power_percent"),
            getByPath(row, "sale.bonus.power_percent"),
            getByPath(row, "product.bonus.power_percent"),
          ]);
          const bonusPercent = Number.isFinite(directBonusPercent)
            ? directBonusPercent / 100
            : (Number.isFinite(nestedBonusPercent) ? nestedBonusPercent / 100 : 0);

          return {
            id: String(id || ""),
            name: String(name || "Marketplace miner"),
            price,
            power,
            bonus_percent: Number.isFinite(bonusPercent) ? bonusPercent : 0,
            width: extractWidth(row),
            currency: row.currency || row.price_currency || getByPath(row, "price.currency") || "RLT",
            image_url:
              getByPath(row, "item.image") ||
              getByPath(row, "item.img") ||
              getByPath(row, "item.icon") ||
              getByPath(row, "item.picture") ||
              getByPath(row, "product.image") ||
              getByPath(row, "product.img") ||
              getByPath(row, "product.icon") ||
              getByPath(row, "image") ||
              getByPath(row, "img") ||
              "",
            raw: row,
          };
        };

        const filterSetup = ensureMinersFilter();
        if (filterSetup.applied) {
          await new Promise((resolve) => setTimeout(resolve, 450));
        }

        const roots = [];
        const safePush = (value) => {
          if (!value || typeof value !== "object") return;
          roots.push(value);
        };

        safePush(window.__NUXT__);
        safePush(window.__NEXT_DATA__);
        safePush(window.__INITIAL_STATE__);
        safePush(window.__APOLLO_STATE__);
        safePush(window.__PRELOADED_STATE__);
        safePush(window.__REDUX_STATE__);
        safePush(window.__STATE__);
        if (window.store && typeof window.store.getState === "function") {
          try {
            safePush(window.store.getState());
          } catch {
            // Ignore store access errors.
          }
        }

        const scripts = [...document.querySelectorAll("script[type='application/json'], script#__NEXT_DATA__")];
        scripts.forEach((script) => {
          const text = script.textContent || "";
          if (!text || text.length < 20) return;
          try {
            const parsed = JSON.parse(text);
            safePush(parsed);
          } catch {
            // Ignore non-json script tags.
          }
        });

        const offers = [];
        const seenKeys = new Set();
        const queue = [...roots];
        const visited = new WeakSet();
        let examinedNodes = 0;
        const maxNodes = 9000;

        while (queue.length > 0 && examinedNodes < maxNodes) {
          const node = queue.shift();
          if (!node || typeof node !== "object") continue;
          if (visited.has(node)) continue;
          visited.add(node);
          examinedNodes += 1;

          if (Array.isArray(node)) {
            if (node.length > 0 && node.every((entry) => entry && typeof entry === "object")) {
              const rows = extractRows({ data: { rows: node } }).length > 0 ? node : [];
              if (rows.length > 0) {
                const minerRows = rows.filter((row) => isMinerLike(row));
                if (minerRows.length > 0) {
                  const normalized = normalizeFirst(minerRows[0]);
                  if (Number.isFinite(normalized.price) && Number.isFinite(normalized.power)) {
                    const key = normalized.id || (normalized.name + ":" + normalized.price + ":" + normalized.power);
                    if (!seenKeys.has(key)) {
                      seenKeys.add(key);
                      offers.push(normalized);
                    }
                  }
                }
              }
            }

            node.forEach((entry) => {
              if (entry && typeof entry === "object") queue.push(entry);
            });
            continue;
          }

          Object.values(node).forEach((value) => {
            if (value && typeof value === "object") queue.push(value);
          });
        }

        const domOffers = collectDomOffers();
        domOffers.forEach((normalized) => {
          if (!normalized || typeof normalized !== "object") return;
          const key = normalized.id || (normalized.name + ":" + normalized.price + ":" + normalized.power);
          if (seenKeys.has(key)) return;
          seenKeys.add(key);
          offers.push(normalized);
        });

        const text = String(document.body?.innerText || "").toLowerCase();
        const authLikely =
          location.pathname.includes("sign-in") ||
          text.includes("sign in") ||
          text.includes("log in") ||
          text.includes("РІРѕР№С‚Рё");
        const captchaLikely =
          text.includes("captcha") ||
          text.includes("verify you are human") ||
          text.includes("РїРѕРґС‚РІРµСЂРґРёС‚Рµ, С‡С‚Рѕ РІС‹ РЅРµ СЂРѕР±РѕС‚");

        const extractPageNumber = (element) => {
          if (!element) return NaN;
          const variants = [
            element.getAttribute && element.getAttribute("data-page"),
            element.getAttribute && element.getAttribute("data-page-number"),
            element.getAttribute && element.getAttribute("title"),
            element.getAttribute && element.getAttribute("aria-label"),
            element.innerText,
            element.textContent,
          ];

          for (const value of variants) {
            if (!value) continue;
            const match = String(value).match(/\d+/);
            if (!match) continue;
            const parsed = Number(match[0]);
            if (Number.isFinite(parsed)) return parsed;
          }
          return NaN;
        };

        const getActivePage = () => {
          const activeSelectors = [
            "[aria-current='page']",
            ".rc-pagination-item-active",
            ".pagination .active",
            "[class*='pagination'] .active",
          ];

          for (const selector of activeSelectors) {
            const candidate = document.querySelector(selector);
            if (!candidate || !isVisible(candidate)) continue;
            const page = extractPageNumber(candidate);
            if (Number.isFinite(page)) return page;
          }
          return null;
        };

        const clickElement = (element) => {
          if (!element) return false;
          try {
            if (typeof element.scrollIntoView === "function") {
              element.scrollIntoView({ block: "center", inline: "center" });
            }
          } catch {
            // Ignore scrolling failures.
          }

          try {
            ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
              const event = new MouseEvent(type, { bubbles: true, cancelable: true, view: window });
              element.dispatchEvent(event);
            });
          } catch {
            // Ignore synthetic event failures.
          }

          try {
            if (typeof element.click === "function") {
              element.click();
            }
          } catch {
            return false;
          }
          return true;
        };

        const findNextControl = () => {
          const activePage = getActivePage();
          const controls = [...document.querySelectorAll("button, a, [role=button], li")];

          if (Number.isFinite(activePage)) {
            const exactNextPage = controls.find((control) => {
              if (!isVisible(control) || isDisabled(control)) return false;
              const page = extractPageNumber(control);
              return Number.isFinite(page) && page === activePage + 1;
            });
            if (exactNextPage) {
              return { element: exactNextPage, strategy: "page-number", activePage };
            }
          }

          const numericCandidates = controls
            .map((control) => ({ control, page: extractPageNumber(control) }))
            .filter((entry) => {
              if (!entry.control || !Number.isFinite(entry.page)) return false;
              if (entry.page <= 1) return false;
              if (!isVisible(entry.control) || isDisabled(entry.control)) return false;
              const container = entry.control.closest("[class*='pagination'], [class*='pager'], nav");
              if (!container) return false;
              return true;
            })
            .sort((a, b) => a.page - b.page);

          if (numericCandidates.length > 0) {
            return {
              element: numericCandidates[0].control,
              strategy: "numeric-fallback",
              activePage,
            };
          }

          const loadMoreControl = controls.find((control) => {
            if (!isVisible(control) || isDisabled(control)) return false;
            const txt = String(control.innerText || control.textContent || "").trim().toLowerCase();
            return (
              txt.includes("load more") ||
              txt.includes("show more") ||
              txt.includes("more") ||
              txt.includes("показать еще") ||
              txt.includes("еще")
            );
          }) || null;
          if (loadMoreControl) {
            return { element: loadMoreControl, strategy: "load-more", activePage };
          }

          const strongSelectors = [
            ".rc-pagination-next a",
            ".rc-pagination-next button",
            ".rc-pagination-next",
            "button[rel='next']",
            "a[rel='next']",
            "[aria-label*='next page' i]",
            "button[aria-label*=next i]",
            "[role=button][aria-label*=next i]",
            "button[class*=next i]",
            "a[class*=next i]",
            "[class*=pagination] li:last-child a",
            "[class*=pagination] button:last-child",
          ];

          for (const selector of strongSelectors) {
            const candidate = document.querySelector(selector);
            if (candidate && isVisible(candidate) && !isDisabled(candidate)) {
              return { element: candidate, strategy: "selector:" + selector, activePage };
            }
          }

          const fallbackControls = [...document.querySelectorAll("button, a, [role=button]")];
          const fallbackControl = fallbackControls.find((control) => {
            if (!isVisible(control) || isDisabled(control)) return false;
            const txt = String(control.innerText || control.textContent || "").trim().toLowerCase();
            const title = String(control.getAttribute("title") || control.getAttribute("aria-label") || "")
              .trim()
              .toLowerCase();
            if (!txt && !title) return false;
            return (
              txt === ">" ||
              txt === ">>" ||
              txt.includes("next") ||
              txt.includes("след") ||
              title.includes("next")
            );
          }) || null;

          if (fallbackControl) {
            return { element: fallbackControl, strategy: "text-next", activePage };
          }

          return { element: null, strategy: "none", activePage };
        };

        let clickedNext = false;
        let nextStrategy = "none";
        const activePageBefore = getActivePage();
        const nextCandidate = findNextControl();
        if (nextCandidate?.element && !isDisabled(nextCandidate.element)) {
          clickedNext = clickElement(nextCandidate.element);
          nextStrategy = nextCandidate.strategy || "unknown";
        } else {
          const before = document.body ? document.body.scrollHeight : 0;
          window.scrollTo(0, before);
          nextStrategy = "scroll-only";
        }

        await new Promise((resolve) => setTimeout(resolve, 350));
        const activePageAfter = getActivePage();

        return {
          href: location.href,
          offers,
          domOffersCount: domOffers.length,
          filterApplied: Boolean(filterSetup?.applied),
          filterStrategy: filterSetup?.strategy || "unknown",
          authLikely,
          captchaLikely,
          clickedNext,
          nextStrategy,
          activePageBefore,
          activePageAfter,
          examinedNodes,
        };
      })();
    `;

    const deadline = Date.now() + maxWaitMs;
    let cycle = 0;
    let stagnantCycles = 0;
    let lastOfferCount = 0;

    while (Date.now() < deadline && cycle < maxAutoPages) {
      cycle += 1;
      let probe;
      try {
        probe = await runWithTimeout(
          worker.webContents.executeJavaScript(perCycleScript, true),
          9000,
          "Interactive probe timeout.",
        );
      } catch (error) {
        attempts.push({
          step: "interactive-probe-error",
          cycle,
          error: String(error),
        });
        if (progress) {
          progress(`Interactive probe failed (cycle ${cycle}): ${error.message}`, "warn");
        }
        await new Promise((resolve) => setTimeout(resolve, 2200));
        continue;
      }

      authLikely = authLikely || Boolean(probe?.authLikely);
      captchaLikely = captchaLikely || Boolean(probe?.captchaLikely);

      const cycleOffers = Array.isArray(probe?.offers) ? probe.offers : [];
      const parsePositivePage = (value) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) return null;
        return parsed;
      };
      const activePageBefore = parsePositivePage(probe?.activePageBefore);
      const activePageAfter = parsePositivePage(probe?.activePageAfter);
      cycleOffers.forEach((normalized) => {
        if (!normalized || typeof normalized !== "object") return;
        const key = buildMarketplaceOfferIdentityKey(normalized);
        if (!key) return;
        if (seenFirstOfferKeys.has(key)) return;
        seenFirstOfferKeys.add(key);
        firstOffers.push({
          ...normalized,
          source: "marketplace-buy-interactive-snapshot",
        });
      });

      attempts.push({
        step: "interactive-cycle",
        cycle,
        href: probe?.href || "",
        offersInCycle: cycleOffers.length,
        domOffersInCycle: Number.isFinite(Number(probe?.domOffersCount))
          ? Number(probe.domOffersCount)
          : 0,
        totalOffers: firstOffers.length,
        clickedNext: Boolean(probe?.clickedNext),
        nextStrategy: probe?.nextStrategy || "none",
        filterApplied: Boolean(probe?.filterApplied),
        filterStrategy: probe?.filterStrategy || "unknown",
        activePageBefore,
        activePageAfter,
        authLikely: Boolean(probe?.authLikely),
        captchaLikely: Boolean(probe?.captchaLikely),
        examinedNodes: probe?.examinedNodes || 0,
      });

      if (progress && (cycle <= 5 || cycle % 5 === 0)) {
        const pageBefore = activePageBefore === null ? "-" : String(activePageBefore);
        const pageAfter = activePageAfter === null ? "-" : String(activePageAfter);
        progress(
          `Interactive cycle ${cycle}: offersInCycle=${cycleOffers.length}, ` +
            `domOffers=${Number.isFinite(Number(probe?.domOffersCount)) ? Number(probe.domOffersCount) : 0}, ` +
            `filter=${probe?.filterApplied ? "yes" : "no"}(${probe?.filterStrategy || "unknown"}), ` +
            `total=${firstOffers.length}, clickedNext=${probe?.clickedNext ? "yes" : "no"}, ` +
            `strategy=${probe?.nextStrategy || "none"}, page=${pageBefore}->${pageAfter}.`,
        );
      }

      if (firstOffers.length > lastOfferCount) {
        if (progress) {
          progress(
            `Interactive scan captured offers: ${firstOffers.length} total (cycle ${cycle}).`,
          );
        }
        stagnantCycles = 0;
      } else {
        stagnantCycles += 1;
      }
      lastOfferCount = firstOffers.length;

      if (firstOffers.length >= 12 && stagnantCycles >= 4) {
        break;
      }
      if (firstOffers.length === 0 && cycle < 15) {
        await new Promise((resolve) => setTimeout(resolve, 2200));
        continue;
      }
      if (stagnantCycles >= 25) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 2200));
    }

    const elapsedMs = Date.now() - startedAt;
    const result = {
      success: firstOffers.length > 0,
      unauthorized: firstOffers.length === 0 && authLikely,
      hardUnauthorized: false,
      endpoint: "https://rollercoin.com/marketplace/buy",
      status: firstOffers.length > 0 ? 200 : 0,
      mode: "marketplace-buy-interactive-snapshot",
      marketplaceOffers: firstOffers,
      attempts: [
        ...attempts,
        {
          step: "interactive-summary",
          offers: firstOffers.length,
          authLikely,
          captchaLikely,
        },
      ],
    };

    if (progress) {
      if (result.success) {
        progress(
          `Interactive scan success: ${firstOffers.length} offers captured in ${elapsedMs} ms.`,
          "success",
        );
      } else if (result.unauthorized) {
        progress(
          `Interactive scan unauthorized after ${elapsedMs} ms. ` +
            "No valid offers captured from page state.",
          "warn",
        );
      } else {
        progress(
          `Interactive scan finished without valid offers in ${elapsedMs} ms. ` +
            `captchaLikely=${captchaLikely ? "yes" : "no"}.`,
          "warn",
        );
      }
    }

    if (!result.success && !result.unauthorized && !result.error) {
      result.error = "Interactive scan finished but did not capture miner offers.";
    }

    return result;
  } catch (error) {
    if (progress) {
      progress(`Interactive scan crashed: ${error.message}`, "error");
    }
    return {
      success: false,
      unauthorized: false,
      hardUnauthorized: false,
      error: `Interactive scan failed: ${error.message}`,
      attempts,
    };
  } finally {
    await closeWindowGracefully(worker);
  }
}

async function captureMarketViaDebugger(endpoints, progress = null) {
  const startedAt = Date.now();
  const worker = createHiddenWorkerWindow({});

  const endpointPaths = endpoints
    .map((endpoint) => {
      try {
        return new URL(endpoint).pathname;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const debuggerSession = worker.webContents.debugger;
  const attempts = [];

  try {
    if (progress) {
      progress("Starting debugger strategy on /game/market/miners ...");
    }
    debuggerSession.attach("1.3");
    try {
      await runWithTimeout(
        debuggerSession.sendCommand("Network.enable"),
        15000,
        "Debugger Network.enable timed out.",
      );
    } catch (error) {
      attempts.push({ type: "debugger-enable-error", error: String(error) });
      if (progress) {
        progress(`Debugger Network.enable failed: ${error.message || String(error)}`, "warn");
      }
      throw error;
    }

    const result = await runWithTimeout(new Promise((resolve) => {
      let finished = false;
      let timeoutId = null;
      let onMessage = null;
      let onDidNavigate = null;

      const finalize = (result) => {
        if (finished) return;
        finished = true;

        if (timeoutId) clearTimeout(timeoutId);
        if (onMessage) debuggerSession.removeListener("message", onMessage);
        if (onDidNavigate) worker.webContents.removeListener("did-navigate", onDidNavigate);

        resolve(result);
      };

      onDidNavigate = (_event, url) => {
        attempts.push({ type: "navigate", url });
        if (url.includes("/sign-in")) {
          if (progress) {
            progress("Debugger strategy redirected to sign-in page (session not authorized).", "warn");
          }
          finalize({
            success: false,
            unauthorized: true,
            hardUnauthorized: true,
            error: "Session is not authenticated (redirected to sign-in).",
            attempts,
          });
        }
      };

      onMessage = async (_event, method, params) => {
        if (method !== "Network.responseReceived") return;

        const url = params?.response?.url || "";
        if (!endpointPaths.some((pathName) => url.includes(pathName))) return;

        const status = Number(params?.response?.status || 0);
        attempts.push({ type: "response", url, status });
        if (progress) {
          progress(`Debugger saw market response: HTTP ${status} (${url}).`);
        }

        if (status !== 200) return;

        try {
          const bodyResult = await debuggerSession.sendCommand("Network.getResponseBody", {
            requestId: params.requestId,
          });
          const rawBody = bodyResult?.base64Encoded
            ? Buffer.from(bodyResult.body, "base64").toString("utf8")
            : bodyResult.body;

          const json = JSON.parse(rawBody);
          if (json && typeof json === "object") {
            finalize({
              success: true,
              endpoint: url,
              status,
              json,
              attempts,
              via: "debugger",
            });
          }
        } catch (error) {
          attempts.push({
            type: "parse-error",
            url,
            error: String(error),
          });
        }
      };

      debuggerSession.on("message", onMessage);
      worker.webContents.on("did-navigate", onDidNavigate);

      timeoutId = setTimeout(() => {
        if (progress) {
          progress("Debugger strategy timeout: no suitable market response in 30s.", "warn");
        }
        finalize({
          success: false,
          error: "Timed out waiting for market API response from in-app session.",
          attempts,
        });
      }, 30000);

      worker.loadURL("https://rollercoin.com/game/market/miners").catch((error) => {
        finalize({
          success: false,
          error: `Navigation failed: ${error.message}`,
          attempts,
        });
      });
    }), 20000, "Debugger hard timeout (20s).");

    if (progress) {
      const elapsedMs = Date.now() - startedAt;
      if (result.success) {
        progress(`Debugger strategy success in ${elapsedMs} ms.`, "success");
      } else {
        progress(`Debugger strategy failed in ${elapsedMs} ms: ${result.error || "unknown error"}.`, "warn");
      }
    }
    return result;
  } catch (error) {
    if (progress) {
      progress(`Debugger strategy crashed: ${error.message}`, "error");
    }
    return {
      success: false,
      error: `Debugger strategy failed: ${error.message}`,
      attempts,
    };
  } finally {
    if (debuggerSession.isAttached()) {
      try {
        debuggerSession.detach();
      } catch {
        // Ignore debugger detach errors.
      }
    }
    await closeWindowGracefully(worker);
  }
}

async function fetchMarketViaSession(options = {}, progress = null) {
  const normalizedOptions = normalizeMarketFetchOptions(options);
  if (progress) {
    progress(`Market fetch started in ${normalizedOptions.refreshMode} mode. Trying direct market API first.`);
  }

  const cookieHeader =
    options && typeof options === "object" && typeof options.cookieHeader === "string"
      ? options.cookieHeader
      : "";

  try {
    const result = finalizeMarketFetchResult(
      await fetchMarketMinersViaDirectApi(cookieHeader, progress, normalizedOptions),
      normalizedOptions,
    );
    if (progress) {
      if (result.success) {
        progress(
          `Direct market API finished successfully with ${result.marketplaceOffers?.length || 0} offers.`,
          "success",
        );
      } else {
        progress(
          `Direct market API failed: ${result.error || "unknown error"}.`,
          result.unauthorized ? "warn" : "error",
        );
      }
    }
    if (result.success) {
      return result;
    }

    if (progress) {
      progress("Trying browser-session API as a fallback...", "warn");
    }

    const fallbackResult = finalizeMarketFetchResult(
      await fetchMarketMinersViaBrowserSession(cookieHeader, progress, normalizedOptions),
      normalizedOptions,
    );
    if (progress) {
      if (fallbackResult.success) {
        progress(
          `Browser-session market API fallback finished successfully with ${fallbackResult.marketplaceOffers?.length || 0} offers.`,
          "success",
        );
      } else {
        progress(
          `Browser-session market API fallback failed: ${fallbackResult.error || "unknown error"}.`,
          fallbackResult.unauthorized ? "warn" : "error",
        );
      }
    }

    if (fallbackResult.success) {
      return fallbackResult;
    }
    if (!fallbackResult.success && result.error) {
      return finalizeMarketFetchResult({
        ...fallbackResult,
        attempts: [
          ...(Array.isArray(result.attempts) ? result.attempts : []),
          ...(Array.isArray(fallbackResult.attempts) ? fallbackResult.attempts : []),
        ],
        error: `${result.error} | Browser fallback: ${fallbackResult.error || "unknown error"}`,
      }, normalizedOptions);
    }

    return finalizeMarketFetchResult(fallbackResult, normalizedOptions);
  } catch (error) {
    if (progress) {
      progress(`Market fetch crashed: ${error.message}`, "error");
    }
    return finalizeMarketFetchResult({
      success: false,
      error: `Market fetch failed: ${error.message}`,
    }, normalizedOptions);
  }
}

async function probeRollercoinAuthStatus(preferredCookieHeader = "") {
  const authSession = session.fromPartition(ROLLERCOIN_PARTITION);
  if (typeof preferredCookieHeader === "string" && preferredCookieHeader.trim()) {
    await syncCookieHeaderToSession(preferredCookieHeader, authSession);
  }

  const sessionInfo = await readRollercoinCookies(authSession);
  const worker = createHiddenWorkerWindow({
    width: 1180,
    height: 860,
    title: "RollerCoin Auth Probe",
  });

  try {
    await runWithTimeout(
      worker.loadURL("https://rollercoin.com/marketplace/buy?itemType=miner"),
      15000,
      "Auth probe bootstrap timeout (15s).",
    );

    const raw = await runWithTimeout(
      worker.webContents.executeJavaScript(
        `
        (async () => {
          const REQUEST_TIMEOUT_MS = 4000;
          const queryProfiles = [
            { label: "basic-limit100", limit: ${MARKET_PAGE_LIMIT}, includeFilters: false },
            { label: "filtered-limit12", limit: 12, includeFilters: true },
            { label: "filtered-limit100", limit: ${MARKET_PAGE_LIMIT}, includeFilters: true },
            { label: "basic-limit12", limit: 12, includeFilters: false },
          ];

          const fetchWithTimeout = async (url, options, timeoutMs) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
              return await fetch(url, {
                ...options,
                signal: controller.signal,
              });
            } finally {
              clearTimeout(timer);
            }
          };

          const getByPath = (obj, path) => {
            if (!obj || typeof obj !== "object") return undefined;
            const parts = path.split(".");
            let current = obj;
            for (const part of parts) {
              if (!current || typeof current !== "object" || !(part in current)) return undefined;
              current = current[part];
            }
            return current;
          };

          const extractRows = (payload) => {
            const root = payload && typeof payload === "object" ? (payload.data ?? payload) : null;
            if (!root || typeof root !== "object") return [];

            const directCandidates = [
              root.items,
              root.rows,
              root.results,
              root.sale_orders,
              root.orders,
              root.list,
            ].filter(Array.isArray);

            for (const candidate of directCandidates) {
              if (candidate.length > 0 && candidate.every((entry) => entry && typeof entry === "object")) {
                return candidate;
              }
            }

            return [];
          };

          const tokenCandidates = [];
          try {
            for (let i = 0; i < localStorage.length; i += 1) {
              const key = localStorage.key(i);
              const value = localStorage.getItem(key);
              if (!value) continue;
              const lowerKey = String(key).toLowerCase();
              const looksLikeTokenKey = /token|auth|jwt|access/.test(lowerKey);
              const looksLikeJwt = /^eyJ[A-Za-z0-9_-]+\\./.test(value);
              if (looksLikeTokenKey || looksLikeJwt) {
                tokenCandidates.push({ key, value });
              }
            }
          } catch {
            // Ignore localStorage read failures.
          }

          const normalizeTokenValues = (value) => {
            if (!value) return [];
            const collected = [];
            const pushIfValid = (candidate) => {
              if (typeof candidate !== "string") return;
              const trimmed = candidate.trim().replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");
              if (!trimmed) return;
              if (/^Bearer\s+/i.test(trimmed)) {
                collected.push(trimmed);
                collected.push(trimmed.replace(/^Bearer\s+/i, ""));
                return;
              }
              collected.push(trimmed);
            };

            pushIfValid(value);

            try {
              const parsed = JSON.parse(value);
              const queue = [parsed];
              const seen = new WeakSet();
              while (queue.length > 0) {
                const current = queue.shift();
                if (!current) continue;
                if (typeof current === "string") {
                  pushIfValid(current);
                  continue;
                }
                if (Array.isArray(current)) {
                  current.forEach((entry) => {
                    if (typeof entry === "string") {
                      pushIfValid(entry);
                    } else if (entry && typeof entry === "object" && !seen.has(entry)) {
                      seen.add(entry);
                      queue.push(entry);
                    }
                  });
                  continue;
                }
                if (typeof current === "object") {
                  Object.entries(current).forEach(([key, entry]) => {
                    if (/token|auth|jwt|access/i.test(String(key))) {
                      if (typeof entry === "string") {
                        pushIfValid(entry);
                      } else if (entry && typeof entry === "object" && !seen.has(entry)) {
                        seen.add(entry);
                        queue.push(entry);
                      }
                    }
                  });
                }
              }
            } catch {
              // Ignore non-JSON token values.
            }

            return [...new Set(collected)];
          };

          const uniqueTokens = [];
          const seenTokens = new Set();
          for (const item of tokenCandidates) {
            const normalizedValues = normalizeTokenValues(item.value);
            normalizedValues.forEach((value) => {
              if (!value || seenTokens.has(value)) return;
              seenTokens.add(value);
              uniqueTokens.push(value);
            });
          }

          const headerVariants = [{ label: "cookie-only", headers: {} }];
          uniqueTokens.forEach((token) => {
            const clean = token.replace(/^Bearer\s+/i, "");
            headerVariants.push({
              label: "authorization-bearer",
              headers: { Authorization: "Bearer " + clean },
            });
            headerVariants.push({
              label: "authorization-raw",
              headers: { Authorization: token },
            });
            headerVariants.push({
              label: "x-access-token",
              headers: { "x-access-token": clean },
            });
            headerVariants.push({
              label: "x-auth-token",
              headers: { "x-auth-token": clean },
            });
            headerVariants.push({
              label: "token",
              headers: { token: clean },
            });
          });

          const buildUrl = (page, profile) => {
            const effectiveLimit =
              profile && Number.isFinite(Number(profile.limit)) && Number(profile.limit) > 0
                ? Math.floor(Number(profile.limit))
                : ${MARKET_PAGE_LIMIT};
            const params = new URLSearchParams();
            params.set("currency", "RLT");
            params.set("itemType", "miner");
            params.set("sort[field]", "date");
            params.set("sort[order]", "-1");
            params.set("skip", String((page - 1) * effectiveLimit));
            params.set("limit", String(effectiveLimit));
            if (profile && profile.includeFilters) {
              params.set("filter[0][name]", "price");
              params.set("filter[0][min]", "0");
              params.set("filter[0][max]", "3439000000");
              params.set("filter[1][name]", "power");
              params.set("filter[1][min]", "1");
              params.set("filter[1][max]", "1380000000");
              params.set("filter[2][name]", "miner_bonus");
              params.set("filter[2][min]", "0");
              params.set("filter[2][max]", "70");
            }
            return "https://rollercoin.com/api/marketplace/buy/sale-orders?" + params.toString();
          };

          const attempts = [];
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          for (let probePass = 1; probePass <= 3; probePass += 1) {
            attempts.push({ step: "probe-pass", pass: probePass });
            for (const profile of queryProfiles) {
              for (const variant of headerVariants) {
                const url = buildUrl(1, profile);
                try {
                  const response = await fetchWithTimeout(url, {
                    method: "GET",
                    credentials: "include",
                    headers: {
                      Accept: "application/json, text/plain, */*",
                      "Cache-Control": "no-cache",
                      Pragma: "no-cache",
                      ...variant.headers,
                    },
                  }, REQUEST_TIMEOUT_MS);

                  const text = await response.text();
                  let json = null;
                  try {
                    json = JSON.parse(text);
                  } catch {
                    // Keep non-JSON payload as raw text.
                  }

                  const rows = json && typeof json === "object" ? extractRows(json) : [];
                  attempts.push({
                    step: "probe-response",
                    pass: probePass,
                    profile: profile.label,
                    variant: variant.label,
                    status: response.status,
                    rows: rows.length,
                  });

                  if (response.ok && rows.length > 0) {
                    return {
                      authenticated: true,
                      message: "RollerCoin session is active.",
                      href: location.href,
                      selectedQueryProfile: profile.label,
                      selectedAuthVariant: variant.label,
                      tokenCount: uniqueTokens.length,
                      attempts,
                    };
                  }
                } catch (error) {
                  attempts.push({
                    step: "probe-request-error",
                    pass: probePass,
                    profile: profile.label,
                    variant: variant.label,
                    status: 0,
                    error: String(error),
                  });
                }
              }
            }

            if (probePass < 3) {
              await wait(900 * probePass);
            }
          }

          return {
            authenticated: false,
            message: "RollerCoin session is not authorized. Login is required.",
            href: location.href,
            tokenCount: uniqueTokens.length,
            attempts,
          };
        })();
        `,
        true,
      ),
      30000,
      "Auth probe executeJavaScript timeout (30s).",
    );

    const result = parseWorkerResult(raw);
    return {
      authenticated: Boolean(result.authenticated),
      message:
        typeof result.message === "string" && result.message.trim()
          ? result.message
          : (result.authenticated
              ? "RollerCoin session is active."
              : "RollerCoin session is not authorized. Login is required."),
      cookieCount: sessionInfo.cookieCount,
      hasSessionCookie: sessionInfo.hasSessionCookie,
      href: result.href || worker.webContents.getURL(),
      selectedQueryProfile: result.selectedQueryProfile || null,
      selectedAuthVariant: result.selectedAuthVariant || null,
      tokenCount: Number.isFinite(Number(result.tokenCount)) ? Number(result.tokenCount) : 0,
      attempts: Array.isArray(result.attempts) ? result.attempts : [],
    };
  } catch (error) {
    return {
      authenticated: false,
      message: `Auth check failed: ${error.message}`,
      cookieCount: sessionInfo.cookieCount,
      hasSessionCookie: sessionInfo.hasSessionCookie,
      href: worker.webContents.getURL(),
      attempts: [],
    };
  } finally {
    await closeWindowGracefully(worker);
  }
}

async function fetchRollercoinCurrentPower(preferredCookieHeader = "") {
  const authSession = session.fromPartition(ROLLERCOIN_PARTITION);
  if (typeof preferredCookieHeader === "string" && preferredCookieHeader.trim()) {
    await syncCookieHeaderToSession(preferredCookieHeader, authSession);
  }

  const sessionInfo = await readRollercoinCookies(authSession);
  const cookieHeader =
    typeof preferredCookieHeader === "string" && preferredCookieHeader.trim()
      ? preferredCookieHeader.trim()
      : sessionInfo.cookieHeader;

  const directEndpoint = "https://rollercoin.com/api/profile/user-power-data";
  if (cookieHeader) {
    try {
      const directResponse = await requestJsonWithCookieHeader(directEndpoint, cookieHeader);
      if (directResponse.statusCode >= 200 && directResponse.statusCode < 300 && directResponse.json) {
        const powerSnapshot = extractRollercoinCurrentPowerPayload(directResponse.json);
        return {
          success: true,
          sourcePath: "direct-user-power-data-api",
          selectedAuthVariant: "cookie-only",
          cookieCount: sessionInfo.cookieCount,
          hasSessionCookie: sessionInfo.hasSessionCookie,
          ...powerSnapshot,
        };
      }
    } catch {
      // Fall through to browser-session fallback.
    }
  }

  const worker = createHiddenWorkerWindow({
    width: 1100,
    height: 800,
    title: "RollerCoin Current Power Worker",
  });

  try {
    await runWithTimeout(
      worker.loadURL("https://rollercoin.com/"),
      15000,
      "Current power worker bootstrap timeout (15s).",
    );

    const raw = await runWithTimeout(
      worker.webContents.executeJavaScript(
        `
        (async () => {
          const REQUEST_TIMEOUT_MS = 5000;
          const endpoint = "https://rollercoin.com/api/profile/user-power-data";
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

          const fetchWithTimeout = async (url, options, timeoutMs) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
              return await fetch(url, {
                ...options,
                signal: controller.signal,
              });
            } finally {
              clearTimeout(timer);
            }
          };

          const tokenCandidates = [];
          try {
            for (let index = 0; index < localStorage.length; index += 1) {
              const key = localStorage.key(index);
              const value = localStorage.getItem(key);
              if (!value) continue;
              const lowerKey = String(key).toLowerCase();
              if (/token|auth|jwt|access/.test(lowerKey) || /^eyJ[A-Za-z0-9_-]+\\./.test(value)) {
                tokenCandidates.push({ key, value });
              }
            }
          } catch {
            // Ignore localStorage access issues.
          }

          const normalizeTokenValues = (value) => {
            if (!value) return [];
            const collected = [];
            const pushIfValid = (candidate) => {
              if (typeof candidate !== "string") return;
              const trimmed = candidate.trim().replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");
              if (!trimmed) return;
              if (/^Bearer\\s+/i.test(trimmed)) {
                collected.push(trimmed);
                collected.push(trimmed.replace(/^Bearer\\s+/i, ""));
                return;
              }
              collected.push(trimmed);
            };

            pushIfValid(value);
            try {
              const parsed = JSON.parse(value);
              const queue = [parsed];
              const seen = new WeakSet();
              while (queue.length > 0) {
                const current = queue.shift();
                if (!current) continue;
                if (typeof current === "string") {
                  pushIfValid(current);
                  continue;
                }
                if (Array.isArray(current)) {
                  current.forEach((entry) => {
                    if (typeof entry === "string") {
                      pushIfValid(entry);
                    } else if (entry && typeof entry === "object" && !seen.has(entry)) {
                      seen.add(entry);
                      queue.push(entry);
                    }
                  });
                  continue;
                }
                if (typeof current === "object") {
                  Object.entries(current).forEach(([key, entry]) => {
                    if (/token|auth|jwt|access/i.test(String(key))) {
                      if (typeof entry === "string") {
                        pushIfValid(entry);
                      } else if (entry && typeof entry === "object" && !seen.has(entry)) {
                        seen.add(entry);
                        queue.push(entry);
                      }
                    }
                  });
                }
              }
            } catch {
              // Ignore non-JSON token values.
            }

            return [...new Set(collected)];
          };

          const uniqueTokens = [];
          const seenTokens = new Set();
          for (const item of tokenCandidates) {
            const normalizedValues = normalizeTokenValues(item.value);
            normalizedValues.forEach((value) => {
              if (!value || seenTokens.has(value)) return;
              seenTokens.add(value);
              uniqueTokens.push(value);
            });
          }

          const headerVariants = [{ label: "cookie-only", headers: {} }];
          uniqueTokens.forEach((token) => {
            const clean = token.replace(/^Bearer\\s+/i, "");
            headerVariants.push({ label: "authorization-bearer", headers: { Authorization: "Bearer " + clean } });
            headerVariants.push({ label: "authorization-raw", headers: { Authorization: token } });
            headerVariants.push({ label: "x-access-token", headers: { "x-access-token": clean } });
            headerVariants.push({ label: "x-auth-token", headers: { "x-auth-token": clean } });
            headerVariants.push({ label: "token", headers: { token: clean } });
          });

          const attempts = [];
          for (let pass = 1; pass <= 3; pass += 1) {
            for (const variant of headerVariants) {
              try {
                const response = await fetchWithTimeout(endpoint, {
                  method: "GET",
                  credentials: "include",
                  cache: "no-store",
                  headers: {
                    Accept: "application/json, text/plain, */*",
                    "Cache-Control": "no-cache",
                    Pragma: "no-cache",
                    ...variant.headers,
                  },
                }, REQUEST_TIMEOUT_MS);

                const text = await response.text();
                let json = null;
                try {
                  json = JSON.parse(text);
                } catch {
                  // Keep text-only failures out of the success path.
                }

                attempts.push({
                  step: "user-power-response",
                  pass,
                  variant: variant.label,
                  status: response.status,
                });

                if (response.ok && json && typeof json === "object") {
                  return {
                    success: true,
                    json,
                    selectedAuthVariant: variant.label,
                    tokenCount: uniqueTokens.length,
                    attempts,
                  };
                }
              } catch (error) {
                attempts.push({
                  step: "user-power-request-error",
                  pass,
                  variant: variant.label,
                  error: String(error),
                });
              }
            }

            if (pass < 3) {
              await wait(700 * pass);
            }
          }

          return {
            success: false,
            unauthorized: true,
            error: "RollerCoin current power API rejected the session.",
            tokenCount: uniqueTokens.length,
            attempts,
          };
        })();
        `,
        true,
      ),
      45000,
      "Current power executeJavaScript timeout (45s).",
    );

    const result = parseWorkerResult(raw);
    if (!result.success || !result.json) {
      return {
        success: false,
        unauthorized: Boolean(result.unauthorized),
        error: result.error || "RollerCoin current power API rejected the session.",
        cookieCount: sessionInfo.cookieCount,
        hasSessionCookie: sessionInfo.hasSessionCookie,
        selectedAuthVariant: result.selectedAuthVariant || null,
        attempts: Array.isArray(result.attempts) ? result.attempts : [],
      };
    }

    const powerSnapshot = extractRollercoinCurrentPowerPayload(result.json);
    return {
      success: true,
      sourcePath: "browser-session-user-power-data-api",
      selectedAuthVariant: result.selectedAuthVariant || null,
      tokenCount: Number.isFinite(Number(result.tokenCount)) ? Number(result.tokenCount) : 0,
      cookieCount: sessionInfo.cookieCount,
      hasSessionCookie: sessionInfo.hasSessionCookie,
      attempts: Array.isArray(result.attempts) ? result.attempts : [],
      ...powerSnapshot,
    };
  } catch (error) {
    return {
      success: false,
      error: `Current power fetch failed: ${error.message}`,
      cookieCount: sessionInfo.cookieCount,
      hasSessionCookie: sessionInfo.hasSessionCookie,
      attempts: [],
    };
  } finally {
    await closeWindowGracefully(worker);
  }
}

async function fetchRollercoinRoomConfig(preferredCookieHeader = "", roomConfigRef = "") {
  const authSession = session.fromPartition(ROLLERCOIN_PARTITION);
  if (typeof preferredCookieHeader === "string" && preferredCookieHeader.trim()) {
    await syncCookieHeaderToSession(preferredCookieHeader, authSession);
  }

  const sessionInfo = await readRollercoinCookies(authSession);
  const cookieHeader =
    typeof preferredCookieHeader === "string" && preferredCookieHeader.trim()
      ? preferredCookieHeader.trim()
      : sessionInfo.cookieHeader;
  const explicitRoomConfigId = parseRoomConfigReference(roomConfigRef);
  let resolvedProfileId = "";
  let profileAttempts = [];

  if (!explicitRoomConfigId) {
    const profileEndpoint = "https://rollercoin.com/api/profile/user-profile-data";

    if (cookieHeader) {
      try {
        const directProfileResponse = await requestJsonWithCookieHeader(profileEndpoint, cookieHeader);
        if (
          directProfileResponse.statusCode >= 200 &&
          directProfileResponse.statusCode < 300 &&
          directProfileResponse.json
        ) {
          resolvedProfileId = extractRollercoinProfileId(directProfileResponse.json);
        }
      } catch {
        // Fall through to browser-session fallback.
      }
    }

    if (!resolvedProfileId) {
      const profileWorker = createHiddenWorkerWindow({
        width: 1100,
        height: 800,
        title: "RollerCoin Profile Worker",
      });

      try {
        await runWithTimeout(
          profileWorker.loadURL("https://rollercoin.com/"),
          15000,
          "Profile worker bootstrap timeout (15s).",
        );

        const rawProfile = await runWithTimeout(
          profileWorker.webContents.executeJavaScript(
            `
            (async () => {
              const REQUEST_TIMEOUT_MS = 5000;
              const endpoint = "https://rollercoin.com/api/profile/user-profile-data";
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

              const fetchWithTimeout = async (url, options, timeoutMs) => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                try {
                  return await fetch(url, {
                    ...options,
                    signal: controller.signal,
                  });
                } finally {
                  clearTimeout(timer);
                }
              };

              const tokenCandidates = [];
              try {
                for (let index = 0; index < localStorage.length; index += 1) {
                  const key = localStorage.key(index);
                  const value = localStorage.getItem(key);
                  if (!value) continue;
                  const lowerKey = String(key).toLowerCase();
                  if (/token|auth|jwt|access/.test(lowerKey) || /^eyJ[A-Za-z0-9_-]+\\./.test(value)) {
                    tokenCandidates.push({ key, value });
                  }
                }
              } catch {
                // Ignore localStorage access issues.
              }

              const normalizeTokenValues = (value) => {
                if (!value) return [];
                const collected = [];
                const pushIfValid = (candidate) => {
                  if (typeof candidate !== "string") return;
                  const trimmed = candidate.trim().replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");
                  if (!trimmed) return;
                  if (/^Bearer\\s+/i.test(trimmed)) {
                    collected.push(trimmed);
                    collected.push(trimmed.replace(/^Bearer\\s+/i, ""));
                    return;
                  }
                  collected.push(trimmed);
                };

                pushIfValid(value);
                try {
                  const parsed = JSON.parse(value);
                  const queue = [parsed];
                  const seen = new WeakSet();
                  while (queue.length > 0) {
                    const current = queue.shift();
                    if (!current) continue;
                    if (typeof current === "string") {
                      pushIfValid(current);
                      continue;
                    }
                    if (Array.isArray(current)) {
                      current.forEach((entry) => {
                        if (typeof entry === "string") {
                          pushIfValid(entry);
                        } else if (entry && typeof entry === "object" && !seen.has(entry)) {
                          seen.add(entry);
                          queue.push(entry);
                        }
                      });
                      continue;
                    }
                    if (typeof current === "object") {
                      Object.entries(current).forEach(([key, entry]) => {
                        if (/token|auth|jwt|access/i.test(String(key))) {
                          if (typeof entry === "string") {
                            pushIfValid(entry);
                          } else if (entry && typeof entry === "object" && !seen.has(entry)) {
                            seen.add(entry);
                            queue.push(entry);
                          }
                        }
                      });
                    }
                  }
                } catch {
                  // Ignore non-JSON token values.
                }

                return [...new Set(collected)];
              };

              const uniqueTokens = [];
              const seenTokens = new Set();
              for (const item of tokenCandidates) {
                const normalizedValues = normalizeTokenValues(item.value);
                normalizedValues.forEach((value) => {
                  if (!value || seenTokens.has(value)) return;
                  seenTokens.add(value);
                  uniqueTokens.push(value);
                });
              }

              const headerVariants = [{ label: "cookie-only", headers: {} }];
              uniqueTokens.forEach((token) => {
                const clean = token.replace(/^Bearer\\s+/i, "");
                headerVariants.push({ label: "authorization-bearer", headers: { Authorization: "Bearer " + clean } });
                headerVariants.push({ label: "authorization-raw", headers: { Authorization: token } });
                headerVariants.push({ label: "x-access-token", headers: { "x-access-token": clean } });
                headerVariants.push({ label: "x-auth-token", headers: { "x-auth-token": clean } });
                headerVariants.push({ label: "token", headers: { token: clean } });
              });

              const attempts = [];
              for (let pass = 1; pass <= 3; pass += 1) {
                for (const variant of headerVariants) {
                  try {
                    const response = await fetchWithTimeout(endpoint, {
                      method: "GET",
                      credentials: "include",
                      cache: "no-store",
                      headers: {
                        Accept: "application/json, text/plain, */*",
                        "Cache-Control": "no-cache",
                        Pragma: "no-cache",
                        ...variant.headers,
                      },
                    }, REQUEST_TIMEOUT_MS);

                    const text = await response.text();
                    let json = null;
                    try {
                      json = JSON.parse(text);
                    } catch {
                      // Keep text-only failures out of the success path.
                    }

                    attempts.push({
                      step: "user-profile-response",
                      pass,
                      variant: variant.label,
                      status: response.status,
                    });

                    if (response.ok && json && typeof json === "object") {
                      return {
                        success: true,
                        json,
                        selectedAuthVariant: variant.label,
                        tokenCount: uniqueTokens.length,
                        attempts,
                      };
                    }
                  } catch (error) {
                    attempts.push({
                      step: "user-profile-request-error",
                      pass,
                      variant: variant.label,
                      error: String(error),
                    });
                  }
                }

                if (pass < 3) {
                  await wait(700 * pass);
                }
              }

              return {
                success: false,
                unauthorized: true,
                error: "RollerCoin profile API rejected the session.",
                tokenCount: uniqueTokens.length,
                attempts,
              };
            })();
            `,
            true,
          ),
          45000,
          "Profile executeJavaScript timeout (45s).",
        );

        const profileResult = parseWorkerResult(rawProfile);
        profileAttempts = Array.isArray(profileResult.attempts) ? profileResult.attempts : [];
        if (!profileResult.success || !profileResult.json) {
          return {
            success: false,
            unauthorized: Boolean(profileResult.unauthorized),
            error: profileResult.error || "RollerCoin profile API rejected the session.",
            endpoint: buildRollercoinRoomConfigEndpoint(""),
            roomConfigId: "",
            requestedProfileId: "",
            cookieCount: sessionInfo.cookieCount,
            hasSessionCookie: sessionInfo.hasSessionCookie,
            selectedAuthVariant: profileResult.selectedAuthVariant || null,
            attempts: profileAttempts,
          };
        }

        resolvedProfileId = extractRollercoinProfileId(profileResult.json);
      } catch (error) {
        return {
          success: false,
          error: `Profile lookup failed: ${error.message}`,
          endpoint: buildRollercoinRoomConfigEndpoint(""),
          roomConfigId: "",
          requestedProfileId: "",
          cookieCount: sessionInfo.cookieCount,
          hasSessionCookie: sessionInfo.hasSessionCookie,
          attempts: profileAttempts,
        };
      } finally {
        await closeWindowGracefully(profileWorker);
      }
    }
  }

  const requestTargetId = explicitRoomConfigId || resolvedProfileId;
  const endpoint = buildRollercoinRoomConfigEndpoint(requestTargetId);

  if (cookieHeader) {
    try {
      const directResponse = await requestJsonWithCookieHeader(endpoint, cookieHeader);
      if (directResponse.statusCode >= 200 && directResponse.statusCode < 300 && directResponse.json) {
        const roomSnapshot = extractRollercoinRoomMinersPayload(directResponse.json);
        return {
          success: true,
          endpoint,
          roomConfigId: roomSnapshot.roomConfigId || explicitRoomConfigId || "",
          requestedProfileId: resolvedProfileId,
          sourcePath: "direct-room-config-api",
          selectedAuthVariant: "cookie-only",
          cookieCount: sessionInfo.cookieCount,
          hasSessionCookie: sessionInfo.hasSessionCookie,
          attempts: profileAttempts,
          ...roomSnapshot,
        };
      }
    } catch {
      // Fall through to browser-session fallback.
    }
  }

  const worker = createHiddenWorkerWindow({
    width: 1100,
    height: 800,
    title: "RollerCoin Room Config Worker",
  });

  try {
    await runWithTimeout(
      worker.loadURL("https://rollercoin.com/"),
      15000,
      "Room config worker bootstrap timeout (15s).",
    );

    const raw = await runWithTimeout(
      worker.webContents.executeJavaScript(
        `
        (async () => {
          const REQUEST_TIMEOUT_MS = 5000;
          const endpoint = ${JSON.stringify(endpoint)};
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

          const fetchWithTimeout = async (url, options, timeoutMs) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
              return await fetch(url, {
                ...options,
                signal: controller.signal,
              });
            } finally {
              clearTimeout(timer);
            }
          };

          const tokenCandidates = [];
          try {
            for (let index = 0; index < localStorage.length; index += 1) {
              const key = localStorage.key(index);
              const value = localStorage.getItem(key);
              if (!value) continue;
              const lowerKey = String(key).toLowerCase();
              if (/token|auth|jwt|access/.test(lowerKey) || /^eyJ[A-Za-z0-9_-]+\\./.test(value)) {
                tokenCandidates.push({ key, value });
              }
            }
          } catch {
            // Ignore localStorage access issues.
          }

          const normalizeTokenValues = (value) => {
            if (!value) return [];
            const collected = [];
            const pushIfValid = (candidate) => {
              if (typeof candidate !== "string") return;
              const trimmed = candidate.trim().replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");
              if (!trimmed) return;
              if (/^Bearer\\s+/i.test(trimmed)) {
                collected.push(trimmed);
                collected.push(trimmed.replace(/^Bearer\\s+/i, ""));
                return;
              }
              collected.push(trimmed);
            };

            pushIfValid(value);
            try {
              const parsed = JSON.parse(value);
              const queue = [parsed];
              const seen = new WeakSet();
              while (queue.length > 0) {
                const current = queue.shift();
                if (!current) continue;
                if (typeof current === "string") {
                  pushIfValid(current);
                  continue;
                }
                if (Array.isArray(current)) {
                  current.forEach((entry) => {
                    if (typeof entry === "string") {
                      pushIfValid(entry);
                    } else if (entry && typeof entry === "object" && !seen.has(entry)) {
                      seen.add(entry);
                      queue.push(entry);
                    }
                  });
                  continue;
                }
                if (typeof current === "object") {
                  Object.entries(current).forEach(([key, entry]) => {
                    if (/token|auth|jwt|access/i.test(String(key))) {
                      if (typeof entry === "string") {
                        pushIfValid(entry);
                      } else if (entry && typeof entry === "object" && !seen.has(entry)) {
                        seen.add(entry);
                        queue.push(entry);
                      }
                    }
                  });
                }
              }
            } catch {
              // Ignore non-JSON token values.
            }

            return [...new Set(collected)];
          };

          const uniqueTokens = [];
          const seenTokens = new Set();
          for (const item of tokenCandidates) {
            const normalizedValues = normalizeTokenValues(item.value);
            normalizedValues.forEach((value) => {
              if (!value || seenTokens.has(value)) return;
              seenTokens.add(value);
              uniqueTokens.push(value);
            });
          }

          const headerVariants = [{ label: "cookie-only", headers: {} }];
          uniqueTokens.forEach((token) => {
            const clean = token.replace(/^Bearer\\s+/i, "");
            headerVariants.push({ label: "authorization-bearer", headers: { Authorization: "Bearer " + clean } });
            headerVariants.push({ label: "authorization-raw", headers: { Authorization: token } });
            headerVariants.push({ label: "x-access-token", headers: { "x-access-token": clean } });
            headerVariants.push({ label: "x-auth-token", headers: { "x-auth-token": clean } });
            headerVariants.push({ label: "token", headers: { token: clean } });
          });

          const attempts = [];
          for (let pass = 1; pass <= 3; pass += 1) {
            for (const variant of headerVariants) {
              try {
                const response = await fetchWithTimeout(endpoint, {
                  method: "GET",
                  credentials: "include",
                  cache: "no-store",
                  headers: {
                    Accept: "application/json, text/plain, */*",
                    "Cache-Control": "no-cache",
                    Pragma: "no-cache",
                    ...variant.headers,
                  },
                }, REQUEST_TIMEOUT_MS);

                const text = await response.text();
                let json = null;
                try {
                  json = JSON.parse(text);
                } catch {
                  // Keep text-only failures out of the success path.
                }

                attempts.push({
                  step: "room-config-response",
                  pass,
                  variant: variant.label,
                  status: response.status,
                });

                if (response.ok && json && typeof json === "object") {
                  return {
                    success: true,
                    json,
                    selectedAuthVariant: variant.label,
                    tokenCount: uniqueTokens.length,
                    attempts,
                  };
                }
              } catch (error) {
                attempts.push({
                  step: "room-config-request-error",
                  pass,
                  variant: variant.label,
                  error: String(error),
                });
              }
            }

            if (pass < 3) {
              await wait(700 * pass);
            }
          }

          return {
            success: false,
            unauthorized: true,
            error: "RollerCoin room-config API rejected the session.",
            tokenCount: uniqueTokens.length,
            attempts,
          };
        })();
        `,
        true,
      ),
      45000,
      "Room config executeJavaScript timeout (45s).",
    );

    const result = parseWorkerResult(raw);
    if (!result.success || !result.json) {
      return {
        success: false,
        unauthorized: Boolean(result.unauthorized),
        error: result.error || "RollerCoin room-config API rejected the session.",
        endpoint,
        roomConfigId: explicitRoomConfigId || "",
        requestedProfileId: resolvedProfileId,
        cookieCount: sessionInfo.cookieCount,
        hasSessionCookie: sessionInfo.hasSessionCookie,
        selectedAuthVariant: result.selectedAuthVariant || null,
        attempts: [...profileAttempts, ...(Array.isArray(result.attempts) ? result.attempts : [])],
      };
    }

    const roomSnapshot = extractRollercoinRoomMinersPayload(result.json);
    return {
      success: true,
      endpoint,
      roomConfigId: roomSnapshot.roomConfigId || explicitRoomConfigId || "",
      requestedProfileId: resolvedProfileId,
      sourcePath: "browser-session-room-config-api",
      selectedAuthVariant: result.selectedAuthVariant || null,
      tokenCount: Number.isFinite(Number(result.tokenCount)) ? Number(result.tokenCount) : 0,
      cookieCount: sessionInfo.cookieCount,
      hasSessionCookie: sessionInfo.hasSessionCookie,
      attempts: [...profileAttempts, ...(Array.isArray(result.attempts) ? result.attempts : [])],
      ...roomSnapshot,
    };
  } catch (error) {
    return {
      success: false,
      error: `Room config fetch failed: ${error.message}`,
      endpoint,
      roomConfigId: explicitRoomConfigId || "",
      requestedProfileId: resolvedProfileId,
      cookieCount: sessionInfo.cookieCount,
      hasSessionCookie: sessionInfo.hasSessionCookie,
      attempts: profileAttempts,
    };
  } finally {
    await closeWindowGracefully(worker);
  }
}

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    writeStartupLog("App ready.");
    Menu.setApplicationMenu(buildApplicationMenu());
    attachRollercoinAssetRequestHeaders(session.defaultSession);
    attachRollercoinAssetRequestHeaders(session.fromPartition(ROLLERCOIN_PARTITION));
    createWindow();
    scheduleAutoUpdateCheck();

    app.on("second-instance", () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.focus();
      }
    });

    ipcMain.handle("rollercoin-auth-login", async () => {
      return openRollercoinAuthWindow();
    });
    ipcMain.handle("rollercoin-auth-status", async (_event, payload) => {
      const cookieHeader =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload.cookieHeader || ""
          : "";
      return probeRollercoinAuthStatus(cookieHeader);
    });
    ipcMain.handle("rollercoin-auth-session", async () => {
      return readRollercoinAuthSessionInfo();
    });
    ipcMain.handle("rollercoin-current-power", async (_event, payload) => {
      const cookieHeader =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload.cookieHeader || ""
          : "";
      return fetchRollercoinCurrentPower(cookieHeader);
    });
    ipcMain.handle("rollercoin-room-config-fetch", async (_event, payload) => {
      const cookieHeader =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload.cookieHeader || ""
          : "";
      const roomConfigRef =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload.roomConfigRef || ""
          : "";
      return fetchRollercoinRoomConfig(cookieHeader, roomConfigRef);
    });
    ipcMain.handle("rollercoin-market-fetch", async (event, payload) => {
      const requestId =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload.requestId || null
          : null;
      const cookieHeader =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload.cookieHeader || ""
          : "";
      const refreshMode =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload.refreshMode || "full"
          : "full";
      const maxPages =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload.maxPages
          : undefined;
      const includeAttempts =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload.includeAttempts !== false
          : true;

      const progress = (message, level = "info", extra = {}) => {
        emitMarketProgress(event.sender, requestId, message, level, extra);
      };

      progress(
        `Request accepted. Starting market miners loading flow (${normalizeMarketRefreshMode(refreshMode)} mode)...`,
      );
      try {
        return await fetchMarketViaSession({
          cookieHeader,
          refreshMode,
          maxPages,
          includeAttempts,
        }, progress);
      } finally {
        clearMarketProgressState(event.sender, requestId);
      }
    });
    ipcMain.handle("app-updates-check", async () => {
      return triggerAutoUpdateCheck({ manual: true });
    });
    ipcMain.handle("app-user-data-path", async () => {
      return {
        success: true,
        path: app.getPath("userData"),
      };
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  writeStartupLog("window-all-closed fired.", { platform: process.platform });
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  writeStartupLog("before-quit fired.");
});

app.on("will-quit", (_event) => {
  writeStartupLog("will-quit fired.");
});

app.on("quit", (_event, exitCode) => {
  writeStartupLog("quit fired.", { exitCode });
});

app.on("browser-window-created", (_event, window) => {
  writeStartupLog("browser-window-created fired.", {
    id: window?.id || null,
  });

  window.on("closed", () => {
    writeStartupLog("browser-window closed.", {
      id: window?.id || null,
    });
  });
});

app.on("child-process-gone", (_event, details) => {
  writeStartupLog("child-process-gone fired.", details);
});

process.on("uncaughtException", (error) => {
  writeStartupLog("uncaughtException", {
    message: error?.message || String(error),
    stack: error?.stack || null,
  });
});

process.on("unhandledRejection", (reason) => {
  writeStartupLog("unhandledRejection", {
    message:
      reason instanceof Error
        ? reason.stack || reason.message
        : String(reason),
  });
});

