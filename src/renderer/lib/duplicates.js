function normalizeMinerName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function toIntegerValue(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
  return Math.floor(numericValue);
}

function toFixedPrecisionValue(value, multiplier, allowZero = false) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return null;
  if (allowZero ? numericValue < 0 : numericValue <= 0) return null;
  return Math.round(numericValue * multiplier);
}

function getDuplicateIdentity(miner) {
  const name = normalizeMinerName(miner?.name);
  const level = toIntegerValue(miner?.level);
  const width = toIntegerValue(miner?.width);
  const power = toFixedPrecisionValue(miner?.power, 1_000_000_000);
  const bonus = toFixedPrecisionValue(miner?.bonusPercent, 10_000, true);

  if (!name || level === null || width === null || power === null || bonus === null) {
    return null;
  }

  return {
    key: `${name}::l${level}::w${width}::p${power}::b${bonus}`,
    name,
    level,
    width,
    power,
    bonus,
  };
}

export function buildDuplicateMinerAnalysis(roomMiners) {
  const groupsByKey = new Map();
  let incompleteCount = 0;

  (Array.isArray(roomMiners) ? roomMiners : []).forEach((miner, index) => {
    const identity = getDuplicateIdentity(miner);
    if (!identity) {
      incompleteCount += 1;
      return;
    }

    const existing = groupsByKey.get(identity.key);
    if (existing) {
      existing.miners.push(miner);
      existing.count += 1;
      return;
    }

    groupsByKey.set(identity.key, {
      ...identity,
      representative: miner,
      miners: [miner],
      count: 1,
      firstIndex: index,
    });
  });

  const duplicateGroups = [...groupsByKey.values()]
    .filter((group) => group.count > 1)
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      if (right.power !== left.power) return right.power - left.power;
      return left.name.localeCompare(right.name, "en", { sensitivity: "base" });
    });

  return {
    totalMiners: Array.isArray(roomMiners) ? roomMiners.length : 0,
    strictEligibleCount: [...groupsByKey.values()].reduce((sum, group) => sum + group.count, 0),
    uniqueExactCount: groupsByKey.size,
    duplicateGroups,
    duplicateGroupCount: duplicateGroups.length,
    duplicateExtraCopies: duplicateGroups.reduce((sum, group) => sum + group.count - 1, 0),
    incompleteCount,
  };
}
