import { formatMarketValue } from "./power";
import { getIpcRenderer } from "./runtime";

export const DEFAULT_LEAGUE_ID = "68af01ce48490927df92d67f";
export const BLOCKS_PER_HOUR = 6;
export const BLOCKS_PER_DAY = 24 * BLOCKS_PER_HOUR;
export const BLOCKS_PER_MONTH = 30 * BLOCKS_PER_DAY;
export const PROFITABILITY_HISTORY_STORAGE_KEY = "rollercoin.profitability.history.v1";
export const PROFITABILITY_HISTORY_LIMIT = 120;

const CURRENCY_CONFIG = {
  RLT: {
    symbol: "RLT",
    name: "RollerToken",
    icon: "rlt",
    divisor: 1_000_000,
    fixedUsdPrice: 1,
    marketId: null,
  },
  SAT: {
    symbol: "BTC",
    name: "Bitcoin",
    icon: "btc",
    divisor: 10_000_000_000,
    marketId: "bitcoin",
  },
  LTC_SMALL: {
    symbol: "LTC",
    name: "Litecoin",
    icon: "ltc",
    divisor: 100_000_000,
    marketId: "litecoin",
  },
  BNB_SMALL: {
    symbol: "BNB",
    name: "BNB",
    icon: "bnb",
    divisor: 10_000_000_000,
    marketId: "binancecoin",
  },
  MATIC_SMALL: {
    symbol: "MATIC",
    name: "Polygon",
    icon: "matic",
    divisor: 10_000_000_000,
    marketId: "polygon-ecosystem-token",
  },
  XRP_SMALL: {
    symbol: "XRP",
    name: "XRP",
    icon: "xrp",
    divisor: 1_000_000,
    marketId: "ripple",
  },
  DOGE_SMALL: {
    symbol: "DOGE",
    name: "Dogecoin",
    icon: "doge",
    divisor: 10_000,
    marketId: "dogecoin",
  },
  ETH_SMALL: {
    symbol: "ETH",
    name: "Ethereum",
    icon: "eth",
    divisor: 10_000_000_000,
    marketId: "ethereum",
  },
  TRX_SMALL: {
    symbol: "TRX",
    name: "TRON",
    icon: "trx",
    divisor: 10_000_000_000,
    marketId: "tron",
  },
  SOL_SMALL: {
    symbol: "SOL",
    name: "Solana",
    icon: "sol",
    divisor: 10_000_000_000,
    marketId: "solana",
  },
  USDT_SMALL: {
    symbol: "USDT",
    name: "Tether",
    icon: "usdt",
    divisor: 1_000_000,
    marketId: "tether",
  },
};

const IGNORED_CURRENCIES = new Set(["RST", "HMT"]);

function getCurrencyConfig(currency) {
  const key = String(currency || "").trim().toUpperCase();
  if (CURRENCY_CONFIG[key]) return CURRENCY_CONFIG[key];
  const baseKey = key.replace(/_SMALL$/, "").toLowerCase();
  return {
    symbol: key.replace(/_SMALL$/, ""),
    name: key.replace(/_SMALL$/, ""),
    icon: baseKey,
    divisor: 1_000_000,
    marketId: null,
  };
}

function buildCurrencyLookupKeys(currency, config = {}) {
  const rawKeys = [
    currency,
    String(currency || "").replace(/_SMALL$/i, ""),
    config.symbol,
    config.name,
    config.icon,
    config.marketId,
  ];

  return rawKeys
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean);
}

function addCurrencyConfigLookupKey(lookup, key, config) {
  const normalizedKey = String(key || "").trim().toUpperCase();
  if (!normalizedKey || lookup.has(normalizedKey)) return;
  lookup.set(normalizedKey, config);
}

function buildWithdrawalConfigLookup(currenciesConfig) {
  const lookup = new Map();
  (Array.isArray(currenciesConfig) ? currenciesConfig : [])
    .filter((entry) => entry && typeof entry === "object")
    .forEach((entry) => {
      const minimumWithdraw = normalizeFiniteNumber(entry.min);
      if (!Number.isFinite(minimumWithdraw) || minimumWithdraw <= 0) return;

      const normalized = {
        minimumWithdraw,
        precision: normalizeFiniteNumber(entry.precision),
        raw: entry,
      };

      [
        entry.balance_key,
        entry.code,
        entry.base_currency,
        entry.validation_name,
        entry.name,
        entry.fullname,
        entry.display_name,
        entry.name_displayed_in_exp_reward,
      ].forEach((key) => {
        addCurrencyConfigLookupKey(lookup, key, normalized);
        addCurrencyConfigLookupKey(lookup, String(key || "").replace(/_SMALL$/i, ""), normalized);
      });
    });

  return lookup;
}

export function buildCurrencyIconUrl(currency) {
  const config = getCurrencyConfig(currency);
  return `https://static.rollercoin.com/static/img/icons/currencies/${encodeURIComponent(config.icon)}.svg?v=1.13`;
}

function normalizeFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function normalizeUserDistribution(userDistribution) {
  const root = userDistribution && typeof userDistribution === "object" ? userDistribution : null;
  if (!root) {
    return {
      maxPower: NaN,
      currentCurrency: "",
      rows: [],
    };
  }

  const powerRows = Array.isArray(root.power_distribution)
    ? root.power_distribution.filter((entry) => entry && typeof entry === "object")
    : Array.isArray(root.distribution)
      ? root.distribution.filter((entry) => entry && typeof entry === "object")
      : [];
  const currentRow = powerRows.find((entry) => normalizeFiniteNumber(entry.user_power) > 0) || null;
  const directUserPower = normalizeFiniteNumber(root.user_power);
  const maxPower = normalizeFiniteNumber(root.max_power);

  return {
    maxPower,
    currentCurrency: String(root.currency || currentRow?.currency || "").trim().toUpperCase(),
    rows: powerRows,
    userPower: Number.isFinite(maxPower) && maxPower > 0
      ? maxPower
      : Number.isFinite(directUserPower) && directUserPower > 0
        ? directUserPower
        : normalizeFiniteNumber(currentRow?.user_power),
  };
}

function toUsd(value, usdPrice) {
  const amount = normalizeFiniteNumber(value);
  const price = normalizeFiniteNumber(usdPrice);
  return Number.isFinite(amount) && Number.isFinite(price) ? amount * price : NaN;
}

function readStoredJson(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeStoredJson(storageKey, value) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Ignore storage write failures.
  }
}

function normalizeHistoryNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(12)) : null;
}

function buildHistoryRow(row) {
  return {
    currency: row.currency,
    symbol: row.symbol,
    name: row.name,
    rewardPerBlock: normalizeHistoryNumber(row.rewardPerBlock),
    rewardPerDay: normalizeHistoryNumber(row.rewardPerDay),
    rewardPerMonth: normalizeHistoryNumber(row.rewardPerMonth),
    usdPerBlock: normalizeHistoryNumber(row.usdPerBlock),
    usdPerDay: normalizeHistoryNumber(row.usdPerDay),
    usdPerMonth: normalizeHistoryNumber(row.usdPerMonth),
    sharePercent: normalizeHistoryNumber(row.sharePercent),
    usdPrice: normalizeHistoryNumber(row.usdPrice),
    userPower: normalizeHistoryNumber(row.userPower),
    adjustedTotalPower: normalizeHistoryNumber(row.adjustedTotalPower),
    blockPayoutAmount: normalizeHistoryNumber(row.blockPayoutAmount),
    blockPayoutUsd: normalizeHistoryNumber(row.blockPayoutUsd),
    blockNumber: Number.isFinite(Number(row.blockNumber)) ? Math.floor(Number(row.blockNumber)) : null,
    blockCreated: row.blockCreated || "",
  };
}

export function formatUsd(value, fractionDigits = 4) {
  if (!Number.isFinite(Number(value))) return "-";
  return `$${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: fractionDigits,
  })}`;
}

export function formatCryptoAmount(value, symbol, fractionDigits = 10) {
  if (!Number.isFinite(Number(value))) return "-";
  return `${formatMarketValue(value, fractionDigits)} ${symbol}`;
}

export function formatProfitabilityPercent(value, fractionDigits = 4) {
  if (!Number.isFinite(Number(value))) return "-";
  return `${formatMarketValue(value, fractionDigits)}%`;
}

export function formatLeaguePower(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "-";
  const units = [
    { label: "Zh/s", divisor: 1_000_000_000_000 },
    { label: "Eh/s", divisor: 1_000_000_000 },
    { label: "Ph/s", divisor: 1_000_000 },
    { label: "Th/s", divisor: 1_000 },
    { label: "Gh/s", divisor: 1 },
  ];
  const unit = units.find((entry) => Math.abs(numericValue) >= entry.divisor) || units[units.length - 1];
  return `${formatMarketValue(numericValue / unit.divisor, 3)} ${unit.label}`;
}

export function buildProfitabilityRows(distribution, userDistribution, pricesByMarketId = {}, currenciesConfig = []) {
  const normalizedUser = normalizeUserDistribution(userDistribution);
  const userCurrency = normalizedUser.currentCurrency;
  const userPower = normalizeFiniteNumber(normalizedUser.userPower);
  const withdrawalConfigLookup = buildWithdrawalConfigLookup(currenciesConfig);

  return (Array.isArray(distribution) ? distribution : [])
    .filter((entry) => entry && typeof entry === "object")
    .filter((entry) => !IGNORED_CURRENCIES.has(String(entry.currency || "").trim().toUpperCase()))
    .map((entry) => {
      const currency = String(entry.currency || "").trim().toUpperCase();
      const config = getCurrencyConfig(currency);
      const withdrawalConfig = buildCurrencyLookupKeys(currency, config)
        .map((key) => withdrawalConfigLookup.get(key))
        .find(Boolean);
      const totalPower = normalizeFiniteNumber(entry.total_power);
      const blockPayoutRaw = normalizeFiniteNumber(entry.block_payout);
      const sameCurrency = currency === userCurrency;
      const adjustedTotalPower =
        Number.isFinite(totalPower) && Number.isFinite(userPower)
          ? totalPower + (sameCurrency ? 0 : userPower)
          : NaN;
      const share =
        Number.isFinite(userPower) && userPower > 0 && Number.isFinite(adjustedTotalPower) && adjustedTotalPower > 0
          ? userPower / adjustedTotalPower
          : NaN;
      const rewardRawPerBlock =
        Number.isFinite(blockPayoutRaw) && Number.isFinite(share) ? blockPayoutRaw * share : NaN;
      const blockPayoutAmount =
        Number.isFinite(blockPayoutRaw) && Number.isFinite(config.divisor) && config.divisor > 0
          ? blockPayoutRaw / config.divisor
          : NaN;
      const rewardPerBlock =
        Number.isFinite(rewardRawPerBlock) && Number.isFinite(config.divisor) && config.divisor > 0
          ? rewardRawPerBlock / config.divisor
          : NaN;
      const usdPrice =
        Number.isFinite(config.fixedUsdPrice)
          ? config.fixedUsdPrice
          : normalizeFiniteNumber(pricesByMarketId?.[config.marketId]?.usd);
      const priceUpdatedAt = Number(pricesByMarketId?.[config.marketId]?.last_updated_at);
      const usdPerBlock = toUsd(rewardPerBlock, usdPrice);
      const blockPayoutUsd = toUsd(blockPayoutAmount, usdPrice);
      const rewardPerHour = Number.isFinite(rewardPerBlock) ? rewardPerBlock * BLOCKS_PER_HOUR : NaN;
      const rewardPerDay = Number.isFinite(rewardPerBlock) ? rewardPerBlock * BLOCKS_PER_DAY : NaN;
      const rewardPerMonth = Number.isFinite(rewardPerBlock) ? rewardPerBlock * BLOCKS_PER_MONTH : NaN;
      const minimumWithdraw = normalizeFiniteNumber(withdrawalConfig?.minimumWithdraw);
      const withdrawDays =
        Number.isFinite(minimumWithdraw) && minimumWithdraw > 0 && Number.isFinite(rewardPerDay) && rewardPerDay > 0
          ? minimumWithdraw / rewardPerDay
          : NaN;

      return {
        currency,
        symbol: config.symbol,
        name: config.name,
        marketId: config.marketId,
        iconUrl: buildCurrencyIconUrl(currency),
        totalPower,
        adjustedTotalPower,
        userPower,
        blockPayoutRaw,
        blockPayoutAmount,
        blockPayoutUsd,
        rewardRawPerBlock,
        rewardPerBlock,
        rewardPerHour,
        rewardPerDay,
        rewardPerMonth,
        minimumWithdraw,
        minimumWithdrawPrecision: Number.isFinite(withdrawalConfig?.precision)
          ? Math.max(0, Math.min(10, Math.floor(withdrawalConfig.precision)))
          : 8,
        withdrawDays,
        usdPrice,
        usdPerBlock,
        usdPerHour: Number.isFinite(usdPerBlock) ? usdPerBlock * BLOCKS_PER_HOUR : NaN,
        usdPerDay: Number.isFinite(usdPerBlock) ? usdPerBlock * BLOCKS_PER_DAY : NaN,
        usdPerMonth: Number.isFinite(usdPerBlock) ? usdPerBlock * BLOCKS_PER_MONTH : NaN,
        sharePercent: Number.isFinite(share) ? share * 100 : NaN,
        activeUsersCount: normalizeFiniteNumber(entry.active_users_count),
        blockNumber: normalizeFiniteNumber(entry.block_number),
        blockCreated: entry.block_created || "",
        isCurrentAllocation: sameCurrency,
        priceUpdatedAt: Number.isFinite(priceUpdatedAt) && priceUpdatedAt > 0 ? priceUpdatedAt * 1000 : null,
      };
    })
    .sort((left, right) => {
      const rightUsd = Number.isFinite(right.usdPerDay) ? right.usdPerDay : -Infinity;
      const leftUsd = Number.isFinite(left.usdPerDay) ? left.usdPerDay : -Infinity;
      if (rightUsd !== leftUsd) return rightUsd - leftUsd;
      return String(left.symbol).localeCompare(String(right.symbol));
    });
}

export function buildProfitabilitySummary(rows, userDistribution) {
  const validRows = (Array.isArray(rows) ? rows : []).filter((row) => Number.isFinite(Number(row.usdPerDay)));
  const best = validRows[0] || null;
  const normalizedUser = normalizeUserDistribution(userDistribution);
  const userPower = normalizeFiniteNumber(normalizedUser.userPower);

  return {
    best,
    totalRows: Array.isArray(rows) ? rows.length : 0,
    pricedRows: validRows.length,
    currentCurrency: normalizedUser.currentCurrency,
    userPower,
  };
}

export function restoreProfitabilityHistory() {
  const saved = readStoredJson(PROFITABILITY_HISTORY_STORAGE_KEY);
  return Array.isArray(saved) ? saved.filter((entry) => entry && typeof entry === "object") : [];
}

export function persistProfitabilityHistory(history) {
  writeStoredJson(PROFITABILITY_HISTORY_STORAGE_KEY, Array.isArray(history) ? history.slice(0, PROFITABILITY_HISTORY_LIMIT) : []);
}

export function recordProfitabilityHistory(history, rows, summary, options = {}) {
  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === "object")
    .map(buildHistoryRow);
  if (normalizedRows.length === 0) return Array.isArray(history) ? history : [];

  const entry = {
    recordedAt: Date.now(),
    leagueId: String(options.leagueId || "").trim(),
    source: options.source || "sync",
    bestCurrency: summary?.best?.currency || "",
    bestSymbol: summary?.best?.symbol || "",
    bestUsdPerDay: normalizeHistoryNumber(summary?.best?.usdPerDay),
    currentCurrency: summary?.currentCurrency || "",
    userPower: normalizeHistoryNumber(summary?.userPower),
    rows: normalizedRows,
  };

  return [entry, ...(Array.isArray(history) ? history : [])].slice(0, PROFITABILITY_HISTORY_LIMIT);
}

export async function invokeLeagueProfitability(cookieHeader, leagueId) {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) {
    throw new Error("Electron IPC is unavailable.");
  }
  return ipcRenderer.invoke("rollercoin-league-profitability-fetch", { cookieHeader, leagueId });
}
