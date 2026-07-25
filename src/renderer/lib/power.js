export const POWER_MULTIPLIER = {
  "Gh/s": 0.001,
  "Th/s": 1,
  "Ph/s": 1000,
  "Eh/s": 1000 ** 2,
  "Zh/s": 1000 ** 3,
};

export const INTERNAL_POWER_UNIT = "Eh/s";
export const UNIT_ORDER = ["Gh/s", "Th/s", "Ph/s", "Eh/s", "Zh/s"];

export const CURRENT_SYSTEM_STORAGE_KEY = "rollercoin.currentSystem.v1";
export const CURRENT_SYSTEM_HISTORY_STORAGE_KEY = "rollercoin.currentSystem.history.v1";
export const CURRENT_SYSTEM_HISTORY_LIMIT = 180;
export const CURRENT_SYSTEM_HISTORY_VISIBLE_COUNT = 5;

export const DEFAULT_CURRENT_SYSTEM = {
  baseValue: "0.183673",
  baseUnit: "Eh/s",
  bonusPercent: "330.49",
  displayUnit: "Eh/s",
};

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

export function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value !== "string") return NaN;
  const normalized = value.trim().replaceAll(" ", "").replace(",", ".");
  if (!normalized) return NaN;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function normalizePowerUnit(value) {
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

export function toThs(value, unit) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return NaN;
  const normalizedUnit = normalizePowerUnit(unit);
  if (!normalizedUnit) return NaN;
  return numericValue * POWER_MULTIPLIER[normalizedUnit];
}

export function convertThsToUnit(valueThs, unit) {
  const normalizedUnit = normalizePowerUnit(unit);
  if (!Number.isFinite(valueThs) || !normalizedUnit) return NaN;
  return valueThs / POWER_MULTIPLIER[normalizedUnit];
}

export function formatMarketValue(value, fractionDigits = 2) {
  if (!Number.isFinite(Number(value))) return "-";
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: fractionDigits });
}

export function formatPowerFromThs(valueThs, displayUnit = "Eh/s", fractionDigits = 6) {
  if (!Number.isFinite(valueThs)) return "-";
  const unit = normalizePowerUnit(displayUnit) || DEFAULT_CURRENT_SYSTEM.displayUnit;
  const value = convertThsToUnit(valueThs, unit);
  if (!Number.isFinite(value)) return "-";
  return `${formatMarketValue(value, fractionDigits)} ${unit}`;
}

export function formatPowerFromPhs(valuePhs, displayUnit = "Eh/s", fractionDigits = 6) {
  return formatPowerFromThs(toThs(valuePhs, "Ph/s"), displayUnit, fractionDigits);
}

export function formatPowerFromEhs(valueEhs, displayUnit = "Eh/s", fractionDigits = 6) {
  return formatPowerFromThs(toThs(valueEhs, "Eh/s"), displayUnit, fractionDigits);
}

export function formatSignedPower(valueThs, displayUnit = "Eh/s", fractionDigits = 6) {
  if (!Number.isFinite(valueThs)) return "-";
  const sign = valueThs > 0 ? "+" : "";
  return `${sign}${formatPowerFromThs(valueThs, displayUnit, fractionDigits)}`;
}

export function roundForStorage(value, fractionDigits = 6) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return NaN;
  return Number(numericValue.toFixed(fractionDigits));
}

export function getCurrentTotal(baseThs, bonusPercent) {
  return baseThs * (1 + bonusPercent / 100);
}

export function getCurrentSystemSnapshot(currentSystem) {
  const baseValue = parseNumber(currentSystem.baseValue);
  const baseUnit = normalizePowerUnit(currentSystem.baseUnit) || DEFAULT_CURRENT_SYSTEM.baseUnit;
  const bonusPercent = parseNumber(currentSystem.bonusPercent);
  const displayUnit = normalizePowerUnit(currentSystem.displayUnit) || DEFAULT_CURRENT_SYSTEM.displayUnit;
  const baseThs = toThs(baseValue, baseUnit);
  const totalThs = getCurrentTotal(baseThs, bonusPercent);

  if (!Number.isFinite(baseValue) || baseValue < 0) return null;
  if (!Number.isFinite(baseThs) || baseThs < 0) return null;
  if (!Number.isFinite(bonusPercent) || bonusPercent < 0) return null;

  return {
    baseValue,
    baseUnit,
    bonusPercent,
    displayUnit,
    baseThs,
    baseEhs: baseThs / POWER_MULTIPLIER["Eh/s"],
    basePhs: baseThs / POWER_MULTIPLIER["Ph/s"],
    totalThs,
    totalEhs: totalThs / POWER_MULTIPLIER["Eh/s"],
  };
}

export function getCurrentSystemHistorySignature(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return "";
  const baseEhs = Number.isFinite(Number(snapshot.baseEhs))
    ? Number(snapshot.baseEhs)
    : Number(snapshot.basePhs) / 1000;
  return `${roundForStorage(baseEhs, 9)}|${roundForStorage(snapshot.bonusPercent, 4)}`;
}

export function getCurrentSystemHistorySourceLabel(source, locale = "en") {
  if (locale === "ru") {
    if (source === "rollercoin-sync") return "Синхронизация RollerCoin";
    if (source === "restore") return "Восстановлено";
    return "Ручное изменение";
  }
  if (source === "rollercoin-sync") return "RollerCoin sync";
  if (source === "restore") return "Restored";
  return "Manual edit";
}

export function createCurrentSystemHistoryEntry(snapshot, source = "manual") {
  const baseEhs = snapshot.baseThs / POWER_MULTIPLIER["Eh/s"];
  const totalEhs = snapshot.totalThs / POWER_MULTIPLIER["Eh/s"];
  return {
    recordedAt: Date.now(),
    baseEhs: roundForStorage(baseEhs, 9),
    basePhs: roundForStorage(snapshot.basePhs, 6),
    bonusPercent: roundForStorage(snapshot.bonusPercent, 4),
    totalEhs: roundForStorage(totalEhs, 9),
    totalPhs: roundForStorage(snapshot.totalThs / POWER_MULTIPLIER["Ph/s"], 6),
    source,
    signature: getCurrentSystemHistorySignature(snapshot),
  };
}

export function recordCurrentSystemHistory(history, snapshot, source = "manual") {
  if (!snapshot) return history;

  const historyEntry = createCurrentSystemHistoryEntry(snapshot, source);
  const latestEntry = history[0];
  if (latestEntry && latestEntry.signature === historyEntry.signature) {
    return history;
  }

  const shouldReplaceLatestManualEntry =
    latestEntry &&
    latestEntry.source === "manual" &&
    historyEntry.source === "manual" &&
    Math.abs(historyEntry.recordedAt - latestEntry.recordedAt) <= 30000;

  const nextHistory = shouldReplaceLatestManualEntry
    ? [historyEntry, ...history.slice(1)]
    : [historyEntry, ...history];

  return nextHistory.slice(0, CURRENT_SYSTEM_HISTORY_LIMIT);
}

export function restoreCurrentSystemState() {
  const saved = readStoredJson(CURRENT_SYSTEM_STORAGE_KEY);
  if (!saved || typeof saved !== "object") {
    return { ...DEFAULT_CURRENT_SYSTEM };
  }

  const savedBaseValue = saved.baseValue === undefined ? DEFAULT_CURRENT_SYSTEM.baseValue : String(saved.baseValue);
  const parsedSavedBaseValue = parseNumber(savedBaseValue);
  const rawSavedBaseUnit = normalizePowerUnit(saved.baseUnit);
  const savedBaseUnit = rawSavedBaseUnit ||
    (Number.isFinite(parsedSavedBaseValue) && parsedSavedBaseValue > 10 ? "Ph/s" : DEFAULT_CURRENT_SYSTEM.baseUnit);
  const savedBaseThs = toThs(parsedSavedBaseValue, savedBaseUnit);
  const restoredBaseEhs = Number.isFinite(savedBaseThs)
    ? roundForStorage(savedBaseThs / POWER_MULTIPLIER["Eh/s"], 9)
    : DEFAULT_CURRENT_SYSTEM.baseValue;

  return {
    baseValue: String(restoredBaseEhs),
    baseUnit: "Eh/s",
    bonusPercent: saved.bonusPercent === undefined ? DEFAULT_CURRENT_SYSTEM.bonusPercent : String(saved.bonusPercent),
    displayUnit: "Eh/s",
  };
}

export function restoreCurrentSystemHistory() {
  const saved = readStoredJson(CURRENT_SYSTEM_HISTORY_STORAGE_KEY);
  return Array.isArray(saved) ? saved : [];
}

export function persistCurrentSystem(currentSystem) {
  const snapshot = getCurrentSystemSnapshot(currentSystem);
  if (!snapshot) return;

  writeStoredJson(CURRENT_SYSTEM_STORAGE_KEY, {
    baseValue: roundForStorage(snapshot.baseValue, 6),
    baseUnit: snapshot.baseUnit,
    bonusPercent: roundForStorage(snapshot.bonusPercent, 4),
    displayUnit: snapshot.displayUnit,
    savedAt: Date.now(),
  });
}

export function persistCurrentSystemHistory(history) {
  writeStoredJson(CURRENT_SYSTEM_HISTORY_STORAGE_KEY, history);
}

export function formatHistoryDateTime(timestamp, locale = "en") {
  if (!Number.isFinite(Number(timestamp))) return "-";
  return new Date(Number(timestamp)).toLocaleString(locale === "ru" ? "ru-RU" : "en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatHistoryGrowthPercent(currentEntry, previousEntry) {
  const currentTotal = Number.isFinite(Number(currentEntry?.totalEhs))
    ? Number(currentEntry.totalEhs)
    : Number(currentEntry?.totalPhs) / 1000;
  const previousTotal = Number.isFinite(Number(previousEntry?.totalEhs))
    ? Number(previousEntry.totalEhs)
    : Number(previousEntry?.totalPhs) / 1000;
  if (!Number.isFinite(currentTotal) || !Number.isFinite(previousTotal) || previousTotal <= 0) {
    return "-";
  }

  const growthPercent = ((currentTotal - previousTotal) / previousTotal) * 100;
  const sign = growthPercent > 0 ? "+" : "";
  return `${sign}${formatMarketValue(growthPercent, 2)}%`;
}
