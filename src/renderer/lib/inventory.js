import { getExactMinerDuplicateKey } from "./duplicates";
import { normalizeInventoryMiners } from "./merge";
import { getCurrentSystemSnapshot, getCurrentTotal, POWER_MULTIPLIER, toThs } from "./power";

const MIN_GAIN_PHS = 0.001;

function getMinerBonusPercentValue(miner) {
  return Number.isFinite(Number(miner?.bonusPercent)) ? Number(miner.bonusPercent) : 0;
}

function getBonusStackKey(miner, index = 0, scope = "miner") {
  const exactKey = getExactMinerDuplicateKey(miner);
  if (exactKey) return `exact:${exactKey}`;

  const id = String(miner?.id || "").trim();
  return `unique:${scope}:${id || index}`;
}

function cloneBonusStackEntries(entries) {
  const cloned = new Map();
  if (!(entries instanceof Map)) return cloned;

  entries.forEach((entry, key) => {
    cloned.set(key, { ...entry });
  });
  return cloned;
}

function addBonusStackEntries(entries, miners, scope) {
  (Array.isArray(miners) ? miners : []).forEach((miner, index) => {
    const key = getBonusStackKey(miner, index, scope);
    const bonusPercent = getMinerBonusPercentValue(miner);
    const existing = entries.get(key);
    entries.set(key, {
      count: (existing?.count || 0) + 1,
      bonusPercent: Math.max(Number(existing?.bonusPercent) || 0, bonusPercent),
    });
  });
}

function removeBonusStackEntries(entries, miners, scope) {
  (Array.isArray(miners) ? miners : []).forEach((miner, index) => {
    const key = getBonusStackKey(miner, index, scope);
    const existing = entries.get(key);
    if (!existing) return;

    const nextCount = Math.max(0, (Number(existing.count) || 0) - 1);
    if (nextCount === 0) {
      entries.delete(key);
      return;
    }

    entries.set(key, { ...existing, count: nextCount });
  });
}

function getBonusStackTotal(entries) {
  if (!(entries instanceof Map)) return 0;
  let total = 0;
  entries.forEach((entry) => {
    if ((Number(entry?.count) || 0) > 0) {
      total += Number(entry?.bonusPercent) || 0;
    }
  });
  return total;
}

function buildRoomBonusState(roomMiners) {
  const entries = new Map();
  addBonusStackEntries(entries, roomMiners, "room");
  return { entries };
}

function calculateEffectiveBonusChange(roomBonusState, purchaseMiners, replacementMiners) {
  const beforeTotal = getBonusStackTotal(roomBonusState.entries);
  const afterRemovalEntries = cloneBonusStackEntries(roomBonusState.entries);
  removeBonusStackEntries(afterRemovalEntries, replacementMiners, "room");
  const afterRemovalTotal = getBonusStackTotal(afterRemovalEntries);

  const afterPurchaseEntries = cloneBonusStackEntries(afterRemovalEntries);
  addBonusStackEntries(afterPurchaseEntries, purchaseMiners, "inventory");
  const afterPurchaseTotal = getBonusStackTotal(afterPurchaseEntries);

  return {
    boughtBonusPercent: afterPurchaseTotal - afterRemovalTotal,
    removedBonusPercent: beforeTotal - afterRemovalTotal,
    bonusPercentDelta: afterPurchaseTotal - beforeTotal,
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

function buildReplacementSets(roomMiners) {
  const normalizedRoomMiners = Array.isArray(roomMiners) ? roomMiners : [];
  const singles = normalizedRoomMiners
    .filter((miner) => Number.isFinite(Number(miner?.width)) && Number(miner.width) > 0)
    .map((miner, index) => ({
      key: `single:${String(miner?.id || index)}`,
      width: Math.floor(Number(miner.width)),
      miners: [miner],
      removedPowerThs: toThs(miner.power, "Ph/s"),
      label: buildReplacementSetLabel([miner]),
    }));

  const flexiblePairs = [];
  const smallMiners = normalizedRoomMiners.filter((miner) => Math.floor(Number(miner?.width || 0)) === 1);
  for (let leftIndex = 0; leftIndex < smallMiners.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < smallMiners.length; rightIndex += 1) {
      const miners = [smallMiners[leftIndex], smallMiners[rightIndex]];
      flexiblePairs.push({
        key: `pair:${String(miners[0]?.id || leftIndex)}:${String(miners[1]?.id || rightIndex)}`,
        width: 2,
        miners,
        removedPowerThs: toThs(miners[0].power, "Ph/s") + toThs(miners[1].power, "Ph/s"),
        label: buildReplacementSetLabel(miners),
      });
    }
  }

  return [...singles, ...flexiblePairs];
}

function cloneMiner(miner) {
  return {
    id: String(miner?.id || ""),
    name: String(miner?.name || "Unknown"),
    level: miner?.level ?? null,
    power: Number.isFinite(Number(miner?.power)) ? Number(miner.power) : NaN,
    bonusPercent: getMinerBonusPercentValue(miner),
    width: Number.isFinite(Number(miner?.width)) ? Math.floor(Number(miner.width)) : null,
    count: Math.max(1, Math.floor(Number(miner?.count) || 1)),
    imageUrl: miner?.imageUrl || "",
    imageCandidates: Array.isArray(miner?.imageCandidates) ? [...miner.imageCandidates] : [],
  };
}

export function buildInventoryReplacementAnalysis({
  roomMiners,
  rawInventoryMiners,
  currentSystemState,
}) {
  const currentSystem = getCurrentSystemSnapshot(currentSystemState);
  const normalizedInventoryMiners = normalizeInventoryMiners(rawInventoryMiners).map(cloneMiner);
  const normalizedRoomMiners = (Array.isArray(roomMiners) ? roomMiners : []).map(cloneMiner);

  if (!currentSystem) {
    return {
      error: "Current system is invalid. Sync RollerCoin power or enter valid base power and bonus.",
      items: [],
      inventoryMiners: normalizedInventoryMiners,
      totalInventoryCount: normalizedInventoryMiners.reduce((sum, miner) => sum + miner.count, 0),
      roomMinersCount: normalizedRoomMiners.length,
      profitableCount: 0,
      duplicateAwareCount: 0,
    };
  }

  const totalCurrentThs = getCurrentTotal(currentSystem.baseThs, currentSystem.bonusPercent);
  const roomBonusState = buildRoomBonusState(normalizedRoomMiners);
  const replacementSets = buildReplacementSets(normalizedRoomMiners);
  const replacementSetsByWidth = new Map();
  replacementSets.forEach((set) => {
    const bucket = replacementSetsByWidth.get(set.width) || [];
    bucket.push(set);
    replacementSetsByWidth.set(set.width, bucket);
  });

  const items = [];
  normalizedInventoryMiners.forEach((inventoryMiner) => {
    const width = Number.isFinite(Number(inventoryMiner.width)) ? Math.floor(Number(inventoryMiner.width)) : null;
    const boughtPowerThs = toThs(inventoryMiner.power, "Ph/s");
    if (!width || !Number.isFinite(boughtPowerThs) || boughtPowerThs <= 0) return;

    const replacementPool = replacementSetsByWidth.get(width) || [];
    replacementPool.forEach((replacementSet) => {
      const bonusChange = calculateEffectiveBonusChange(roomBonusState, [inventoryMiner], replacementSet.miners);
      const projectedBaseThs = currentSystem.baseThs + boughtPowerThs - replacementSet.removedPowerThs;
      const projectedBonusPercent = currentSystem.bonusPercent + bonusChange.bonusPercentDelta;
      const projectedTotalThs = getCurrentTotal(projectedBaseThs, projectedBonusPercent);
      const gainThs = projectedTotalThs - totalCurrentThs;
      const gainPower = gainThs / POWER_MULTIPLIER["Ph/s"];
      if (!Number.isFinite(gainPower) || gainPower <= MIN_GAIN_PHS) return;

      items.push({
        key: `${inventoryMiner.id || inventoryMiner.name}:${replacementSet.key}`,
        inventoryMiner,
        replacementMiners: replacementSet.miners,
        replacementLabel: replacementSet.label,
        inventoryCount: inventoryMiner.count,
        boughtPowerThs,
        removedPowerThs: replacementSet.removedPowerThs,
        boughtBonusPercent: bonusChange.boughtBonusPercent,
        removedBonusPercent: bonusChange.removedBonusPercent,
        bonusPercentDelta: bonusChange.bonusPercentDelta,
        basePowerDelta: (boughtPowerThs - replacementSet.removedPowerThs) / POWER_MULTIPLIER["Ph/s"],
        gainPower,
        projectedBasePower: projectedBaseThs / POWER_MULTIPLIER["Ph/s"],
        projectedBonusPercent,
        projectedTotalPower: projectedTotalThs / POWER_MULTIPLIER["Ph/s"],
        duplicateAware: getExactMinerDuplicateKey(inventoryMiner) !== "" && bonusChange.boughtBonusPercent <= 0,
      });
    });
  });

  const sortedItems = items.sort((left, right) => {
    if (right.gainPower !== left.gainPower) return right.gainPower - left.gainPower;
    if (right.basePowerDelta !== left.basePowerDelta) return right.basePowerDelta - left.basePowerDelta;
    return String(left.inventoryMiner.name || "").localeCompare(String(right.inventoryMiner.name || ""), "en", { sensitivity: "base" });
  });

  return {
    error: null,
    items: sortedItems,
    inventoryMiners: normalizedInventoryMiners,
    totalInventoryCount: normalizedInventoryMiners.reduce((sum, miner) => sum + miner.count, 0),
    roomMinersCount: normalizedRoomMiners.length,
    profitableCount: sortedItems.length,
    duplicateAwareCount: sortedItems.filter((item) => item.duplicateAware).length,
  };
}
