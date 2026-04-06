const https = require("https");
const { ipcRenderer } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const STARTUP_LOG_PATH = path.join(os.tmpdir(), "roller-coin-calculator-startup.log");

function writeRendererLog(message, extra = null) {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  try {
    fs.appendFileSync(
      STARTUP_LOG_PATH,
      `[${new Date().toISOString()}] [renderer] ${message}${suffix}\n`,
      "utf8",
    );
  } catch {
    // Ignore logging failures.
  }
}

window.addEventListener("error", (event) => {
  writeRendererLog("window error", {
    message: event?.message || null,
    filename: event?.filename || null,
    lineno: event?.lineno || null,
    colno: event?.colno || null,
    error: event?.error?.stack || event?.error?.message || null,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event?.reason;
  writeRendererLog("unhandledrejection", {
    reason:
      reason instanceof Error
        ? reason.stack || reason.message
        : typeof reason === "string"
          ? reason
          : JSON.stringify(reason),
  });
});

window.addEventListener("beforeunload", () => {
  writeRendererLog("beforeunload fired");
});

document.addEventListener("visibilitychange", () => {
  writeRendererLog("visibilitychange", {
    visibilityState: document.visibilityState,
    hidden: document.hidden,
  });
});

process.on("uncaughtException", (error) => {
  writeRendererLog("process uncaughtException", {
    message: error?.message || String(error),
    stack: error?.stack || null,
  });
});

process.on("exit", (code) => {
  writeRendererLog("process exit", { code });
});

writeRendererLog("renderer.js loaded");

const POWER_MULTIPLIER = {
  "Gh/s": 0.001,
  "Th/s": 1,
  "Ph/s": 1000,
  "Eh/s": 1000 ** 2,
  "Zh/s": 1000 ** 3,
};

const UNIT_ORDER = ["Gh/s", "Th/s", "Ph/s", "Eh/s", "Zh/s"];

const CURRENT_SYSTEM_STORAGE_KEY = "rollercoin.currentSystem.v1";
const CURRENT_SYSTEM_HISTORY_STORAGE_KEY = "rollercoin.currentSystem.history.v1";
const ACTIVE_TAB_STORAGE_KEY = "rollercoin.activeTab.v1";
const MARKET_VIEW_TAB_STORAGE_KEY = "rollercoin.marketViewTab.v1";
const CURRENT_SYSTEM_HISTORY_LIMIT = 180;
const CURRENT_SYSTEM_HISTORY_VISIBLE_COUNT = 5;
const CURRENT_SYSTEM_FIELD_IDS = [
  "currentBasePowerValue",
  "currentBasePowerUnit",
  "currentBonusPercent",
];
const CURRENT_SYSTEM_FIELD_ID_SET = new Set(CURRENT_SYSTEM_FIELD_IDS);

const ROLLERCOIN_MARKET_STORAGE_KEY = "rollercoin.marketSettings.v1";
const ROLLERCOIN_MARKET_MINERS_CACHE_STORAGE_KEY = "rollercoin.marketMinersCache.v1";
const ROLLERCOIN_MARKET_MINERS_CACHE_VERSION = 2;
const MARKET_FIELD_IDS = [
  "displayPowerUnit",
  "marketRoomWidthMode",
  "marketRecommendationMode",
  "marketReplacementStrategy",
  "rollercoinCookie",
  "marketBudget",
  "marketMaxMinerPrice",
  "marketSortMode",
  "roomMinersSortMode",
  "roomMinersSearch",
  "marketTopN",
];
const MARKET_FIELD_ID_SET = new Set(MARKET_FIELD_IDS);

const MARKET_API_CANDIDATE_ENDPOINTS = [
  "https://rollercoin.com/api/market/offers?category=miners",
  "https://rollercoin.com/api/market/offers/?category=miners",
  "https://rollercoin.com/api/market/offers",
  "https://rollercoin.com/api/market/get-market",
];
const MARKET_DIRECT_PAGE_LIMIT = 100;
const MARKET_DIRECT_MAX_PAGES = 250;
const MARKET_DIRECT_PAGE_BATCH_SIZE = 2;

const candidatesBody = document.getElementById("candidatesBody");
const addCandidateBtn = document.getElementById("addCandidateBtn");
const calculateBtn = document.getElementById("calculateBtn");
const resultContent = document.getElementById("resultContent");
const currentTotalPowerStat = document.getElementById("currentTotalPowerStat");
const currentBonusPowerStat = document.getElementById("currentBonusPowerStat");
const candidateCountStat = document.getElementById("candidateCountStat");
const refreshCurrentPowerBtn = document.getElementById("refreshCurrentPowerBtn");
const currentSystemSyncStatus = document.getElementById("currentSystemSyncStatus");
const displayPowerUnitInput = document.getElementById("displayPowerUnit");
const powerHistoryBody = document.getElementById("powerHistoryBody");
const clearPowerHistoryBtn = document.getElementById("clearPowerHistoryBtn");
const togglePowerHistoryBtn = document.getElementById("togglePowerHistoryBtn");
const authTokenIndicator = document.getElementById("authTokenIndicator");
const authTokenMessage = document.getElementById("authTokenMessage");
const authActionBtn = document.getElementById("authActionBtn");
const checkAppUpdatesBtn = document.getElementById("checkAppUpdatesBtn");
const rollercoinLoginBtn = document.getElementById("rollercoinLoginBtn");
const rollercoinCookieInput = document.getElementById("rollercoinCookie");
const marketRoomWidthModeInput = document.getElementById("marketRoomWidthMode");
const marketRecommendationModeInput = document.getElementById("marketRecommendationMode");
const marketReplacementStrategyInput = document.getElementById("marketReplacementStrategy");
const marketBudgetInput = document.getElementById("marketBudget");
const marketMaxMinerPriceInput = document.getElementById("marketMaxMinerPrice");
const marketSortModeInput = document.getElementById("marketSortMode");
const roomMinersSortModeInput = document.getElementById("roomMinersSortMode");
const roomMinersSearchInput = document.getElementById("roomMinersSearch");
const marketTopNInput = document.getElementById("marketTopN");
const loadRoomMinersBtn = document.getElementById("loadRoomMinersBtn");
const loadMarketMinersBtn = document.getElementById("loadMarketMinersBtn");
const findBestMarketBtn = document.getElementById("findBestMarketBtn");
const marketStatus = document.getElementById("marketStatus");
const marketSummary = document.getElementById("marketSummary");
const roomMinersStatus = document.getElementById("roomMinersStatus");
const roomReplacementSuggestions = document.getElementById("roomReplacementSuggestions");
const roomMinersBody = document.getElementById("roomMinersBody");
const marketResultsBody = document.getElementById("marketResultsBody");
const roomMinersCountInfo = document.getElementById("roomMinersCountInfo");
const marketResultsCountInfo = document.getElementById("marketResultsCountInfo");
const showMoreRoomMinersBtn = document.getElementById("showMoreRoomMinersBtn");
const showMoreMarketResultsBtn = document.getElementById("showMoreMarketResultsBtn");
const marketLogsOutput = document.getElementById("marketLogsOutput");
const clearMarketLogsBtn = document.getElementById("clearMarketLogsBtn");
const roomMinersPowerHeader = document.getElementById("roomMinersPowerHeader");
const marketSortGainPowerOption = document.getElementById("marketSortGainPowerOption");
const marketResultsPowerHeader = document.getElementById("marketResultsPowerHeader");
const marketResultsGainHeader = document.getElementById("marketResultsGainHeader");
const marketResultsGainPerPriceHeader = document.getElementById("marketResultsGainPerPriceHeader");

let marketMinersCache = [];
let marketSourceInfo = null;
let roomMinersCache = [];
let roomMinersSourceInfo = null;
let activeMarketRequestId = null;
let marketHeartbeatTimer = null;
let marketHeartbeatStartedAt = 0;
let marketProgressListenerBound = false;
let marketLogLines = [];
let marketLogText = "";
let authStatusState = "checking";
let authStatusCheckInFlight = false;
let appUpdateCheckInFlight = false;
let currentPowerSyncInFlight = false;
let roomMinersLoadInFlight = false;
let visibleRoomMinersCount = 25;
let visibleMarketResultsCount = 25;
let lastRenderedRoomMiners = [];
let lastRenderedMarketRecommendations = [];
let lastRenderedMarketRecommendationsOptions = {};
let marketHoverTooltip = null;
let marketHoverTooltipContent = new Map();
let currentSystemHistory = [];
let isPowerHistoryExpanded = false;

const MARKET_LOG_MAX_LINES = 250;
const TABLE_RENDER_BATCH_SIZE = 25;
const MIN_RECOMMENDATION_GAIN_THS = 1;
const BUDGET_COMBINATION_BUY_POOL_LIMIT = 90;
const BUDGET_COMBINATION_REPLACEMENT_SET_LIMIT = 8;
const BUDGET_COMBINATION_OPTION_LIMIT = 320;
const BUDGET_COMBINATION_STATE_LIMIT = 220;
const BUDGET_COMBINATION_RESULT_LIMIT = 160;
const BUDGET_COMBINATION_UNLIMITED_MAX_DEPTH = 5;

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value !== "string") return NaN;
  const normalized = value.trim().replaceAll(" ", "").replace(",", ".");
  if (!normalized) return NaN;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function firstFiniteNumber(values) {
  for (const value of values) {
    const parsed = parseNumber(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return NaN;
}

function normalizeMinerDisplayLevel(value) {
  const parsed = parseNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  // RollerCoin APIs expose miner upgrade levels as internal indexes: 1 => L2, 2 => L3, etc.
  return Math.floor(parsed) + 1;
}

function buildMinerLevelBadgeUrl(level) {
  const normalizedLevel = normalizeMinerDisplayLevel(level);
  if (!normalizedLevel) return "";
  return `https://rollercoin.com/static/img/storage/rarity_icons/level_${normalizedLevel}.png?v=1.0.0`;
}

function normalizePowerUnit(value) {
  if (typeof value !== "string") return "";

  const normalized = value.trim().toLowerCase().replaceAll(" ", "");
  if (!normalized) return "";

  if (["gh/s", "ghs", "gh"].includes(normalized)) return "Gh/s";
  if (["th/s", "ths", "th"].includes(normalized)) return "Th/s";
  if (["ph/s", "phs", "ph"].includes(normalized)) return "Ph/s";
  if (["eh/s", "ehs", "eh"].includes(normalized)) return "Eh/s";
  if (["zh/s", "zhs", "zh"].includes(normalized)) return "Zh/s";

  return "";
}

function convertGhsToPhs(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return NaN;
  return numericValue / (1000 ** 2);
}

function getDisplayPowerUnit() {
  const selectedUnit = normalizePowerUnit(displayPowerUnitInput?.value);
  return selectedUnit || "Ph/s";
}

function toThs(value, unit) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return NaN;
  return numericValue * POWER_MULTIPLIER[unit];
}

function convertThsToUnit(valueThs, unit) {
  const normalizedUnit = normalizePowerUnit(unit);
  if (!Number.isFinite(valueThs) || !normalizedUnit) return NaN;
  return valueThs / POWER_MULTIPLIER[normalizedUnit];
}

function formatPowerFromThs(valueThs, options = {}) {
  if (!Number.isFinite(valueThs)) return "-";
  const unit = normalizePowerUnit(options.unit) || getDisplayPowerUnit();
  const fractionDigits = Number.isFinite(options.fractionDigits) ? options.fractionDigits : 6;
  const value = convertThsToUnit(valueThs, unit);
  if (!Number.isFinite(value)) return "-";

  return `${formatMarketValue(value, fractionDigits)} ${unit}`;
}

function formatPowerFromPhs(valuePhs, options = {}) {
  return formatPowerFromThs(toThs(valuePhs, "Ph/s"), options);
}

function formatSignedPower(valueThs, options = {}) {
  if (!Number.isFinite(valueThs)) return "-";
  const sign = valueThs > 0 ? "+" : "";
  return `${sign}${formatPowerFromThs(valueThs, options)}`;
}

function updatePowerUnitLabels() {
  const unit = getDisplayPowerUnit();

  if (roomMinersPowerHeader) {
    roomMinersPowerHeader.textContent = `Power (${unit})`;
  }
  if (marketSortGainPowerOption) {
    marketSortGainPowerOption.textContent = `Gain (${unit})`;
  }
  if (marketResultsPowerHeader) {
    marketResultsPowerHeader.textContent = `Power (${unit})`;
  }
  if (marketResultsGainHeader) {
    marketResultsGainHeader.textContent = `Gain (${unit})`;
  }
  if (marketResultsGainPerPriceHeader) {
    marketResultsGainPerPriceHeader.textContent = `Gain / RLT (${unit})`;
  }
}

function readNonNegativeNumber(inputId, required = true) {
  const input = document.getElementById(inputId);
  const raw = input.value.trim();
  if (raw === "") return required ? NaN : null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return NaN;
  return value;
}

function readStoredJson(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeStoredJson(storageKey, value) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Ignore storage write failures.
  }
}

function roundForStorage(value, fractionDigits = 6) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return NaN;
  return Number(numericValue.toFixed(fractionDigits));
}

function getCurrentSystemHistorySignature(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return "";
  const basePhs = roundForStorage(snapshot.basePhs, 6);
  const bonusPercent = roundForStorage(snapshot.bonusPercent, 4);
  return `${basePhs}|${bonusPercent}`;
}

function getCurrentSystemHistorySourceLabel(source) {
  if (source === "rollercoin-sync") return "RollerCoin sync";
  if (source === "restore") return "Restored";
  return "Manual edit";
}

function createCurrentSystemHistoryEntry(snapshot, source = "manual") {
  const totalThs = getCurrentTotal(snapshot.baseThs, snapshot.bonusPercent);
  return {
    recordedAt: Date.now(),
    basePhs: roundForStorage(snapshot.basePhs, 6),
    bonusPercent: roundForStorage(snapshot.bonusPercent, 4),
    totalPhs: roundForStorage(totalThs / POWER_MULTIPLIER["Ph/s"], 6),
    source,
    signature: getCurrentSystemHistorySignature(snapshot),
  };
}

function saveCurrentSystem(options = {}) {
  const snapshot = getCurrentSystemSnapshot(false);
  if (!snapshot) return;

  const payload = {
    baseValue: roundForStorage(snapshot.baseValue, 6),
    baseUnit: snapshot.baseUnit,
    bonusPercent: roundForStorage(snapshot.bonusPercent, 4),
    displayUnit: getDisplayPowerUnit(),
    savedAt: Date.now(),
  };
  writeStoredJson(CURRENT_SYSTEM_STORAGE_KEY, payload);

  if (!options.recordHistory) return;

  const historyEntry = createCurrentSystemHistoryEntry(snapshot, options.source || "manual");
  const latestEntry = currentSystemHistory[0];
  if (latestEntry && latestEntry.signature === historyEntry.signature) {
    return;
  }

  const shouldReplaceLatestManualEntry =
    latestEntry &&
    latestEntry.source === "manual" &&
    historyEntry.source === "manual" &&
    Math.abs(historyEntry.recordedAt - latestEntry.recordedAt) <= 30000;

  currentSystemHistory = shouldReplaceLatestManualEntry
    ? [historyEntry, ...currentSystemHistory.slice(1)]
    : [historyEntry, ...currentSystemHistory];
  currentSystemHistory = currentSystemHistory.slice(0, CURRENT_SYSTEM_HISTORY_LIMIT);
  writeStoredJson(CURRENT_SYSTEM_HISTORY_STORAGE_KEY, currentSystemHistory);
  renderCurrentSystemHistory();
}

function restoreCurrentSystem() {
  const saved = readStoredJson(CURRENT_SYSTEM_STORAGE_KEY);
  if (!saved || typeof saved !== "object") return;

  const baseValue = parseNumber(saved.baseValue);
  const baseUnit = normalizePowerUnit(saved.baseUnit);
  const bonusPercent = parseNumber(saved.bonusPercent);
  const displayUnit = normalizePowerUnit(saved.displayUnit);

  if (Number.isFinite(baseValue) && baseValue >= 0) {
    document.getElementById("currentBasePowerValue").value = String(baseValue);
  }
  if (baseUnit) {
    document.getElementById("currentBasePowerUnit").value = baseUnit;
  }
  if (Number.isFinite(bonusPercent) && bonusPercent >= 0) {
    document.getElementById("currentBonusPercent").value = String(bonusPercent);
  }
  if (displayUnit && displayPowerUnitInput) {
    displayPowerUnitInput.value = displayUnit;
  }
}

function restoreCurrentSystemHistory() {
  const savedHistory = readStoredJson(CURRENT_SYSTEM_HISTORY_STORAGE_KEY);
  if (!Array.isArray(savedHistory)) {
    currentSystemHistory = [];
    return;
  }

  currentSystemHistory = savedHistory
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      recordedAt: Number(entry.recordedAt) > 0 ? Number(entry.recordedAt) : Date.now(),
      basePhs: roundForStorage(parseNumber(entry.basePhs), 6),
      bonusPercent: roundForStorage(parseNumber(entry.bonusPercent), 4),
      totalPhs: roundForStorage(parseNumber(entry.totalPhs), 6),
      source: typeof entry.source === "string" ? entry.source : "manual",
      signature:
        typeof entry.signature === "string" && entry.signature
          ? entry.signature
          : `${roundForStorage(parseNumber(entry.basePhs), 6)}|${roundForStorage(parseNumber(entry.bonusPercent), 4)}`,
    }))
    .filter((entry) =>
      Number.isFinite(entry.recordedAt) &&
      Number.isFinite(entry.basePhs) &&
      Number.isFinite(entry.bonusPercent) &&
      Number.isFinite(entry.totalPhs),
    )
    .sort((leftEntry, rightEntry) => rightEntry.recordedAt - leftEntry.recordedAt)
    .slice(0, CURRENT_SYSTEM_HISTORY_LIMIT);
}

function formatHistoryDateTime(timestamp) {
  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed) || parsed <= 0) return "-";
  return new Date(parsed).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatHistoryGrowthPercent(currentEntry, previousEntry) {
  const currentTotal = parseNumber(currentEntry?.totalPhs);
  const previousTotal = parseNumber(previousEntry?.totalPhs);
  if (!Number.isFinite(currentTotal) || !Number.isFinite(previousTotal) || previousTotal <= 0) {
    return "-";
  }

  const growthPercent = ((currentTotal - previousTotal) / previousTotal) * 100;
  const sign = growthPercent > 0 ? "+" : "";
  return `${sign}${formatMarketValue(growthPercent, 2)}%`;
}

function renderCurrentSystemHistory() {
  if (!powerHistoryBody) return;

  if (!Array.isArray(currentSystemHistory) || currentSystemHistory.length === 0) {
    powerHistoryBody.innerHTML = `
      <tr>
        <td colspan="6" class="muted">Power history will appear here after the first saved snapshot.</td>
      </tr>
    `;
    if (clearPowerHistoryBtn) {
      clearPowerHistoryBtn.disabled = true;
    }
    if (togglePowerHistoryBtn) {
      togglePowerHistoryBtn.hidden = true;
      togglePowerHistoryBtn.disabled = true;
      togglePowerHistoryBtn.textContent = "Show older entries";
    }
    return;
  }

  const hasHiddenEntries = currentSystemHistory.length > CURRENT_SYSTEM_HISTORY_VISIBLE_COUNT;
  const visibleEntries = isPowerHistoryExpanded
    ? currentSystemHistory
    : currentSystemHistory.slice(0, CURRENT_SYSTEM_HISTORY_VISIBLE_COUNT);

  powerHistoryBody.innerHTML = visibleEntries
    .map((entry) => {
      const fullIndex = currentSystemHistory.indexOf(entry);
      const previousEntry = currentSystemHistory[fullIndex + 1] || null;
      const growthText = formatHistoryGrowthPercent(entry, previousEntry);
      const growthClass =
        growthText.startsWith("+") ? "positive" : growthText.startsWith("-") && growthText !== "-" ? "negative" : "muted";
      return `
      <tr>
        <td>${escapeHtml(formatHistoryDateTime(entry.recordedAt))}</td>
        <td>${escapeHtml(formatPowerFromPhs(entry.basePhs))}</td>
        <td>${escapeHtml(`${formatMarketValue(entry.bonusPercent, 2)}%`)}</td>
        <td>${escapeHtml(formatPowerFromPhs(entry.totalPhs))}</td>
        <td><span class="${growthClass}">${escapeHtml(growthText)}</span></td>
        <td>${escapeHtml(getCurrentSystemHistorySourceLabel(entry.source))}</td>
      </tr>
    `;
    })
    .join("");

  if (clearPowerHistoryBtn) {
    clearPowerHistoryBtn.disabled = false;
  }
  if (togglePowerHistoryBtn) {
    if (!hasHiddenEntries) {
      togglePowerHistoryBtn.hidden = true;
      togglePowerHistoryBtn.disabled = true;
      togglePowerHistoryBtn.textContent = "Show older entries";
    } else {
      const hiddenCount = currentSystemHistory.length - CURRENT_SYSTEM_HISTORY_VISIBLE_COUNT;
      togglePowerHistoryBtn.hidden = false;
      togglePowerHistoryBtn.disabled = false;
      togglePowerHistoryBtn.textContent = isPowerHistoryExpanded
        ? "Show only latest 5"
        : `Show ${hiddenCount} older entries`;
    }
  }
}

function clearCurrentSystemHistory() {
  currentSystemHistory = [];
  isPowerHistoryExpanded = false;
  try {
    localStorage.removeItem(CURRENT_SYSTEM_HISTORY_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
  renderCurrentSystemHistory();
}

function setCurrentSystemSyncStatus(message, tone = "neutral") {
  if (!currentSystemSyncStatus) return;
  currentSystemSyncStatus.textContent = message;
  currentSystemSyncStatus.classList.remove("market-error", "market-success");
  if (tone === "error") currentSystemSyncStatus.classList.add("market-error");
  if (tone === "success") currentSystemSyncStatus.classList.add("market-success");
}

function setCurrentPowerSyncInFlight(isInFlight) {
  currentPowerSyncInFlight = isInFlight;
  if (!refreshCurrentPowerBtn) return;
  refreshCurrentPowerBtn.disabled = isInFlight;
  refreshCurrentPowerBtn.textContent = isInFlight ? "Syncing..." : "Sync from RollerCoin";
}

function setRoomMinersStatus(message, tone = "neutral") {
  if (!roomMinersStatus) return;
  roomMinersStatus.textContent = message;
  roomMinersStatus.classList.remove("market-error", "market-success");
  if (tone === "error") roomMinersStatus.classList.add("market-error");
  if (tone === "success") roomMinersStatus.classList.add("market-success");
}

function setRoomMinersLoadInFlight(isInFlight) {
  roomMinersLoadInFlight = isInFlight;
  if (!loadRoomMinersBtn) return;
  loadRoomMinersBtn.disabled = isInFlight;
  loadRoomMinersBtn.textContent = isInFlight ? "Loading room..." : "Load room miners";
}

function updateVisibleRowsControls(options) {
  const {
    button,
    countInfo,
    visibleCount,
    totalCount,
    itemLabel,
  } = options;

  const safeVisibleCount = Math.min(Math.max(visibleCount, 0), Math.max(totalCount, 0));
  if (countInfo) {
    countInfo.textContent = totalCount > 0 ? `Showing ${safeVisibleCount} of ${totalCount} ${itemLabel}.` : "";
  }

  if (!button) return;

  const remainingCount = Math.max(0, totalCount - safeVisibleCount);
  if (remainingCount <= 0) {
    button.hidden = true;
    button.disabled = true;
    button.textContent = `Show ${TABLE_RENDER_BATCH_SIZE} more`;
    return;
  }

  const nextBatchCount = Math.min(TABLE_RENDER_BATCH_SIZE, remainingCount);
  button.hidden = false;
  button.disabled = false;
  button.textContent = `Show ${nextBatchCount} more`;
}

function getRoomMinersSortMode() {
  const value = roomMinersSortModeInput?.value;
  if (value === "bonusDesc") return "bonusDesc";
  if (value === "widthAsc") return "widthAsc";
  if (value === "nameAsc") return "nameAsc";
  return "powerDesc";
}

function getRoomMinersSearchQuery() {
  return String(roomMinersSearchInput?.value || "").trim().toLowerCase();
}

function filterRoomMiners(miners) {
  const query = getRoomMinersSearchQuery();
  if (!query) return [...miners];

  const terms = query.split(/\s+/).filter(Boolean);
  return miners.filter((miner) => {
    const name = String(miner?.name || "").toLowerCase();
    const level = Number.isFinite(Number(miner?.level)) ? Math.floor(Number(miner.level)) : null;
    const width = Number.isFinite(Number(miner?.width)) ? Math.floor(Number(miner.width)) : null;
    const haystack = [
      name,
      level ? `l${level}` : "",
      level ? `level ${level}` : "",
      width ? `width ${width}` : "",
      width ? String(width) : "",
    ]
      .filter(Boolean)
      .join(" ");

    return terms.every((term) => haystack.includes(term));
  });
}

function compareMinerNames(leftMiner, rightMiner) {
  const leftName = String(leftMiner?.name || "").trim();
  const rightName = String(rightMiner?.name || "").trim();
  const byName = leftName.localeCompare(rightName, "en", { sensitivity: "base" });
  if (byName !== 0) return byName;

  const leftLevel = Number.isFinite(Number(leftMiner?.level)) ? Number(leftMiner.level) : 0;
  const rightLevel = Number.isFinite(Number(rightMiner?.level)) ? Number(rightMiner.level) : 0;
  return rightLevel - leftLevel;
}

function sortRoomMiners(miners) {
  const sortMode = getRoomMinersSortMode();
  const readPower = (miner) => {
    const value = Number(miner?.power);
    return Number.isFinite(value) ? value : -1;
  };
  const readBonus = (miner) => {
    const value = Number(miner?.bonusPercent);
    return Number.isFinite(value) ? value : -1;
  };

  return [...miners].sort((leftMiner, rightMiner) => {
    if (sortMode === "nameAsc") {
      const byName = compareMinerNames(leftMiner, rightMiner);
      if (byName !== 0) return byName;
      return readPower(rightMiner) - readPower(leftMiner);
    }

    if (sortMode === "widthAsc") {
      const leftWidth = Number.isFinite(Number(leftMiner?.width)) ? Number(leftMiner.width) : Number.POSITIVE_INFINITY;
      const rightWidth = Number.isFinite(Number(rightMiner?.width)) ? Number(rightMiner.width) : Number.POSITIVE_INFINITY;
      if (leftWidth !== rightWidth) return leftWidth - rightWidth;
      if (readPower(rightMiner) !== readPower(leftMiner)) return readPower(rightMiner) - readPower(leftMiner);
      return compareMinerNames(leftMiner, rightMiner);
    }

    if (sortMode === "bonusDesc") {
      if (readBonus(rightMiner) !== readBonus(leftMiner)) {
        return readBonus(rightMiner) - readBonus(leftMiner);
      }
      if (readPower(rightMiner) !== readPower(leftMiner)) return readPower(rightMiner) - readPower(leftMiner);
      return compareMinerNames(leftMiner, rightMiner);
    }

    if (readPower(rightMiner) !== readPower(leftMiner)) return readPower(rightMiner) - readPower(leftMiner);
    if (readBonus(rightMiner) !== readBonus(leftMiner)) {
      return readBonus(rightMiner) - readBonus(leftMiner);
    }
    return compareMinerNames(leftMiner, rightMiner);
  });
}

function renderRoomMinersCollection(miners = [], options = {}) {
  if (!roomMinersBody) return;
  const resetPagination = options.resetPagination !== false;

  if (resetPagination) {
    visibleRoomMinersCount = TABLE_RENDER_BATCH_SIZE;
  }

  if (!Array.isArray(miners) || miners.length === 0) {
    lastRenderedRoomMiners = [];
    roomMinersBody.innerHTML = `
      <tr>
        <td colspan="5" class="muted">Room miners will appear here after loading the current room.</td>
      </tr>
    `;
    updateVisibleRowsControls({
      button: showMoreRoomMinersBtn,
      countInfo: roomMinersCountInfo,
      visibleCount: 0,
      totalCount: 0,
      itemLabel: "room miners",
    });
    return;
  }

  const filteredMiners = filterRoomMiners(miners);
  if (filteredMiners.length === 0) {
    lastRenderedRoomMiners = [];
    roomMinersBody.innerHTML = `
      <tr>
        <td colspan="5" class="muted">No room miners match the current search.</td>
      </tr>
    `;
    updateVisibleRowsControls({
      button: showMoreRoomMinersBtn,
      countInfo: roomMinersCountInfo,
      visibleCount: 0,
      totalCount: 0,
      itemLabel: "room miners",
    });
    return;
  }

  const sortedMiners = sortRoomMiners(filteredMiners);
  lastRenderedRoomMiners = sortedMiners;
  const visibleMiners = sortedMiners.slice(0, visibleRoomMinersCount);

  roomMinersBody.innerHTML = visibleMiners
    .map((miner, index) => {
      const actualIndex = index + 1;
      const hasImage = typeof miner.imageUrl === "string" && miner.imageUrl.length > 0;
      const hasLevelBadge = typeof miner.levelBadgeUrl === "string" && miner.levelBadgeUrl.length > 0;
      const imageFallbacks = Array.isArray(miner.imageCandidates)
        ? miner.imageCandidates.filter((candidate) => candidate && candidate !== miner.imageUrl)
        : [];
      const fallbackAttr =
        hasImage && imageFallbacks.length > 0
          ? ` data-fallbacks="${escapeHtml(encodeURIComponent(JSON.stringify(imageFallbacks)))}"`
          : "";
      const imagePart = hasImage
        ? `<div class="market-miner-thumb-wrap">
             <img class="market-miner-thumb" src="${escapeHtml(miner.imageUrl)}" alt="${escapeHtml(miner.name)}" loading="lazy"${fallbackAttr} />
             ${hasLevelBadge ? `<img class="market-miner-level-badge" src="${escapeHtml(miner.levelBadgeUrl)}" alt="Level ${escapeHtml(miner.level || "")}" loading="lazy" />` : ""}
           </div>`
        : `<div class="market-miner-thumb-wrap">
             <div class="market-miner-thumb placeholder">${escapeHtml((miner.name || "M").slice(0, 1).toUpperCase())}</div>
             ${hasLevelBadge ? `<img class="market-miner-level-badge" src="${escapeHtml(miner.levelBadgeUrl)}" alt="Level ${escapeHtml(miner.level || "")}" loading="lazy" />` : ""}
           </div>`;

      return `
        <tr>
          <td>${actualIndex}</td>
          <td>
            <div class="market-miner-cell">
              ${imagePart}
              <span>${escapeHtml(miner.name)}</span>
            </div>
          </td>
          <td>${formatPowerFromPhs(miner.power)}</td>
          <td>${formatMarketValue(miner.bonusPercent, 2)}%</td>
          <td>${escapeHtml(miner.width || "-")}</td>
        </tr>
      `;
    })
    .join("");

  updateVisibleRowsControls({
    button: showMoreRoomMinersBtn,
    countInfo: roomMinersCountInfo,
    visibleCount: visibleMiners.length,
    totalCount: sortedMiners.length,
    itemLabel: "room miners",
  });
  bindMarketImageFallbacks();
}

function getCurrentSystemSnapshot(required = false) {
  const currentBasePowerValue = readNonNegativeNumber("currentBasePowerValue", !required ? false : true);
  const currentBasePowerUnit = document.getElementById("currentBasePowerUnit").value;
  const currentBonusPercent = readNonNegativeNumber("currentBonusPercent", !required ? false : true);

  if (currentBasePowerValue === null || currentBonusPercent === null) {
    return null;
  }

  const currentBaseThs = toThs(currentBasePowerValue, currentBasePowerUnit);
  if (!Number.isFinite(currentBaseThs) || !Number.isFinite(currentBonusPercent) || currentBonusPercent < 0) {
    return null;
  }

  return {
    baseValue: currentBasePowerValue,
    baseUnit: currentBasePowerUnit,
    baseThs: currentBaseThs,
    basePhs: currentBaseThs / POWER_MULTIPLIER["Ph/s"],
    bonusPercent: currentBonusPercent,
  };
}

function applyCurrentSystemFromRollercoin(powerSnapshot) {
  if (!powerSnapshot || typeof powerSnapshot !== "object") {
    throw new Error("Invalid RollerCoin power snapshot.");
  }

  const basePhs = parseNumber(powerSnapshot.basePowerPhs);
  const bonusPercent = parseNumber(powerSnapshot.bonusPercent);
  if (!Number.isFinite(basePhs) || basePhs < 0) {
    throw new Error("RollerCoin power response did not include a valid base power.");
  }
  if (!Number.isFinite(bonusPercent) || bonusPercent < 0) {
    throw new Error("RollerCoin power response did not include a valid bonus percent.");
  }

  document.getElementById("currentBasePowerValue").value = String(basePhs);
  document.getElementById("currentBasePowerUnit").value = "Ph/s";
  document.getElementById("currentBonusPercent").value = String(bonusPercent);
  saveCurrentSystem({ recordHistory: true, source: "rollercoin-sync" });
  recalculateLive();
}

function saveMarketSettings() {
  // Persistence is intentionally disabled. Market settings reset on each launch.
}

function restoreMarketSettings() {
  // Persistence is intentionally disabled. Market settings always start clean.
}

function formatMarketDateTime(timestamp) {
  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed) || parsed <= 0) return "unknown";
  return new Date(parsed).toLocaleString("en-US", { hour12: false });
}

function normalizeMarketSourceInfo(rawSourceInfo, fallbackScore = 0) {
  const endpoint =
    typeof rawSourceInfo?.endpoint === "string" && rawSourceInfo.endpoint.trim()
      ? rawSourceInfo.endpoint.trim()
      : "local-cache";
  const sourcePath =
    typeof rawSourceInfo?.sourcePath === "string" && rawSourceInfo.sourcePath.trim()
      ? rawSourceInfo.sourcePath.trim()
      : "local-storage";

  const parsedScore = parseNumber(rawSourceInfo?.sourceScore);
  const sourceScore =
    Number.isFinite(parsedScore) && parsedScore >= 0
      ? parsedScore
      : Math.max(0, Number(fallbackScore) || 0);

  const parsedLoadedAt = Number(rawSourceInfo?.loadedAt);
  const loadedAt = Number.isFinite(parsedLoadedAt) && parsedLoadedAt > 0 ? parsedLoadedAt : Date.now();

  return {
    endpoint,
    sourcePath,
    sourceScore,
    loadedAt,
  };
}

function saveMarketMinersCache() {
  // Persistence is intentionally disabled. Market miners stay in memory only.
}

function restoreMarketMinersCache() {
  return false;
}

function setMarketStatus(message, tone = "neutral") {
  if (!marketStatus) return;
  marketStatus.textContent = message;
  marketStatus.classList.remove("market-error", "market-success");
  if (tone === "error") marketStatus.classList.add("market-error");
  if (tone === "success") marketStatus.classList.add("market-success");
}

function setAuthIndicatorState(state, message) {
  authStatusState = state;

  if (authTokenIndicator) {
    authTokenIndicator.classList.remove("auth-valid", "auth-invalid", "auth-checking");
    if (state === "valid") authTokenIndicator.classList.add("auth-valid");
    if (state === "invalid") authTokenIndicator.classList.add("auth-invalid");
    if (state === "checking") authTokenIndicator.classList.add("auth-checking");
  }

  if (authTokenMessage) {
    authTokenMessage.textContent = message;
  }

  if (authActionBtn) {
    authActionBtn.disabled = authStatusCheckInFlight;
    authActionBtn.textContent =
      authStatusCheckInFlight
        ? "Checking..."
        : state === "invalid"
          ? "Login required"
          : state === "valid"
            ? "Recheck auth"
            : "Check auth";
  }
}

function markAuthStatusDirty() {
  const cookieHeader = rollercoinCookieInput?.value?.trim?.() ?? "";
  if (!cookieHeader) {
    setAuthIndicatorState("invalid", "No saved RollerCoin session. Login is required.");
    return;
  }

  setAuthIndicatorState("checking", "Session changed. Click Check auth to verify it.");
}

async function checkRollercoinAuthStatus(options = {}) {
  const silent = Boolean(options.silent);
  if (authStatusCheckInFlight) return;

  authStatusCheckInFlight = true;
  setAuthIndicatorState("checking", "Checking RollerCoin session...");

  try {
    if (!ipcRenderer || typeof ipcRenderer.invoke !== "function") {
      throw new Error("IPC is unavailable.");
    }

    const cookieHeader = rollercoinCookieInput?.value?.trim?.() ?? "";
    const authResult = await ipcRenderer.invoke("rollercoin-auth-status", { cookieHeader });

    if (authResult?.authenticated) {
      const details = [];
      if (authResult.selectedAuthVariant) details.push(`auth=${authResult.selectedAuthVariant}`);
      if (authResult.selectedQueryProfile) details.push(`query=${authResult.selectedQueryProfile}`);
      const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
      setAuthIndicatorState("valid", `Session is active${suffix}.`);
      if (!silent) {
        setMarketStatus("RollerCoin session is active. Market loading is available.", "success");
      }
    } else {
      setAuthIndicatorState(
        "invalid",
        authResult?.message || "RollerCoin session is not authorized. Login is required.",
      );
      if (!silent) {
        setMarketStatus("RollerCoin login is required before loading market miners.", "error");
      }
    }
  } catch (error) {
    setAuthIndicatorState("invalid", `Auth check failed: ${error.message}`);
    if (!silent) {
      setMarketStatus(`Auth check failed: ${error.message}`, "error");
    }
  } finally {
    authStatusCheckInFlight = false;
    if (authActionBtn) {
      authActionBtn.disabled = false;
      authActionBtn.textContent =
        authStatusState === "invalid"
          ? "Login required"
          : authStatusState === "valid"
            ? "Recheck auth"
            : "Check auth";
    }
  }
}

async function handleAuthAction() {
  if (authStatusCheckInFlight) return;

  if (authStatusState === "invalid") {
    await handleRollercoinLogin();
    return;
  }

  await checkRollercoinAuthStatus();
}

async function refreshCurrentPowerFromRollercoin(options = {}) {
  const silent = Boolean(options.silent);
  const allowUnauthenticated = Boolean(options.allowUnauthenticated);
  if (currentPowerSyncInFlight) return null;

  setCurrentPowerSyncInFlight(true);
  setCurrentSystemSyncStatus("Syncing current power from RollerCoin...", "neutral");

  try {
    if (!ipcRenderer || typeof ipcRenderer.invoke !== "function") {
      throw new Error("IPC is unavailable.");
    }

    const cookieHeader = rollercoinCookieInput?.value?.trim?.() ?? "";
    const powerResult = await ipcRenderer.invoke("rollercoin-current-power", { cookieHeader });
    if (!powerResult?.success) {
      const message =
        powerResult?.error ||
        powerResult?.message ||
        "Failed to load current RollerCoin power.";
      if (allowUnauthenticated && powerResult?.unauthorized) {
        setCurrentSystemSyncStatus("RollerCoin power sync is available after login.", "neutral");
        return powerResult;
      }
      throw new Error(message);
    }

    applyCurrentSystemFromRollercoin(powerResult);
    const syncedBasePower = formatPowerFromPhs(parseNumber(powerResult.basePowerPhs));
    const syncedBonusPercent = formatMarketValue(parseNumber(powerResult.bonusPercent), 2);
    const authSuffix = powerResult.selectedAuthVariant ? ` via ${powerResult.selectedAuthVariant}` : "";
    setCurrentSystemSyncStatus(
      `Synced from RollerCoin${authSuffix}: ${syncedBasePower} base, ${syncedBonusPercent}% bonus.`,
      "success",
    );

    if (!silent) {
      setMarketStatus("Current system synced from RollerCoin.", "success");
    }

    if (marketMinersCache.length > 0) {
      try {
        updateMarketRecommendationsView("Recommendations updated using RollerCoin current power.", "success");
      } catch (error) {
        appendMarketLog(`Current power synced, but market filters are invalid: ${error.message}`, "warn");
      }
    }

    return powerResult;
  } catch (error) {
    setCurrentSystemSyncStatus(`Current power sync failed: ${error.message}`, "error");
    if (!silent) {
      setMarketStatus(`Current power sync failed: ${error.message}`, "error");
    }
    return null;
  } finally {
    setCurrentPowerSyncInFlight(false);
  }
}

function getRoomMinerOwnershipKey(miner) {
  const normalizedName = String(miner?.name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const level = Number.isFinite(Number(miner?.level)) ? Math.floor(Number(miner.level)) : 0;
  return `${normalizedName}::${level}`;
}

function getRoomWidthMode() {
  const value = marketRoomWidthModeInput?.value;
  return value === "1" || value === "2" ? value : "any";
}

function getMarketReplacementMode() {
  const value = marketReplacementStrategyInput?.value;
  return value === "flex" || value === "strict" ? value : "off";
}

function getMarketReplacementEnabled() {
  return getMarketReplacementMode() !== "off";
}

function getMarketRecommendationMode() {
  return marketRecommendationModeInput?.value === "budget" ? "budget" : "single";
}

function getMarketReplacementStrategy() {
  return getMarketReplacementMode() === "flex" ? "flex" : "strict";
}

function saveActiveTab(storageKey, tabId) {
  void storageKey;
  void tabId;
}

function setActiveTab(groupName, targetPanelId, storageKey = "") {
  if (!groupName || !targetPanelId) return;

  const buttons = Array.from(
    document.querySelectorAll(`.tab-button[data-tab-group="${groupName}"][data-tab-target]`),
  );
  const panels = Array.from(document.querySelectorAll(`.tab-panel[data-tab-group="${groupName}"]`));
  if (buttons.length === 0 || panels.length === 0) return;

  buttons.forEach((button) => {
    const isActive = button.dataset.tabTarget === targetPanelId;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
    button.tabIndex = isActive ? 0 : -1;
  });

  panels.forEach((panel) => {
    const isActive = panel.id === targetPanelId;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  });

  saveActiveTab(storageKey, targetPanelId);
}

function initializeTabs() {
  const buttons = Array.from(document.querySelectorAll(".tab-button[data-tab-group][data-tab-target]"));
  if (buttons.length === 0) return;

  const groups = new Map();
  buttons.forEach((button) => {
    const groupName = button.dataset.tabGroup || "";
    if (!groupName) return;
    const storageKey = button.dataset.tabStorageKey || "";
    if (!groups.has(groupName)) {
      groups.set(groupName, { buttons: [], storageKey });
    }
    const group = groups.get(groupName);
    group.buttons.push(button);
    if (!group.storageKey && storageKey) {
      group.storageKey = storageKey;
    }
  });

  groups.forEach((group, groupName) => {
    const panels = Array.from(document.querySelectorAll(`.tab-panel[data-tab-group="${groupName}"]`));
    if (panels.length === 0) return;

    group.buttons.forEach((button) => {
      button.addEventListener("click", () => {
        setActiveTab(groupName, button.dataset.tabTarget || panels[0].id, group.storageKey || "");
      });
    });

    let initialTabId =
      group.buttons.find((button) => button.classList.contains("is-active"))?.dataset.tabTarget ||
      panels[0].id;

    setActiveTab(groupName, initialTabId, group.storageKey || "");
  });
}

function clearTransientLocalState() {
  marketMinersCache = [];
  marketSourceInfo = null;
  roomMinersCache = [];

  if (rollercoinCookieInput) {
    rollercoinCookieInput.value = "";
  }
}

function buildReplacementSetLabel(miners) {
  if (!Array.isArray(miners) || miners.length === 0) return "-";
  return miners
    .map((miner) => {
      const levelText = miner?.level ? ` L${miner.level}` : "";
      const widthText = miner?.width ? ` [${miner.width}]` : "";
      return `${miner?.name || "Unknown"}${levelText}${widthText}`;
    })
    .join(" + ");
}

function buildRoomReplacementSets(strategy = "strict") {
  const roomMinerMaskById = new Map(
    roomMinersCache.map((miner, index) => [String(miner?.id || `room-miner-${index + 1}`), 1n << BigInt(index)]),
  );
  const buildRemovedMask = (miners) => miners.reduce((mask, miner) => {
    const minerKey = String(miner?.id || "");
    return mask | (roomMinerMaskById.get(minerKey) || 0n);
  }, 0n);
  const singles = roomMinersCache
    .filter((miner) => Number.isFinite(Number(miner?.width)) && Number(miner.width) > 0)
    .map((miner) => ({
      width: Math.floor(Number(miner.width)),
      miners: [miner],
      removedPowerThs: toThs(miner.power, "Ph/s"),
      removedBonusPercent: miner.bonusPercent,
      removedMask: buildRemovedMask([miner]),
      label: buildReplacementSetLabel([miner]),
    }));

  if (strategy !== "flex") {
    return singles;
  }

  const flexibleSets = [...singles];
  const smallMiners = roomMinersCache.filter((miner) => Math.floor(Number(miner?.width || 0)) === 1);
  for (let leftIndex = 0; leftIndex < smallMiners.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < smallMiners.length; rightIndex += 1) {
      const miners = [smallMiners[leftIndex], smallMiners[rightIndex]];
      flexibleSets.push({
        width: 2,
        miners,
        removedPowerThs: toThs(miners[0].power, "Ph/s") + toThs(miners[1].power, "Ph/s"),
        removedBonusPercent: miners[0].bonusPercent + miners[1].bonusPercent,
        removedMask: buildRemovedMask(miners),
        label: buildReplacementSetLabel(miners),
      });
    }
  }

  return flexibleSets;
}

async function loadRoomMinersFromRollercoin(options = {}) {
  const silent = Boolean(options.silent);
  const allowUnauthenticated = Boolean(options.allowUnauthenticated);
  if (roomMinersLoadInFlight) return null;

  setRoomMinersLoadInFlight(true);
  setRoomMinersStatus("Loading room miners from RollerCoin...", "neutral");

  try {
    if (!ipcRenderer || typeof ipcRenderer.invoke !== "function") {
      throw new Error("IPC is unavailable.");
    }

    const cookieHeader = rollercoinCookieInput?.value?.trim?.() ?? "";
    const roomResult = await ipcRenderer.invoke("rollercoin-room-config-fetch", {
      cookieHeader,
      roomConfigRef: "",
    });

    if (!roomResult?.success || !Array.isArray(roomResult.miners)) {
      if (allowUnauthenticated && roomResult?.unauthorized) {
        setRoomMinersStatus("Room miners sync is available after RollerCoin login.", "neutral");
        return roomResult;
      }
      throw new Error(roomResult?.error || "Failed to load room miners.");
    }

    const normalizedRoomMiners = normalizeRoomMiners(roomResult.miners);
    if (normalizedRoomMiners.length === 0) {
      throw new Error("Room config returned no parseable miners.");
    }

    roomMinersCache = normalizedRoomMiners;
    roomMinersSourceInfo = {
      endpoint: roomResult.endpoint || "https://rollercoin.com/api/game/room-config/",
      roomConfigId: roomResult.roomConfigId || "",
      loadedAt: Date.now(),
    };
    renderRoomMinersCollection(roomMinersCache);

    const roomIdText = roomResult.roomConfigId ? ` (room ${roomResult.roomConfigId})` : " (current room)";
    setRoomMinersStatus(
      `Loaded ${normalizedRoomMiners.length} room miners${roomIdText}. Market table excludes same name + level.`,
      "success",
    );
    appendMarketLog(`Loaded ${normalizedRoomMiners.length} room miners${roomIdText}.`, "success");

    if (marketMinersCache.length > 0) {
      updateMarketRecommendationsView(
        silent ? "Recommendations updated using loaded room miners." : "Recommendations updated using loaded room miners.",
        "success",
      );
    }

    return roomResult;
  } catch (error) {
    roomMinersCache = [];
    roomMinersSourceInfo = null;
    renderRoomMinersCollection([]);
    setRoomMinersStatus(`Room miners load failed: ${error.message}`, "error");
    if (!silent) {
      setMarketStatus(`Room miners load failed: ${error.message}`, "error");
    }
    return null;
  } finally {
    setRoomMinersLoadInFlight(false);
  }
}

function formatLogTime(timestamp) {
  const date = Number.isFinite(timestamp) ? new Date(timestamp) : new Date();
  return date.toLocaleTimeString("en-US", { hour12: false });
}

function appendMarketLog(message, level = "info", timestamp = Date.now()) {
  if (!marketLogsOutput) return;
  const safeLevel = typeof level === "string" ? level.toUpperCase() : "INFO";
  const line = `[${formatLogTime(timestamp)}] [${safeLevel}] ${message}`;
  marketLogLines.push(line);

  if (marketLogLines.length > MARKET_LOG_MAX_LINES) {
    marketLogLines = marketLogLines.slice(-MARKET_LOG_MAX_LINES);
    marketLogText = marketLogLines.join("\n");
  } else {
    marketLogText = marketLogText ? `${marketLogText}\n${line}` : line;
  }

  marketLogsOutput.textContent = marketLogText;
  marketLogsOutput.scrollTop = marketLogsOutput.scrollHeight;
}

function clearMarketLogs() {
  marketLogLines = [];
  marketLogText = "";
  if (marketLogsOutput) {
    marketLogsOutput.textContent = "";
  }
}

function startMarketHeartbeat() {
  stopMarketHeartbeat();
  marketHeartbeatStartedAt = Date.now();
  marketHeartbeatTimer = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - marketHeartbeatStartedAt) / 1000);
    appendMarketLog(`Loading is still in progress (${elapsedSec}s elapsed)...`, "info");
  }, 15000);
}

function stopMarketHeartbeat() {
  if (marketHeartbeatTimer) {
    clearInterval(marketHeartbeatTimer);
    marketHeartbeatTimer = null;
  }
}

function logAttemptsSummary(attempts, label) {
  if (!Array.isArray(attempts) || attempts.length === 0) return;
  const previewLimit = 30;

  appendMarketLog(`${label}: attempts collected = ${attempts.length}.`, "info");
  attempts.slice(0, previewLimit).forEach((attempt, index) => {
    const parts = [];
    if (attempt.step) parts.push(`step=${attempt.step}`);
    if (attempt.type) parts.push(`type=${attempt.type}`);
    if (attempt.page !== undefined) parts.push(`page=${attempt.page}`);
    if (attempt.status !== undefined) parts.push(`status=${attempt.status}`);
    if (attempt.endpoint) parts.push(`endpoint=${attempt.endpoint}`);
    if (attempt.url) parts.push(`url=${attempt.url}`);
    if (attempt.href) parts.push(`href=${attempt.href}`);
    if (attempt.offersInCycle !== undefined) parts.push(`offersInCycle=${attempt.offersInCycle}`);
    if (attempt.domOffersInCycle !== undefined) parts.push(`domOffersInCycle=${attempt.domOffersInCycle}`);
    if (attempt.totalOffers !== undefined) parts.push(`totalOffers=${attempt.totalOffers}`);
    if (attempt.clickedNext !== undefined) parts.push(`clickedNext=${attempt.clickedNext ? "yes" : "no"}`);
    if (attempt.filterApplied !== undefined) parts.push(`filterApplied=${attempt.filterApplied ? "yes" : "no"}`);
    if (attempt.filterStrategy) parts.push(`filterStrategy=${attempt.filterStrategy}`);
    if (attempt.activePageBefore !== undefined) parts.push(`activePageBefore=${attempt.activePageBefore}`);
    if (attempt.activePageAfter !== undefined) parts.push(`activePageAfter=${attempt.activePageAfter}`);
    if (attempt.nextStrategy) parts.push(`nextStrategy=${attempt.nextStrategy}`);
    if (attempt.selectedBy) parts.push(`selectedBy=${attempt.selectedBy}`);
    if (attempt.error) parts.push(`error=${attempt.error}`);
    appendMarketLog(`Attempt ${index + 1}: ${parts.join(", ") || "no details"}`, "info");
  });

  if (attempts.length > previewLimit) {
    appendMarketLog(`... and ${attempts.length - previewLimit} more attempts.`, "info");
  }
}

function bindMarketProgressListener() {
  if (marketProgressListenerBound) return;
  if (!ipcRenderer || typeof ipcRenderer.on !== "function") return;

  ipcRenderer.on("rollercoin-market-progress", (_event, payload) => {
    if (!payload || typeof payload !== "object") return;
    if (!activeMarketRequestId) return;
    if (payload.requestId && payload.requestId !== activeMarketRequestId) return;
    appendMarketLog(payload.message || "No message", payload.level || "info", payload.timestamp);
  });

  marketProgressListenerBound = true;
}

function getByPath(obj, path) {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || typeof current !== "object" || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function ensureMarketHoverTooltip() {
  if (marketHoverTooltip instanceof HTMLDivElement) {
    return marketHoverTooltip;
  }

  const tooltip = document.createElement("div");
  tooltip.className = "market-hover-tooltip";
  tooltip.hidden = true;
  document.body.appendChild(tooltip);
  marketHoverTooltip = tooltip;
  return tooltip;
}

function positionMarketHoverTooltip(clientX, clientY) {
  if (!(marketHoverTooltip instanceof HTMLDivElement) || marketHoverTooltip.hidden) return;

  const offset = 14;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const tooltipRect = marketHoverTooltip.getBoundingClientRect();

  let left = clientX + offset;
  let top = clientY + offset;

  if (left + tooltipRect.width > viewportWidth - 12) {
    left = Math.max(12, clientX - tooltipRect.width - offset);
  }
  if (top + tooltipRect.height > viewportHeight - 12) {
    top = Math.max(12, clientY - tooltipRect.height - offset);
  }

  marketHoverTooltip.style.left = `${Math.max(12, left)}px`;
  marketHoverTooltip.style.top = `${Math.max(12, top)}px`;
}

function hideMarketHoverTooltip() {
  if (!(marketHoverTooltip instanceof HTMLDivElement)) return;
  marketHoverTooltip.hidden = true;
}

function showMarketHoverTooltip(html, clientX, clientY) {
  if (typeof html !== "string" || !html.trim()) {
    hideMarketHoverTooltip();
    return;
  }

  const tooltip = ensureMarketHoverTooltip();
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  positionMarketHoverTooltip(clientX, clientY);
}

function pickLocalizedText(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return (
    value.ru ||
    value.en ||
    value.cn ||
    Object.values(value).find((entry) => typeof entry === "string") ||
    ""
  );
}

function buildMinerImageKeyFromName(value) {
  const text = pickLocalizedText(value).trim();
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

function collectObjectArrays(root) {
  const arrays = [];
  const seen = new WeakSet();
  const queue = [{ node: root, path: "root" }];

  while (queue.length > 0) {
    const { node, path } = queue.shift();
    if (!node || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);

    if (Array.isArray(node)) {
      const objectEntries = node.filter((entry) => entry && typeof entry === "object");
      if (objectEntries.length > 0) {
        arrays.push({ path, items: objectEntries, totalLength: node.length });
      }
      objectEntries.forEach((entry, index) => {
        queue.push({ node: entry, path: `${path}[${index}]` });
      });
      continue;
    }

    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === "object") {
        queue.push({ node: value, path: `${path}.${key}` });
      }
    }
  }

  return arrays;
}

function collectObjectValueCollections(root) {
  const collections = [];
  const seen = new WeakSet();
  const queue = [{ node: root, path: "root" }];

  while (queue.length > 0) {
    const { node, path } = queue.shift();
    if (!node || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((entry, index) => {
        if (entry && typeof entry === "object") {
          queue.push({ node: entry, path: `${path}[${index}]` });
        }
      });
      continue;
    }

    const values = Object.values(node);
    const objectValues = values.filter((value) => value && typeof value === "object" && !Array.isArray(value));
    const ratio = values.length === 0 ? 0 : objectValues.length / values.length;
    if (objectValues.length >= 3 && ratio >= 0.6) {
      collections.push({ path, items: objectValues, source: "object-values" });
    }

    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === "object") {
        queue.push({ node: value, path: `${path}.${key}` });
      }
    }
  }

  return collections;
}

function collectRootKeyCollections(root) {
  if (!root || typeof root !== "object" || Array.isArray(root)) return [];

  const candidateKeys = [
    "miners",
    "sales",
    "personalOffers",
    "craftingOffers",
    "racks",
    "appearance",
    "event",
    "seasonStore",
    "eventStore",
    "boxes",
    "parts",
    "hats",
    "trophies",
  ];

  const collections = [];
  for (const key of candidateKeys) {
    if (!(key in root)) continue;
    const value = root[key];
    const path = `root.${key}`;

    if (Array.isArray(value)) {
      const items = value.filter((entry) => entry && typeof entry === "object");
      if (items.length > 0) {
        collections.push({ path, items, source: "root-key-array" });
      }
      continue;
    }

    if (value && typeof value === "object") {
      const objectValues = Object.values(value).filter((entry) => entry && typeof entry === "object");
      if (objectValues.length > 0) {
        collections.push({ path: `${path}.*`, items: objectValues, source: "root-key-object-values" });
      }
    }
  }

  return collections;
}

function collectDeepObjectCandidates(root, maxNodes = 15000) {
  const candidates = [];
  const seen = new WeakSet();
  const queue = [{ node: root, path: "root" }];

  while (queue.length > 0 && candidates.length < maxNodes) {
    const { node, path } = queue.shift();
    if (!node || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((entry, index) => {
        if (entry && typeof entry === "object") {
          queue.push({ node: entry, path: `${path}[${index}]` });
        }
      });
      continue;
    }

    candidates.push({ path, item: node });

    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === "object") {
        queue.push({ node: value, path: `${path}.${key}` });
      }
    }
  }

  return candidates;
}

function summarizePayloadShape(payload) {
  const root = payload?.data ?? payload;
  if (!root || typeof root !== "object") {
    return { rootType: typeof root, rootKeys: [], rootKeyTypes: [] };
  }

  const rootKeys = Object.keys(root).slice(0, 20);
  const rootKeyTypes = rootKeys.map((key) => {
    const value = root[key];
    if (Array.isArray(value)) return `${key}:array(${value.length})`;
    if (value && typeof value === "object") return `${key}:object(${Object.keys(value).length})`;
    return `${key}:${typeof value}`;
  });
  const arrays = collectObjectArrays(root);
  const collections = collectObjectValueCollections(root);
  const rootKeyCollections = collectRootKeyCollections(root);
  return {
    rootType: Array.isArray(root) ? "array" : "object",
    rootKeys,
    rootKeyTypes,
    arrayCollections: arrays.length,
    objectValueCollections: collections.length,
    rootKeyCollections: rootKeyCollections.length,
  };
}

function getMinerCandidateSources(rawItem) {
  const roomConfigRaw = rawItem?.__roomConfigRaw === true;
  const saleOrdersRaw = rawItem?.__saleOrdersRaw === true;
  const variants = [
    rawItem,
    rawItem?.raw,
    rawItem?.node,
    rawItem?.item,
    rawItem?.miner,
    rawItem?.sale,
    rawItem?.market_item,
    rawItem?.marketItem,
    rawItem?.itemInfo,
    rawItem?.item_info,
    rawItem?.product,
    rawItem?.offer,
    rawItem?.offer_data,
    rawItem?.offerData,
    rawItem?.data,
    rawItem?.attributes,
  ];

  const seen = new Set();
  return variants.filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    if (seen.has(entry)) return false;
    seen.add(entry);
    if (roomConfigRaw && entry.__roomConfigRaw !== true) {
      entry.__roomConfigRaw = true;
    }
    if (saleOrdersRaw && entry.__saleOrdersRaw !== true) {
      entry.__saleOrdersRaw = true;
    }
    return true;
  });
}

function parseMinerFromRaw(rawItem, fallbackIndex) {
  const candidates = getMinerCandidateSources(rawItem);
  for (const candidate of candidates) {
    const power = extractMinerPower(candidate);
    const price = extractMinerPrice(candidate);
    if (!Number.isFinite(power) || !Number.isFinite(price) || power <= 0 || price <= 0) {
      continue;
    }

    const bonusPercent = extractMinerBonus(candidate);
    const effectivePower = power * (1 + bonusPercent / 100);
    const efficiency = effectivePower / price;

    return {
      id: String(extractMinerId(candidate, fallbackIndex)),
      name: extractMinerName(candidate, fallbackIndex),
      power,
      bonusPercent,
      level: extractMinerLevel(candidate),
      width: extractMinerWidth(candidate),
      effectivePower,
      price,
      currency: extractMinerCurrency(candidate),
      imageUrl: extractMinerImageUrl(candidate, rawItem),
      imageCandidates: extractMinerImageCandidates(candidate, rawItem),
      levelBadgeUrl: extractMinerLevelBadgeUrl(candidate),
      efficiency,
    };
  }

  return null;
}

function normalizeRoomMinerFromRaw(rawItem, fallbackIndex) {
  const candidates = getMinerCandidateSources(rawItem);
  for (const candidate of candidates) {
    const power = extractMinerPower(candidate);
    if (!Number.isFinite(power) || power <= 0) {
      continue;
    }

    const bonusPercent = extractMinerBonus(candidate);
    return {
      id: String(extractMinerId(candidate, fallbackIndex)),
      name: extractMinerName(candidate, fallbackIndex),
      power,
      bonusPercent,
      level: extractMinerLevel(candidate),
      width: extractMinerWidth(candidate),
      imageUrl: extractMinerImageUrl(candidate, rawItem),
      imageCandidates: extractMinerImageCandidates(candidate, rawItem),
      levelBadgeUrl: extractMinerLevelBadgeUrl(candidate),
    };
  }

  return null;
}

function extractMinerPower(rawItem) {
  const parsed = firstFiniteNumber([
    getByPath(rawItem, "product.power"),
    getByPath(rawItem, "item.power"),
    getByPath(rawItem, "miner.power"),
    getByPath(rawItem, "sale.power"),
    getByPath(rawItem, "itemInfo.power"),
    getByPath(rawItem, "item_info.power"),
    rawItem?.power,
    rawItem?.hashrate,
    rawItem?.hash_rate,
  ]);
  if (!Number.isFinite(parsed)) {
    return parsed;
  }

  // RollerCoin miner API power values come in Gh/s; store them internally as Ph/s.
  return convertGhsToPhs(parsed);
}

function extractMinerBonus(rawItem) {
  const parsed = firstFiniteNumber([
    rawItem?.miner_bonus,
    rawItem?.percent_bonus,
    rawItem?.bonus_percent,
    getByPath(rawItem, "price.miner_bonus"),
    getByPath(rawItem, "product.miner_bonus"),
    getByPath(rawItem, "product.percent_bonus"),
    getByPath(rawItem, "product.bonus_percent"),
    getByPath(rawItem, "item.miner_bonus"),
    getByPath(rawItem, "item.percent_bonus"),
    getByPath(rawItem, "item.bonus_percent"),
    getByPath(rawItem, "item_info.miner_bonus"),
    getByPath(rawItem, "item_info.percent_bonus"),
    getByPath(rawItem, "miner.percent_bonus"),
    getByPath(rawItem, "sale.percent_bonus"),
    rawItem?.bonus,
  ]);
  if (Number.isFinite(parsed)) {
    if (rawItem?.__saleOrdersRaw === true) {
      return parsed / 100;
    }
    if (rawItem?.__roomConfigRaw === true) {
      if (parsed >= 1000000) return parsed / 10000;
      if (Number.isInteger(parsed)) return parsed / 100;
    }
    return parsed;
  }

  const nestedBonus = firstFiniteNumber([
    getByPath(rawItem, "bonus.power_percent"),
    getByPath(rawItem, "item.bonus.power_percent"),
    getByPath(rawItem, "item_info.bonus.power_percent"),
    getByPath(rawItem, "product.bonus.power_percent"),
  ]);

  return Number.isFinite(nestedBonus) ? nestedBonus / 100 : 0;
}

function extractMinerLevel(rawItem) {
  const parsed = firstFiniteNumber([
    rawItem?.level,
    getByPath(rawItem, "item.level"),
    getByPath(rawItem, "item_info.level"),
    getByPath(rawItem, "product.level"),
  ]);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return normalizeMinerDisplayLevel(parsed);
}

function extractMinerWidth(rawItem) {
  const directParsed = firstFiniteNumber([
    rawItem?.width,
    rawItem?.size,
    rawItem?.slotSize,
    rawItem?.slot_size,
    rawItem?.cell_width,
    rawItem?.slots,
    getByPath(rawItem, "item.width"),
    getByPath(rawItem, "item.size"),
    getByPath(rawItem, "item.slotSize"),
    getByPath(rawItem, "item.slot_size"),
    getByPath(rawItem, "item_info.width"),
    getByPath(rawItem, "item_info.size"),
    getByPath(rawItem, "item_info.slotSize"),
    getByPath(rawItem, "item_info.slot_size"),
    getByPath(rawItem, "product.width"),
    getByPath(rawItem, "product.size"),
    getByPath(rawItem, "product.slotSize"),
    getByPath(rawItem, "product.slot_size"),
    getByPath(rawItem, "placement.width"),
    getByPath(rawItem, "placement.size"),
    getByPath(rawItem, "placement.slotSize"),
    getByPath(rawItem, "placement.slot_size"),
    getByPath(rawItem, "placement_info.width"),
    getByPath(rawItem, "placement_info.size"),
    getByPath(rawItem, "placement_info.slotSize"),
    getByPath(rawItem, "placement_info.slot_size"),
    getByPath(rawItem, "miner.width"),
    getByPath(rawItem, "miner.size"),
    getByPath(rawItem, "sale.width"),
    getByPath(rawItem, "sale.size"),
  ]);
  if (Number.isFinite(directParsed) && directParsed > 0) {
    return Math.floor(directParsed);
  }

  const textualCandidates = [
    rawItem?.width,
    rawItem?.size,
    rawItem?.slotSize,
    rawItem?.slot_size,
    getByPath(rawItem, "item.width"),
    getByPath(rawItem, "item.size"),
    getByPath(rawItem, "item_info.width"),
    getByPath(rawItem, "item_info.size"),
    getByPath(rawItem, "product.width"),
    getByPath(rawItem, "product.size"),
    getByPath(rawItem, "placement.size"),
    getByPath(rawItem, "placement_info.size"),
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

function extractMinerPrice(rawItem) {
  const parsed = firstFiniteNumber([
    rawItem?.price,
    rawItem?.cost,
    rawItem?.value,
    rawItem?.price_value,
    rawItem?.rlt_price,
    getByPath(rawItem, "product.price"),
    getByPath(rawItem, "product.cost"),
    getByPath(rawItem, "item.price"),
    getByPath(rawItem, "item.cost"),
    getByPath(rawItem, "miner.price"),
    getByPath(rawItem, "sale.price"),
    getByPath(rawItem, "offer.price"),
    getByPath(rawItem, "prices.rlt"),
    getByPath(rawItem, "prices.RLT"),
    getByPath(rawItem, "price.rlt"),
    getByPath(rawItem, "price.RLT"),
    getByPath(rawItem, "price.value"),
    getByPath(rawItem, "buy_action.price"),
    getByPath(rawItem, "buy_action.amount"),
    rawItem?.amount,
  ]);
  if (Number.isFinite(parsed) && rawItem?.__saleOrdersRaw === true) {
    return parsed / 1000000;
  }
  return parsed;
}

function extractMinerCurrency(rawItem) {
  return (
    rawItem?.currency ||
    rawItem?.price_currency ||
    getByPath(rawItem, "price.currency") ||
    getByPath(rawItem, "buy_action.currency") ||
    "RLT"
  );
}

function normalizeImageUrl(value) {
  if (!value) return "";
  const url = String(value).trim();
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) {
    return url;
  }
  if (url.startsWith("//")) {
    return `https:${url}`;
  }
  if (url.startsWith("/")) {
    return `https://rollercoin.com${url}`;
  }
  return "";
}

function getImagePenalty(url) {
  const signature = String(url || "").toLowerCase();
  let penalty = 0;
  if (signature.includes("one_horse_power")) penalty += 5000;
  if (signature.includes("level")) penalty += 1000;
  if (signature.includes("rarity")) penalty += 1000;
  if (signature.includes("badge")) penalty += 1000;
  if (signature.includes("frame")) penalty += 1000;
  if (signature.includes("rank")) penalty += 1000;
  if (signature.includes("star")) penalty += 800;
  if (signature.includes("icon")) penalty += 400;
  return penalty;
}

function buildMarketImageUrlCandidatesFromFilename(rawItem) {
  const filename =
    rawItem?.filename ||
    getByPath(rawItem, "item.filename") ||
    getByPath(rawItem, "item_info.filename") ||
    getByPath(rawItem, "product.filename") ||
    "";
  if (!filename) return "";

  const imgVer =
    rawItem?.img_ver ||
    getByPath(rawItem, "item.img_ver") ||
    getByPath(rawItem, "item_info.img_ver") ||
    getByPath(rawItem, "product.img_ver") ||
    "";

  const safeFilename = encodeURIComponent(String(filename));
  const suffixes = imgVer ? [`?v=${encodeURIComponent(String(imgVer))}`, ""] : [""];
  const bases = [
    "https://static.rollercoin.com/static/img/market/miners/",
    "https://rollercoin.com/static/img/market/miners/",
    "https://static.rollercoin.com/static/img/storage/miners/",
    "https://rollercoin.com/static/img/storage/miners/",
    "https://static.rollercoin.com/static/img/collections/miners/",
    "https://rollercoin.com/static/img/collections/miners/",
  ];
  const extensions = [".gif", ".png", ".webp", ".jpg"];
  const candidates = [];

  bases.forEach((base) => {
    extensions.forEach((extension) => {
      suffixes.forEach((suffix) => {
        candidates.push(`${base}${safeFilename}${extension}${suffix}`);
      });
    });
  });

  return [...new Set(candidates)];
}

function buildMarketImageUrlCandidatesFromName(rawItem) {
  const imageKey = buildMinerImageKeyFromName(
    getByPath(rawItem, "product.name") ||
      getByPath(rawItem, "item.name") ||
      getByPath(rawItem, "item_info.name") ||
      getByPath(rawItem, "miner.name") ||
      getByPath(rawItem, "sale.name") ||
      rawItem?.name ||
      rawItem?.title,
  );
  if (!imageKey) return [];

  const imgVer =
    rawItem?.img_ver ||
    getByPath(rawItem, "item.img_ver") ||
    getByPath(rawItem, "item_info.img_ver") ||
    getByPath(rawItem, "product.img_ver") ||
    "";
  const suffixes = imgVer ? [`?v=${encodeURIComponent(String(imgVer))}`, ""] : [""];
  const bases = [
    "https://static.rollercoin.com/static/img/market/miners/",
    "https://rollercoin.com/static/img/market/miners/",
  ];
  const candidates = [];

  bases.forEach((base) => {
    suffixes.forEach((suffix) => {
      candidates.push(`${base}${encodeURIComponent(imageKey)}.gif${suffix}`);
    });
  });

  return [...new Set(candidates)];
}

function buildMarketImageUrlFromFilename(rawItem) {
  return buildMarketImageUrlCandidatesFromFilename(rawItem)[0] || "";
}

function extractMinerLevelBadgeUrl(rawItem) {
  return buildMinerLevelBadgeUrl(extractMinerLevel(rawItem));
}

function extractMinerImageCandidates(rawItem, rootItem = null) {
  const candidates = [
    rawItem?.image_url,
    rawItem?.imageUrl,
    rawItem?.image,
    rawItem?.img,
    rawItem?.icon,
    getByPath(rawItem, "item.image"),
    getByPath(rawItem, "item.img"),
    getByPath(rawItem, "item.icon"),
    getByPath(rawItem, "item.picture"),
    getByPath(rawItem, "product.image"),
    getByPath(rawItem, "product.img"),
    getByPath(rawItem, "product.icon"),
    getByPath(rawItem, "miner.image"),
    getByPath(rawItem, "sale.image"),
    getByPath(rawItem, "raw.image_url"),
    getByPath(rawItem, "raw.image"),
    ...(Array.isArray(rawItem?.image_candidates) ? rawItem.image_candidates : []),
    ...(Array.isArray(rawItem?.imageCandidates) ? rawItem.imageCandidates : []),
    rootItem?.image_url,
    rootItem?.imageUrl,
    rootItem?.image,
    rootItem?.img,
    ...(Array.isArray(rootItem?.image_candidates) ? rootItem.image_candidates : []),
    ...(Array.isArray(rootItem?.imageCandidates) ? rootItem.imageCandidates : []),
    ...buildMarketImageUrlCandidatesFromName(rawItem),
    ...buildMarketImageUrlCandidatesFromName(rootItem),
    ...buildMarketImageUrlCandidatesFromFilename(rawItem),
    ...buildMarketImageUrlCandidatesFromFilename(rootItem),
  ];

  const ranked = [];
  for (const candidate of candidates) {
    const normalized = normalizeImageUrl(candidate);
    if (!normalized) continue;
    const score = 10000 - getImagePenalty(normalized);
    ranked.push({ normalized, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return [...new Set(ranked.map((entry) => entry.normalized))];
}

function extractMinerImageUrl(rawItem, rootItem = null) {
  return extractMinerImageCandidates(rawItem, rootItem)[0] || "";
}

function extractMinerName(rawItem, fallbackIndex) {
  const candidates = [
    getByPath(rawItem, "product.name"),
    getByPath(rawItem, "product.title"),
    getByPath(rawItem, "item.name"),
    getByPath(rawItem, "item.title"),
    getByPath(rawItem, "miner.name"),
    getByPath(rawItem, "sale.name"),
    rawItem?.name,
    rawItem?.title,
    getByPath(rawItem, "itemInfo.name"),
    getByPath(rawItem, "item_info.name"),
  ];

  for (const candidate of candidates) {
    const text = pickLocalizedText(candidate);
    if (text) return text;
  }

  return `Miner ${fallbackIndex + 1}`;
}

function extractMinerId(rawItem, fallbackIndex) {
  return (
    rawItem?.id ||
    rawItem?.order_id ||
    rawItem?.offer_id ||
    rawItem?.item_id ||
    getByPath(rawItem, "product.id") ||
    getByPath(rawItem, "item.id") ||
    getByPath(rawItem, "miner.id") ||
    getByPath(rawItem, "sale.id") ||
    getByPath(rawItem, "product.miner_id") ||
    `miner-${fallbackIndex + 1}`
  );
}

function scorePotentialMinerArray(items) {
  let score = 0;
  for (const item of items) {
    const parsed = parseMinerFromRaw(item, score);
    if (parsed) {
      score += 1;
    }
  }
  return score;
}

function normalizeMarketMiners(rawItems) {
  const map = new Map();

  rawItems.forEach((rawItem, index) => {
    const miner = parseMinerFromRaw(rawItem, index);
    if (!miner) return;

    const dedupeKey = `${miner.id}:${miner.level || 0}:${miner.price}:${miner.power}:${miner.bonusPercent}`;
    if (!map.has(dedupeKey)) {
      map.set(dedupeKey, miner);
    }
  });

  return [...map.values()];
}

function normalizeCachedMiner(rawItem, index) {
  if (!rawItem || typeof rawItem !== "object") return null;

  const power = parseNumber(rawItem.power);
  const price = parseNumber(rawItem.price);
  if (!Number.isFinite(power) || !Number.isFinite(price) || power <= 0 || price <= 0) {
    return null;
  }

  const bonusRaw = firstFiniteNumber([
    rawItem.bonusPercent,
    rawItem.bonus_percent,
    rawItem.percent_bonus,
    rawItem.bonus,
  ]);
  const bonusPercent = Number.isFinite(bonusRaw) ? bonusRaw : 0;

  const effectivePowerRaw = parseNumber(rawItem.effectivePower);
  const effectivePower =
    Number.isFinite(effectivePowerRaw) && effectivePowerRaw > 0
      ? effectivePowerRaw
      : power * (1 + bonusPercent / 100);

  const efficiencyRaw = parseNumber(rawItem.efficiency);
  const efficiency =
    Number.isFinite(efficiencyRaw) && efficiencyRaw > 0 ? efficiencyRaw : effectivePower / price;

  const idCandidate =
    (typeof rawItem.id === "string" && rawItem.id.trim()) ||
    (typeof rawItem.id === "number" && rawItem.id) ||
    `cached-miner-${index + 1}`;

  const name =
    typeof rawItem.name === "string" && rawItem.name.trim()
      ? rawItem.name.trim()
      : `Miner ${index + 1}`;

  const currency =
    typeof rawItem.currency === "string" && rawItem.currency.trim() ? rawItem.currency.trim() : "RLT";

  const imageUrl = normalizeImageUrl(rawItem.imageUrl || rawItem.image_url || rawItem.img || rawItem.image);
  const imageCandidates = [
    ...(Array.isArray(rawItem.imageCandidates) ? rawItem.imageCandidates : []),
    ...(Array.isArray(rawItem.image_candidates) ? rawItem.image_candidates : []),
    ...extractMinerImageCandidates(rawItem),
  ]
    .map((entry) => normalizeImageUrl(entry))
    .filter(Boolean);
  const level = normalizeMinerDisplayLevel(rawItem.level);
  const widthRaw = parseNumber(rawItem.width);
  const width = Number.isFinite(widthRaw) && widthRaw > 0 ? Math.floor(widthRaw) : extractMinerWidth(rawItem);
  const levelBadgeUrl =
    buildMinerLevelBadgeUrl(level) ||
    normalizeImageUrl(rawItem.levelBadgeUrl || rawItem.level_badge_url);

  return {
    id: String(idCandidate),
    name,
    power,
    bonusPercent,
    level,
    width,
    effectivePower,
    price,
    currency,
    imageUrl: imageUrl || imageCandidates[0] || "",
    imageCandidates: [...new Set(imageCandidates)],
    levelBadgeUrl,
    efficiency,
  };
}

function normalizeCachedMarketMiners(rawItems) {
  if (!Array.isArray(rawItems)) return [];

  const map = new Map();
  rawItems.forEach((rawItem, index) => {
    const miner = normalizeCachedMiner(rawItem, index);
    if (!miner) return;

    const dedupeKey = `${miner.id}:${miner.level || 0}:${miner.price}:${miner.power}:${miner.bonusPercent}`;
    if (!map.has(dedupeKey)) {
      map.set(dedupeKey, miner);
    }
  });

  return [...map.values()];
}

function normalizeRoomMiners(rawItems) {
  if (!Array.isArray(rawItems)) return [];

  const map = new Map();
  rawItems.forEach((rawItem, index) => {
    const miner = normalizeRoomMinerFromRaw(
      rawItem && typeof rawItem === "object" ? { ...rawItem, __roomConfigRaw: true } : rawItem,
      index,
    );
    if (!miner) return;

    const dedupeKey = `${miner.name}:${miner.level || 0}:${miner.width || 0}:${miner.power}:${miner.bonusPercent}`;
    if (!map.has(dedupeKey)) {
      map.set(dedupeKey, miner);
    }
  });

  return [...map.values()];
}

function logMinerPreview(miners, label = "Miner preview") {
  if (!Array.isArray(miners) || miners.length === 0) return;
  appendMarketLog(`${label}: showing up to first 5 miners.`, "info");
  miners.slice(0, 5).forEach((miner, index) => {
    appendMarketLog(
      `Miner ${index + 1}: name=${miner.name}, price=${miner.price}, power=${miner.power}, bonus=${miner.bonusPercent || 0}%`,
      "info",
    );
  });
}

function requestJsonWithCookies(url, cookieHeader) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        headers: {
          Accept: "application/json, text/plain, */*",
          Cookie: cookieHeader,
          "Cache-Control": "no-cache",
          Origin: "https://rollercoin.com",
          Pragma: "no-cache",
          Referer: "https://rollercoin.com/game/market/miners",
          "User-Agent": "Mozilla/5.0 RollerCoinCalculator",
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
            // Keep non-JSON as raw body.
          }

          resolve({
            statusCode: res.statusCode || 0,
            body,
            json,
          });
        });
      },
    );

    req.setTimeout(20000, () => {
      req.destroy(new Error("Request timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

function buildDirectMarketSaleOrdersUrl(page) {
  const params = new URLSearchParams();
  params.set("currency", "RLT");
  params.set("itemType", "miner");
  params.set("sort[field]", "date");
  params.set("sort[order]", "-1");
  params.set("skip", String((page - 1) * MARKET_DIRECT_PAGE_LIMIT));
  params.set("limit", String(MARKET_DIRECT_PAGE_LIMIT));
  return `https://rollercoin.com/api/marketplace/buy/sale-orders?${params.toString()}`;
}

function extractMarketRows(payload) {
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
}

async function fetchDirectMarketMinersByCookie(cookieHeader) {
  const offersMap = new Map();
  const seenPageKeys = new Set();
  let lastError = "Unknown error while loading direct market API.";
  let stagnantPageCount = 0;

  let shouldStop = false;
  for (
    let batchStartPage = 1;
    batchStartPage <= MARKET_DIRECT_MAX_PAGES && !shouldStop;
    batchStartPage += MARKET_DIRECT_PAGE_BATCH_SIZE
  ) {
    const pages = [];
    for (
      let page = batchStartPage;
      page < batchStartPage + MARKET_DIRECT_PAGE_BATCH_SIZE && page <= MARKET_DIRECT_MAX_PAGES;
      page += 1
    ) {
      const url = buildDirectMarketSaleOrdersUrl(page);
      pages.push({ page, url });
      appendMarketLog(`Direct API GET page ${page}: ${url}`, "info");
    }

    const responses = await Promise.all(
      pages.map(async ({ page, url }) => {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          const requestUrl = `${url}&_=${page}-${attempt}-${Date.now()}`;
          try {
            const response = await requestJsonWithCookies(requestUrl, cookieHeader);
            const shouldRetry =
              attempt < 3 &&
              (
                response.statusCode === 403 ||
                response.statusCode === 429 ||
                response.statusCode >= 500 ||
                !response.json ||
                typeof response.json !== "object"
              );
            if (shouldRetry) {
              appendMarketLog(
                `Direct API page ${page} attempt ${attempt} returned ${response.statusCode}. Retrying...`,
                "warn",
              );
              await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
              continue;
            }

            return {
              page,
              url: requestUrl,
              response,
            };
          } catch (error) {
            if (attempt < 3) {
              appendMarketLog(
                `Direct API page ${page} attempt ${attempt} failed: ${error.message || String(error)}. Retrying...`,
                "warn",
              );
              await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
              continue;
            }
            throw error;
          }
        }

        return {
          page,
          url,
          response: await requestJsonWithCookies(url, cookieHeader),
        };
      }),
    );

    for (const { page, response } of responses) {
      appendMarketLog(`Direct API page ${page} status: ${response.statusCode}`, "info");

      if (response.statusCode === 401 || response.statusCode === 403) {
        if (offersMap.size > 0) {
          appendMarketLog(
            `Direct API stopped on page ${page} with status ${response.statusCode}. Keeping ${offersMap.size} already loaded miners.`,
            "warn",
          );
          shouldStop = true;
          break;
        }
        throw new Error("Session is not authorized for direct market API. Log in to RollerCoin again.");
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        lastError = `Direct market API returned status ${response.statusCode} on page ${page}.`;
        throw new Error(lastError);
      }
      if (!response.json || typeof response.json !== "object") {
        lastError = `Direct market API returned non-JSON payload on page ${page}.`;
        throw new Error(lastError);
      }

      const rows = extractMarketRows(response.json);
      appendMarketLog(`Direct API page ${page} rows: ${rows.length}.`, "info");
      if (rows.length === 0) {
        shouldStop = true;
        break;
      }

      const pageMiners = normalizeMarketMiners(
        rows.map((row) => ({
          ...row,
          __saleOrdersRaw: true,
        })),
      );
      const firstKey =
        pageMiners[0]?.id ||
        (pageMiners[0]
          ? `${pageMiners[0].name}:${pageMiners[0].price}:${pageMiners[0].power}:${pageMiners[0].bonusPercent}`
          : `page-${page}-empty`);

      if (seenPageKeys.has(firstKey)) {
        stagnantPageCount += 1;
        appendMarketLog(
          `Direct API page ${page} repeated first offer signature (${stagnantPageCount}/3).`,
          "warn",
        );
        if (stagnantPageCount >= 3) {
          appendMarketLog("Direct API encountered repeated pages several times. Stopping pagination.", "warn");
          shouldStop = true;
          break;
        }
        continue;
      }
      seenPageKeys.add(firstKey);

      const uniqueBefore = offersMap.size;
      pageMiners.forEach((miner) => {
        const dedupeKey = `${miner.id}:${miner.price}:${miner.power}:${miner.bonusPercent}`;
        if (!offersMap.has(dedupeKey)) {
          offersMap.set(dedupeKey, miner);
        }
      });
      const addedMiners = offersMap.size - uniqueBefore;
      stagnantPageCount = addedMiners > 0 ? 0 : stagnantPageCount + 1;

      appendMarketLog(
        `Direct API page ${page} normalized=${pageMiners.length}, added=${addedMiners}, uniqueTotal=${offersMap.size}.`,
        "info",
      );
      if (stagnantPageCount >= 3) {
        appendMarketLog("Direct API stopped after several pages without new miners.", "warn");
        shouldStop = true;
        break;
      }
      if (rows.length < MARKET_DIRECT_PAGE_LIMIT || pageMiners.length === 0) {
        shouldStop = true;
        break;
      }
    }
  }

  const miners = [...offersMap.values()];
  if (miners.length === 0) {
    throw new Error(lastError || "Direct market API returned no miner offers.");
  }

  return {
    miners,
    endpoint: "https://rollercoin.com/api/marketplace/buy/sale-orders",
    sourcePath: "direct-market-api-cookie-fallback",
    sourceScore: miners.length,
  };
}

function parseMarketPayload(endpoint, payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error(`API ${endpoint} returned invalid JSON payload.`);
  }

  const payloadRoot = payload.data ?? payload;
  const arrayCollections = collectObjectArrays(payloadRoot);
  const objectValueCollections = collectObjectValueCollections(payloadRoot);
  const rootKeyCollections = collectRootKeyCollections(payloadRoot);
  const collections = [...rootKeyCollections, ...arrayCollections, ...objectValueCollections];

  if (collections.length === 0) {
    const deepCandidates = collectDeepObjectCandidates(payloadRoot, 15000);
    const deepMiners = normalizeMarketMiners(deepCandidates.map((entry) => entry.item));
    if (deepMiners.length > 0) {
      return {
        miners: deepMiners,
        endpoint,
        sourcePath: "fallback-deep-object-scan",
        sourceScore: deepMiners.length,
      };
    }

    const shape = summarizePayloadShape(payload);
    throw new Error(
      `No object collections found in API payload from ${endpoint}. ` +
        `rootType=${shape.rootType}; keys=${shape.rootKeys.join(", ") || "-"}; ` +
        `keyTypes=${shape.rootKeyTypes.join(", ") || "-"}.`,
    );
  }

  const bestArray = collections
    .map((entry) => ({ ...entry, score: scorePotentialMinerArray(entry.items) }))
    .sort((a, b) => b.score - a.score)[0];

  if (!bestArray || bestArray.score === 0) {
    const fallbackRawItems = collections.flatMap((entry) => entry.items).slice(0, 10000);
    const fallbackMiners = normalizeMarketMiners(fallbackRawItems);
    if (fallbackMiners.length > 0) {
      return {
        miners: fallbackMiners,
        endpoint,
        sourcePath: "fallback-all-collections",
        sourceScore: fallbackMiners.length,
      };
    }

    const deepCandidates = collectDeepObjectCandidates(payloadRoot, 15000);
    const deepMiners = normalizeMarketMiners(deepCandidates.map((entry) => entry.item));
    if (deepMiners.length > 0) {
      return {
        miners: deepMiners,
        endpoint,
        sourcePath: "fallback-deep-object-scan-after-score0",
        sourceScore: deepMiners.length,
      };
    }

    throw new Error(`Could not find miner-like offers in API payload from ${endpoint}.`);
  }

  const miners = normalizeMarketMiners(bestArray.items);
  if (miners.length === 0) {
    const fallbackRawItems = collections.flatMap((entry) => entry.items).slice(0, 10000);
    const fallbackMiners = normalizeMarketMiners(fallbackRawItems);
    if (fallbackMiners.length > 0) {
      return {
        miners: fallbackMiners,
        endpoint,
        sourcePath: "fallback-all-collections-after-best-failed",
        sourceScore: fallbackMiners.length,
      };
    }

    const deepCandidates = collectDeepObjectCandidates(payloadRoot, 15000);
    const deepMiners = normalizeMarketMiners(deepCandidates.map((entry) => entry.item));
    if (deepMiners.length > 0) {
      return {
        miners: deepMiners,
        endpoint,
        sourcePath: "fallback-deep-object-scan-after-best-failed",
        sourceScore: deepMiners.length,
      };
    }

    throw new Error(`Failed to parse miner offers from ${endpoint}.`);
  }

  return {
    miners,
    endpoint,
    sourcePath: bestArray.path,
    sourceScore: bestArray.score,
  };
}

async function fetchMarketMiners(cookieHeader, requestId = null) {
  let lastError = "Unknown error while loading market offers.";
  let hadSuccessfulSessionResponse = false;

  if (ipcRenderer && typeof ipcRenderer.invoke === "function") {
    try {
      appendMarketLog("Requesting market miners via authenticated Electron session...", "info");
      const sessionResponse = await ipcRenderer.invoke(
        "rollercoin-market-fetch",
        {
          cookieHeader,
          requestId,
        },
      );

      if (sessionResponse?.attempts) {
        logAttemptsSummary(sessionResponse.attempts, "Main process trace");
      }
      if (sessionResponse?.diagnostics && typeof sessionResponse.diagnostics === "object") {
        const diagnostics = sessionResponse.diagnostics;
        appendMarketLog(
          `Session diagnostics: probeOk=${diagnostics.sawAnyProbeOk ? "yes" : "no"}, ` +
            `probeJson=${diagnostics.sawAnyProbeJson ? "yes" : "no"}, ` +
            `probeRows=${diagnostics.sawAnyProbeRows ? "yes" : "no"}, ` +
            `hardUnauthorized=${diagnostics.sawUnauthorizedStatus ? "yes" : "no"}.`,
          "info",
        );
      }

      if (sessionResponse && sessionResponse.success && Array.isArray(sessionResponse.marketplaceOffers)) {
        hadSuccessfulSessionResponse = true;
        const miners = normalizeCachedMarketMiners(sessionResponse.marketplaceOffers);
        if (miners.length === 0) {
          throw new Error("Marketplace/buy scan returned no valid miner offers.");
        }
        appendMarketLog(
          `Session returned ${sessionResponse.marketplaceOffers.length} offers; normalized to ${miners.length} miners.`,
          "success",
        );
        if (sessionResponse.partial && sessionResponse.warning) {
          appendMarketLog(sessionResponse.warning, "warn");
        }
        logMinerPreview(miners, "Session direct API preview");
        return {
          miners,
          endpoint: sessionResponse.endpoint || "https://rollercoin.com/api/marketplace/buy/sale-orders",
          sourcePath: sessionResponse.sourcePath || "direct-market-api",
          sourceScore: miners.length,
        };
      }

      if (sessionResponse && sessionResponse.success && sessionResponse.json) {
        hadSuccessfulSessionResponse = true;
        appendMarketLog(
          `Session returned JSON payload from ${sessionResponse.endpoint || "unknown endpoint"}.`,
          "success",
        );
        try {
          const parsed = parseMarketPayload(
            sessionResponse.endpoint || "session-fetch",
            sessionResponse.json,
          );
          logMinerPreview(parsed.miners, "Session API payload preview");
          return parsed;
        } catch (error) {
          const shape = summarizePayloadShape(sessionResponse.json);
          appendMarketLog(
            `Session payload parse details: rootType=${shape.rootType}; ` +
              `arrayCollections=${shape.arrayCollections}; ` +
              `objectValueCollections=${shape.objectValueCollections}; ` +
              `rootKeyCollections=${shape.rootKeyCollections}; ` +
              `keys=${shape.rootKeys.join(", ") || "-"}.`,
            "warn",
          );
          if (Array.isArray(shape.rootKeyTypes) && shape.rootKeyTypes.length > 0) {
            appendMarketLog(`Session payload key types: ${shape.rootKeyTypes.join(", ")}.`, "info");
          }
          lastError = `Session payload parse failed: ${error.message}`;
          appendMarketLog(lastError, "error");
          throw new Error(lastError);
        }
      }

      if (sessionResponse && sessionResponse.unauthorized) {
        const hardUnauthorized = Boolean(sessionResponse.hardUnauthorized);
        lastError = hardUnauthorized
          ? "Session is not authorized for market API. Log in to RollerCoin again."
          : "Market endpoint format changed or data was not parseable in this session.";
        appendMarketLog(lastError, "warn");
      } else if (sessionResponse && sessionResponse.error) {
        lastError = `Session fetch error: ${sessionResponse.error}`;
        appendMarketLog(lastError, "warn");
      }
    } catch (error) {
      lastError = `Session fetch failed: ${error.message}`;
      appendMarketLog(lastError, "error");
    }
  }

  if (hadSuccessfulSessionResponse) {
    throw new Error(lastError);
  }

  if (!cookieHeader) {
    throw new Error(lastError);
  }

  appendMarketLog("Main-process loading failed. Trying direct sale-orders API via cookie fallback...", "warn");
  try {
    return await fetchDirectMarketMinersByCookie(cookieHeader);
  } catch (error) {
    throw new Error(error.message || lastError);
  }
}

function formatMarketValue(value, fractionDigits = 2) {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", { maximumFractionDigits: fractionDigits });
}

function readOptionalInputNumber(element) {
  if (!element) return null;
  const raw = element.value.trim();
  if (!raw) return null;
  const value = parseNumber(raw);
  if (!Number.isFinite(value) || value < 0) return NaN;
  return value;
}

function getTopNValue() {
  const rawText = marketTopNInput?.value?.trim?.() ?? "";
  if (!rawText) return null;

  const raw = parseNumber(rawText);
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error("Invalid top results value. Enter a positive number or leave it empty.");
  }

  return Math.floor(raw);
}

function getMarketSortMode() {
  const value = marketSortModeInput?.value;
  return value === "gainPower" ? "gainPower" : "gainPerPrice";
}

function getMarketMinerOfferKey(miner) {
  const id = String(miner?.id || "");
  const level = Number.isFinite(Number(miner?.level)) ? Math.floor(Number(miner.level)) : 0;
  const price = Number(miner?.price) || 0;
  const power = Number(miner?.power) || 0;
  const bonusPercent = Number(miner?.bonusPercent) || 0;
  return `${id}:${level}:${price}:${power}:${bonusPercent}`;
}

function cloneMinerForRecommendation(miner) {
  return {
    id: String(miner?.id || ""),
    name: String(miner?.name || "Unknown"),
    level: miner?.level ?? null,
    power: Number.isFinite(Number(miner?.power)) ? Number(miner.power) : NaN,
    bonusPercent: Number.isFinite(Number(miner?.bonusPercent)) ? Number(miner.bonusPercent) : 0,
    width: Number.isFinite(Number(miner?.width)) ? Math.floor(Number(miner.width)) : null,
    price: Number.isFinite(Number(miner?.price)) ? Number(miner.price) : NaN,
    currency: typeof miner?.currency === "string" && miner.currency ? miner.currency : "RLT",
    imageUrl: miner?.imageUrl || "",
    imageCandidates: Array.isArray(miner?.imageCandidates) ? [...miner.imageCandidates] : [],
    levelBadgeUrl: miner?.levelBadgeUrl || "",
  };
}

function compareByGainThenEfficiencyDesc(leftItem, rightItem) {
  if (rightItem.gainPower !== leftItem.gainPower) return rightItem.gainPower - leftItem.gainPower;
  if (rightItem.gainPerPrice !== leftItem.gainPerPrice) return rightItem.gainPerPrice - leftItem.gainPerPrice;
  return leftItem.price - rightItem.price;
}

function compareRecommendationItems(leftItem, rightItem, sortMode = "gainPerPrice") {
  if (sortMode === "gainPower") {
    return compareByGainThenEfficiencyDesc(leftItem, rightItem);
  }
  if (rightItem.gainPerPrice !== leftItem.gainPerPrice) return rightItem.gainPerPrice - leftItem.gainPerPrice;
  if (rightItem.gainPower !== leftItem.gainPower) return rightItem.gainPower - leftItem.gainPower;
  return leftItem.price - rightItem.price;
}

function sortRecommendationItems(items, sortMode = "gainPerPrice") {
  return [...items].sort((leftItem, rightItem) => compareRecommendationItems(leftItem, rightItem, sortMode));
}

function buildRecommendationEntry({
  currentSystem,
  totalCurrentThs,
  purchaseMiners,
  replacementMiners = [],
  price,
  currency = "RLT",
  boughtPowerThs,
  boughtBonusPercent,
  removedPowerThs = 0,
  removedBonusPercent = 0,
  removedMask = 0n,
  buyMask = 0n,
  entryType = "single",
  replaceTextOverride = null,
  sourceMinerId = "",
  offerKey = "",
  bundleKey = "",
}) {
  const normalizedPurchaseMiners = Array.isArray(purchaseMiners)
    ? purchaseMiners.map((miner) => cloneMinerForRecommendation(miner))
    : [];
  const normalizedReplacementMiners = Array.isArray(replacementMiners)
    ? replacementMiners.map((miner) => cloneMinerForRecommendation(miner))
    : [];

  const safeBoughtPowerThs = Number.isFinite(Number(boughtPowerThs))
    ? Number(boughtPowerThs)
    : normalizedPurchaseMiners.reduce((sum, miner) => sum + toThs(miner.power, "Ph/s"), 0);
  const safeBoughtBonusPercent = Number.isFinite(Number(boughtBonusPercent))
    ? Number(boughtBonusPercent)
    : normalizedPurchaseMiners.reduce((sum, miner) => sum + (Number(miner.bonusPercent) || 0), 0);
  const safeRemovedPowerThs = Number.isFinite(Number(removedPowerThs))
    ? Number(removedPowerThs)
    : normalizedReplacementMiners.reduce((sum, miner) => sum + toThs(miner.power, "Ph/s"), 0);
  const safeRemovedBonusPercent = Number.isFinite(Number(removedBonusPercent))
    ? Number(removedBonusPercent)
    : normalizedReplacementMiners.reduce((sum, miner) => sum + (Number(miner.bonusPercent) || 0), 0);

  const projectedBaseThs = currentSystem.baseThs + safeBoughtPowerThs - safeRemovedPowerThs;
  const projectedBonusPercent = currentSystem.bonusPercent + safeBoughtBonusPercent - safeRemovedBonusPercent;
  const projectedTotalThs = getCurrentTotal(projectedBaseThs, projectedBonusPercent);
  const gainThs = projectedTotalThs - totalCurrentThs;
  const numericPrice = Number(price);
  const gainPerPrice = numericPrice > 0 ? gainThs / numericPrice : NaN;
  const purchaseCount = normalizedPurchaseMiners.length;
  const widthDisplayValues = normalizedPurchaseMiners
    .map((miner) => (Number.isFinite(Number(miner?.width)) ? String(Math.floor(Number(miner.width))) : ""))
    .filter(Boolean);
  const widthDisplay = widthDisplayValues.length > 0 ? widthDisplayValues.join(" + ") : "-";
  const leadMiner = normalizedPurchaseMiners[0] || {};

  return {
    entryType,
    isBundle: purchaseCount > 1,
    bundleKey,
    offerKey: offerKey || getMarketMinerOfferKey(leadMiner),
    sourceMinerId: String(sourceMinerId || leadMiner.id || ""),
    name:
      purchaseCount === 1
        ? String(leadMiner.name || "Marketplace miner")
        : buildReplacementSetLabel(normalizedPurchaseMiners),
    price: numericPrice,
    power: safeBoughtPowerThs / POWER_MULTIPLIER["Ph/s"],
    bonusPercent: safeBoughtBonusPercent,
    width: purchaseCount === 1 ? (leadMiner.width ?? null) : widthDisplay,
    widthDisplay,
    gainPower: gainThs / POWER_MULTIPLIER["Ph/s"],
    gainPerPrice: Number.isFinite(gainPerPrice) ? gainPerPrice / POWER_MULTIPLIER["Ph/s"] : NaN,
    projectedBasePower: projectedBaseThs / POWER_MULTIPLIER["Ph/s"],
    projectedBonusPercent,
    projectedTotalPower: projectedTotalThs / POWER_MULTIPLIER["Ph/s"],
    replacedMinerName: normalizedReplacementMiners[0]?.name || "",
    replacedMinerLevel: normalizedReplacementMiners[0]?.level ?? null,
    replacedMinerWidth: normalizedReplacementMiners[0]?.width ?? null,
    replacedMinerCount: normalizedReplacementMiners.length,
    replacementMiners: normalizedReplacementMiners,
    replaceText:
      typeof replaceTextOverride === "string"
        ? replaceTextOverride
        : normalizedReplacementMiners.length > 0
          ? buildReplacementSetLabel(normalizedReplacementMiners)
          : "-",
    purchaseMiners: normalizedPurchaseMiners,
    purchaseCount,
    imageUrl: leadMiner.imageUrl || "",
    imageCandidates: Array.isArray(leadMiner.imageCandidates) ? [...leadMiner.imageCandidates] : [],
    levelBadgeUrl: purchaseCount === 1 ? leadMiner.levelBadgeUrl || "" : "",
    currency,
    boughtPowerThs: safeBoughtPowerThs,
    boughtBonusPercent: safeBoughtBonusPercent,
    removedPowerThs: safeRemovedPowerThs,
    removedBonusPercent: safeRemovedBonusPercent,
    removedMask,
    buyMask,
    marketMinerIds: normalizedPurchaseMiners.map((miner) => String(miner?.id || "")),
  };
}

function buildFilteredMarketMiners({
  budget,
  maxMinerPrice,
  roomWidthMode,
  roomMinersCacheSnapshot,
  ownedRoomMinerKeys,
}) {
  const hasBudgetFilter = budget !== null;
  const hasMaxPriceFilter = maxMinerPrice !== null;
  const hasWidthFilter = roomWidthMode !== "any";
  const hideOwnedRoomMiners = roomMinersCacheSnapshot.length > 0 && ownedRoomMinerKeys.size > 0;

  return marketMinersCache.filter((miner) => {
    const price = Number(miner?.price);
    if (hasBudgetFilter && (!Number.isFinite(price) || price > budget)) return false;
    if (hasMaxPriceFilter && (!Number.isFinite(price) || price > maxMinerPrice)) return false;
    if (hasWidthFilter && String(miner?.width || "") !== roomWidthMode) return false;
    if (hideOwnedRoomMiners && ownedRoomMinerKeys.has(getRoomMinerOwnershipKey(miner))) return false;
    return true;
  });
}

function buildSingleRecommendationItems({
  filteredMarketMiners,
  currentSystem,
  totalCurrentThs,
  replacementEnabled,
  roomReplacementSets,
  sortMode,
}) {
  const replacementSetsByWidth = new Map();
  roomReplacementSets.forEach((replacementSet) => {
    const widthKey = Number(replacementSet?.width);
    if (!Number.isFinite(widthKey) || widthKey <= 0) return;
    const bucket = replacementSetsByWidth.get(widthKey) || [];
    bucket.push(replacementSet);
    replacementSetsByWidth.set(widthKey, bucket);
  });

  const singleItems = filteredMarketMiners
    .map((miner) => {
      const purchaseMiner = cloneMinerForRecommendation(miner);
      const offerKey = getMarketMinerOfferKey(miner);
      const sharedParams = {
        currentSystem,
        totalCurrentThs,
        purchaseMiners: [purchaseMiner],
        price: miner.price,
        currency: miner.currency || "RLT",
        boughtPowerThs: toThs(miner.power, "Ph/s"),
        boughtBonusPercent: miner.bonusPercent,
        sourceMinerId: miner.id,
        offerKey,
      };

      if (!replacementEnabled) {
        return buildRecommendationEntry(sharedParams);
      }

      const minerWidth = Number.isFinite(Number(miner.width)) ? Math.floor(Number(miner.width)) : null;
      const replacementPool = minerWidth ? (replacementSetsByWidth.get(minerWidth) || []) : [];
      let bestRecommendation = null;

      replacementPool.forEach((replacementSet) => {
        const candidateRecommendation = buildRecommendationEntry({
          ...sharedParams,
          replacementMiners: replacementSet.miners,
          removedPowerThs: replacementSet.removedPowerThs,
          removedBonusPercent: replacementSet.removedBonusPercent,
          removedMask: replacementSet.removedMask,
        });

        if (
          !bestRecommendation ||
          compareByGainThenEfficiencyDesc(candidateRecommendation, bestRecommendation) < 0
        ) {
          bestRecommendation = candidateRecommendation;
        }
      });

      if (bestRecommendation) {
        return bestRecommendation;
      }

      return buildRecommendationEntry({
        ...sharedParams,
        replaceTextOverride: minerWidth
          ? `No room miner found for width ${minerWidth}`
          : "Width not detected",
      });
    })
    .filter(Boolean);

  return sortRecommendationItems(singleItems, sortMode);
}

function selectBudgetCombinationBuyPool(singleItems, budget = null) {
  const positiveSingles = singleItems.filter((miner) => hasMeaningfulPositiveGain(miner.gainPower));
  const selected = new Map();
  const addItems = (items) => {
    items.forEach((item) => {
      const offerKey = String(item.offerKey || "");
      if (!offerKey || selected.has(offerKey)) return;
      selected.set(offerKey, item);
    });
  };

  addItems([...positiveSingles].sort((leftItem, rightItem) => compareByGainThenEfficiencyDesc(leftItem, rightItem))
    .slice(0, BUDGET_COMBINATION_BUY_POOL_LIMIT));
  addItems([...positiveSingles].sort((leftItem, rightItem) => compareRecommendationItems(leftItem, rightItem, "gainPerPrice"))
    .slice(0, BUDGET_COMBINATION_BUY_POOL_LIMIT));
  addItems([...positiveSingles]
    .sort((leftItem, rightItem) => leftItem.price - rightItem.price || compareByGainThenEfficiencyDesc(leftItem, rightItem))
    .slice(0, Math.max(18, Math.floor(BUDGET_COMBINATION_BUY_POOL_LIMIT / 3))));
  if (budget === null) {
    addItems([...positiveSingles]
      .sort((leftItem, rightItem) => rightItem.price - leftItem.price || compareByGainThenEfficiencyDesc(leftItem, rightItem))
      .slice(0, Math.max(18, Math.floor(BUDGET_COMBINATION_BUY_POOL_LIMIT / 3))));
  }

  return [...selected.values()].slice(0, BUDGET_COMBINATION_BUY_POOL_LIMIT);
}

function getReplacementSetLossEstimate(replacementSet, currentSystem) {
  if (!replacementSet) return Number.POSITIVE_INFINITY;
  return (
    replacementSet.removedPowerThs * (1 + currentSystem.bonusPercent / 100) +
    currentSystem.baseThs * (replacementSet.removedBonusPercent / 100)
  );
}

function compareReplacementSetsByLoss(leftSet, rightSet, currentSystem) {
  const leftLoss = getReplacementSetLossEstimate(leftSet, currentSystem);
  const rightLoss = getReplacementSetLossEstimate(rightSet, currentSystem);

  if (leftLoss !== rightLoss) return leftLoss - rightLoss;
  if (leftSet.removedPowerThs !== rightSet.removedPowerThs) {
    return leftSet.removedPowerThs - rightSet.removedPowerThs;
  }
  if (leftSet.removedBonusPercent !== rightSet.removedBonusPercent) {
    return leftSet.removedBonusPercent - rightSet.removedBonusPercent;
  }
  return leftSet.miners.length - rightSet.miners.length;
}

function buildBudgetReplacementSetMap(currentSystem, maxWidth) {
  const normalizedMaxWidth = Math.max(0, Math.floor(Number(maxWidth) || 0));
  const replacementBuckets = new Map();
  replacementBuckets.set(0, [{
    width: 0,
    miners: [],
    removedPowerThs: 0,
    removedBonusPercent: 0,
    removedMask: 0n,
    label: "-",
  }]);

  const roomMinerMaskById = new Map(
    roomMinersCache.map((miner, index) => [String(miner?.id || `room-miner-${index + 1}`), 1n << BigInt(index)]),
  );
  const roomMinerEntries = roomMinersCache
    .map((miner, index) => {
      const width = Number.isFinite(Number(miner?.width)) ? Math.floor(Number(miner.width)) : null;
      if (!Number.isFinite(width) || width <= 0 || width > normalizedMaxWidth) return null;

      return {
        width,
        miner,
        removedPowerThs: toThs(miner.power, "Ph/s"),
        removedBonusPercent: Number(miner.bonusPercent) || 0,
        removedMask: roomMinerMaskById.get(String(miner?.id || `room-miner-${index + 1}`)) || 0n,
      };
    })
    .filter(Boolean);

  roomMinerEntries.forEach((roomEntry) => {
    for (let width = normalizedMaxWidth - roomEntry.width; width >= 0; width -= 1) {
      const sourceBucket = replacementBuckets.get(width) || [];
      if (sourceBucket.length === 0) continue;

      const nextWidth = width + roomEntry.width;
      const nextBucket = replacementBuckets.get(nextWidth) || [];
      sourceBucket.forEach((state) => {
        if ((state.removedMask & roomEntry.removedMask) !== 0n) return;

        nextBucket.push({
          width: nextWidth,
          miners: [...state.miners, roomEntry.miner],
          removedPowerThs: state.removedPowerThs + roomEntry.removedPowerThs,
          removedBonusPercent: state.removedBonusPercent + roomEntry.removedBonusPercent,
          removedMask: state.removedMask | roomEntry.removedMask,
          label: buildReplacementSetLabel([...state.miners, roomEntry.miner]),
        });
      });

      const uniqueBucket = new Map();
      nextBucket.forEach((state) => {
        const bucketKey = state.removedMask.toString(16);
        const existing = uniqueBucket.get(bucketKey);
        if (!existing || compareReplacementSetsByLoss(state, existing, currentSystem) < 0) {
          uniqueBucket.set(bucketKey, state);
        }
      });

      replacementBuckets.set(
        nextWidth,
        [...uniqueBucket.values()]
          .sort((leftSet, rightSet) => compareReplacementSetsByLoss(leftSet, rightSet, currentSystem))
          .slice(0, BUDGET_COMBINATION_REPLACEMENT_SET_LIMIT),
      );
    }
  });

  const bestSetsByWidth = new Map();
  replacementBuckets.forEach((bucket, width) => {
    if (!Number.isFinite(Number(width)) || Number(width) <= 0 || !Array.isArray(bucket) || bucket.length === 0) return;
    bestSetsByWidth.set(Number(width), bucket[0]);
  });

  return bestSetsByWidth;
}

function buildBudgetModeSingleItems({
  filteredMarketMiners,
  currentSystem,
  totalCurrentThs,
  replacementEnabled,
  replacementSetsByWidth,
  sortMode,
}) {
  const items = filteredMarketMiners
    .map((miner) => {
      const purchaseMiner = cloneMinerForRecommendation(miner);
      const widthKey = Number.isFinite(Number(purchaseMiner.width)) ? Math.floor(Number(purchaseMiner.width)) : null;

      if (replacementEnabled) {
        const replacementSet = widthKey ? replacementSetsByWidth.get(widthKey) : null;
        if (!replacementSet) return null;

        return buildRecommendationEntry({
          currentSystem,
          totalCurrentThs,
          purchaseMiners: [purchaseMiner],
          replacementMiners: replacementSet.miners,
          price: purchaseMiner.price,
          currency: purchaseMiner.currency || "RLT",
          boughtPowerThs: toThs(purchaseMiner.power, "Ph/s"),
          boughtBonusPercent: purchaseMiner.bonusPercent,
          removedPowerThs: replacementSet.removedPowerThs,
          removedBonusPercent: replacementSet.removedBonusPercent,
          removedMask: replacementSet.removedMask,
          sourceMinerId: purchaseMiner.id,
          offerKey: getMarketMinerOfferKey(purchaseMiner),
        });
      }

      return buildRecommendationEntry({
        currentSystem,
        totalCurrentThs,
        purchaseMiners: [purchaseMiner],
        price: purchaseMiner.price,
        currency: purchaseMiner.currency || "RLT",
        boughtPowerThs: toThs(purchaseMiner.power, "Ph/s"),
        boughtBonusPercent: purchaseMiner.bonusPercent,
        sourceMinerId: purchaseMiner.id,
        offerKey: getMarketMinerOfferKey(purchaseMiner),
      });
    })
    .filter(Boolean);

  return sortRecommendationItems(items, sortMode);
}

function buildBudgetCombinationOptions({
  budget,
  buyPool,
}) {
  const options = [];
  const hasBudgetLimit = Number.isFinite(budget) && budget > 0;

  buyPool.forEach((singleItem, buyIndex) => {
    const purchaseMiner = singleItem?.purchaseMiners?.[0];
    if (!purchaseMiner) return;

    const price = Number(purchaseMiner.price);
    if (!Number.isFinite(price) || price <= 0 || (hasBudgetLimit && price > budget)) return;

    options.push({
      purchaseMiners: [purchaseMiner],
      price,
      currency: purchaseMiner.currency || "RLT",
      boughtPowerThs: toThs(purchaseMiner.power, "Ph/s"),
      boughtBonusPercent: purchaseMiner.bonusPercent,
      totalWidth: Number.isFinite(Number(purchaseMiner.width)) ? Math.floor(Number(purchaseMiner.width)) : 0,
      offerKey: getMarketMinerOfferKey(purchaseMiner),
      buyMask: 1n << BigInt(buyIndex),
      atomicKey: `${getMarketMinerOfferKey(purchaseMiner)}::${buyIndex}`,
    });
  });

  return options
    .sort((leftItem, rightItem) => {
      const leftEfficiency = leftItem.price > 0 ? leftItem.boughtPowerThs / leftItem.price : -Infinity;
      const rightEfficiency = rightItem.price > 0 ? rightItem.boughtPowerThs / rightItem.price : -Infinity;
      if (rightEfficiency !== leftEfficiency) return rightEfficiency - leftEfficiency;
      if (rightItem.boughtPowerThs !== leftItem.boughtPowerThs) return rightItem.boughtPowerThs - leftItem.boughtPowerThs;
      return leftItem.price - rightItem.price;
    })
    .slice(0, BUDGET_COMBINATION_OPTION_LIMIT)
    .map((item, optionIndex) => ({
      ...item,
      optionIndex,
    }));
}

function pruneBudgetCombinationStates(states) {
  const uniqueStates = new Map();
  states.forEach((state) => {
    const uniqueKey = `${state.buyMask.toString(16)}:${state.totalWidth}`;
    const existing = uniqueStates.get(uniqueKey);
    if (!existing || compareByGainThenEfficiencyDesc(state.recommendation, existing.recommendation) < 0) {
      uniqueStates.set(uniqueKey, state);
    }
  });

  const dedupedStates = [...uniqueStates.values()];
  const selectedStates = new Map();
  const appendStates = (items, limit) => {
    items.slice(0, limit).forEach((item) => {
      if (!selectedStates.has(item.signature)) {
        selectedStates.set(item.signature, item);
      }
    });
  };

  appendStates(
    [...dedupedStates].sort((leftState, rightState) =>
      compareByGainThenEfficiencyDesc(leftState.recommendation, rightState.recommendation)),
    BUDGET_COMBINATION_STATE_LIMIT,
  );
  appendStates(
    [...dedupedStates].sort((leftState, rightState) =>
      compareRecommendationItems(leftState.recommendation, rightState.recommendation, "gainPerPrice")),
    BUDGET_COMBINATION_STATE_LIMIT,
  );
  appendStates(
    [...dedupedStates].sort((leftState, rightState) =>
      leftState.recommendation.price - rightState.recommendation.price ||
      compareByGainThenEfficiencyDesc(leftState.recommendation, rightState.recommendation)),
    Math.max(40, Math.floor(BUDGET_COMBINATION_STATE_LIMIT / 2)),
  );

  return [...selectedStates.values()]
    .sort((leftState, rightState) => compareByGainThenEfficiencyDesc(leftState.recommendation, rightState.recommendation))
    .slice(0, BUDGET_COMBINATION_STATE_LIMIT);
}

function buildBudgetCombinationItems({
  budget,
  singleItems,
  currentSystem,
  totalCurrentThs,
  replacementEnabled,
  replacementSetsByWidth,
  sortMode,
}) {
  if (budget !== null && (!Number.isFinite(budget) || budget <= 0)) {
    return [];
  }
  const hasBudgetLimit = Number.isFinite(budget) && budget > 0;

  const buyPool = selectBudgetCombinationBuyPool(singleItems, budget);
  const atomicOptions = buildBudgetCombinationOptions({
    budget,
    buyPool,
  });

  if (atomicOptions.length < 2) {
    return [];
  }

  const minOptionPrice = Math.min(...atomicOptions.map((item) => item.price));
  const maxDepth =
    hasBudgetLimit
      ? Math.max(2, Math.min(BUDGET_COMBINATION_UNLIMITED_MAX_DEPTH, Math.floor(budget / Math.max(minOptionPrice, 0.01))))
      : BUDGET_COMBINATION_UNLIMITED_MAX_DEPTH;
  const bundleResults = new Map();
  let frontier = [{
    price: 0,
    boughtPowerThs: 0,
    boughtBonusPercent: 0,
    buyMask: 0n,
    totalWidth: 0,
    purchaseMiners: [],
    lastOptionIndex: -1,
    atomicKeys: [],
  }];

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const nextStates = [];

    frontier.forEach((state) => {
      for (let optionIndex = state.lastOptionIndex + 1; optionIndex < atomicOptions.length; optionIndex += 1) {
        const option = atomicOptions[optionIndex];
        if ((state.buyMask & option.buyMask) !== 0n) continue;

        const totalPrice = state.price + option.price;
        if (hasBudgetLimit && totalPrice > budget + 1e-9) continue;
        const totalWidth = state.totalWidth + option.totalWidth;
        const replacementSet = replacementEnabled ? replacementSetsByWidth.get(totalWidth) : null;
        if (replacementEnabled && !replacementSet) continue;

        const atomicKeys = [...state.atomicKeys, option.atomicKey];
        const recommendation = buildRecommendationEntry({
          currentSystem,
          totalCurrentThs,
          purchaseMiners: [...state.purchaseMiners, ...option.purchaseMiners],
          replacementMiners: replacementSet?.miners || [],
          price: totalPrice,
          currency: option.currency || "RLT",
          boughtPowerThs: state.boughtPowerThs + option.boughtPowerThs,
          boughtBonusPercent: state.boughtBonusPercent + option.boughtBonusPercent,
          removedPowerThs: replacementSet?.removedPowerThs || 0,
          removedBonusPercent: replacementSet?.removedBonusPercent || 0,
          removedMask: replacementSet?.removedMask || 0n,
          buyMask: state.buyMask | option.buyMask,
          entryType: "bundle",
          sourceMinerId: "bundle",
          bundleKey: atomicKeys.join("|"),
        });

        const nextState = {
          price: totalPrice,
          boughtPowerThs: state.boughtPowerThs + option.boughtPowerThs,
          boughtBonusPercent: state.boughtBonusPercent + option.boughtBonusPercent,
          buyMask: state.buyMask | option.buyMask,
          totalWidth,
          purchaseMiners: [...state.purchaseMiners, ...option.purchaseMiners],
          lastOptionIndex: optionIndex,
          atomicKeys,
          signature: atomicKeys.join("|"),
          recommendation,
        };

        nextStates.push(nextState);
        if (depth > 1 && hasMeaningfulPositiveGain(recommendation.gainPower)) {
          const existing = bundleResults.get(nextState.signature);
          if (!existing || compareRecommendationItems(recommendation, existing, sortMode) < 0) {
            bundleResults.set(nextState.signature, recommendation);
          }
        }
      }
    });

    if (nextStates.length === 0) {
      break;
    }

    frontier = pruneBudgetCombinationStates(nextStates);
  }

  return sortRecommendationItems([...bundleResults.values()], sortMode).slice(0, BUDGET_COMBINATION_RESULT_LIMIT);
}

function getRecommendationTotalWidth(recommendation) {
  const purchaseMiners =
    Array.isArray(recommendation?.purchaseMiners) && recommendation.purchaseMiners.length > 0
      ? recommendation.purchaseMiners
      : recommendation
        ? [recommendation]
        : [];

  return purchaseMiners.reduce((totalWidth, miner) => {
    const width = Number(miner?.width);
    return Number.isFinite(width) && width > 0 ? totalWidth + Math.floor(width) : totalWidth;
  }, 0);
}

function buildHoverReplacementSetMap(currentSystem, maxWidth) {
  const normalizedMaxWidth = Math.max(0, Math.floor(Number(maxWidth) || 0));
  const replacementBuckets = new Map();
  replacementBuckets.set(0, [{
    width: 0,
    miners: [],
    removedPowerThs: 0,
    removedBonusPercent: 0,
    removedMask: 0n,
    label: "-",
  }]);

  const roomMinerMaskById = new Map(
    roomMinersCache.map((miner, index) => [String(miner?.id || `room-miner-${index + 1}`), 1n << BigInt(index)]),
  );
  const roomMinerEntries = roomMinersCache
    .map((miner, index) => {
      const width = Number.isFinite(Number(miner?.width)) ? Math.floor(Number(miner.width)) : null;
      if (!Number.isFinite(width) || width <= 0 || width > 2 || width > normalizedMaxWidth) return null;

      return {
        width,
        miner,
        removedPowerThs: toThs(miner.power, "Ph/s"),
        removedBonusPercent: Number(miner.bonusPercent) || 0,
        removedMask: roomMinerMaskById.get(String(miner?.id || `room-miner-${index + 1}`)) || 0n,
      };
    })
    .filter(Boolean);

  roomMinerEntries.forEach((roomEntry) => {
    for (let width = normalizedMaxWidth - roomEntry.width; width >= 0; width -= 1) {
      const sourceBucket = replacementBuckets.get(width) || [];
      if (sourceBucket.length === 0) continue;

      const nextWidth = width + roomEntry.width;
      const nextBucket = replacementBuckets.get(nextWidth) || [];
      sourceBucket.forEach((state) => {
        if ((state.removedMask & roomEntry.removedMask) !== 0n) return;

        nextBucket.push({
          width: nextWidth,
          miners: [...state.miners, roomEntry.miner],
          removedPowerThs: state.removedPowerThs + roomEntry.removedPowerThs,
          removedBonusPercent: state.removedBonusPercent + roomEntry.removedBonusPercent,
          removedMask: state.removedMask | roomEntry.removedMask,
          label: buildReplacementSetLabel([...state.miners, roomEntry.miner]),
        });
      });

      const uniqueBucket = new Map();
      nextBucket.forEach((state) => {
        const bucketKey = state.removedMask.toString(16);
        const existing = uniqueBucket.get(bucketKey);
        if (!existing || compareReplacementSetsByLoss(state, existing, currentSystem) < 0) {
          uniqueBucket.set(bucketKey, state);
        }
      });

      replacementBuckets.set(
        nextWidth,
        [...uniqueBucket.values()]
          .sort((leftSet, rightSet) => compareReplacementSetsByLoss(leftSet, rightSet, currentSystem))
          .slice(0, BUDGET_COMBINATION_REPLACEMENT_SET_LIMIT),
      );
    }
  });

  const bestSetsByWidth = new Map();
  replacementBuckets.forEach((bucket, width) => {
    if (!Number.isFinite(Number(width)) || Number(width) <= 0 || !Array.isArray(bucket) || bucket.length === 0) return;
    bestSetsByWidth.set(Number(width), bucket[0]);
  });

  return bestSetsByWidth;
}

function formatMarketHoverReplacementMiner(miner) {
  const levelText = miner?.level ? ` L${miner.level}` : "";
  const powerText = formatPowerFromPhs(miner?.power);
  const bonusText = `${formatMarketValue(Number(miner?.bonusPercent) || 0, 2)}%`;
  return `
    <li class="market-hover-tooltip-miner">
      <span class="market-hover-tooltip-name">${escapeHtml(miner?.name || "Unknown")}${escapeHtml(levelText)}</span>
      <span class="market-hover-tooltip-meta">${escapeHtml(powerText)} - ${escapeHtml(bonusText)}</span>
    </li>
  `;
}

function buildMarketHoverReplacementHtml(recommendation, currentSystem, hoverReplacementMap) {
  const purchaseMiners =
    Array.isArray(recommendation?.purchaseMiners) && recommendation.purchaseMiners.length > 0
      ? recommendation.purchaseMiners
      : recommendation
        ? [recommendation]
        : [];
  const targetWidth = getRecommendationTotalWidth(recommendation);
  const leadName = purchaseMiners[0]?.name || recommendation?.name || "market miner";
  const title =
    purchaseMiners.length > 1
      ? `Remove room miners for bundle (${purchaseMiners.length})`
      : `Remove room miners for ${leadName}`;

  if (!currentSystem) {
    return `
      <div class="market-hover-tooltip-title">${escapeHtml(title)}</div>
      <div class="market-hover-tooltip-empty">Current system is not available.</div>
    `;
  }

  if (roomMinersCache.length === 0) {
    return `
      <div class="market-hover-tooltip-title">${escapeHtml(title)}</div>
      <div class="market-hover-tooltip-empty">Load room miners to see replacement candidates.</div>
    `;
  }

  if (!Number.isFinite(targetWidth) || targetWidth <= 0) {
    return `
      <div class="market-hover-tooltip-title">${escapeHtml(title)}</div>
      <div class="market-hover-tooltip-empty">Width of the new miner is not detected.</div>
    `;
  }

  const replacementSet = hoverReplacementMap.get(targetWidth);
  if (!replacementSet || !Array.isArray(replacementSet.miners) || replacementSet.miners.length === 0) {
    return `
      <div class="market-hover-tooltip-title">${escapeHtml(title)}</div>
      <div class="market-hover-tooltip-empty">No suitable room miners with width 1 or 2 were found for ${escapeHtml(String(targetWidth))} slot(s).</div>
    `;
  }

  return `
    <div class="market-hover-tooltip-title">${escapeHtml(title)}</div>
    <div class="market-hover-tooltip-subtitle">Best exact fit among room miners with width 1 and 2: ${escapeHtml(String(targetWidth))} slot(s)</div>
    <ul class="market-hover-tooltip-list">
      ${replacementSet.miners.map((miner) => formatMarketHoverReplacementMiner(miner)).join("")}
    </ul>
  `;
}

function bindMarketHoverTooltips() {
  if (!marketResultsBody) return;

  marketResultsBody.querySelectorAll("tr[data-hover-tooltip-key]").forEach((row) => {
    if (!(row instanceof HTMLTableRowElement)) return;
    if (row.dataset.hoverTooltipBound === "1") return;
    row.dataset.hoverTooltipBound = "1";

    row.addEventListener("mouseenter", (event) => {
      const tooltipKey = row.dataset.hoverTooltipKey || "";
      showMarketHoverTooltip(marketHoverTooltipContent.get(tooltipKey) || "", event.clientX, event.clientY);
    });

    row.addEventListener("mousemove", (event) => {
      positionMarketHoverTooltip(event.clientX, event.clientY);
    });

    row.addEventListener("mouseleave", () => {
      hideMarketHoverTooltip();
    });
  });
}

function buildMarketRecommendations() {
  const budget = readOptionalInputNumber(marketBudgetInput);
  const maxMinerPrice = readOptionalInputNumber(marketMaxMinerPriceInput);
  const recommendationMode = getMarketRecommendationMode();
  const replacementRequested = getMarketReplacementEnabled();
  const replacementStrategy = getMarketReplacementStrategy();
  const sortMode = getMarketSortMode();
  const roomWidthMode = getRoomWidthMode();
  const topN = getTopNValue();
  const currentSystem = getCurrentSystemSnapshot(true);

  if (Number.isNaN(budget)) {
    throw new Error("Invalid budget value. Enter a non-negative number.");
  }
  if (Number.isNaN(maxMinerPrice)) {
    throw new Error("Invalid max price value. Enter a non-negative number.");
  }
  if (!currentSystem) {
    throw new Error("Current system is invalid. Sync RollerCoin power or enter valid base power and bonus.");
  }

  const replacementEnabled = replacementRequested && roomMinersCache.length > 0;
  const replacementPendingRoomLoad = replacementRequested && roomMinersCache.length === 0;

  const totalCurrentThs = getCurrentTotal(currentSystem.baseThs, currentSystem.bonusPercent);
  const ownedRoomMinerKeys = new Set(roomMinersCache.map((miner) => getRoomMinerOwnershipKey(miner)));
  const overlappingOwnedCount = marketMinersCache.filter((miner) =>
    ownedRoomMinerKeys.has(getRoomMinerOwnershipKey(miner))).length;
  const roomReplacementSets = replacementEnabled ? buildRoomReplacementSets(replacementStrategy) : [];
  const filteredMarketMiners = buildFilteredMarketMiners({
    budget,
    maxMinerPrice,
    roomWidthMode,
    roomMinersCacheSnapshot: roomMinersCache,
    ownedRoomMinerKeys,
  });
  const singleItems = buildSingleRecommendationItems({
    filteredMarketMiners,
    currentSystem,
    totalCurrentThs,
    replacementEnabled,
    roomReplacementSets,
    sortMode,
  });
  let filtered = singleItems;
  let bundleItems = [];

  if (recommendationMode === "budget") {
    const positivePrices = filteredMarketMiners
      .map((miner) => Number(miner?.price))
      .filter((price) => Number.isFinite(price) && price > 0);
    const minFilteredPrice = positivePrices.length > 0 ? Math.min(...positivePrices) : NaN;
    const maxBudgetDepth =
      budget === null
        ? BUDGET_COMBINATION_UNLIMITED_MAX_DEPTH
        : Number.isFinite(minFilteredPrice) && minFilteredPrice > 0
          ? Math.max(2, Math.min(BUDGET_COMBINATION_UNLIMITED_MAX_DEPTH, Math.floor(budget / Math.max(minFilteredPrice, 0.01))))
          : 2;
    const maxMarketWidth = Math.max(
      0,
      ...filteredMarketMiners.map((miner) =>
        (Number.isFinite(Number(miner?.width)) ? Math.floor(Number(miner.width)) : 0)),
    );
    const replacementSetsByWidth =
      replacementEnabled
        ? buildBudgetReplacementSetMap(currentSystem, Math.max(maxMarketWidth * maxBudgetDepth, maxMarketWidth))
        : new Map();
    const budgetSingleItems = buildBudgetModeSingleItems({
      filteredMarketMiners,
      currentSystem,
      totalCurrentThs,
      replacementEnabled,
      replacementSetsByWidth,
      sortMode,
    });
    bundleItems = buildBudgetCombinationItems({
      budget,
      singleItems: budgetSingleItems,
      currentSystem,
      totalCurrentThs,
      replacementEnabled,
      replacementSetsByWidth,
      sortMode,
    });
    filtered = sortRecommendationItems([...budgetSingleItems, ...bundleItems], sortMode);
  } else {
    filtered = sortRecommendationItems(singleItems, sortMode);
  }

  const upgradeItems = filtered.filter((miner) => hasMeaningfulPositiveGain(miner.gainPower));

  return {
    allItems: filtered,
    items: topN === null ? upgradeItems : upgradeItems.slice(0, topN),
    budget,
    currentSystem,
    overlappingOwnedCount,
    maxMinerPrice,
    roomMinersCount: roomMinersCache.length,
    roomWidthMode,
    replacementEnabled,
    replacementPendingRoomLoad,
    replacementRequested,
    replacementStrategy,
    recommendationMode,
    bundleCount: bundleItems.length,
    recommendedCount: upgradeItems.length,
    sortMode,
    topN,
    totalMatched: filtered.length,
    upgradeItems,
  };
}

function updateMarketRecommendationsView(statusMessage = "Recommendations updated.", tone = "success") {
  const recommendations = buildMarketRecommendations();
  renderMarketRecommendations(recommendations.items, recommendations);
  renderRoomReplacementSuggestions(recommendations.upgradeItems, recommendations);

  const budgetText =
    recommendations.budget === null
      ? recommendations.recommendationMode === "budget"
        ? "unlimited"
        : "not set"
      : formatMarketValue(recommendations.budget, 2);
  const maxPriceText =
    recommendations.maxMinerPrice === null ? "not set" : formatMarketValue(recommendations.maxMinerPrice, 2);
  const sourceText = marketSourceInfo ? marketSourceInfo.endpoint : "cached";
  const sourcePathText = marketSourceInfo ? marketSourceInfo.sourcePath : "memory-cache";
  const loadedAtText =
    marketSourceInfo && Number.isFinite(Number(marketSourceInfo.loadedAt))
      ? formatMarketDateTime(marketSourceInfo.loadedAt)
      : "unknown";
  const currentBaseText = formatPowerFromPhs(recommendations.currentSystem.basePhs);
  const currentBonusText = `${formatMarketValue(recommendations.currentSystem.bonusPercent, 2)}%`;
  const sortModeText = recommendations.sortMode === "gainPower" ? "gain to system" : "gain per RLT";
  const recommendationModeText =
    recommendations.recommendationMode === "budget" ? "budget combinations" : "single purchase";
  const roomWidthText =
    recommendations.roomWidthMode === "1"
      ? "small only"
      : recommendations.roomWidthMode === "2"
        ? "large only"
        : "any";
  const replacementText =
    recommendations.replacementEnabled
      ? recommendations.recommendationMode === "budget"
        ? "on (budget slots)"
        : recommendations.replacementStrategy === "flex"
          ? "on (flex)"
          : "on (strict)"
      : recommendations.replacementPendingRoomLoad
        ? "pending room miners"
        : "off";

  if (marketSummary) {
    marketSummary.textContent =
      `Matched: ${recommendations.totalMatched}; profitable upgrades: ${recommendations.recommendedCount}; budget: ${budgetText}; max price/miner: ${maxPriceText}; ` +
      `sort: ${sortModeText}; mode: ${recommendationModeText}; bundles: ${recommendations.bundleCount}; room miners: ${recommendations.roomMinersCount}; hidden owned: ${recommendations.overlappingOwnedCount}; width: ${roomWidthText}; replacement: ${replacementText}; ` +
      `current base: ${currentBaseText}; current bonus: ${currentBonusText}; ` +
      `source: ${sourceText}; path: ${sourcePathText}; updated: ${loadedAtText}.`;
  }

  setMarketStatus(statusMessage, tone);
  return recommendations;
}

function renderRoomReplacementSuggestions(recommendations = [], context = null) {
  if (!roomReplacementSuggestions) return;

  const items = Array.isArray(recommendations) ? recommendations : [];
  const actionableSuggestions = items
    .filter((miner) => hasMeaningfulPositiveGain(miner?.gainPower))
    .filter((miner) => typeof miner?.replaceText === "string")
    .filter((miner) => miner.replaceText && miner.replaceText !== "-")
    .filter((miner) => !/^No room miner found/i.test(miner.replaceText))
    .filter((miner) => !/^Width not detected/i.test(miner.replaceText));

  if (actionableSuggestions.length === 0) {
    roomReplacementSuggestions.textContent =
      "Replacement suggestions will appear here after finding market options.";
    return;
  }

  const buildSuggestionImage = (miner) => {
    const hasImage = typeof miner?.imageUrl === "string" && miner.imageUrl.length > 0;
    const hasLevelBadge = typeof miner?.levelBadgeUrl === "string" && miner.levelBadgeUrl.length > 0;
    const imageFallbacks = Array.isArray(miner?.imageCandidates)
      ? miner.imageCandidates.filter((candidate) => candidate && candidate !== miner.imageUrl)
      : [];
    const fallbackAttr =
      hasImage && imageFallbacks.length > 0
        ? ` data-fallbacks="${escapeHtml(encodeURIComponent(JSON.stringify(imageFallbacks)))}"`
        : "";

    if (hasImage) {
      return `<div class="market-miner-thumb-wrap suggestion-miner-visual">
        <img class="market-miner-thumb" src="${escapeHtml(miner.imageUrl)}" alt="${escapeHtml(miner.name || "Miner")}" loading="lazy"${fallbackAttr} />
        ${hasLevelBadge ? `<img class="market-miner-level-badge" src="${escapeHtml(miner.levelBadgeUrl)}" alt="Level ${escapeHtml(miner.level || "")}" loading="lazy" />` : ""}
      </div>`;
    }

    return `<div class="market-miner-thumb-wrap suggestion-miner-visual">
      <div class="market-miner-thumb placeholder">${escapeHtml(String(miner?.name || "M").slice(0, 1).toUpperCase())}</div>
      ${hasLevelBadge ? `<img class="market-miner-level-badge" src="${escapeHtml(miner.levelBadgeUrl)}" alt="Level ${escapeHtml(miner.level || "")}" loading="lazy" />` : ""}
    </div>`;
  };

  const formatMinerMeta = (miner, tone = "buy") => {
    const levelText = miner.level ? ` L${miner.level}` : "";
    const widthText = Number.isFinite(Number(miner.width)) ? ` [${Math.floor(Number(miner.width))}]` : "";
    const powerText = formatPowerFromPhs(miner.power);
    const bonusValue = Number(miner.bonusPercent);
    const bonusClass = bonusValue > 0 ? "positive" : bonusValue < 0 ? "negative" : "muted";
    const bonusText = `${formatMarketValue(miner.bonusPercent, 2)}% bonus`;
    return `
      <div class="suggestion-miner-card suggestion-miner-card-${escapeHtml(tone)}">
        ${buildSuggestionImage(miner)}
        <div class="suggestion-miner-copy">
          <div class="suggestion-miner-name">${escapeHtml(miner.name)}${escapeHtml(levelText)}${escapeHtml(widthText)}</div>
          <div class="suggestion-miner-meta">
            <span class="positive">${escapeHtml(powerText)}</span>
            <span class="${bonusClass}">${escapeHtml(bonusText)}</span>
          </div>
        </div>
      </div>
    `;
  };

  const formatSuggestion = (miner, index) => {
    const priceText = `${formatMarketValue(miner.price, 2)} ${miner.currency || "RLT"}`;
    const gainText = `+${formatPowerFromPhs(miner.gainPower)}`;
    const buyMiners =
      Array.isArray(miner.purchaseMiners) && miner.purchaseMiners.length > 0
        ? miner.purchaseMiners
        : [miner];
    const buyText =
      buyMiners.length > 0
        ? `<div class="suggestion-buy-list">${buyMiners.map((purchaseMiner) => formatMinerMeta(purchaseMiner, "buy")).join("")}</div>`
        : escapeHtml(miner.name || "Marketplace miner");
    const removeText =
      Array.isArray(miner.replacementMiners) && miner.replacementMiners.length > 0
        ? `<div class="suggestion-remove-list">${miner.replacementMiners.map((replacementMiner) => formatMinerMeta(replacementMiner, "remove")).join("")}</div>`
        : escapeHtml(miner.replaceText);
    return `
      <li class="suggestion-item">
        <div class="suggestion-line">
          <span class="suggestion-rank">${index + 1}.</span>
          <div class="suggestion-block">
            <span class="suggestion-label">Buy</span>
            <div class="suggestion-value">${buyText}</div>
            <span class="suggestion-label suggestion-label-remove">Remove</span>
            <div class="suggestion-value">${removeText}</div>
          </div>
        </div>
        <div class="suggestion-metrics">
          <span class="positive">${escapeHtml(gainText)}</span>
          <span class="muted">price ${escapeHtml(priceText)}</span>
        </div>
      </li>
    `;
  };

  const economySuggestions = [...actionableSuggestions]
    .sort((leftMiner, rightMiner) => {
      if (rightMiner.gainPerPrice !== leftMiner.gainPerPrice) {
        return rightMiner.gainPerPrice - leftMiner.gainPerPrice;
      }
      if (rightMiner.gainPower !== leftMiner.gainPower) {
        return rightMiner.gainPower - leftMiner.gainPower;
      }
      return leftMiner.price - rightMiner.price;
    })
    .slice(0, 5)
    .map(formatSuggestion);

  const powerSuggestions = [...actionableSuggestions]
    .sort((leftMiner, rightMiner) => {
      if (rightMiner.gainPower !== leftMiner.gainPower) {
        return rightMiner.gainPower - leftMiner.gainPower;
      }
      if (rightMiner.gainPerPrice !== leftMiner.gainPerPrice) {
        return rightMiner.gainPerPrice - leftMiner.gainPerPrice;
      }
      return leftMiner.price - rightMiner.price;
    })
    .slice(0, 5)
    .map(formatSuggestion);

  const budgetLabel =
    context && Number.isFinite(context.budget)
      ? `Budget: ${formatMarketValue(context.budget, 2)} RLT`
      : "Budget: not set";

  roomReplacementSuggestions.innerHTML = `
    <div class="suggestion-group">
      <div class="suggestion-title">Cheaper upgrades <span class="muted">(${escapeHtml(budgetLabel)})</span></div>
      <ol class="suggestion-list">
        ${economySuggestions.length > 0 ? economySuggestions.join("") : '<li class="muted">No upgrade suggestions.</li>'}
      </ol>
    </div>
    <div class="suggestion-group">
      <div class="suggestion-title">Maximum power within budget <span class="muted">(${escapeHtml(budgetLabel)})</span></div>
      <ol class="suggestion-list">
        ${powerSuggestions.length > 0 ? powerSuggestions.join("") : '<li class="muted">No power suggestions.</li>'}
      </ol>
    </div>
  `;
  bindMarketImageFallbacks();
}

function renderMarketRecommendations(recommendations, options = {}) {
  if (!marketResultsBody) return;
  const renderOptions = { ...lastRenderedMarketRecommendationsOptions, ...(options || {}) };
  const resetPagination = renderOptions.resetPagination !== false;
  hideMarketHoverTooltip();
  marketHoverTooltipContent = new Map();

  if (resetPagination) {
    visibleMarketResultsCount = TABLE_RENDER_BATCH_SIZE;
  }

  lastRenderedMarketRecommendations = Array.isArray(recommendations) ? [...recommendations] : [];
  lastRenderedMarketRecommendationsOptions = renderOptions;

  if (recommendations.length === 0) {
    const emptyMessage =
      Number.isFinite(renderOptions.totalMatched) && renderOptions.totalMatched > 0
        ? "No profitable market upgrades match the current filters."
        : "No market miners match the current filters.";
    marketResultsBody.innerHTML = `
      <tr>
        <td colspan="8" class="muted">${emptyMessage}</td>
      </tr>
    `;
    renderRoomReplacementSuggestions([]);
    updateVisibleRowsControls({
      button: showMoreMarketResultsBtn,
      countInfo: marketResultsCountInfo,
      visibleCount: 0,
      totalCount: 0,
      itemLabel: "market results",
    });
    return;
  }

  const visibleRecommendations = recommendations.slice(0, visibleMarketResultsCount);
  const currentSystem = renderOptions && typeof renderOptions.currentSystem === "object" ? renderOptions.currentSystem : null;
  const maxHoverWidth = visibleRecommendations.reduce(
    (maxWidth, recommendation) => Math.max(maxWidth, getRecommendationTotalWidth(recommendation)),
    0,
  );
  const hoverReplacementMap =
    currentSystem && maxHoverWidth > 0 ? buildHoverReplacementSetMap(currentSystem, maxHoverWidth) : new Map();

  marketResultsBody.innerHTML = visibleRecommendations
    .map((miner, index) => {
      const actualIndex = index + 1;
      const tooltipKey = `market-hover-${actualIndex}-${String(miner.bundleKey || miner.offerKey || index)}`;
      marketHoverTooltipContent.set(
        tooltipKey,
        buildMarketHoverReplacementHtml(miner, currentSystem, hoverReplacementMap),
      );
      const purchaseMiners =
        Array.isArray(miner.purchaseMiners) && miner.purchaseMiners.length > 0
          ? miner.purchaseMiners
          : [miner];
      const leadMiner = purchaseMiners[0] || miner;
      const currency = escapeHtml(miner.currency || "RLT");
      const hasImage = typeof leadMiner.imageUrl === "string" && leadMiner.imageUrl.length > 0;
      const hasLevelBadge = typeof leadMiner.levelBadgeUrl === "string" && leadMiner.levelBadgeUrl.length > 0;
      const imageFallbacks = Array.isArray(leadMiner.imageCandidates)
        ? leadMiner.imageCandidates.filter((candidate) => candidate && candidate !== leadMiner.imageUrl)
        : [];
      const fallbackAttr =
        hasImage && imageFallbacks.length > 0
          ? ` data-fallbacks="${escapeHtml(encodeURIComponent(JSON.stringify(imageFallbacks)))}"`
          : "";
      const titleText =
        purchaseMiners.length === 1
          ? leadMiner.name
          : `Bundle (${purchaseMiners.length}): ${purchaseMiners.map((purchaseMiner) => purchaseMiner.name).join(" + ")}`;
      const subtitleText =
        purchaseMiners.length === 1
          ? `${formatMarketValue(miner.bonusPercent, 2)}% bonus`
          : `Buy ${purchaseMiners.length} miners, widths ${escapeHtml(miner.widthDisplay || "-")}`;
      const widthText = escapeHtml(miner.widthDisplay || miner.width || "-");
      const imagePart = hasImage
        ? `<div class="market-miner-thumb-wrap">
             <img class="market-miner-thumb" src="${escapeHtml(leadMiner.imageUrl)}" alt="${escapeHtml(titleText)}" loading="lazy"${fallbackAttr} />
             ${hasLevelBadge ? `<img class="market-miner-level-badge" src="${escapeHtml(leadMiner.levelBadgeUrl)}" alt="Level ${escapeHtml(leadMiner.level || "")}" loading="lazy" />` : ""}
           </div>`
        : `<div class="market-miner-thumb-wrap">
             <div class="market-miner-thumb placeholder">${escapeHtml((titleText || "M").slice(0, 1).toUpperCase())}</div>
             ${hasLevelBadge ? `<img class="market-miner-level-badge" src="${escapeHtml(leadMiner.levelBadgeUrl)}" alt="Level ${escapeHtml(leadMiner.level || "")}" loading="lazy" />` : ""}
           </div>`;
      return `
        <tr data-hover-tooltip-key="${escapeHtml(tooltipKey)}">
          <td>${actualIndex}</td>
          <td>
            <div class="market-miner-cell">
              ${imagePart}
              <div class="market-miner-copy">
                <span>${escapeHtml(titleText)}</span>
                <span class="market-miner-subcopy">${subtitleText}</span>
              </div>
            </div>
          </td>
          <td>${formatMarketValue(miner.price, 2)} ${currency}</td>
          <td>${formatPowerFromPhs(miner.power)}</td>
          <td>${formatMarketValue(miner.bonusPercent, 2)}%</td>
          <td>${widthText}</td>
          <td>${formatPowerFromPhs(miner.gainPower)}</td>
          <td>${formatPowerFromPhs(miner.gainPerPrice)}</td>
        </tr>
      `;
    })
    .join("");

  updateVisibleRowsControls({
    button: showMoreMarketResultsBtn,
    countInfo: marketResultsCountInfo,
    visibleCount: visibleRecommendations.length,
    totalCount: recommendations.length,
    itemLabel: "market results",
  });
  bindMarketImageFallbacks();
  bindMarketHoverTooltips();
}

function bindMarketImageFallbacks() {
  [marketResultsBody, roomMinersBody, roomReplacementSuggestions].filter(Boolean).forEach((container) => {
    container.querySelectorAll("img.market-miner-thumb[data-fallbacks]").forEach((image) => {
    if (!(image instanceof HTMLImageElement)) return;
    if (image.dataset.fallbackBound === "1") return;
    image.dataset.fallbackBound = "1";

    image.addEventListener("error", () => {
      const encoded = image.dataset.fallbacks || "";
      if (!encoded) {
        image.dataset.fallbackBound = "done";
        return;
      }

      let fallbacks = [];
      try {
        const parsed = JSON.parse(decodeURIComponent(encoded));
        if (Array.isArray(parsed)) {
          fallbacks = parsed.filter((entry) => typeof entry === "string" && entry.trim());
        }
      } catch {
        fallbacks = [];
      }

      const nextUrl = fallbacks.shift();
      if (!nextUrl) {
        image.removeAttribute("data-fallbacks");
        image.dataset.fallbackBound = "done";
        return;
      }

      image.dataset.fallbacks = encodeURIComponent(JSON.stringify(fallbacks));
      image.src = nextUrl;
    });
  });
  });
}

function setMarketControlsDisabled(isDisabled) {
  [rollercoinLoginBtn, loadRoomMinersBtn, loadMarketMinersBtn, findBestMarketBtn].forEach((button) => {
    if (button) button.disabled = isDisabled;
  });
}

async function handleCheckAppUpdates() {
  if (appUpdateCheckInFlight) return;

  if (!ipcRenderer || typeof ipcRenderer.invoke !== "function") {
    setMarketStatus("App update check is unavailable in this build.", "error");
    return;
  }

  appUpdateCheckInFlight = true;
  const originalLabel = checkAppUpdatesBtn ? checkAppUpdatesBtn.textContent : "";
  if (checkAppUpdatesBtn) {
    checkAppUpdatesBtn.disabled = true;
    checkAppUpdatesBtn.textContent = "Checking...";
  }
  setMarketStatus("Checking for app updates...", "neutral");

  try {
    const result = await ipcRenderer.invoke("app-updates-check");
    const status = typeof result?.status === "string" ? result.status : "unknown";
    const message =
      typeof result?.message === "string" && result.message.trim()
        ? result.message
        : "App update check finished.";
    const tone = status === "error" ? "error" : status === "update-available" ? "success" : "neutral";

    appendMarketLog(`App update check: ${message}`, tone === "error" ? "error" : "info");
    setMarketStatus(message, tone);
  } catch (error) {
    const message = `App update check failed: ${error.message}`;
    appendMarketLog(message, "error");
    setMarketStatus(message, "error");
  } finally {
    appUpdateCheckInFlight = false;
    if (checkAppUpdatesBtn) {
      checkAppUpdatesBtn.disabled = false;
      checkAppUpdatesBtn.textContent = originalLabel || "Check for app updates";
    }
  }
}

async function handleLoadRoomMiners() {
  const result = await loadRoomMinersFromRollercoin({ silent: false });
  if (!result || marketMinersCache.length === 0) return;

  try {
    updateMarketRecommendationsView("Recommendations updated using room miners.", "success");
  } catch (error) {
    setMarketStatus(`Filter error: ${error.message}`, "error");
  }
}

async function handleRollercoinLogin() {
  if (!rollercoinCookieInput) return;

  if (!ipcRenderer || typeof ipcRenderer.invoke !== "function") {
    setMarketStatus("IPC is unavailable. Paste your RollerCoin cookie manually.", "error");
    return;
  }

  setMarketControlsDisabled(true);
  setMarketStatus("Opening RollerCoin login window. Close it after successful login.", "neutral");

  try {
    const loginResult = await ipcRenderer.invoke("rollercoin-auth-login");
    if (!loginResult || typeof loginResult.cookieHeader !== "string") {
      throw new Error("Failed to read cookies from login window.");
    }

    rollercoinCookieInput.value = loginResult.cookieHeader;
    saveMarketSettings();

    if (loginResult.cookieHeader.trim()) {
      setMarketStatus(
        `Session captured (${loginResult.cookieCount} cookies). You can now load market miners.`,
        "success",
      );
      await Promise.allSettled([
        checkRollercoinAuthStatus({ silent: true }),
        refreshCurrentPowerFromRollercoin({ silent: true, allowUnauthenticated: true }),
        loadRoomMinersFromRollercoin({ silent: true, allowUnauthenticated: true }),
      ]);
    } else {
      setAuthIndicatorState("invalid", "No RollerCoin session detected. Login again and close the auth window.");
      setMarketStatus("No cookies found. Login again and close the auth window.", "error");
    }
  } catch (error) {
    setAuthIndicatorState("invalid", `Login failed: ${error.message}`);
    setMarketStatus(`Login error: ${error.message}`, "error");
  } finally {
    setMarketControlsDisabled(false);
  }
}

async function handleLoadMarketMiners() {
  if (!rollercoinCookieInput) return;

  const previousMinersCache = Array.isArray(marketMinersCache) ? [...marketMinersCache] : [];
  const previousSourceInfo = marketSourceInfo ? { ...marketSourceInfo } : null;
  const cookieHeader = rollercoinCookieInput.value.trim();
  const requestId = `market-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  activeMarketRequestId = requestId;
  saveMarketSettings();
  clearMarketLogs();
  appendMarketLog("Load miners requested by user.", "info");
  appendMarketLog(`Request ID: ${requestId}`, "info");
  lastRenderedMarketRecommendations = [];
  updateVisibleRowsControls({
    button: showMoreMarketResultsBtn,
    countInfo: marketResultsCountInfo,
    visibleCount: 0,
    totalCount: 0,
    itemLabel: "market results",
  });
  if (marketResultsBody) {
    marketResultsBody.innerHTML = `
      <tr>
        <td colspan="8" class="muted">Loading miners from market...</td>
      </tr>
    `;
  }
  if (marketSummary) {
    marketSummary.textContent = "";
  }
  if (!cookieHeader) {
    appendMarketLog("Cookie field is empty. Session fetch will rely on in-app auth partition.", "warn");
  }
  setMarketControlsDisabled(true);
  setMarketStatus(
    "Loading miners from market API. Direct mode runs first, browser mode is the fallback...",
    "neutral",
  );
  startMarketHeartbeat();

  try {
    const loadResult = await fetchMarketMiners(cookieHeader, requestId);
    marketMinersCache = loadResult.miners;
    marketSourceInfo = normalizeMarketSourceInfo(loadResult, marketMinersCache.length);
    saveMarketMinersCache();
    appendMarketLog(
      `Loaded ${marketMinersCache.length} miners from ${loadResult.endpoint}. Source path: ${loadResult.sourcePath}.`,
      "success",
    );
    try {
      updateMarketRecommendationsView(
        `Loaded ${marketMinersCache.length} miners (${loadResult.endpoint}).`,
        "success",
      );
    } catch (error) {
      renderMarketRecommendations([]);
      if (marketSummary) {
        marketSummary.textContent = "";
      }
      appendMarketLog(`Loaded miners, but filters are invalid: ${error.message}`, "warn");
      setMarketStatus(
        `Loaded ${marketMinersCache.length} miners, but filters are invalid: ${error.message}`,
        "error",
      );
    }
  } catch (error) {
    appendMarketLog(`Load miners failed: ${error.message}`, "error");

    if (previousMinersCache.length > 0) {
      marketMinersCache = previousMinersCache;
      marketSourceInfo = previousSourceInfo;
      appendMarketLog(
        `Showing previously cached miners (${previousMinersCache.length}) after refresh failure.`,
        "warn",
      );
      try {
        updateMarketRecommendationsView(
          `Refresh failed: ${error.message}. Showing cached miners.`,
          "error",
        );
      } catch (filterError) {
        renderMarketRecommendations([]);
        if (marketSummary) {
          marketSummary.textContent = "";
        }
        setMarketStatus(
          `Refresh failed: ${error.message}. Cached miners are available, but filters are invalid: ${filterError.message}`,
          "error",
        );
      }
    } else {
      marketMinersCache = [];
      marketSourceInfo = null;
      renderMarketRecommendations([]);
      if (marketSummary) {
        marketSummary.textContent = "";
      }
      setMarketStatus(`Failed to load market miners: ${error.message}`, "error");
    }
  } finally {
    stopMarketHeartbeat();
    activeMarketRequestId = null;
    setMarketControlsDisabled(false);
  }
}

function handleFindBestMarketOptions() {
  if (marketMinersCache.length === 0) {
    setMarketStatus("Load market miners first.", "error");
    return;
  }

  try {
    updateMarketRecommendationsView("Recommendations updated.", "success");
  } catch (error) {
    setMarketStatus(`Filter error: ${error.message}`, "error");
  }
}

function buildCandidateRow() {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td class="candidate-index"></td>
    <td><input type="number" min="0" step="0.001" class="cand-power" /></td>
    <td>
      <select class="cand-unit">
        <option>Gh/s</option>
        <option>Th/s</option>
        <option selected>Ph/s</option>
        <option>Eh/s</option>
        <option>Zh/s</option>
      </select>
    </td>
    <td><input type="number" min="0" step="0.01" class="cand-bonus" /></td>
    <td><input type="number" min="0" step="0.01" class="cand-price" /></td>
    <td><button type="button" class="remove-btn">Delete</button></td>
  `;

  row.querySelector(".remove-btn").addEventListener("click", () => {
    row.remove();
    reindexRows();
  });

  return row;
}

function reindexRows() {
  const rows = candidatesBody.querySelectorAll("tr");
  rows.forEach((row, idx) => {
    row.dataset.index = String(idx + 1);
    row.querySelector(".candidate-index").textContent = String(idx + 1);
  });
  if (candidateCountStat) {
    candidateCountStat.textContent = String(rows.length);
  }
}

function addCandidate() {
  const row = buildCandidateRow();
  candidatesBody.appendChild(row);
  reindexRows();
}

function getCurrentTotal(baseThs, bonusPercent) {
  return baseThs * (1 + bonusPercent / 100);
}

function hasMeaningfulPositiveGain(gainPowerPhs) {
  if (!Number.isFinite(gainPowerPhs)) return false;
  return gainPowerPhs > (MIN_RECOMMENDATION_GAIN_THS / POWER_MULTIPLIER["Ph/s"]);
}

function updateCurrentStats() {
  const currentBasePowerValue = readNonNegativeNumber("currentBasePowerValue", false);
  const currentBasePowerUnit = document.getElementById("currentBasePowerUnit").value;
  const currentBonusPercent = readNonNegativeNumber("currentBonusPercent", false);

  if (currentBasePowerValue === null || currentBonusPercent === null) {
    currentTotalPowerStat.textContent = "-";
    currentBonusPowerStat.textContent = "-";
    return;
  }

  const currentBaseThs = toThs(currentBasePowerValue, currentBasePowerUnit);
  if (!Number.isFinite(currentBaseThs) || !Number.isFinite(currentBonusPercent) || currentBonusPercent < 0) {
    currentTotalPowerStat.textContent = "-";
    currentBonusPowerStat.textContent = "-";
    return;
  }

  const bonusPower = currentBaseThs * (currentBonusPercent / 100);
  const totalPower = currentBaseThs + bonusPower;
  currentTotalPowerStat.textContent = formatPowerFromThs(totalPower);
  currentBonusPowerStat.textContent = formatPowerFromThs(bonusPower);
}

function readCandidateRows() {
  const rows = [...candidatesBody.querySelectorAll("tr")];
  return rows
    .map((row, idx) => {
      const powerRaw = row.querySelector(".cand-power").value.trim();
      const unit = row.querySelector(".cand-unit").value;
      const bonusRaw = row.querySelector(".cand-bonus").value.trim();
      const priceRaw = row.querySelector(".cand-price").value.trim();

      const isEmptyRow = powerRaw === "" && bonusRaw === "" && priceRaw === "";
      if (isEmptyRow) return null;

      const power = powerRaw === "" ? NaN : Number(powerRaw);
      const bonusPercent = bonusRaw === "" ? NaN : Number(bonusRaw);
      const price = priceRaw === "" ? null : Number(priceRaw);

      return {
        index: idx + 1,
        powerThs: toThs(power, unit),
        unit,
        powerValue: power,
        bonusPercent,
        price,
      };
    })
    .filter(Boolean);
}

function validateInput(currentBaseThs, currentBonusPercent, oldMiner, candidates) {
  if (!Number.isFinite(currentBaseThs) || currentBaseThs < 0) {
    return "Current base power is invalid.";
  }
  if (!Number.isFinite(currentBonusPercent) || currentBonusPercent < 0) {
    return "Current total bonus is invalid.";
  }

  if ((oldMiner.powerThs === null) !== (oldMiner.bonusPercent === null)) {
    return "For replacement miner set both power and bonus, or keep both fields empty.";
  }

  if (oldMiner.powerThs !== null) {
    if (!Number.isFinite(oldMiner.powerThs) || oldMiner.powerThs < 0) {
      return "Old miner power is invalid.";
    }
    if (!Number.isFinite(oldMiner.bonusPercent) || oldMiner.bonusPercent < 0) {
      return "Old miner bonus is invalid.";
    }
  }

  if (candidates.length === 0) {
    return "Add at least one candidate.";
  }

  for (const cand of candidates) {
    if (!Number.isFinite(cand.powerThs) || cand.powerThs < 0) {
      return `Candidate #${cand.index}: invalid power.`;
    }
    if (!Number.isFinite(cand.bonusPercent) || cand.bonusPercent < 0) {
      return `Candidate #${cand.index}: invalid bonus.`;
    }
    if (cand.price !== null && (!Number.isFinite(cand.price) || cand.price < 0)) {
      return `Candidate #${cand.index}: invalid price.`;
    }
  }

  return null;
}

function calculate() {
  const currentBasePowerValue = readNonNegativeNumber("currentBasePowerValue");
  const currentBasePowerUnit = document.getElementById("currentBasePowerUnit").value;
  const currentBonusPercent = readNonNegativeNumber("currentBonusPercent");
  const currentBaseThs = toThs(currentBasePowerValue, currentBasePowerUnit);

  const oldPowerValue = readNonNegativeNumber("oldMinerPowerValue", false);
  const oldPowerUnit = document.getElementById("oldMinerPowerUnit").value;
  const oldBonusPercent = readNonNegativeNumber("oldMinerBonusPercent", false);
  const oldMiner = {
    powerThs: oldPowerValue === null ? null : toThs(oldPowerValue, oldPowerUnit),
    bonusPercent: oldBonusPercent,
  };

  const candidates = readCandidateRows();
  const validationError = validateInput(currentBaseThs, currentBonusPercent, oldMiner, candidates);
  if (validationError) {
    highlightBestRow(null);
    resultContent.innerHTML = `<p class="error">${validationError}</p>`;
    return;
  }

  const totalCurrent = getCurrentTotal(currentBaseThs, currentBonusPercent);
  const hasPriceForAll = candidates.every((candidate) => candidate.price !== null && candidate.price > 0);

  const scored = candidates.map((cand) => {
    let baseNew = currentBaseThs + cand.powerThs;
    let bonusNew = currentBonusPercent + cand.bonusPercent;

    if (oldMiner.powerThs !== null) {
      baseNew -= oldMiner.powerThs;
      bonusNew -= oldMiner.bonusPercent;
    }

    const totalNew = getCurrentTotal(baseNew, bonusNew);
    const delta = totalNew - totalCurrent;
    const deltaPerDollar = cand.price && cand.price > 0 ? delta / cand.price : null;

    return {
      ...cand,
      baseNew,
      bonusNew,
      totalNew,
      delta,
      deltaPerDollar,
    };
  });

  scored.sort((a, b) => {
    if (hasPriceForAll) return b.deltaPerDollar - a.deltaPerDollar;
    return b.delta - a.delta;
  });

  const best = scored[0];
  highlightBestRow(best.index);

  const metricLabel = hasPriceForAll ? "By gain per $1" : "By absolute gain";
  const deltaPerDollarText =
    best.deltaPerDollar === null
      ? "not calculated"
      : `${formatPowerFromThs(best.deltaPerDollar)} / $1`;

  const rowsHtml = scored
    .map((cand) => {
      const deltaClass = cand.delta >= 0 ? "positive" : "negative";
      const perDollarText =
        cand.deltaPerDollar === null ? "-" : `${formatSignedPower(cand.deltaPerDollar)} / $1`;
      return `
        <tr>
          <td>#${cand.index}${cand.index === best.index ? " (best)" : ""}</td>
          <td class="${deltaClass}">${formatSignedPower(cand.delta)}</td>
          <td class="${deltaClass}">${perDollarText}</td>
        </tr>
      `;
    })
    .join("");

  resultContent.innerHTML = `
    <p class="best">Best candidate: #${best.index}</p>
    <div class="result-grid">
      <div class="muted">Selection metric</div>
      <div>${metricLabel}</div>

      <div class="muted">New base power</div>
      <div>${formatPowerFromThs(best.baseNew)}</div>

      <div class="muted">New total bonus</div>
      <div>${best.bonusNew.toLocaleString("en-US", { maximumFractionDigits: 4 })}%</div>

      <div class="muted">New total power</div>
      <div>${formatPowerFromThs(best.totalNew)}</div>

      <div class="muted">Total power gain</div>
      <div>${formatPowerFromThs(best.delta)}</div>

      <div class="muted">Gain per dollar</div>
      <div>${deltaPerDollarText}</div>
    </div>
    <table class="candidates-result-table">
      <thead>
        <tr>
          <th>Miner</th>
          <th>Total power gain</th>
          <th>Gain per $</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;
}

function highlightBestRow(bestIndex) {
  const rows = candidatesBody.querySelectorAll("tr");
  rows.forEach((row) => {
    const isBest = bestIndex !== null && row.dataset.index === String(bestIndex);
    row.classList.toggle("best-row", isBest);
  });
}

function recalculateLive() {
  updateCurrentStats();
  calculate();
}

function refreshPowerUnitViews() {
  updatePowerUnitLabels();
  renderCurrentSystemHistory();
  recalculateLive();
  renderRoomMinersCollection(roomMinersCache, { resetPagination: false });

  if (marketMinersCache.length === 0) {
    if (lastRenderedMarketRecommendations.length > 0) {
      renderMarketRecommendations(lastRenderedMarketRecommendations, { resetPagination: false });
    }
    return;
  }

  try {
    updateMarketRecommendationsView("Display unit updated.", "success");
  } catch (error) {
    setMarketStatus(`Filter error: ${error.message}`, "error");
  }
}

async function initializeRollercoinSessionState() {
  setAuthIndicatorState("invalid", "No saved RollerCoin session. Login is required.");
  setMarketStatus("Login to RollerCoin to load fresh data.", "neutral");
  setCurrentSystemSyncStatus("RollerCoin power sync is available after login.", "neutral");
  setRoomMinersStatus("Room miners are not loaded. Login to RollerCoin first.", "neutral");

  if (!ipcRenderer || typeof ipcRenderer.invoke !== "function") {
    return;
  }

  try {
    const sessionInfo = await ipcRenderer.invoke("rollercoin-auth-session");
    const cookieHeader =
      sessionInfo && typeof sessionInfo.cookieHeader === "string"
        ? sessionInfo.cookieHeader.trim()
        : "";

    if (!cookieHeader) {
      return;
    }

    if (rollercoinCookieInput) {
      rollercoinCookieInput.value = cookieHeader;
    }

    setAuthIndicatorState("checking", "Saved RollerCoin session found. Verifying...");
    await checkRollercoinAuthStatus({ silent: true });
    if (authStatusState === "valid") {
      setMarketStatus("Saved RollerCoin session restored.", "success");
    }
  } catch (error) {
    setAuthIndicatorState("invalid", `Saved session check failed: ${error.message}`);
  }
}

addCandidateBtn.addEventListener("click", () => {
  addCandidate();
  recalculateLive();
});

calculateBtn.addEventListener("click", recalculateLive);

if (rollercoinLoginBtn) {
  rollercoinLoginBtn.addEventListener("click", handleRollercoinLogin);
}
if (checkAppUpdatesBtn) {
  checkAppUpdatesBtn.addEventListener("click", handleCheckAppUpdates);
}
if (loadMarketMinersBtn) {
  loadMarketMinersBtn.addEventListener("click", handleLoadMarketMiners);
}
if (findBestMarketBtn) {
  findBestMarketBtn.addEventListener("click", handleFindBestMarketOptions);
}
if (loadRoomMinersBtn) {
  loadRoomMinersBtn.addEventListener("click", handleLoadRoomMiners);
}
if (refreshCurrentPowerBtn) {
  refreshCurrentPowerBtn.addEventListener("click", () =>
    refreshCurrentPowerFromRollercoin({ silent: false, allowUnauthenticated: false }));
}
if (marketSortModeInput) {
  marketSortModeInput.addEventListener("change", () => {
    saveMarketSettings();
    if (marketMinersCache.length === 0) return;
    try {
      updateMarketRecommendationsView("Market sorting updated.", "success");
    } catch (error) {
      setMarketStatus(`Filter error: ${error.message}`, "error");
    }
  });
}
if (displayPowerUnitInput) {
  displayPowerUnitInput.addEventListener("change", () => {
    saveCurrentSystem({ recordHistory: false });
    refreshPowerUnitViews();
  });
}
if (roomMinersSortModeInput) {
  roomMinersSortModeInput.addEventListener("change", () => {
    saveMarketSettings();
    renderRoomMinersCollection(roomMinersCache);
  });
}
if (roomMinersSearchInput) {
  roomMinersSearchInput.addEventListener("input", () => {
    saveMarketSettings();
    renderRoomMinersCollection(roomMinersCache);
  });
}
if (marketRoomWidthModeInput) {
  marketRoomWidthModeInput.addEventListener("change", () => {
    saveMarketSettings();
    if (marketMinersCache.length === 0) return;
    try {
      updateMarketRecommendationsView("Market width filter updated.", "success");
    } catch (error) {
      setMarketStatus(`Filter error: ${error.message}`, "error");
    }
  });
}
if (marketRecommendationModeInput) {
  marketRecommendationModeInput.addEventListener("change", () => {
    saveMarketSettings();
    if (marketMinersCache.length === 0) return;
    try {
      updateMarketRecommendationsView("Recommendation mode updated.", "success");
    } catch (error) {
      setMarketStatus(`Filter error: ${error.message}`, "error");
    }
  });
}
if (marketReplacementStrategyInput) {
  marketReplacementStrategyInput.addEventListener("change", () => {
    saveMarketSettings();
    if (marketMinersCache.length === 0) return;
    try {
      updateMarketRecommendationsView("Replacement behavior updated.", "success");
    } catch (error) {
      setMarketStatus(`Filter error: ${error.message}`, "error");
    }
  });
}
if (clearMarketLogsBtn) {
  clearMarketLogsBtn.addEventListener("click", clearMarketLogs);
}
if (showMoreRoomMinersBtn) {
  showMoreRoomMinersBtn.addEventListener("click", () => {
    visibleRoomMinersCount += TABLE_RENDER_BATCH_SIZE;
    renderRoomMinersCollection(lastRenderedRoomMiners, { resetPagination: false });
  });
}
if (showMoreMarketResultsBtn) {
  showMoreMarketResultsBtn.addEventListener("click", () => {
    visibleMarketResultsCount += TABLE_RENDER_BATCH_SIZE;
    renderMarketRecommendations(lastRenderedMarketRecommendations, { resetPagination: false });
  });
}
if (authActionBtn) {
  authActionBtn.addEventListener("click", handleAuthAction);
}
if (clearPowerHistoryBtn) {
  clearPowerHistoryBtn.addEventListener("click", clearCurrentSystemHistory);
}
if (togglePowerHistoryBtn) {
  togglePowerHistoryBtn.addEventListener("click", () => {
    isPowerHistoryExpanded = !isPowerHistoryExpanded;
    renderCurrentSystemHistory();
  });
}

candidatesBody.addEventListener("input", recalculateLive);
candidatesBody.addEventListener("change", recalculateLive);

document.addEventListener("input", (event) => {
  if (!(event.target instanceof HTMLElement)) return;

  if (CURRENT_SYSTEM_FIELD_ID_SET.has(event.target.id)) {
    saveCurrentSystem({ recordHistory: false });
  }
  if (MARKET_FIELD_ID_SET.has(event.target.id)) {
    saveMarketSettings();
    if (event.target.id === "rollercoinCookie") {
      markAuthStatusDirty();
    }
  }

  if (event.target.closest(".card") && !event.target.closest("#marketCard")) {
    recalculateLive();
  }
});

document.addEventListener("change", (event) => {
  if (!(event.target instanceof HTMLElement)) return;

  if (CURRENT_SYSTEM_FIELD_ID_SET.has(event.target.id)) {
    saveCurrentSystem({ recordHistory: true, source: "manual" });
  }
  if (MARKET_FIELD_ID_SET.has(event.target.id)) {
    saveMarketSettings();
    if (event.target.id === "rollercoinCookie") {
      markAuthStatusDirty();
    }
  }

  if (event.target.closest(".card") && !event.target.closest("#marketCard")) {
    recalculateLive();
  }
});

clearTransientLocalState();
restoreCurrentSystem();
restoreCurrentSystemHistory();
initializeTabs();
updatePowerUnitLabels();
bindMarketProgressListener();
addCandidate();
updateCurrentStats();
renderCurrentSystemHistory();
renderRoomMinersCollection([]);
void initializeRollercoinSessionState();
