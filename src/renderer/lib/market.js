import {
  POWER_MULTIPLIER,
  formatMarketValue,
  formatPowerFromPhs,
  getCurrentSystemSnapshot,
  getCurrentTotal,
  parseNumber,
  toThs,
} from "./power";
import { getFs, getIpcRenderer, getOs, getPath } from "./runtime";

export const MARKET_DIRECT_MAX_PAGES = 250;
export const MARKET_QUICK_REFRESH_PAGE_LIMIT = 8;
export const MARKET_FULL_REFRESH_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const TABLE_RENDER_BATCH_SIZE = 25;
export const MARKET_LOG_MAX_LINES = 250;
export const BUDGET_POOL_LIMIT = 120;
export const BUDGET_MAX_DEPTH = 4;

export const DEFAULT_MARKET_SETTINGS = {
  roomWidthMode: "any",
  recommendationMode: "budget",
  replacementStrategy: "flex",
  budget: "",
  maxMinerPrice: "",
  sortMode: "gainPerPrice",
  roomMinersSortMode: "powerDesc",
  roomMinersSearch: "",
  topN: "",
};

const CACHE_FILENAME = "market-miners-cache.json";
const MIN_GAIN_PHS = 0.001;

export function createDefaultMarketState() {
  return {
    authStatus: "invalid",
    authMessage: "No saved RollerCoin session. Login is required.",
    authChecking: false,
    cookieHeader: "",
    appUpdateChecking: false,
    appUpdateMessage: "",
    currentPowerSyncInFlight: false,
    currentPowerSyncStatus: "RollerCoin power sync is idle.",
    roomMinersLoadInFlight: false,
    roomMinersStatus: "Room miners are not loaded.",
    marketLoading: false,
    marketStatus: "Login to RollerCoin to load fresh data.",
    marketSummary: "",
    marketLogs: [],
    roomMiners: [],
    roomMinersSourceInfo: null,
    marketCatalog: [],
    marketMiners: [],
    marketSourceInfo: null,
    activeRequestId: null,
    visibleRoomMinersCount: TABLE_RENDER_BATCH_SIZE,
    visibleMarketResultsCount: TABLE_RENDER_BATCH_SIZE,
    primaryTab: "market",
    marketViewTab: "upgrades",
    settings: { ...DEFAULT_MARKET_SETTINGS },
  };
}

function getByPath(obj, path) {
  return path.split(".").reduce((current, part) => (current && typeof current === "object" ? current[part] : undefined), obj);
}

function pickText(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  return String(value.en || value.us || value.ru || value.title || value.name || "").trim();
}

function firstFinite(values) {
  for (const value of values) {
    const parsed = parseNumber(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return NaN;
}

function normalizeUrl(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `https://rollercoin.com${trimmed}`;
  return trimmed;
}

function getWidth(item) {
  const width = firstFinite([item.width, item.size, item.slot_size, getByPath(item, "item.width"), getByPath(item, "product.width")]);
  if (Number.isFinite(width) && width > 0) return Math.floor(width);
  const text = String(item.width || item.size || "").trim().toLowerCase();
  if (["small", "1", "1x1"].includes(text)) return 1;
  if (["large", "2", "2x1"].includes(text)) return 2;
  return null;
}

function normalizeMiner(item, index, fallbackName = "Marketplace miner") {
  if (!item || typeof item !== "object") return null;
  const power = firstFinite([item.power, item.hashrate, getByPath(item, "item.power"), getByPath(item, "product.power")]);
  if (!Number.isFinite(power) || power <= 0) return null;
  const imageUrl = normalizeUrl(item.image_url || item.imageUrl || item.image || getByPath(item, "item.image") || getByPath(item, "product.image"));
  return {
    id: String(item.id || item.item_id || item.offer_id || item.order_id || `miner-${index + 1}`),
    name: pickText(getByPath(item, "item.name")) || pickText(getByPath(item, "product.name")) || pickText(item.name) || fallbackName,
    power,
    bonusPercent: Number.isFinite(firstFinite([item.percent_bonus, item.bonus_percent, getByPath(item, "item.percent_bonus")])) ? firstFinite([item.percent_bonus, item.bonus_percent, getByPath(item, "item.percent_bonus")]) : 0,
    level: Number.isFinite(firstFinite([item.level, getByPath(item, "item.level")])) ? Math.floor(firstFinite([item.level, getByPath(item, "item.level")])) : null,
    width: getWidth(item),
    imageUrl,
    imageCandidates: imageUrl ? [imageUrl] : [],
    levelBadgeUrl: "",
    currency: "RLT",
  };
}

export function normalizeRoomMiners(rawItems) {
  const seenIds = new Set();
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((item, index) => {
      const miner = normalizeMiner(item, index, "Room miner");
      if (!miner) return null;
      let nextId = miner.id;
      let duplicateIndex = 2;
      while (seenIds.has(nextId)) {
        nextId = `${miner.id}#${duplicateIndex}`;
        duplicateIndex += 1;
      }
      seenIds.add(nextId);
      return { ...miner, id: nextId };
    })
    .filter(Boolean);
}

export function normalizeMarketMiners(rawItems) {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((item, index) => {
      const miner = normalizeMiner(item, index);
      const price = firstFinite([item.price, item.cost, item.amount, item.price_value, item.rlt_price, getByPath(item, "price.value"), getByPath(item, "item.price")]);
      if (!miner || !Number.isFinite(price) || price <= 0) return null;
      const now = Date.now();
      return {
        ...miner,
        sourceOfferId: miner.id,
        variantKey: `${miner.name.toLowerCase()}|${miner.power}|${miner.bonusPercent}|${miner.width || "na"}|${miner.level || "na"}`,
        price,
        effectivePower: miner.power * (1 + miner.bonusPercent / 100),
        efficiency: (miner.power * (1 + miner.bonusPercent / 100)) / price,
        firstSeenAt: now,
        lastSeenAt: now,
        lastPriceRefreshAt: now,
      };
    })
    .filter(Boolean);
}

export const normalizeCachedMarketMiners = normalizeMarketMiners;

export function normalizeMarketSourceInfo(rawSourceInfo, fallbackScore = 0) {
  return {
    endpoint: rawSourceInfo?.endpoint || "cached",
    sourcePath: rawSourceInfo?.sourcePath || "memory-cache",
    sourceScore: Number.isFinite(Number(rawSourceInfo?.sourceScore)) ? Number(rawSourceInfo.sourceScore) : fallbackScore,
    refreshMode: rawSourceInfo?.refreshMode === "quick" ? "quick" : "full",
    maxPages: Number.isFinite(Number(rawSourceInfo?.maxPages)) ? Number(rawSourceInfo.maxPages) : MARKET_DIRECT_MAX_PAGES,
    loadedAt: Number.isFinite(Number(rawSourceInfo?.loadedAt)) ? Number(rawSourceInfo.loadedAt) : Date.now(),
    fullRefreshedAt: Number.isFinite(Number(rawSourceInfo?.fullRefreshedAt)) ? Number(rawSourceInfo.fullRefreshedAt) : null,
    quickRefreshedAt: Number.isFinite(Number(rawSourceInfo?.quickRefreshedAt)) ? Number(rawSourceInfo.quickRefreshedAt) : null,
    catalogCount: Math.max(0, Math.floor(Number(rawSourceInfo?.catalogCount) || 0)),
    activeCount: Math.max(0, Math.floor(Number(rawSourceInfo?.activeCount) || 0)),
    cacheRestored: Boolean(rawSourceInfo?.cacheRestored),
  };
}

export function buildActiveMarketMinersFromCatalog(catalog) {
  return (Array.isArray(catalog) ? catalog : []).filter((miner) =>
    Number.isFinite(Number(miner?.price)) &&
    Number(miner.price) > 0 &&
    Number.isFinite(Number(miner?.power)) &&
    Number(miner.power) > 0,
  );
}

export function mergeMarketMinerCatalog(existingCatalog, scannedMiners, options = {}) {
  const mode = options?.mode === "quick" ? "quick" : "full";
  const now = Date.now();
  const nextMap = new Map((mode === "quick" ? existingCatalog : []).map((miner) => [miner.variantKey, { ...miner }]));
  normalizeMarketMiners(scannedMiners).forEach((miner) => {
    const existing = nextMap.get(miner.variantKey);
    nextMap.set(miner.variantKey, {
      ...(existing || {}),
      ...miner,
      firstSeenAt: existing?.firstSeenAt || miner.firstSeenAt || now,
      lastSeenAt: now,
      lastPriceRefreshAt: now,
    });
  });
  const catalog = [...nextMap.values()].sort((left, right) => (Number(left.price) || 0) - (Number(right.price) || 0));
  const sourceInfo = normalizeMarketSourceInfo({
    ...(options?.sourceInfo || {}),
    loadedAt: now,
    refreshMode: mode,
    quickRefreshedAt: mode === "quick" ? now : options?.previousSourceInfo?.quickRefreshedAt,
    fullRefreshedAt: mode === "full" ? now : options?.previousSourceInfo?.fullRefreshedAt,
    catalogCount: catalog.length,
    activeCount: catalog.length,
  }, catalog.length);
  return { catalog, activeMiners: buildActiveMarketMinersFromCatalog(catalog), sourceInfo };
}

function getCachePath() {
  const fs = getFs();
  const path = getPath();
  const os = getOs();
  if (!fs || !path || !os) return "";
  const dir = path.join(os.homedir(), ".roller-coin-calculator");
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return path.join(dir, CACHE_FILENAME);
}

export function restoreMarketMinersCache() {
  const fs = getFs();
  const filePath = getCachePath();
  if (!fs || !filePath) return null;
  try {
    if (!fs.existsSync(filePath)) return null;
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const catalog = Array.isArray(payload?.catalog) ? payload.catalog : [];
    const activeMiners = buildActiveMarketMinersFromCatalog(catalog);
    if (catalog.length === 0 || activeMiners.length === 0) return null;
    return {
      catalog,
      activeMiners,
      sourceInfo: normalizeMarketSourceInfo({ ...(payload?.sourceInfo || {}), cacheRestored: true }, activeMiners.length),
    };
  } catch {
    return null;
  }
}

export function saveMarketMinersCache(catalog, sourceInfo) {
  const fs = getFs();
  const filePath = getCachePath();
  if (!fs || !filePath) return false;
  try {
    fs.writeFileSync(filePath, JSON.stringify({
      version: 4,
      savedAt: Date.now(),
      sourceInfo: normalizeMarketSourceInfo(sourceInfo, Array.isArray(catalog) ? catalog.length : 0),
      catalog: Array.isArray(catalog) ? catalog : [],
    }), "utf8");
    return true;
  } catch {
    return false;
  }
}

export function shouldRunFullMarketRefresh(sourceInfo) {
  const fullRefreshedAt = Number(sourceInfo?.fullRefreshedAt);
  if (!Number.isFinite(fullRefreshedAt)) return true;
  return Date.now() - fullRefreshedAt >= MARKET_FULL_REFRESH_MAX_AGE_MS;
}

export function buildMarketRefreshPlan(sourceInfo) {
  if (!sourceInfo) return [{ mode: "full", maxPages: MARKET_DIRECT_MAX_PAGES, includeAttempts: true, label: "Initial full market sync" }];
  const plan = [{ mode: "quick", maxPages: MARKET_QUICK_REFRESH_PAGE_LIMIT, includeAttempts: false, label: "Quick market refresh" }];
  if (shouldRunFullMarketRefresh(sourceInfo)) {
    plan.push({ mode: "full", maxPages: MARKET_DIRECT_MAX_PAGES, includeAttempts: true, label: "Full market reconciliation" });
  }
  return plan;
}

export function appendMarketLog(logs, message, level = "info", timestamp = Date.now()) {
  const time = new Date(timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return [...logs, `[${time}] [${String(level).toUpperCase()}] ${message}`].slice(-MARKET_LOG_MAX_LINES);
}

export async function invokeAuthStatus(cookieHeader) {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) throw new Error("IPC is unavailable.");
  return ipcRenderer.invoke("rollercoin-auth-status", { cookieHeader });
}

export async function invokeAuthSession() {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) throw new Error("IPC is unavailable.");
  return ipcRenderer.invoke("rollercoin-auth-session");
}

export async function invokeAuthLogin() {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) throw new Error("IPC is unavailable.");
  return ipcRenderer.invoke("rollercoin-auth-login");
}

export async function invokeCurrentPower(cookieHeader) {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) throw new Error("IPC is unavailable.");
  return ipcRenderer.invoke("rollercoin-current-power", { cookieHeader });
}

export async function invokeRoomConfig(cookieHeader) {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) throw new Error("IPC is unavailable.");
  return ipcRenderer.invoke("rollercoin-room-config-fetch", { cookieHeader, roomConfigRef: "" });
}

export async function invokeMarketFetch(cookieHeader, requestId, options = {}) {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) throw new Error("IPC is unavailable.");
  return ipcRenderer.invoke("rollercoin-market-fetch", {
    cookieHeader,
    requestId,
    refreshMode: options.refreshMode || "full",
    maxPages: options.maxPages || MARKET_DIRECT_MAX_PAGES,
    includeAttempts: options.includeAttempts !== false,
  });
}

export async function invokeAppUpdateCheck() {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) throw new Error("IPC is unavailable.");
  return ipcRenderer.invoke("app-updates-check");
}

export function subscribeMarketProgress(listener) {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer || typeof ipcRenderer.on !== "function") return () => {};
  const handler = (_event, payload) => listener(payload);
  ipcRenderer.on("rollercoin-market-progress", handler);
  return () => {
    if (typeof ipcRenderer.removeListener === "function") {
      ipcRenderer.removeListener("rollercoin-market-progress", handler);
    }
  };
}

export function getRoomMinerOwnershipKey(miner) {
  return [
    String(miner?.name || "").trim().toLowerCase(),
    Number(miner?.power || 0).toFixed(12),
    Number(miner?.bonusPercent || 0).toFixed(6),
    Number.isFinite(Number(miner?.width)) ? Math.floor(Number(miner.width)) : "na",
  ].join("|");
}

function buildRecommendationEntry(currentSystem, totalCurrentThs, purchaseMiners, replacementMiners = []) {
  const boughtPowerThs = purchaseMiners.reduce((sum, miner) => sum + toThs(miner.power, "Ph/s"), 0);
  const boughtBonus = purchaseMiners.reduce((sum, miner) => sum + (Number(miner.bonusPercent) || 0), 0);
  const removedPowerThs = replacementMiners.reduce((sum, miner) => sum + toThs(miner.power, "Ph/s"), 0);
  const removedBonus = replacementMiners.reduce((sum, miner) => sum + (Number(miner.bonusPercent) || 0), 0);
  const totalNew = getCurrentTotal(currentSystem.baseThs + boughtPowerThs - removedPowerThs, currentSystem.bonusPercent + boughtBonus - removedBonus);
  const gainThs = totalNew - totalCurrentThs;
  const leadMiner = purchaseMiners[0];
  const totalPrice = purchaseMiners.reduce((sum, miner) => sum + (Number(miner.price) || 0), 0);
  return {
    isBundle: purchaseMiners.length > 1,
    name: purchaseMiners.length === 1 ? leadMiner.name : purchaseMiners.map((miner) => miner.name).join(" + "),
    price: totalPrice,
    power: boughtPowerThs / POWER_MULTIPLIER["Ph/s"],
    bonusPercent: boughtBonus,
    width: purchaseMiners.reduce((sum, miner) => sum + (Number(miner.width) || 0), 0),
    gainPower: gainThs / POWER_MULTIPLIER["Ph/s"],
    gainPerPrice: totalPrice > 0 ? (gainThs / totalPrice) / POWER_MULTIPLIER["Ph/s"] : NaN,
    projectedBasePower: (currentSystem.baseThs + boughtPowerThs - removedPowerThs) / POWER_MULTIPLIER["Ph/s"],
    projectedBonusPercent: currentSystem.bonusPercent + boughtBonus - removedBonus,
    projectedTotalPower: totalNew / POWER_MULTIPLIER["Ph/s"],
    replacementMiners,
    replaceText: replacementMiners.length > 0 ? replacementMiners.map((miner) => miner.name).join(" + ") : "-",
    purchaseMiners,
    purchaseCount: purchaseMiners.length,
    imageUrl: leadMiner.imageUrl || "",
    imageCandidates: Array.isArray(leadMiner.imageCandidates) ? [...leadMiner.imageCandidates] : [],
    levelBadgeUrl: leadMiner.levelBadgeUrl || "",
    currency: leadMiner.currency || "RLT",
  };
}

function sortRecommendationItems(items, sortMode) {
  return [...items].sort((left, right) => {
    if (sortMode === "gainPower") {
      if (right.gainPower !== left.gainPower) return right.gainPower - left.gainPower;
      if (right.gainPerPrice !== left.gainPerPrice) return right.gainPerPrice - left.gainPerPrice;
      return left.price - right.price;
    }
    if (right.gainPerPrice !== left.gainPerPrice) return right.gainPerPrice - left.gainPerPrice;
    if (right.gainPower !== left.gainPower) return right.gainPower - left.gainPower;
    return left.price - right.price;
  });
}

function sortRoomMinersInternal(miners, sortMode, searchQuery) {
  const normalizedSearch = String(searchQuery || "").trim().toLowerCase();
  const filtered = normalizedSearch
    ? miners.filter((miner) => [miner.name, miner.level ? `l${miner.level}` : "", miner.width ? `width ${miner.width}` : ""].join(" ").toLowerCase().includes(normalizedSearch))
    : [...miners];
  filtered.sort((left, right) => {
    if (sortMode === "bonusDesc") return (Number(right.bonusPercent) || 0) - (Number(left.bonusPercent) || 0);
    if (sortMode === "widthAsc") return (Number(left.width) || 0) - (Number(right.width) || 0);
    if (sortMode === "nameAsc") return String(left.name || "").localeCompare(String(right.name || ""), "en", { sensitivity: "base" });
    return (Number(right.power) || 0) - (Number(left.power) || 0);
  });
  return filtered;
}

export function sortRoomMinersCollection(miners, sortMode = "powerDesc", searchQuery = "") {
  return sortRoomMinersInternal(miners, sortMode, searchQuery);
}

export function buildMarketRecommendations({ currentSystemState, marketMiners, roomMiners, marketSettings, marketSourceInfo }) {
  const currentSystem = getCurrentSystemSnapshot(currentSystemState);
  const roomMinersSorted = sortRoomMinersInternal(roomMiners, marketSettings.roomMinersSortMode, marketSettings.roomMinersSearch);
  if (!currentSystem) {
    return { error: "Current system is invalid. Sync RollerCoin power or enter valid base power and bonus.", items: [], allItems: [], upgradeItems: [], roomMinersSorted, marketSummary: "", replacementEnabled: false, replacementPendingRoomLoad: false, bundleCount: 0, recommendedCount: 0, totalMatched: 0, roomMinersCount: roomMiners.length, filteredMarketMinersCount: 0, overlappingOwnedCount: 0 };
  }

  const budget = marketSettings.budget.trim() ? parseNumber(marketSettings.budget) : null;
  const maxMinerPrice = marketSettings.maxMinerPrice.trim() ? parseNumber(marketSettings.maxMinerPrice) : null;
  const topN = marketSettings.topN.trim() ? Math.max(1, Math.floor(parseNumber(marketSettings.topN) || 0)) : null;
  if (Number.isNaN(budget)) return { error: "Invalid budget value. Enter a non-negative number.", items: [], allItems: [], upgradeItems: [], roomMinersSorted, marketSummary: "", replacementEnabled: false, replacementPendingRoomLoad: false, bundleCount: 0, recommendedCount: 0, totalMatched: 0, roomMinersCount: roomMiners.length, filteredMarketMinersCount: 0, overlappingOwnedCount: 0 };
  if (Number.isNaN(maxMinerPrice)) return { error: "Invalid max price value. Enter a non-negative number.", items: [], allItems: [], upgradeItems: [], roomMinersSorted, marketSummary: "", replacementEnabled: false, replacementPendingRoomLoad: false, bundleCount: 0, recommendedCount: 0, totalMatched: 0, roomMinersCount: roomMiners.length, filteredMarketMinersCount: 0, overlappingOwnedCount: 0 };

  const replacementEnabled = marketSettings.replacementStrategy !== "off" && roomMiners.length > 0;
  const replacementPendingRoomLoad = marketSettings.replacementStrategy !== "off" && roomMiners.length === 0;
  const ownedKeys = new Set(roomMiners.map((miner) => getRoomMinerOwnershipKey(miner)));
  const filteredMarketMiners = marketMiners.filter((miner) => {
    const price = Number(miner.price);
    if (budget !== null && (!Number.isFinite(price) || price > budget)) return false;
    if (maxMinerPrice !== null && (!Number.isFinite(price) || price > maxMinerPrice)) return false;
    if (marketSettings.roomWidthMode !== "any" && String(miner.width || "") !== marketSettings.roomWidthMode) return false;
    if (ownedKeys.size > 0 && ownedKeys.has(getRoomMinerOwnershipKey(miner))) return false;
    return true;
  });

  const totalCurrentThs = getCurrentTotal(currentSystem.baseThs, currentSystem.bonusPercent);
  const singles = filteredMarketMiners.map((miner) => buildRecommendationEntry(currentSystem, totalCurrentThs, [miner]));
  const budgetPool = filteredMarketMiners
    .slice()
    .sort((left, right) => (Number(right.efficiency) || 0) - (Number(left.efficiency) || 0))
    .slice(0, BUDGET_POOL_LIMIT);
  const bundles = [];
  if (marketSettings.recommendationMode === "budget") {
    const maxDepth = budget === null ? BUDGET_MAX_DEPTH : Math.max(2, Math.min(BUDGET_MAX_DEPTH, Math.floor((budget || 0) / Math.max(Math.min(...budgetPool.map((miner) => Number(miner.price) || Infinity)), 0.01))));
    const walk = (startIndex, selected, totalPrice) => {
      if (selected.length >= 2) {
        bundles.push(buildRecommendationEntry(currentSystem, totalCurrentThs, selected));
      }
      if (selected.length >= maxDepth) return;
      for (let index = startIndex; index < budgetPool.length; index += 1) {
        const miner = budgetPool[index];
        const nextPrice = totalPrice + (Number(miner.price) || 0);
        if (budget !== null && nextPrice > budget + 1e-9) continue;
        walk(index + 1, [...selected, miner], nextPrice);
      }
    };
    walk(0, [], 0);
  }

  let allItems = marketSettings.recommendationMode === "budget" ? [...singles, ...bundles] : singles;
  allItems = sortRecommendationItems(allItems, marketSettings.sortMode);
  const upgradeItems = allItems.filter((item) => Number.isFinite(item.gainPower) && item.gainPower > MIN_GAIN_PHS);
  const items = topN === null ? upgradeItems : upgradeItems.slice(0, topN);
  const currentBaseText = formatPowerFromPhs(currentSystem.basePhs, currentSystem.displayUnit);
  const currentBonusText = `${formatMarketValue(currentSystem.bonusPercent, 2)}%`;
  const marketSummary =
    `Matched: ${allItems.length}; profitable upgrades: ${upgradeItems.length}; budget: ${budget === null ? "unlimited" : formatMarketValue(budget, 2)}; ` +
    `max price/miner: ${maxMinerPrice === null ? "not set" : formatMarketValue(maxMinerPrice, 2)}; current base: ${currentBaseText}; current bonus: ${currentBonusText}; ` +
    `source: ${marketSourceInfo?.endpoint || "cached"}; refresh: ${marketSourceInfo?.refreshMode || "full"}; updated: ${marketSourceInfo?.loadedAt ? new Date(Number(marketSourceInfo.loadedAt)).toLocaleString("en-US") : "unknown"}.`;

  return {
    error: null,
    items,
    allItems,
    upgradeItems,
    roomMinersSorted,
    marketSummary,
    replacementEnabled,
    replacementPendingRoomLoad,
    bundleCount: bundles.length,
    recommendedCount: upgradeItems.length,
    totalMatched: allItems.length,
    roomMinersCount: roomMiners.length,
    filteredMarketMinersCount: filteredMarketMiners.length,
    overlappingOwnedCount: marketMiners.filter((miner) => ownedKeys.has(getRoomMinerOwnershipKey(miner))).length,
  };
}
