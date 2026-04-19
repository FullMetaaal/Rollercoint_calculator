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
export const PRICE_HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const BUDGET_COMBINATION_BUY_POOL_LIMIT = 90;
const BUDGET_COMBINATION_REPLACEMENT_SET_LIMIT = 8;
const BUDGET_COMBINATION_OPTION_LIMIT = 320;
const BUDGET_COMBINATION_STATE_LIMIT = 220;
const BUDGET_COMBINATION_RESULT_LIMIT = 160;
const BUDGET_COMBINATION_UNLIMITED_MAX_DEPTH = 5;
const PRICE_HISTORY_MAX_POINTS = 60;
const PRICE_HISTORY_REPEAT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CACHE_FILENAME = "market-miners-cache.json";
const MARKET_MINERS_CACHE_VERSION = 5;
const MIN_GAIN_PHS = 0.001;

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
  return path
    .split(".")
    .reduce((current, part) => (current && typeof current === "object" ? current[part] : undefined), obj);
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

function roundPriceValue(value) {
  return Number(Number(value).toFixed(6));
}

function normalizePriceHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") return null;

  const price = Number(entry.price);
  const observedAt = Number(entry.observedAt ?? entry.seenAt ?? entry.timestamp);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(observedAt) || observedAt <= 0) {
    return null;
  }

  return {
    price: roundPriceValue(price),
    observedAt: Math.floor(observedAt),
  };
}

function trimPriceHistory(entries, now = Date.now()) {
  const cutoff = now - PRICE_HISTORY_MAX_AGE_MS;
  const dedupedByTimestamp = new Map();

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const normalized = normalizePriceHistoryEntry(entry);
    if (!normalized) return;
    if (normalized.observedAt < cutoff) return;
    dedupedByTimestamp.set(normalized.observedAt, normalized);
  });

  return [...dedupedByTimestamp.values()]
    .sort((left, right) => left.observedAt - right.observedAt)
    .slice(-PRICE_HISTORY_MAX_POINTS);
}

function mergePriceHistory(existingEntries, nextEntries, now = Date.now()) {
  return trimPriceHistory([
    ...(Array.isArray(existingEntries) ? existingEntries : []),
    ...(Array.isArray(nextEntries) ? nextEntries : []),
  ], now);
}

function appendPriceObservation(entries, price, observedAt = Date.now()) {
  const normalizedHistory = trimPriceHistory(entries, observedAt);
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    return normalizedHistory;
  }

  const nextEntry = {
    price: roundPriceValue(numericPrice),
    observedAt: Math.floor(observedAt),
  };
  const lastEntry = normalizedHistory[normalizedHistory.length - 1];
  if (!lastEntry) {
    return trimPriceHistory([...normalizedHistory, nextEntry], observedAt);
  }

  const samePrice = Math.abs(lastEntry.price - nextEntry.price) < 1e-9;
  const withinRepeatWindow = nextEntry.observedAt - lastEntry.observedAt < PRICE_HISTORY_REPEAT_INTERVAL_MS;
  if (samePrice && withinRepeatWindow) {
    return trimPriceHistory([
      ...normalizedHistory.slice(0, -1),
      nextEntry,
    ], observedAt);
  }

  return trimPriceHistory([...normalizedHistory, nextEntry], observedAt);
}

function calculateMedian(values) {
  const sorted = [...values]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (sorted.length === 0) return NaN;

  const middleIndex = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middleIndex];
  }
  return (sorted[middleIndex - 1] + sorted[middleIndex]) / 2;
}

function buildPriceWindowStats(entries, maxAgeMs, now = Date.now()) {
  const filtered = trimPriceHistory(entries, now).filter((entry) => now - entry.observedAt <= maxAgeMs);
  const prices = filtered.map((entry) => Number(entry.price)).filter((value) => Number.isFinite(value) && value > 0);

  if (prices.length === 0) {
    return {
      sampleCount: 0,
      minPrice: NaN,
      maxPrice: NaN,
      medianPrice: NaN,
      averagePrice: NaN,
      latestPrice: NaN,
      firstObservedAt: null,
      lastObservedAt: null,
    };
  }

  const sum = prices.reduce((accumulator, value) => accumulator + value, 0);
  return {
    sampleCount: prices.length,
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
    medianPrice: calculateMedian(prices),
    averagePrice: sum / prices.length,
    latestPrice: prices[prices.length - 1],
    firstObservedAt: filtered[0]?.observedAt || null,
    lastObservedAt: filtered[filtered.length - 1]?.observedAt || null,
  };
}

function deriveFairPriceCategory(currentPrice, referencePrice, sampleCount) {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(referencePrice) || referencePrice <= 0 || sampleCount < 2) {
    return "no-history";
  }

  const ratio = currentPrice / referencePrice;
  if (ratio <= 0.92) return "cheap";
  if (ratio >= 1.08) return "overpriced";
  return "fair";
}

function getFairPriceLabel(category) {
  if (category === "cheap") return "Cheap";
  if (category === "overpriced") return "Overpriced";
  if (category === "fair") return "Near median";
  return "New";
}

function buildPriceHistoryStats(entries, currentPrice, now = Date.now()) {
  const history = trimPriceHistory(entries, now);
  const window3d = buildPriceWindowStats(history, 3 * 24 * 60 * 60 * 1000, now);
  const window7d = buildPriceWindowStats(history, 7 * 24 * 60 * 60 * 1000, now);
  const window30d = buildPriceWindowStats(history, PRICE_HISTORY_MAX_AGE_MS, now);
  const referenceWindow = window30d.sampleCount >= 2
    ? { key: "30d", stats: window30d }
    : window7d.sampleCount >= 2
      ? { key: "7d", stats: window7d }
      : window3d.sampleCount >= 2
        ? { key: "3d", stats: window3d }
        : { key: "30d", stats: window30d };
  const hasReferenceHistory = referenceWindow.stats.sampleCount >= 2;
  const referencePrice = hasReferenceHistory ? Number(referenceWindow.stats.medianPrice) : NaN;
  const safeCurrentPrice = Number(currentPrice);
  const deltaPercent =
    Number.isFinite(safeCurrentPrice) &&
    safeCurrentPrice > 0 &&
    Number.isFinite(referencePrice) &&
    referencePrice > 0
      ? ((safeCurrentPrice - referencePrice) / referencePrice) * 100
      : NaN;
  const category = deriveFairPriceCategory(safeCurrentPrice, referencePrice, referenceWindow.stats.sampleCount);

  return {
    history,
    totalSamples: history.length,
    window3d,
    window7d,
    window30d,
    referenceWindow: referenceWindow.key,
    referencePrice,
    deltaPercent,
    category,
    label: getFairPriceLabel(category),
  };
}

function buildAggregateFairPriceData(miners, fallbackPrice) {
  const normalizedMiners = Array.isArray(miners) ? miners.filter(Boolean) : [];
  const eligibleMiners = normalizedMiners.filter((miner) => {
    const referencePrice = Number(miner?.priceHistoryStats?.referencePrice);
    const sampleCount = Number(miner?.priceHistoryStats?.totalSamples);
    return Number.isFinite(referencePrice) && referencePrice > 0 && Number.isFinite(sampleCount) && sampleCount >= 2;
  });
  const aggregateReferencePrice = eligibleMiners.reduce((sum, miner) => {
    const referencePrice = Number(miner?.priceHistoryStats?.referencePrice);
    return Number.isFinite(referencePrice) && referencePrice > 0 ? sum + referencePrice : sum;
  }, 0);
  const aggregateSampleCount = eligibleMiners.reduce((sum, miner) => {
    const sampleCount = Number(miner?.priceHistoryStats?.totalSamples);
    return Number.isFinite(sampleCount) ? sum + sampleCount : sum;
  }, 0);
  const safePrice = Number(fallbackPrice);
  const hasFullCoverage = normalizedMiners.length > 0 && eligibleMiners.length === normalizedMiners.length;
  const deltaPercent =
    hasFullCoverage &&
    Number.isFinite(safePrice) &&
    safePrice > 0 &&
    aggregateReferencePrice > 0
      ? ((safePrice - aggregateReferencePrice) / aggregateReferencePrice) * 100
      : NaN;
  const category = hasFullCoverage
    ? deriveFairPriceCategory(safePrice, aggregateReferencePrice, aggregateSampleCount)
    : "no-history";

  return {
    referencePrice: hasFullCoverage ? aggregateReferencePrice : NaN,
    deltaPercent,
    category,
    label: getFairPriceLabel(category),
    totalSamples: aggregateSampleCount,
  };
}

function getMinerDisplayLevelFromRaw(value) {
  const parsed = firstFinite([value]);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed) + 1;
}

function buildMinerLevelBadgeUrl(displayLevel) {
  const parsed = firstFinite([displayLevel]);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return `https://rollercoin.com/static/img/storage/rarity_icons/level_${Math.floor(parsed)}.png?v=1.0.0`;
}

function normalizeMinerIdentityName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function getMinerDisplayLevelValue(miner) {
  const level = firstFinite([miner?.level]);
  if (!Number.isFinite(level) || level <= 0) return null;
  return Math.floor(level);
}

function getMinerWidthIdentityValue(miner) {
  const width = firstFinite([miner?.width]);
  if (!Number.isFinite(width) || width <= 0) return null;
  return Math.floor(width);
}

function getMinerPowerIdentityValue(miner) {
  const power = firstFinite([miner?.power]);
  if (!Number.isFinite(power) || power <= 0) return null;
  return Math.round(power * 1_000_000);
}

function getMinerBonusIdentityValue(miner) {
  const bonusPercent = firstFinite([miner?.bonusPercent]);
  if (!Number.isFinite(bonusPercent) || bonusPercent < 0) return null;
  return Math.round(bonusPercent * 100);
}

function getMinerSpecsIdentityKey(miner) {
  const name = normalizeMinerIdentityName(miner?.name);
  if (!name) return "";

  const width = getMinerWidthIdentityValue(miner);
  const power = getMinerPowerIdentityValue(miner);
  const bonusPercent = getMinerBonusIdentityValue(miner);
  if (width === null || power === null || bonusPercent === null) return "";

  return `${name}::w${width}::p${power}::b${bonusPercent}`;
}

function getMinerIdentityKeys(miner) {
  const name = normalizeMinerIdentityName(miner?.name);
  if (!name) return [];

  const keys = new Set();
  const level = getMinerDisplayLevelValue(miner);
  if (level !== null) {
    keys.add(`${name}::l${level}`);
  }

  const specsKey = getMinerSpecsIdentityKey(miner);
  if (specsKey) {
    keys.add(specsKey);
  }

  return [...keys];
}

function getMinerCandidateSources(rawItem, options = {}) {
  const roomRaw = options.roomRaw === true || rawItem?.__roomConfigRaw === true;
  const saleOrdersRaw = options.saleOrdersRaw === true || rawItem?.__saleOrdersRaw === true;
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
    if (roomRaw && entry.__roomConfigRaw !== true) {
      entry.__roomConfigRaw = true;
    }
    if (saleOrdersRaw && entry.__saleOrdersRaw !== true) {
      entry.__saleOrdersRaw = true;
    }
    return true;
  });
}

function normalizeUrl(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:")) {
    return trimmed;
  }
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `https://rollercoin.com${trimmed}`;
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

function buildMarketImageUrlCandidatesFromName(item) {
  const name =
    pickText(getByPath(item, "item.name")) ||
    pickText(getByPath(item, "item_info.name")) ||
    pickText(getByPath(item, "product.name")) ||
    pickText(item?.name) ||
    "";
  const imageKey = buildMinerImageKeyFromName(name);
  if (!imageKey) return [];

  const imgVer =
    item?.img_ver ||
    getByPath(item, "item.img_ver") ||
    getByPath(item, "item_info.img_ver") ||
    getByPath(item, "product.img_ver") ||
    "";
  const suffixes = Number.isFinite(Number(imgVer)) ? [`?v=${Number(imgVer)}`, ""] : [""];
  const bases = [
    "https://static.rollercoin.com/static/img/market/miners/",
    "https://rollercoin.com/static/img/market/miners/",
  ];
  const extensions = [".gif", ".png", ".webp", ".jpg"];
  const candidates = [];

  bases.forEach((base) => {
    extensions.forEach((extension) => {
      suffixes.forEach((suffix) => {
        candidates.push(`${base}${encodeURIComponent(imageKey)}${extension}${suffix}`);
      });
    });
  });

  return candidates;
}

function buildMarketImageUrlCandidatesFromFilename(item) {
  const filename =
    item?.filename ||
    getByPath(item, "item.filename") ||
    getByPath(item, "item_info.filename") ||
    getByPath(item, "product.filename") ||
    "";
  if (!filename) return [];

  const imgVer =
    item?.img_ver ||
    getByPath(item, "item.img_ver") ||
    getByPath(item, "item_info.img_ver") ||
    getByPath(item, "product.img_ver") ||
    "";
  const safeFilename = encodeURIComponent(String(filename).trim());
  const suffixes = Number.isFinite(Number(imgVer)) ? [`?v=${Number(imgVer)}`, ""] : [""];
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

  return candidates;
}

function collectImageCandidates(item, rootItem = null) {
  const candidates = [
    item?.image_url,
    item?.imageUrl,
    item?.image,
    item?.img,
    item?.icon,
    getByPath(item, "item.image"),
    getByPath(item, "item.img"),
    getByPath(item, "item.icon"),
    getByPath(item, "item.picture"),
    getByPath(item, "item_info.image"),
    getByPath(item, "item_info.img"),
    getByPath(item, "product.image"),
    getByPath(item, "product.img"),
    getByPath(item, "product.icon"),
    getByPath(item, "miner.image"),
    getByPath(item, "sale.image"),
    getByPath(item, "raw.image_url"),
    getByPath(item, "raw.image"),
    ...(Array.isArray(item?.image_candidates) ? item.image_candidates : []),
    ...(Array.isArray(item?.imageCandidates) ? item.imageCandidates : []),
    rootItem?.image_url,
    rootItem?.imageUrl,
    rootItem?.image,
    rootItem?.img,
    ...(Array.isArray(rootItem?.image_candidates) ? rootItem.image_candidates : []),
    ...(Array.isArray(rootItem?.imageCandidates) ? rootItem.imageCandidates : []),
    ...buildMarketImageUrlCandidatesFromName(item),
    ...buildMarketImageUrlCandidatesFromName(rootItem),
    ...buildMarketImageUrlCandidatesFromFilename(item),
    ...buildMarketImageUrlCandidatesFromFilename(rootItem),
  ];

  const ranked = [];
  candidates.forEach((candidate) => {
    const normalized = normalizeUrl(candidate);
    if (!normalized) return;
    ranked.push({ normalized, score: 10000 - getImagePenalty(normalized) });
  });

  ranked.sort((left, right) => right.score - left.score);
  return [...new Set(ranked.map((entry) => entry.normalized))];
}

function getWidth(item) {
  const directWidth = firstFinite([
    item?.width,
    item?.size,
    item?.slotSize,
    item?.slot_size,
    item?.cell_width,
    item?.slots,
    getByPath(item, "item.width"),
    getByPath(item, "item.size"),
    getByPath(item, "item.slotSize"),
    getByPath(item, "item.slot_size"),
    getByPath(item, "item_info.width"),
    getByPath(item, "item_info.size"),
    getByPath(item, "item_info.slotSize"),
    getByPath(item, "item_info.slot_size"),
    getByPath(item, "product.width"),
    getByPath(item, "product.size"),
    getByPath(item, "product.slotSize"),
    getByPath(item, "product.slot_size"),
    getByPath(item, "placement.width"),
    getByPath(item, "placement.size"),
    getByPath(item, "placement.slotSize"),
    getByPath(item, "placement.slot_size"),
    getByPath(item, "miner.width"),
    getByPath(item, "miner.size"),
  ]);
  if (Number.isFinite(directWidth) && directWidth > 0) return Math.floor(directWidth);

  const textCandidates = [
    item?.width,
    item?.size,
    item?.slotSize,
    item?.slot_size,
    getByPath(item, "item.width"),
    getByPath(item, "item.size"),
    getByPath(item, "item_info.width"),
    getByPath(item, "item_info.size"),
    getByPath(item, "product.width"),
    getByPath(item, "product.size"),
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);

  if (textCandidates.some((value) => ["small", "1", "1x1"].includes(value))) return 1;
  if (textCandidates.some((value) => ["large", "2", "2x1"].includes(value))) return 2;
  return null;
}

function extractBonusPercent(item, options = {}) {
  const saleOrdersRaw = options.saleOrdersRaw === true || item?.__saleOrdersRaw === true;
  const roomRaw = options.roomRaw === true || item?.__roomConfigRaw === true;
  const sourceSignature = String(item?.source || "").trim().toLowerCase();
  const normalizeNonRoomMarketBonus = (value) => {
    if (!Number.isFinite(value)) return 0;
    if (Number.isInteger(value) && value >= 100) return value / 100;
    return value;
  };
  const directBonus = firstFinite([
    item?.bonusPercent,
    item?.miner_bonus,
    item?.percent_bonus,
    item?.bonus_percent,
    item?.bonus,
    getByPath(item, "price.bonusPercent"),
    getByPath(item, "price.miner_bonus"),
    getByPath(item, "item.bonusPercent"),
    getByPath(item, "item.miner_bonus"),
    getByPath(item, "item.percent_bonus"),
    getByPath(item, "item.bonus_percent"),
    getByPath(item, "item_info.bonusPercent"),
    getByPath(item, "item_info.miner_bonus"),
    getByPath(item, "item_info.percent_bonus"),
    getByPath(item, "item_info.bonus_percent"),
    getByPath(item, "miner.bonusPercent"),
    getByPath(item, "miner.miner_bonus"),
    getByPath(item, "miner.percent_bonus"),
    getByPath(item, "miner.bonus_percent"),
    getByPath(item, "sale.bonusPercent"),
    getByPath(item, "sale.miner_bonus"),
    getByPath(item, "sale.percent_bonus"),
    getByPath(item, "sale.bonus_percent"),
    getByPath(item, "product.bonusPercent"),
    getByPath(item, "product.miner_bonus"),
    getByPath(item, "product.percent_bonus"),
    getByPath(item, "product.bonus_percent"),
    getByPath(item, "raw.bonusPercent"),
    getByPath(item, "raw.miner_bonus"),
    getByPath(item, "raw.percent_bonus"),
    getByPath(item, "raw.bonus_percent"),
  ]);
  if (Number.isFinite(directBonus)) {
    if (saleOrdersRaw) {
      return directBonus / 100;
    }
    if (roomRaw) {
      if (directBonus >= 1000000) return directBonus / 10000;
      if (Number.isInteger(directBonus)) return directBonus / 100;
    }
    if (
      Number.isInteger(directBonus) &&
      directBonus >= 100 &&
      (
        sourceSignature.includes("first-offer") ||
        sourceSignature.includes("interactive-snapshot")
      )
    ) {
      return directBonus / 100;
    }
    return directBonus;
  }

  const nestedBonus = firstFinite([
    getByPath(item, "bonus.powerPercent"),
    getByPath(item, "bonus.power_percent"),
    getByPath(item, "item.bonus.powerPercent"),
    getByPath(item, "item.bonus.power_percent"),
    getByPath(item, "item_info.bonus.powerPercent"),
    getByPath(item, "item_info.bonus.power_percent"),
    getByPath(item, "miner.bonus.powerPercent"),
    getByPath(item, "miner.bonus.power_percent"),
    getByPath(item, "sale.bonus.powerPercent"),
    getByPath(item, "sale.bonus.power_percent"),
    getByPath(item, "product.bonus.powerPercent"),
    getByPath(item, "product.bonus.power_percent"),
    getByPath(item, "raw.bonus.powerPercent"),
    getByPath(item, "raw.bonus.power_percent"),
  ]);
  if (!Number.isFinite(nestedBonus)) return 0;
  if (saleOrdersRaw || roomRaw) return nestedBonus / 100;
  return normalizeNonRoomMarketBonus(nestedBonus);
}

function extractMinerLevel(item, { roomRaw = false } = {}) {
  const parsed = firstFinite([
    item?.level,
    getByPath(item, "item.level"),
    getByPath(item, "item_info.level"),
    getByPath(item, "product.level"),
  ]);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return getMinerDisplayLevelFromRaw(parsed);
}

function extractRoomPower(item) {
  const rawPower = firstFinite([
    getByPath(item, "product.power"),
    getByPath(item, "item.power"),
    getByPath(item, "miner.power"),
    getByPath(item, "sale.power"),
    getByPath(item, "itemInfo.power"),
    getByPath(item, "item_info.power"),
    item?.power,
    item?.hashrate,
    item?.hash_rate,
  ]);
  if (!Number.isFinite(rawPower) || rawPower <= 0) return NaN;
  return rawPower / 1000000;
}

function extractMarketPower(item) {
  const power = firstFinite([
    item?.power,
    item?.hashrate,
    getByPath(item, "item.power"),
    getByPath(item, "item_info.power"),
    getByPath(item, "product.power"),
  ]);
  return Number.isFinite(power) && power > 0 ? power : NaN;
}

function extractMarketPrice(item) {
  const price = firstFinite([
    item?.price,
    item?.cost,
    item?.amount,
    item?.price_value,
    item?.rlt_price,
    getByPath(item, "price.value"),
    getByPath(item, "item.price"),
    getByPath(item, "item_info.price"),
    getByPath(item, "product.price"),
  ]);
  return Number.isFinite(price) && price > 0 ? price : NaN;
}

function buildNormalizedMinerBase(item, index, fallbackName, options = {}) {
  if (!item || typeof item !== "object") return null;

  const candidates = getMinerCandidateSources(item, { roomRaw: !options.market });
  for (const candidate of candidates) {
    const power = options.market ? extractMarketPower(candidate) : extractRoomPower(candidate);
    if (!Number.isFinite(power) || power <= 0) continue;

    const price = options.market ? extractMarketPrice(candidate) : NaN;
    if (options.market && (!Number.isFinite(price) || price <= 0)) continue;

    const bonusPercent = extractBonusPercent(candidate, { roomRaw: !options.market });
    const name =
      pickText(getByPath(candidate, "product.name")) ||
      pickText(getByPath(candidate, "item.name")) ||
      pickText(getByPath(candidate, "item_info.name")) ||
      pickText(candidate?.name) ||
      fallbackName;
    const imageCandidates = collectImageCandidates(candidate, item);
    const imageUrl = imageCandidates[0] || "";
    const level =
      extractMinerLevel(candidate, { roomRaw: !options.market }) ??
      extractMinerLevel(item, { roomRaw: !options.market });
    const levelBadgeUrl =
      buildMinerLevelBadgeUrl(level) ||
      normalizeUrl(candidate?.level_badge_url || candidate?.levelBadgeUrl) ||
      normalizeUrl(item?.level_badge_url || item?.levelBadgeUrl);

    return {
      id: String(
        candidate.id ||
        candidate.item_id ||
        candidate.offer_id ||
        candidate.order_id ||
        item.id ||
        item.item_id ||
        item.offer_id ||
        item.order_id ||
        `miner-${index + 1}`,
      ),
      name: String(name || fallbackName),
      power,
      bonusPercent: Number.isFinite(bonusPercent) ? bonusPercent : 0,
      level,
      width: getWidth(candidate) ?? getWidth(item),
      imageUrl,
      imageCandidates,
      levelBadgeUrl,
      currency:
        candidate?.currency ||
        candidate?.price_currency ||
        getByPath(candidate, "price.currency") ||
        item?.currency ||
        item?.price_currency ||
        getByPath(item, "price.currency") ||
        "RLT",
      extractedPrice: options.market ? price : NaN,
    };
  }

  return null;
}

export function normalizeRoomMiners(rawItems) {
  const seenIds = new Set();
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((item, index) => {
      const miner = buildNormalizedMinerBase(item, index, "Room miner", { market: false });
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

function getMarketVariantSignature(miner) {
  return [
    String(miner?.name || "").trim().toLowerCase(),
    Number.isFinite(Number(miner?.power)) ? Number(miner.power) : "na",
    Number.isFinite(Number(miner?.width)) ? Math.floor(Number(miner.width)) : "na",
    Number.isFinite(Number(miner?.level)) ? Math.floor(Number(miner.level)) : "na",
  ].join("|");
}

function buildMarketVariantKey(miner, bonusPercent) {
  return `${String(miner?.name || "").trim().toLowerCase()}|${Number(miner?.power) || 0}|${bonusPercent}|${miner?.width || "na"}|${miner?.level || "na"}`;
}

function mergeNormalizedMarketVariant(existingMiner, nextMiner) {
  if (!existingMiner) return nextMiner;
  const existingPrice = Number(existingMiner?.price);
  const nextPrice = Number(nextMiner?.price);
  const takeNext =
    !Number.isFinite(existingPrice) ||
    (Number.isFinite(nextPrice) && nextPrice < existingPrice);
  const preferred = takeNext ? nextMiner : existingMiner;
  const secondary = takeNext ? existingMiner : nextMiner;

  return {
    ...secondary,
    ...preferred,
    firstSeenAt: Math.min(
      Number.isFinite(Number(existingMiner?.firstSeenAt)) ? Number(existingMiner.firstSeenAt) : Number.MAX_SAFE_INTEGER,
      Number.isFinite(Number(nextMiner?.firstSeenAt)) ? Number(nextMiner.firstSeenAt) : Number.MAX_SAFE_INTEGER,
    ),
    lastSeenAt: Math.max(Number(existingMiner?.lastSeenAt) || 0, Number(nextMiner?.lastSeenAt) || 0),
    lastPriceRefreshAt: Math.max(
      Number(existingMiner?.lastPriceRefreshAt) || 0,
      Number(nextMiner?.lastPriceRefreshAt) || 0,
    ),
    priceHistory: mergePriceHistory(existingMiner?.priceHistory, nextMiner?.priceHistory),
  };
}

function finalizeNormalizedMarketMiners(normalizedMiners) {
  const inferredBonusBySignature = new Map();
  normalizedMiners.forEach((miner) => {
    const bonusPercent = Number(miner?.bonusPercent);
    if (!Number.isFinite(bonusPercent) || bonusPercent <= 0) return;
    const signature = getMarketVariantSignature(miner);
    const existing = inferredBonusBySignature.get(signature);
    if (!Number.isFinite(existing) || bonusPercent > existing) {
      inferredBonusBySignature.set(signature, bonusPercent);
    }
  });

  const deduped = new Map();
  normalizedMiners.forEach((miner) => {
    const signature = getMarketVariantSignature(miner);
    const inferredBonus = inferredBonusBySignature.get(signature);
    const ownBonus = Number.isFinite(Number(miner?.bonusPercent)) ? Number(miner.bonusPercent) : 0;
    const resolvedBonusPercent = ownBonus > 0
      ? ownBonus
      : (Number.isFinite(inferredBonus) ? inferredBonus : 0);
    const resolvedMiner = {
      ...miner,
      bonusPercent: resolvedBonusPercent,
      variantKey: buildMarketVariantKey(miner, resolvedBonusPercent),
      effectivePower: Number(miner.power) * (1 + resolvedBonusPercent / 100),
      efficiency:
        Number(miner.price) > 0
          ? (Number(miner.power) * (1 + resolvedBonusPercent / 100)) / Number(miner.price)
          : NaN,
    };
    const priceHistoryStats = buildPriceHistoryStats(resolvedMiner.priceHistory, resolvedMiner.price);
    const enrichedMiner = {
      ...resolvedMiner,
      priceHistory: priceHistoryStats.history,
      priceHistoryStats,
      fairPriceCategory: priceHistoryStats.category,
      fairPriceLabel: priceHistoryStats.label,
      fairPriceReferencePrice: priceHistoryStats.referencePrice,
      fairPriceDeltaPercent: priceHistoryStats.deltaPercent,
    };
    deduped.set(
      enrichedMiner.variantKey,
      mergeNormalizedMarketVariant(deduped.get(enrichedMiner.variantKey), enrichedMiner),
    );
  });

  return [...deduped.values()].map((miner) => {
    const priceHistoryStats = buildPriceHistoryStats(miner.priceHistory, miner.price);
    return {
      ...miner,
      priceHistory: priceHistoryStats.history,
      priceHistoryStats,
      fairPriceCategory: priceHistoryStats.category,
      fairPriceLabel: priceHistoryStats.label,
      fairPriceReferencePrice: priceHistoryStats.referencePrice,
      fairPriceDeltaPercent: priceHistoryStats.deltaPercent,
    };
  });
}

export function normalizeMarketMiners(rawItems) {
  const normalized = (Array.isArray(rawItems) ? rawItems : [])
    .map((item, index) => {
      const miner = buildNormalizedMinerBase(item, index, "Marketplace miner", { market: true });
      const price = Number.isFinite(Number(miner?.extractedPrice))
        ? Number(miner.extractedPrice)
        : extractMarketPrice(item);
      if (!miner || !Number.isFinite(price) || price <= 0) return null;

      const now = Date.now();
      const { extractedPrice, ...baseMiner } = miner;
      return {
        ...baseMiner,
        sourceOfferId: miner.id,
        price,
        firstSeenAt: Number(item?.firstSeenAt) || now,
        lastSeenAt: Number(item?.lastSeenAt) || now,
        lastPriceRefreshAt: Number(item?.lastPriceRefreshAt) || now,
        priceHistory: trimPriceHistory(item?.priceHistory, now),
      };
    })
    .filter(Boolean);

  return finalizeNormalizedMarketMiners(normalized);
}

export function normalizeCachedMarketMiners(rawItems) {
  const normalized = (Array.isArray(rawItems) ? rawItems : [])
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;

      const price = Number(item?.price);
      const power = Number(item?.power);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(power) || power <= 0) {
        return null;
      }

      const level = firstFinite([item?.level]);
      const width = firstFinite([item?.width]);
      const bonusPercent = firstFinite([item?.bonusPercent, item?.bonus_percent]);
      const imageCandidates = collectImageCandidates(item);
      const imageUrl = imageCandidates[0] || normalizeUrl(item?.imageUrl || item?.image_url) || "";
      const normalizedLevel = Number.isFinite(level) && level > 0 ? Math.floor(level) : null;

      return {
        id: String(item?.id || item?.sourceOfferId || `miner-${index + 1}`),
        sourceOfferId: String(item?.sourceOfferId || item?.id || `miner-${index + 1}`),
        name: String(item?.name || "Marketplace miner"),
        power,
        bonusPercent: Number.isFinite(bonusPercent) && bonusPercent >= 0 ? bonusPercent : 0,
        level: normalizedLevel,
        width: Number.isFinite(width) && width > 0 ? Math.floor(width) : null,
        imageUrl,
        imageCandidates,
        levelBadgeUrl:
          buildMinerLevelBadgeUrl(normalizedLevel) ||
          normalizeUrl(item?.levelBadgeUrl || item?.level_badge_url),
        currency: typeof item?.currency === "string" && item.currency ? item.currency : "RLT",
        price,
        firstSeenAt: Number(item?.firstSeenAt) || Date.now(),
        lastSeenAt: Number(item?.lastSeenAt) || Date.now(),
        lastPriceRefreshAt: Number(item?.lastPriceRefreshAt) || Date.now(),
        priceHistory: trimPriceHistory(item?.priceHistory),
      };
    })
    .filter(Boolean);

  return finalizeNormalizedMarketMiners(normalized);
}

export function normalizeMarketSourceInfo(rawSourceInfo, fallbackScore = 0) {
  return {
    endpoint: rawSourceInfo?.endpoint || "cached",
    sourcePath: rawSourceInfo?.sourcePath || "memory-cache",
    sourceScore: Number.isFinite(Number(rawSourceInfo?.sourceScore))
      ? Number(rawSourceInfo.sourceScore)
      : fallbackScore,
    refreshMode: rawSourceInfo?.refreshMode === "quick" ? "quick" : "full",
    maxPages: Number.isFinite(Number(rawSourceInfo?.maxPages))
      ? Number(rawSourceInfo.maxPages)
      : MARKET_DIRECT_MAX_PAGES,
    loadedAt: Number.isFinite(Number(rawSourceInfo?.loadedAt))
      ? Number(rawSourceInfo.loadedAt)
      : Date.now(),
    fullRefreshedAt: Number.isFinite(Number(rawSourceInfo?.fullRefreshedAt))
      ? Number(rawSourceInfo.fullRefreshedAt)
      : null,
    quickRefreshedAt: Number.isFinite(Number(rawSourceInfo?.quickRefreshedAt))
      ? Number(rawSourceInfo.quickRefreshedAt)
      : null,
    catalogCount: Math.max(0, Math.floor(Number(rawSourceInfo?.catalogCount) || 0)),
    activeCount: Math.max(0, Math.floor(Number(rawSourceInfo?.activeCount) || 0)),
    cacheRestored: Boolean(rawSourceInfo?.cacheRestored),
  };
}

export function buildActiveMarketMinersFromCatalog(catalog) {
  return normalizeCachedMarketMiners(Array.isArray(catalog) ? catalog : []).filter((miner) =>
    Number.isFinite(Number(miner?.price)) &&
    Number(miner.price) > 0 &&
    Number.isFinite(Number(miner?.power)) &&
    Number(miner.power) > 0,
  );
}

export function mergeMarketMinerCatalog(existingCatalog, scannedMiners, options = {}) {
  const mode = options?.mode === "quick" ? "quick" : "full";
  const now = Date.now();
  const nextMap = new Map(
    (mode === "quick" ? normalizeCachedMarketMiners(existingCatalog) : []).map((miner) => [miner.variantKey, { ...miner }]),
  );

  normalizeMarketMiners(scannedMiners).forEach((miner) => {
    const existing = nextMap.get(miner.variantKey);
    nextMap.set(miner.variantKey, {
      ...(existing || {}),
      ...miner,
      firstSeenAt: existing?.firstSeenAt || miner.firstSeenAt || now,
      lastSeenAt: now,
      lastPriceRefreshAt: now,
      priceHistory: appendPriceObservation(
        mergePriceHistory(existing?.priceHistory, miner?.priceHistory, now),
        miner.price,
        now,
      ),
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

  return {
    catalog,
    activeMiners: buildActiveMarketMinersFromCatalog(catalog),
    sourceInfo,
  };
}

function getCachePath() {
  const fs = getFs();
  const path = getPath();
  const os = getOs();
  if (!fs || !path || !os) return "";

  const dir = path.join(os.homedir(), ".roller-coin-calculator");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Ignore cache directory creation failures.
  }

  return path.join(dir, CACHE_FILENAME);
}

export function restoreMarketMinersCache() {
  const fs = getFs();
  const filePath = getCachePath();
  if (!fs || !filePath) return null;

  try {
    if (!fs.existsSync(filePath)) return null;
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (Number(payload?.version) !== MARKET_MINERS_CACHE_VERSION) return null;
    const catalog = normalizeCachedMarketMiners(Array.isArray(payload?.catalog) ? payload.catalog : []);
    const activeMiners = buildActiveMarketMinersFromCatalog(catalog);
    if (catalog.length === 0 || activeMiners.length === 0) return null;

    return {
      catalog,
      activeMiners,
      sourceInfo: normalizeMarketSourceInfo(
        { ...(payload?.sourceInfo || {}), cacheRestored: true },
        activeMiners.length,
      ),
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
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          version: MARKET_MINERS_CACHE_VERSION,
          savedAt: Date.now(),
          sourceInfo: normalizeMarketSourceInfo(
            sourceInfo,
            Array.isArray(catalog) ? catalog.length : 0,
          ),
          catalog: Array.isArray(catalog) ? catalog : [],
        },
        null,
        0,
      ),
      "utf8",
    );
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
  if (!sourceInfo) {
    return [{
      mode: "full",
      maxPages: MARKET_DIRECT_MAX_PAGES,
      includeAttempts: true,
      label: "Initial full market sync",
    }];
  }

  const plan = [{
    mode: "quick",
    maxPages: MARKET_QUICK_REFRESH_PAGE_LIMIT,
    includeAttempts: false,
    label: "Quick market refresh",
  }];

  if (shouldRunFullMarketRefresh(sourceInfo)) {
    plan.push({
      mode: "full",
      maxPages: MARKET_DIRECT_MAX_PAGES,
      includeAttempts: true,
      label: "Full market reconciliation",
    });
  }

  return plan;
}

export function appendMarketLog(logs, message, level = "info", timestamp = Date.now()) {
  const time = new Date(timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
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
  return getMinerIdentityKeys(miner)[0] || "";
}

function hasOwnedMinerMatch(miner, ownedMinerKeys) {
  if (!(ownedMinerKeys instanceof Set) || ownedMinerKeys.size === 0) return false;
  return getMinerIdentityKeys(miner).some((key) => ownedMinerKeys.has(key));
}

function reconcileMarketMinerLevelsWithRoomMiners(marketMiners, roomMiners) {
  if (!Array.isArray(marketMiners) || marketMiners.length === 0) return [];
  if (!Array.isArray(roomMiners) || roomMiners.length === 0) return [...marketMiners];

  const roomMinerBySpecsKey = new Map();
  roomMiners.forEach((miner) => {
    const specsKey = getMinerSpecsIdentityKey(miner);
    if (!specsKey) return;

    const currentLevel = getMinerDisplayLevelValue(miner);
    const existing = roomMinerBySpecsKey.get(specsKey);
    const existingLevel = getMinerDisplayLevelValue(existing);
    if (!existing || (currentLevel !== null && (existingLevel === null || currentLevel > existingLevel))) {
      roomMinerBySpecsKey.set(specsKey, miner);
    }
  });

  return marketMiners.map((miner) => {
    const specsKey = getMinerSpecsIdentityKey(miner);
    if (!specsKey) return miner;

    const roomMiner = roomMinerBySpecsKey.get(specsKey);
    if (!roomMiner) return miner;

    const roomLevel = getMinerDisplayLevelValue(roomMiner);
    const marketLevel = getMinerDisplayLevelValue(miner);
    if (marketLevel !== null || roomLevel === null) return miner;

    return {
      ...miner,
      level: roomLevel,
      levelBadgeUrl: buildMinerLevelBadgeUrl(roomLevel) || miner?.levelBadgeUrl || "",
    };
  });
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
    fairPriceCategory: typeof miner?.fairPriceCategory === "string" ? miner.fairPriceCategory : "no-history",
    fairPriceLabel: typeof miner?.fairPriceLabel === "string" ? miner.fairPriceLabel : "New",
    fairPriceReferencePrice: Number.isFinite(Number(miner?.fairPriceReferencePrice)) ? Number(miner.fairPriceReferencePrice) : NaN,
    fairPriceDeltaPercent: Number.isFinite(Number(miner?.fairPriceDeltaPercent)) ? Number(miner.fairPriceDeltaPercent) : NaN,
    priceHistoryStats: miner?.priceHistoryStats && typeof miner.priceHistoryStats === "object"
      ? { ...miner.priceHistoryStats }
      : null,
  };
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

function getMarketMinerOfferKey(miner) {
  const id = String(miner?.id || "");
  const price = Number(miner?.price) || 0;
  const power = Number(miner?.power) || 0;
  const bonusPercent = Number(miner?.bonusPercent) || 0;
  return `${id}:${price}:${power}:${bonusPercent}`;
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
  if (sortMode === "fairPrice") {
    const leftDelta = Number(leftItem?.fairPriceDeltaPercent);
    const rightDelta = Number(rightItem?.fairPriceDeltaPercent);
    const leftSortValue = Number.isFinite(leftDelta) ? leftDelta : Number.POSITIVE_INFINITY;
    const rightSortValue = Number.isFinite(rightDelta) ? rightDelta : Number.POSITIVE_INFINITY;
    if (leftSortValue !== rightSortValue) return leftSortValue - rightSortValue;
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
  const fairPriceData = buildAggregateFairPriceData(normalizedPurchaseMiners, numericPrice);

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
    fairPriceCategory: fairPriceData.category,
    fairPriceLabel: fairPriceData.label,
    fairPriceReferencePrice: fairPriceData.referencePrice,
    fairPriceDeltaPercent: fairPriceData.deltaPercent,
    fairPriceHistorySamples: fairPriceData.totalSamples,
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
  marketMiners,
  budget,
  maxMinerPrice,
  roomWidthMode,
  roomMiners,
  ownedRoomMinerKeys,
}) {
  const hasBudgetFilter = budget !== null;
  const hasMaxPriceFilter = maxMinerPrice !== null;
  const hasWidthFilter = roomWidthMode !== "any";
  const hideOwnedRoomMiners = roomMiners.length > 0 && ownedRoomMinerKeys.size > 0;

  return marketMiners.filter((miner) => {
    const price = Number(miner?.price);
    if (hasBudgetFilter && (!Number.isFinite(price) || price > budget)) return false;
    if (hasMaxPriceFilter && (!Number.isFinite(price) || price > maxMinerPrice)) return false;
    if (hasWidthFilter && String(miner?.width || "") !== roomWidthMode) return false;
    if (hideOwnedRoomMiners && hasOwnedMinerMatch(miner, ownedRoomMinerKeys)) return false;
    return true;
  });
}

function buildRoomReplacementSets(roomMiners, strategy = "strict") {
  const roomMinerMaskById = new Map(
    roomMiners.map((miner, index) => [String(miner?.id || `room-miner-${index + 1}`), 1n << BigInt(index)]),
  );
  const buildRemovedMask = (miners) =>
    miners.reduce((mask, miner) => {
      const minerKey = String(miner?.id || "");
      return mask | (roomMinerMaskById.get(minerKey) || 0n);
    }, 0n);

  const singles = roomMiners
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
  const smallMiners = roomMiners.filter((miner) => Math.floor(Number(miner?.width || 0)) === 1);
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
        replaceTextOverride: minerWidth ? `No room miner found for width ${minerWidth}` : "Width not detected",
      });
    })
    .filter(Boolean);

  return sortRecommendationItems(singleItems, sortMode);
}

function hasMeaningfulPositiveGain(gainPowerPhs) {
  if (!Number.isFinite(gainPowerPhs)) return false;
  return gainPowerPhs > MIN_GAIN_PHS;
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

  addItems(
    [...positiveSingles]
      .sort((leftItem, rightItem) => compareByGainThenEfficiencyDesc(leftItem, rightItem))
      .slice(0, BUDGET_COMBINATION_BUY_POOL_LIMIT),
  );
  addItems(
    [...positiveSingles]
      .sort((leftItem, rightItem) => compareRecommendationItems(leftItem, rightItem, "gainPerPrice"))
      .slice(0, BUDGET_COMBINATION_BUY_POOL_LIMIT),
  );
  addItems(
    [...positiveSingles]
      .sort(
        (leftItem, rightItem) =>
          leftItem.price - rightItem.price || compareByGainThenEfficiencyDesc(leftItem, rightItem),
      )
      .slice(0, Math.max(18, Math.floor(BUDGET_COMBINATION_BUY_POOL_LIMIT / 3))),
  );

  if (budget === null) {
    addItems(
      [...positiveSingles]
        .sort(
          (leftItem, rightItem) =>
            rightItem.price - leftItem.price || compareByGainThenEfficiencyDesc(leftItem, rightItem),
        )
        .slice(0, Math.max(18, Math.floor(BUDGET_COMBINATION_BUY_POOL_LIMIT / 3))),
    );
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

function buildBudgetReplacementSetMap(roomMiners, currentSystem, maxWidth) {
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
    roomMiners.map((miner, index) => [String(miner?.id || `room-miner-${index + 1}`), 1n << BigInt(index)]),
  );
  const roomMinerEntries = roomMiners
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
    if (!Number.isFinite(Number(width)) || Number(width) <= 0 || !Array.isArray(bucket) || bucket.length === 0) {
      return;
    }
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

function buildBudgetCombinationOptions({ budget, buyPool }) {
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
    .sort((leftState, rightState) =>
      compareByGainThenEfficiencyDesc(leftState.recommendation, rightState.recommendation))
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
  const atomicOptions = buildBudgetCombinationOptions({ budget, buyPool });
  if (atomicOptions.length < 2) {
    return [];
  }

  const minOptionPrice = Math.min(...atomicOptions.map((item) => item.price));
  const maxDepth = hasBudgetLimit
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

function sortRoomMinersInternal(miners, sortMode, searchQuery) {
  const normalizedSearch = String(searchQuery || "").trim().toLowerCase();
  const filtered = normalizedSearch
    ? miners.filter((miner) =>
      [miner.name, miner.level ? `l${miner.level}` : "", miner.width ? `width ${miner.width}` : ""]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch))
    : [...miners];

  filtered.sort((left, right) => {
    if (sortMode === "bonusDesc") return (Number(right.bonusPercent) || 0) - (Number(left.bonusPercent) || 0);
    if (sortMode === "widthAsc") return (Number(left.width) || 0) - (Number(right.width) || 0);
    if (sortMode === "nameAsc") {
      return String(left.name || "").localeCompare(String(right.name || ""), "en", { sensitivity: "base" });
    }
    return (Number(right.power) || 0) - (Number(left.power) || 0);
  });

  return filtered;
}

export function sortRoomMinersCollection(miners, sortMode = "powerDesc", searchQuery = "") {
  return sortRoomMinersInternal(miners, sortMode, searchQuery);
}

function emptyRecommendations(error, roomMinersSorted, roomMinersCount) {
  return {
    error,
    items: [],
    allItems: [],
    upgradeItems: [],
    cheaperUpgradeItems: [],
    maxPowerUpgradeItems: [],
    roomMinersSorted,
    marketSummary: "",
    replacementEnabled: false,
    replacementPendingRoomLoad: false,
    replacementRequested: false,
    replacementStrategy: "off",
    recommendationMode: "budget",
    sortMode: "gainPerPrice",
    budget: null,
    bundleCount: 0,
    recommendedCount: 0,
    totalMatched: 0,
    roomMinersCount,
    filteredMarketMinersCount: 0,
    overlappingOwnedCount: 0,
  };
}

export function buildMarketRecommendations({
  currentSystemState,
  marketMiners,
  roomMiners,
  marketSettings,
  marketSourceInfo,
}) {
  const currentSystem = getCurrentSystemSnapshot(currentSystemState);
  const reconciledMarketMiners = reconcileMarketMinerLevelsWithRoomMiners(marketMiners, roomMiners);
  const roomMinersSorted = sortRoomMinersInternal(
    roomMiners,
    marketSettings.roomMinersSortMode,
    marketSettings.roomMinersSearch,
  );

  if (!currentSystem) {
    return emptyRecommendations(
      "Current system is invalid. Sync RollerCoin power or enter valid base power and bonus.",
      roomMinersSorted,
      roomMiners.length,
    );
  }

  const budget = marketSettings.budget.trim() ? parseNumber(marketSettings.budget) : null;
  const maxMinerPrice = marketSettings.maxMinerPrice.trim() ? parseNumber(marketSettings.maxMinerPrice) : null;
  const topN = marketSettings.topN.trim()
    ? Math.max(1, Math.floor(parseNumber(marketSettings.topN) || 0))
    : null;

  if (Number.isNaN(budget)) {
    return emptyRecommendations("Invalid budget value. Enter a non-negative number.", roomMinersSorted, roomMiners.length);
  }
  if (Number.isNaN(maxMinerPrice)) {
    return emptyRecommendations("Invalid max price value. Enter a non-negative number.", roomMinersSorted, roomMiners.length);
  }

  const recommendationMode = marketSettings.recommendationMode === "budget" ? "budget" : "single";
  const replacementRequested = marketSettings.replacementStrategy !== "off";
  const replacementStrategy = marketSettings.replacementStrategy === "flex" ? "flex" : "strict";
  const replacementEnabled = replacementRequested && roomMiners.length > 0;
  const replacementPendingRoomLoad = replacementRequested && roomMiners.length === 0;
  const ownedRoomMinerKeys = new Set(roomMiners.flatMap((miner) => getMinerIdentityKeys(miner)));
  const overlappingOwnedCount = reconciledMarketMiners.filter((miner) =>
    hasOwnedMinerMatch(miner, ownedRoomMinerKeys)).length;

  const filteredMarketMiners = buildFilteredMarketMiners({
    marketMiners: reconciledMarketMiners,
    budget,
    maxMinerPrice,
    roomWidthMode: marketSettings.roomWidthMode,
    roomMiners,
    ownedRoomMinerKeys,
  });

  const totalCurrentThs = getCurrentTotal(currentSystem.baseThs, currentSystem.bonusPercent);
  const roomReplacementSets = replacementEnabled ? buildRoomReplacementSets(roomMiners, replacementStrategy) : [];
  const singleItems = buildSingleRecommendationItems({
    filteredMarketMiners,
    currentSystem,
    totalCurrentThs,
    replacementEnabled,
    roomReplacementSets,
    sortMode: marketSettings.sortMode,
  });

  let allItems = singleItems;
  let bundleItems = [];

  if (recommendationMode === "budget") {
    const positivePrices = filteredMarketMiners
      .map((miner) => Number(miner?.price))
      .filter((price) => Number.isFinite(price) && price > 0);
    const minFilteredPrice = positivePrices.length > 0 ? Math.min(...positivePrices) : NaN;
    const maxBudgetDepth = budget === null
      ? BUDGET_COMBINATION_UNLIMITED_MAX_DEPTH
      : Number.isFinite(minFilteredPrice) && minFilteredPrice > 0
        ? Math.max(
          2,
          Math.min(BUDGET_COMBINATION_UNLIMITED_MAX_DEPTH, Math.floor(budget / Math.max(minFilteredPrice, 0.01))),
        )
        : 2;
    const maxMarketWidth = Math.max(
      0,
      ...filteredMarketMiners.map((miner) =>
        (Number.isFinite(Number(miner?.width)) ? Math.floor(Number(miner.width)) : 0)),
    );
    const replacementSetsByWidth = replacementEnabled
      ? buildBudgetReplacementSetMap(roomMiners, currentSystem, Math.max(maxMarketWidth * maxBudgetDepth, maxMarketWidth))
      : new Map();
    const budgetSingleItems = buildBudgetModeSingleItems({
      filteredMarketMiners,
      currentSystem,
      totalCurrentThs,
      replacementEnabled,
      replacementSetsByWidth,
      sortMode: marketSettings.sortMode,
    });
    bundleItems = buildBudgetCombinationItems({
      budget,
      singleItems: budgetSingleItems,
      currentSystem,
      totalCurrentThs,
      replacementEnabled,
      replacementSetsByWidth,
      sortMode: marketSettings.sortMode,
    });
    allItems = sortRecommendationItems([...budgetSingleItems, ...bundleItems], marketSettings.sortMode);
  } else {
    allItems = sortRecommendationItems(singleItems, marketSettings.sortMode);
  }

  const upgradeItems = allItems.filter((miner) => hasMeaningfulPositiveGain(miner.gainPower));
  const items = topN === null ? upgradeItems : upgradeItems.slice(0, topN);
  const cheaperUpgradeItems = [...upgradeItems]
    .filter((miner) => typeof miner?.replaceText === "string" && miner.replaceText !== "-")
    .filter((miner) => !/^No room miner found/i.test(miner.replaceText))
    .filter((miner) => !/^Width not detected/i.test(miner.replaceText))
    .sort((leftMiner, rightMiner) => {
      if (rightMiner.gainPerPrice !== leftMiner.gainPerPrice) {
        return rightMiner.gainPerPrice - leftMiner.gainPerPrice;
      }
      if (rightMiner.gainPower !== leftMiner.gainPower) {
        return rightMiner.gainPower - leftMiner.gainPower;
      }
      return leftMiner.price - rightMiner.price;
    })
    .slice(0, 5);
  const maxPowerUpgradeItems = [...upgradeItems]
    .filter((miner) => typeof miner?.replaceText === "string" && miner.replaceText !== "-")
    .filter((miner) => !/^No room miner found/i.test(miner.replaceText))
    .filter((miner) => !/^Width not detected/i.test(miner.replaceText))
    .sort((leftMiner, rightMiner) => {
      if (rightMiner.gainPower !== leftMiner.gainPower) {
        return rightMiner.gainPower - leftMiner.gainPower;
      }
      if (rightMiner.gainPerPrice !== leftMiner.gainPerPrice) {
        return rightMiner.gainPerPrice - leftMiner.gainPerPrice;
      }
      return leftMiner.price - rightMiner.price;
    })
    .slice(0, 5);

  const budgetText = budget === null
    ? recommendationMode === "budget"
      ? "unlimited"
      : "not set"
    : formatMarketValue(budget, 2);
  const maxPriceText = maxMinerPrice === null ? "not set" : formatMarketValue(maxMinerPrice, 2);
  const currentBaseText = formatPowerFromPhs(currentSystem.basePhs, currentSystem.displayUnit);
  const currentBonusText = `${formatMarketValue(currentSystem.bonusPercent, 2)}%`;
  const sortModeText =
    marketSettings.sortMode === "gainPower"
      ? "gain to system"
      : marketSettings.sortMode === "fairPrice"
        ? "fair price first"
        : "gain per RLT";
  const recommendationModeText = recommendationMode === "budget" ? "budget combinations" : "single purchase";
  const roomWidthText = marketSettings.roomWidthMode === "1"
    ? "small only"
    : marketSettings.roomWidthMode === "2"
      ? "large only"
      : "any";
  const replacementText = replacementEnabled
    ? recommendationMode === "budget"
      ? "on (budget slots)"
      : replacementStrategy === "flex"
        ? "on (flex)"
        : "on (strict)"
    : replacementPendingRoomLoad
      ? "pending room miners"
      : "off";
  const marketSummary =
    `Matched: ${allItems.length}; profitable upgrades: ${upgradeItems.length}; budget: ${budgetText}; max price/miner: ${maxPriceText}; ` +
    `sort: ${sortModeText}; mode: ${recommendationModeText}; bundles: ${bundleItems.length}; room miners: ${roomMiners.length}; hidden owned: ${overlappingOwnedCount}; width: ${roomWidthText}; replacement: ${replacementText}; ` +
    `current base: ${currentBaseText}; current bonus: ${currentBonusText}; ` +
    `source: ${marketSourceInfo?.endpoint || "cached"}; refresh: ${marketSourceInfo?.refreshMode || "full"}; updated: ${marketSourceInfo?.loadedAt ? new Date(Number(marketSourceInfo.loadedAt)).toLocaleString("en-US") : "unknown"}.`;

  return {
    error: null,
    items,
    allItems,
    upgradeItems,
    cheaperUpgradeItems,
    maxPowerUpgradeItems,
    roomMinersSorted,
    marketSummary,
    replacementEnabled,
    replacementPendingRoomLoad,
    replacementRequested,
    replacementStrategy,
    recommendationMode,
    sortMode: marketSettings.sortMode,
    budget,
    bundleCount: bundleItems.length,
    recommendedCount: upgradeItems.length,
    totalMatched: allItems.length,
    roomMinersCount: roomMiners.length,
    filteredMarketMinersCount: filteredMarketMiners.length,
    overlappingOwnedCount,
  };
}
