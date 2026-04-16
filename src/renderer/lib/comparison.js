import {
  formatPowerFromThs,
  formatSignedPower,
  getCurrentTotal,
  parseNumber,
  toThs,
} from "./power";

function parseOptionalNonNegative(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = parseNumber(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return NaN;
  return parsed;
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

  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.powerThs) || candidate.powerThs < 0) {
      return `Candidate #${candidate.index}: invalid power.`;
    }
    if (!Number.isFinite(candidate.bonusPercent) || candidate.bonusPercent < 0) {
      return `Candidate #${candidate.index}: invalid bonus.`;
    }
    if (candidate.price !== null && (!Number.isFinite(candidate.price) || candidate.price < 0)) {
      return `Candidate #${candidate.index}: invalid price.`;
    }
  }

  return null;
}

export function createEmptyCandidateRow() {
  return {
    id: `candidate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    powerValue: "",
    unit: "Ph/s",
    bonusPercent: "",
    price: "",
  };
}

export function calculateComparisonAnalysis(currentSystem, comparison) {
  const currentBasePowerValue = parseOptionalNonNegative(currentSystem.baseValue);
  const currentBonusPercent = parseOptionalNonNegative(currentSystem.bonusPercent);
  const currentBaseThs = toThs(currentBasePowerValue, currentSystem.baseUnit);

  const oldPowerValue = parseOptionalNonNegative(comparison.oldMinerPowerValue);
  const oldBonusPercent = parseOptionalNonNegative(comparison.oldMinerBonusPercent);
  const oldMiner = {
    powerThs: oldPowerValue === null ? null : toThs(oldPowerValue, comparison.oldMinerPowerUnit),
    bonusPercent: oldBonusPercent,
  };

  const candidates = comparison.candidates
    .map((candidate, index) => {
      const powerValue = parseOptionalNonNegative(candidate.powerValue);
      const bonusPercent = parseOptionalNonNegative(candidate.bonusPercent);
      const price = parseOptionalNonNegative(candidate.price);
      const isEmptyRow = powerValue === null && bonusPercent === null && price === null;
      if (isEmptyRow) return null;

      return {
        id: candidate.id,
        index: index + 1,
        powerValue,
        unit: candidate.unit,
        powerThs: toThs(powerValue, candidate.unit),
        bonusPercent,
        price,
      };
    })
    .filter(Boolean);

  const validationError = validateInput(currentBaseThs, currentBonusPercent, oldMiner, candidates);
  if (validationError) {
    return {
      error: validationError,
      bestIndex: null,
      metricLabel: null,
      rows: [],
      summary: null,
      currentTotalText: Number.isFinite(currentBaseThs) && Number.isFinite(currentBonusPercent)
        ? formatPowerFromThs(getCurrentTotal(currentBaseThs, currentBonusPercent), currentSystem.displayUnit)
        : "-",
      currentBonusText:
        Number.isFinite(currentBaseThs) && Number.isFinite(currentBonusPercent)
          ? formatPowerFromThs(currentBaseThs * (currentBonusPercent / 100), currentSystem.displayUnit)
          : "-",
    };
  }

  const totalCurrent = getCurrentTotal(currentBaseThs, currentBonusPercent);
  const hasPriceForAll = candidates.every((candidate) => candidate.price !== null && candidate.price > 0);

  const scored = candidates.map((candidate) => {
    let baseNew = currentBaseThs + candidate.powerThs;
    let bonusNew = currentBonusPercent + candidate.bonusPercent;

    if (oldMiner.powerThs !== null) {
      baseNew -= oldMiner.powerThs;
      bonusNew -= oldMiner.bonusPercent;
    }

    const totalNew = getCurrentTotal(baseNew, bonusNew);
    const delta = totalNew - totalCurrent;
    const deltaPerDollar = candidate.price && candidate.price > 0 ? delta / candidate.price : null;

    return {
      ...candidate,
      baseNew,
      bonusNew,
      totalNew,
      delta,
      deltaPerDollar,
    };
  });

  scored.sort((left, right) => {
    if (hasPriceForAll) return (right.deltaPerDollar || -Infinity) - (left.deltaPerDollar || -Infinity);
    return right.delta - left.delta;
  });

  const best = scored[0];
  return {
    error: null,
    bestIndex: best?.index ?? null,
    metricLabel: hasPriceForAll ? "By gain per $1" : "By absolute gain",
    rows: scored.map((candidate) => ({
      ...candidate,
      deltaText: formatSignedPower(candidate.delta, currentSystem.displayUnit),
      deltaPerDollarText:
        candidate.deltaPerDollar === null
          ? "-"
          : `${formatSignedPower(candidate.deltaPerDollar, currentSystem.displayUnit)} / $1`,
    })),
    summary: best
      ? {
          bestIndex: best.index,
          baseNewText: formatPowerFromThs(best.baseNew, currentSystem.displayUnit),
          bonusNewText: `${Number(best.bonusNew).toLocaleString("en-US", { maximumFractionDigits: 4 })}%`,
          totalNewText: formatPowerFromThs(best.totalNew, currentSystem.displayUnit),
          deltaText: formatPowerFromThs(best.delta, currentSystem.displayUnit),
          deltaPerDollarText:
            best.deltaPerDollar === null
              ? "not calculated"
              : `${formatPowerFromThs(best.deltaPerDollar, currentSystem.displayUnit)} / $1`,
        }
      : null,
    currentTotalText: formatPowerFromThs(totalCurrent, currentSystem.displayUnit),
    currentBonusText: formatPowerFromThs(currentBaseThs * (currentBonusPercent / 100), currentSystem.displayUnit),
  };
}
