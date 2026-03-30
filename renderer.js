const https = require("https");
const { ipcRenderer } = require("electron");

const POWER_MULTIPLIER = {
  "Th/s": 1,
  "Ph/s": 1000,
  "Eh/s": 1000 ** 2,
  "Zh/s": 1000 ** 3,
};

const UNIT_ORDER = ["Th/s", "Ph/s", "Eh/s", "Zh/s"];

const CURRENT_SYSTEM_STORAGE_KEY = "rollercoin.currentSystem.v1";
const CURRENT_SYSTEM_FIELD_IDS = [
  "currentBasePowerValue",
  "currentBasePowerUnit",
  "currentBonusPercent",
];
const CURRENT_SYSTEM_FIELD_ID_SET = new Set(CURRENT_SYSTEM_FIELD_IDS);

const ROLLERCOIN_MARKET_STORAGE_KEY = "rollercoin.marketSettings.v1";
const ROLLERCOIN_MARKET_MINERS_CACHE_STORAGE_KEY = "rollercoin.marketMinersCache.v1";
const ROLLERCOIN_MARKET_MINERS_CACHE_VERSION = 1;
const MARKET_FIELD_IDS = [
  "marketRoomConfigRef",
  "marketRoomWidthMode",
  "marketReplacementEnabled",
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
const authTokenIndicator = document.getElementById("authTokenIndicator");
const authTokenMessage = document.getElementById("authTokenMessage");
const authActionBtn = document.getElementById("authActionBtn");

const rollercoinLoginBtn = document.getElementById("rollercoinLoginBtn");
const rollercoinCookieInput = document.getElementById("rollercoinCookie");
const marketRoomConfigRefInput = document.getElementById("marketRoomConfigRef");
const marketRoomWidthModeInput = document.getElementById("marketRoomWidthMode");
const marketReplacementEnabledInput = document.getElementById("marketReplacementEnabled");
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

let marketMinersCache = [];
let marketSourceInfo = null;
let roomMinersCache = [];
let roomMinersSourceInfo = null;
let activeMarketRequestId = null;
let marketHeartbeatTimer = null;
let marketHeartbeatStartedAt = 0;
let marketProgressListenerBound = false;
let marketLogLines = [];
let authStatusState = "checking";
let authStatusCheckInFlight = false;
let currentPowerSyncInFlight = false;
let roomMinersLoadInFlight = false;
let visibleRoomMinersCount = 25;
let visibleMarketResultsCount = 25;
let lastRenderedRoomMiners = [];
let lastRenderedMarketRecommendations = [];

const MARKET_LOG_MAX_LINES = 250;
const TABLE_RENDER_BATCH_SIZE = 25;

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

function toThs(value, unit) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return NaN;
  return numericValue * POWER_MULTIPLIER[unit];
}

function formatPowerFromThs(valueThs) {
  if (!Number.isFinite(valueThs)) return "-";
  let value = valueThs;
  let unit = UNIT_ORDER[0];

  for (let i = 0; i < UNIT_ORDER.length - 1; i += 1) {
    if (value >= 1000) {
      value /= 1000;
      unit = UNIT_ORDER[i + 1];
    } else {
      break;
    }
  }

  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} ${unit}`;
}

function formatSignedPower(valueThs) {
  if (!Number.isFinite(valueThs)) return "-";
  const sign = valueThs > 0 ? "+" : "";
  return `${sign}${formatPowerFromThs(valueThs)}`;
}

function readNonNegativeNumber(inputId, required = true) {
  const input = document.getElementById(inputId);
  const raw = input.value.trim();
  if (raw === "") return required ? NaN : null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return NaN;
  return value;
}

function saveCurrentSystem() {
  try {
    const currentSystem = {
      currentBasePowerValue: document.getElementById("currentBasePowerValue").value,
      currentBasePowerUnit: document.getElementById("currentBasePowerUnit").value,
      currentBonusPercent: document.getElementById("currentBonusPercent").value,
    };
    localStorage.setItem(CURRENT_SYSTEM_STORAGE_KEY, JSON.stringify(currentSystem));
  } catch {
    // Ignore localStorage write issues.
  }
}

function restoreCurrentSystem() {
  try {
    const raw = localStorage.getItem(CURRENT_SYSTEM_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;

    if (parsed.currentBasePowerValue !== undefined && parsed.currentBasePowerValue !== null) {
      document.getElementById("currentBasePowerValue").value = String(parsed.currentBasePowerValue);
    }
    if (UNIT_ORDER.includes(parsed.currentBasePowerUnit)) {
      document.getElementById("currentBasePowerUnit").value = parsed.currentBasePowerUnit;
    }
    if (parsed.currentBonusPercent !== undefined && parsed.currentBonusPercent !== null) {
      document.getElementById("currentBonusPercent").value = String(parsed.currentBonusPercent);
    }
  } catch {
    // Ignore malformed storage data.
  }
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
  const byName = leftName.localeCompare(rightName, "ru", { sensitivity: "base" });
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
        <td colspan="5" class="muted">Room miners will appear here after loading room config.</td>
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
          <td>${formatMarketValue(miner.power, 3)}</td>
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
  saveCurrentSystem();
  recalculateLive();
}

function saveMarketSettings() {
  if (!rollercoinCookieInput) return;

  try {
    const payload = {
      marketRoomConfigRef: marketRoomConfigRefInput?.value ?? "",
      marketRoomWidthMode: marketRoomWidthModeInput?.value ?? "any",
      marketReplacementEnabled: marketReplacementEnabledInput?.value ?? "off",
      marketReplacementStrategy: marketReplacementStrategyInput?.value ?? "strict",
      rollercoinCookie: rollercoinCookieInput.value,
      marketBudget: marketBudgetInput?.value ?? "",
      marketMaxMinerPrice: marketMaxMinerPriceInput?.value ?? "",
      marketSortMode: marketSortModeInput?.value ?? "gainPerPrice",
      roomMinersSortMode: roomMinersSortModeInput?.value ?? "powerDesc",
      roomMinersSearch: roomMinersSearchInput?.value ?? "",
      marketTopN: marketTopNInput?.value ?? "",
    };
    localStorage.setItem(ROLLERCOIN_MARKET_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore localStorage write issues.
  }
}

function restoreMarketSettings() {
  if (!rollercoinCookieInput) return;

  try {
    const raw = localStorage.getItem(ROLLERCOIN_MARKET_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;

    if (typeof parsed.rollercoinCookie === "string") {
      rollercoinCookieInput.value = parsed.rollercoinCookie;
    }
    if (typeof parsed.marketRoomConfigRef === "string" && marketRoomConfigRefInput) {
      marketRoomConfigRefInput.value = parsed.marketRoomConfigRef;
    }
    if (
      typeof parsed.marketRoomWidthMode === "string" &&
      marketRoomWidthModeInput &&
      ["any", "1", "2"].includes(parsed.marketRoomWidthMode)
    ) {
      marketRoomWidthModeInput.value = parsed.marketRoomWidthMode;
    }
    if (
      typeof parsed.marketReplacementEnabled === "string" &&
      marketReplacementEnabledInput &&
      ["off", "on"].includes(parsed.marketReplacementEnabled)
    ) {
      marketReplacementEnabledInput.value = parsed.marketReplacementEnabled;
    }
    if (
      typeof parsed.marketReplacementStrategy === "string" &&
      marketReplacementStrategyInput &&
      ["strict", "flex"].includes(parsed.marketReplacementStrategy)
    ) {
      marketReplacementStrategyInput.value = parsed.marketReplacementStrategy;
    }
    if (typeof parsed.marketBudget === "string" && marketBudgetInput) {
      marketBudgetInput.value = parsed.marketBudget;
    }
    if (typeof parsed.marketMaxMinerPrice === "string" && marketMaxMinerPriceInput) {
      marketMaxMinerPriceInput.value = parsed.marketMaxMinerPrice;
    }
    if (
      typeof parsed.marketSortMode === "string" &&
      marketSortModeInput &&
      ["gainPerPrice", "gainPower"].includes(parsed.marketSortMode)
    ) {
      marketSortModeInput.value = parsed.marketSortMode;
    }
    if (
      typeof parsed.roomMinersSortMode === "string" &&
      roomMinersSortModeInput &&
      ["powerDesc", "bonusDesc", "widthAsc", "nameAsc"].includes(parsed.roomMinersSortMode)
    ) {
      roomMinersSortModeInput.value = parsed.roomMinersSortMode;
    }
    if (typeof parsed.roomMinersSearch === "string" && roomMinersSearchInput) {
      roomMinersSearchInput.value = parsed.roomMinersSearch;
    }
    if (typeof parsed.marketTopN === "string" && marketTopNInput) {
      marketTopNInput.value = parsed.marketTopN;
    }
  } catch {
    // Ignore malformed storage data.
  }
}

function formatMarketDateTime(timestamp) {
  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed) || parsed <= 0) return "unknown";
  return new Date(parsed).toLocaleString("ru-RU", { hour12: false });
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
  try {
    if (!Array.isArray(marketMinersCache) || marketMinersCache.length === 0) {
      localStorage.removeItem(ROLLERCOIN_MARKET_MINERS_CACHE_STORAGE_KEY);
      return;
    }

    const payload = {
      version: ROLLERCOIN_MARKET_MINERS_CACHE_VERSION,
      savedAt: Date.now(),
      sourceInfo: normalizeMarketSourceInfo(marketSourceInfo, marketMinersCache.length),
      miners: marketMinersCache,
    };

    localStorage.setItem(ROLLERCOIN_MARKET_MINERS_CACHE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore localStorage write issues.
  }
}

function restoreMarketMinersCache() {
  try {
    const raw = localStorage.getItem(ROLLERCOIN_MARKET_MINERS_CACHE_STORAGE_KEY);
    if (!raw) return false;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return false;

    const rawMiners = Array.isArray(parsed) ? parsed : parsed.miners;
    const normalizedMiners = normalizeCachedMarketMiners(rawMiners);
    if (normalizedMiners.length === 0) {
      localStorage.removeItem(ROLLERCOIN_MARKET_MINERS_CACHE_STORAGE_KEY);
      return false;
    }

    marketMinersCache = normalizedMiners;
    const sourceBase =
      parsed.sourceInfo && typeof parsed.sourceInfo === "object"
        ? parsed.sourceInfo
        : { loadedAt: Number(parsed.savedAt) || Date.now() };
    marketSourceInfo = normalizeMarketSourceInfo(sourceBase, normalizedMiners.length);
    appendMarketLog(
      `Loaded ${normalizedMiners.length} miners from local cache (${formatMarketDateTime(marketSourceInfo.loadedAt)}).`,
      "info",
    );

    try {
      updateMarketRecommendationsView(
        `Loaded ${normalizedMiners.length} cached miners. Click "Load miners from market" to refresh.`,
        "success",
      );
      if (getMarketReplacementEnabled() && roomMinersCache.length === 0) {
        setRoomMinersStatus(
          "Replacement mode is enabled, but room miners are not loaded yet. Showing cached market miners without replacement suggestions.",
          "neutral",
        );
      }
    } catch (error) {
      renderMarketRecommendations([]);
      if (marketSummary) {
        marketSummary.textContent = "";
      }
      setMarketStatus(
        `Loaded cached miners (${normalizedMiners.length}), but filters are invalid: ${error.message}`,
        "error",
      );
    }

    return true;
  } catch {
    return false;
  }
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
    const syncedBasePhs = formatMarketValue(parseNumber(powerResult.basePowerPhs), 6);
    const syncedBonusPercent = formatMarketValue(parseNumber(powerResult.bonusPercent), 2);
    const authSuffix = powerResult.selectedAuthVariant ? ` via ${powerResult.selectedAuthVariant}` : "";
    setCurrentSystemSyncStatus(
      `Synced from RollerCoin${authSuffix}: ${syncedBasePhs} Ph/s base, ${syncedBonusPercent}% bonus.`,
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

function getMarketReplacementEnabled() {
  return marketReplacementEnabledInput?.value === "on";
}

function getMarketReplacementStrategy() {
  return marketReplacementStrategyInput?.value === "flex" ? "flex" : "strict";
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
  const singles = roomMinersCache
    .filter((miner) => Number.isFinite(Number(miner?.width)) && Number(miner.width) > 0)
    .map((miner) => ({
      width: Math.floor(Number(miner.width)),
      miners: [miner],
      removedPowerThs: toThs(miner.power, "Ph/s"),
      removedBonusPercent: miner.bonusPercent,
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

    const roomConfigRef = marketRoomConfigRefInput?.value?.trim?.() ?? "";
    const cookieHeader = rollercoinCookieInput?.value?.trim?.() ?? "";
    const roomResult = await ipcRenderer.invoke("rollercoin-room-config-fetch", {
      cookieHeader,
      roomConfigRef,
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

    const roomIdText = roomResult.roomConfigId ? ` (room ${roomResult.roomConfigId})` : "";
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
  return date.toLocaleTimeString("ru-RU", { hour12: false });
}

function appendMarketLog(message, level = "info", timestamp = Date.now()) {
  if (!marketLogsOutput) return;
  const safeLevel = typeof level === "string" ? level.toUpperCase() : "INFO";
  const line = `[${formatLogTime(timestamp)}] [${safeLevel}] ${message}`;
  marketLogLines.push(line);

  if (marketLogLines.length > MARKET_LOG_MAX_LINES) {
    marketLogLines = marketLogLines.slice(-MARKET_LOG_MAX_LINES);
  }

  marketLogsOutput.textContent = marketLogLines.join("\n");
  marketLogsOutput.scrollTop = marketLogsOutput.scrollHeight;
}

function clearMarketLogs() {
  marketLogLines = [];
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
  if (Number.isFinite(parsed) && rawItem?.__saleOrdersRaw === true) {
    return parsed / 1000000;
  }
  if (Number.isFinite(parsed) && rawItem?.__roomConfigRaw === true && parsed >= 100000) {
    return parsed / 1000000;
  }
  return parsed;
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
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
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
  const level = extractMinerLevel(rawItem);
  if (!level) return "";
  return `https://rollercoin.com/static/img/storage/rarity_icons/level_${level}.png?v=1.0.0`;
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

    const dedupeKey = `${miner.id}:${miner.price}:${miner.power}:${miner.bonusPercent}`;
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

  const bonusRaw = parseNumber(rawItem.bonusPercent);
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
  const levelRaw = parseNumber(rawItem.level);
  const level = Number.isFinite(levelRaw) && levelRaw > 0 ? Math.floor(levelRaw) : null;
  const widthRaw = parseNumber(rawItem.width);
  const width = Number.isFinite(widthRaw) && widthRaw > 0 ? Math.floor(widthRaw) : extractMinerWidth(rawItem);
  const levelBadgeUrl = normalizeImageUrl(rawItem.levelBadgeUrl || rawItem.level_badge_url);

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

    const dedupeKey = `${miner.id}:${miner.price}:${miner.power}:${miner.bonusPercent}`;
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
        const miners = normalizeMarketMiners(sessionResponse.marketplaceOffers);
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
  return value.toLocaleString("ru-RU", { maximumFractionDigits: fractionDigits });
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

function buildMarketRecommendations() {
  const budget = readOptionalInputNumber(marketBudgetInput);
  const maxMinerPrice = readOptionalInputNumber(marketMaxMinerPriceInput);
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
  const buildProjectedCandidate = (miner, replacementSet = null) => {
    const minerPowerThs = toThs(miner.power, "Ph/s");
    const removedPowerThs = replacementSet ? replacementSet.removedPowerThs : 0;
    const removedBonusPercent = replacementSet ? replacementSet.removedBonusPercent : 0;
    const projectedBaseThs = currentSystem.baseThs + minerPowerThs - removedPowerThs;
    const projectedBonusPercent = currentSystem.bonusPercent + miner.bonusPercent - removedBonusPercent;
    const projectedTotalThs = getCurrentTotal(projectedBaseThs, projectedBonusPercent);
    const gainThs = projectedTotalThs - totalCurrentThs;
    const gainPerPrice = miner.price > 0 ? gainThs / miner.price : NaN;

    return {
      projectedBasePower: projectedBaseThs / POWER_MULTIPLIER["Ph/s"],
      projectedBonusPercent,
      projectedTotalPower: projectedTotalThs / POWER_MULTIPLIER["Ph/s"],
      gainPower: gainThs / POWER_MULTIPLIER["Ph/s"],
      gainPerPrice: Number.isFinite(gainPerPrice) ? gainPerPrice / POWER_MULTIPLIER["Ph/s"] : NaN,
      replacedMinerName: replacementSet?.miners[0]?.name || "",
      replacedMinerLevel: replacementSet?.miners[0]?.level ?? null,
      replacedMinerWidth: replacementSet?.width ?? null,
      replacedMinerCount: replacementSet?.miners?.length ?? 0,
      replaceText: replacementSet?.label || "-",
    };
  };

  const filtered = marketMinersCache
    .filter((miner) => (budget === null ? true : miner.price <= budget))
    .filter((miner) => (maxMinerPrice === null ? true : miner.price <= maxMinerPrice))
    .filter((miner) => (roomWidthMode === "any" ? true : String(miner.width || "") === roomWidthMode))
    .filter((miner) => (roomMinersCache.length === 0 ? true : !ownedRoomMinerKeys.has(getRoomMinerOwnershipKey(miner))))
    .map((miner) => {
      let bestSwap = null;

      if (!replacementEnabled) {
        bestSwap = buildProjectedCandidate(miner);
      } else {
        const minerWidth = Number.isFinite(Number(miner.width)) ? Math.floor(Number(miner.width)) : null;
        const replacementPool = minerWidth
          ? roomReplacementSets.filter((set) => set.width === minerWidth)
          : [];

        replacementPool.forEach((replacementSet) => {
          const candidateSwap = buildProjectedCandidate(miner, replacementSet);

          if (
            !bestSwap ||
            candidateSwap.gainPower > bestSwap.gainPower ||
            (
              candidateSwap.gainPower === bestSwap.gainPower &&
              candidateSwap.gainPerPrice > bestSwap.gainPerPrice
            )
          ) {
            bestSwap = candidateSwap;
          }
        });

        if (!bestSwap) {
          bestSwap = {
            ...buildProjectedCandidate(miner),
            replaceText: minerWidth
              ? `No room miner found for width ${minerWidth}`
              : "Width not detected",
          };
        }
      }

      if (!bestSwap) return null;

      return {
        ...miner,
        ...bestSwap,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (sortMode === "gainPower") {
        if (b.gainPower !== a.gainPower) return b.gainPower - a.gainPower;
        if (b.gainPerPrice !== a.gainPerPrice) return b.gainPerPrice - a.gainPerPrice;
        return a.price - b.price;
      }
      if (b.gainPerPrice !== a.gainPerPrice) return b.gainPerPrice - a.gainPerPrice;
      if (b.gainPower !== a.gainPower) return b.gainPower - a.gainPower;
      return a.price - b.price;
    });

  return {
    allItems: filtered,
    items: topN === null ? filtered : filtered.slice(0, topN),
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
    sortMode,
    topN,
    totalMatched: filtered.length,
  };
}

function updateMarketRecommendationsView(statusMessage = "Recommendations updated.", tone = "success") {
  const recommendations = buildMarketRecommendations();
  renderMarketRecommendations(recommendations.items);
  renderRoomReplacementSuggestions(recommendations.allItems, recommendations);

  const budgetText = recommendations.budget === null ? "not set" : formatMarketValue(recommendations.budget, 2);
  const maxPriceText =
    recommendations.maxMinerPrice === null ? "not set" : formatMarketValue(recommendations.maxMinerPrice, 2);
  const sourceText = marketSourceInfo ? marketSourceInfo.endpoint : "cached";
  const sourcePathText = marketSourceInfo ? marketSourceInfo.sourcePath : "memory-cache";
  const loadedAtText =
    marketSourceInfo && Number.isFinite(Number(marketSourceInfo.loadedAt))
      ? formatMarketDateTime(marketSourceInfo.loadedAt)
      : "unknown";
  const currentBaseText = `${formatMarketValue(recommendations.currentSystem.basePhs, 6)} Ph/s`;
  const currentBonusText = `${formatMarketValue(recommendations.currentSystem.bonusPercent, 2)}%`;
  const sortModeText = recommendations.sortMode === "gainPower" ? "gain to system" : "gain per RLT";
  const roomWidthText =
    recommendations.roomWidthMode === "1"
      ? "small only"
      : recommendations.roomWidthMode === "2"
        ? "large only"
        : "any";
  const replacementText =
    recommendations.replacementEnabled
      ? recommendations.replacementStrategy === "flex"
        ? "on (flex)"
        : "on (strict)"
      : recommendations.replacementPendingRoomLoad
        ? "pending room miners"
        : "off";

  if (marketSummary) {
    marketSummary.textContent =
      `Matched: ${recommendations.totalMatched}; budget: ${budgetText}; max price/miner: ${maxPriceText}; ` +
      `sort: ${sortModeText}; room miners: ${recommendations.roomMinersCount}; hidden owned: ${recommendations.overlappingOwnedCount}; width: ${roomWidthText}; replacement: ${replacementText}; ` +
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
    .filter((miner) => typeof miner?.replaceText === "string")
    .filter((miner) => miner.replaceText && miner.replaceText !== "-")
    .filter((miner) => !/^No room miner found/i.test(miner.replaceText))
    .filter((miner) => !/^Width not detected/i.test(miner.replaceText));

  if (actionableSuggestions.length === 0) {
    roomReplacementSuggestions.textContent =
      "Replacement suggestions will appear here after finding market options.";
    return;
  }

  const formatSuggestion = (miner, index) => {
    const levelText = miner.level ? ` L${miner.level}` : "";
    const priceText = `${formatMarketValue(miner.price, 2)} ${miner.currency || "RLT"}`;
    const gainText = `+${formatMarketValue(miner.gainPower, 6)} Ph/s`;
    return `${index + 1}. Buy ${miner.name}${levelText} -> remove ${miner.replaceText} | gain ${gainText} | price ${priceText}`;
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

  roomReplacementSuggestions.textContent = [
    `Cheaper upgrades (${budgetLabel}):`,
    ...(economySuggestions.length > 0 ? economySuggestions : ["No upgrade suggestions."]),
    "",
    `Maximum power within budget (${budgetLabel}):`,
    ...(powerSuggestions.length > 0 ? powerSuggestions : ["No power suggestions."]),
  ].join("\n");
}

function renderMarketRecommendations(recommendations, options = {}) {
  if (!marketResultsBody) return;
  const resetPagination = options.resetPagination !== false;

  if (resetPagination) {
    visibleMarketResultsCount = TABLE_RENDER_BATCH_SIZE;
  }

  lastRenderedMarketRecommendations = Array.isArray(recommendations) ? [...recommendations] : [];

  if (recommendations.length === 0) {
    marketResultsBody.innerHTML = `
      <tr>
        <td colspan="8" class="muted">No market miners match the current filters.</td>
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

  marketResultsBody.innerHTML = visibleRecommendations
    .map((miner, index) => {
      const actualIndex = index + 1;
      const currency = escapeHtml(miner.currency || "RLT");
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
          <td>${formatMarketValue(miner.price, 2)} ${currency}</td>
          <td>${formatMarketValue(miner.power, 3)}</td>
          <td>${formatMarketValue(miner.bonusPercent, 2)}%</td>
          <td>${escapeHtml(miner.width || "-")}</td>
          <td>${formatMarketValue(miner.gainPower, 6)}</td>
          <td>${formatMarketValue(miner.gainPerPrice, 6)}</td>
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
}

function bindMarketImageFallbacks() {
  [marketResultsBody, roomMinersBody].filter(Boolean).forEach((container) => {
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
      await checkRollercoinAuthStatus({ silent: true });
      await refreshCurrentPowerFromRollercoin({ silent: true, allowUnauthenticated: true });
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
    "Loading miners from direct market API with full pagination...",
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
  candidateCountStat.textContent = String(rows.length);
}

function addCandidate() {
  const row = buildCandidateRow();
  candidatesBody.appendChild(row);
  reindexRows();
}

function getCurrentTotal(baseThs, bonusPercent) {
  return baseThs * (1 + bonusPercent / 100);
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
      <div>${best.bonusNew.toLocaleString("ru-RU", { maximumFractionDigits: 4 })}%</div>

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

async function initializeRollercoinSessionState() {
  await checkRollercoinAuthStatus({ silent: true });
  await refreshCurrentPowerFromRollercoin({ silent: true, allowUnauthenticated: true });
  await loadRoomMinersFromRollercoin({ silent: true, allowUnauthenticated: true });
}

addCandidateBtn.addEventListener("click", () => {
  addCandidate();
  recalculateLive();
});

calculateBtn.addEventListener("click", recalculateLive);

if (rollercoinLoginBtn) {
  rollercoinLoginBtn.addEventListener("click", handleRollercoinLogin);
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
if (marketReplacementEnabledInput) {
  marketReplacementEnabledInput.addEventListener("change", () => {
    saveMarketSettings();
    if (marketMinersCache.length === 0) return;
    try {
      updateMarketRecommendationsView("Replacement mode updated.", "success");
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
      updateMarketRecommendationsView("Replacement strategy updated.", "success");
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

candidatesBody.addEventListener("input", recalculateLive);
candidatesBody.addEventListener("change", recalculateLive);

document.addEventListener("input", (event) => {
  if (!(event.target instanceof HTMLElement)) return;

  if (CURRENT_SYSTEM_FIELD_ID_SET.has(event.target.id)) {
    saveCurrentSystem();
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
    saveCurrentSystem();
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

restoreCurrentSystem();
restoreMarketSettings();
restoreMarketMinersCache();
bindMarketProgressListener();
addCandidate();
updateCurrentStats();
setCurrentSystemSyncStatus("RollerCoin power sync is idle.");
setRoomMinersStatus("Room miners are not loaded.");
renderRoomMinersCollection([]);
initializeRollercoinSessionState();
