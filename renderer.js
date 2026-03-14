const POWER_MULTIPLIER = {
  "Th/s": 1,
  "Ph/s": 1000,
  "Eh/s": 1000 ** 2,
  "Zh/s": 1000 ** 3,
};

const UNIT_ORDER = ["Th/s", "Ph/s", "Eh/s", "Zh/s"];

const candidatesBody = document.getElementById("candidatesBody");
const addCandidateBtn = document.getElementById("addCandidateBtn");
const calculateBtn = document.getElementById("calculateBtn");
const resultContent = document.getElementById("resultContent");
const currentTotalPowerStat = document.getElementById("currentTotalPowerStat");
const currentBonusPowerStat = document.getElementById("currentBonusPowerStat");
const candidateCountStat = document.getElementById("candidateCountStat");

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
    <td><button type="button" class="remove-btn">Удалить</button></td>
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
    return "Некорректная текущая базовая мощность.";
  }
  if (!Number.isFinite(currentBonusPercent) || currentBonusPercent < 0) {
    return "Некорректный текущий общий бонус.";
  }

  if ((oldMiner.powerThs === null) !== (oldMiner.bonusPercent === null)) {
    return "Для майнера на замену укажите и мощность, и бонус, либо оставьте оба поля пустыми.";
  }

  if (oldMiner.powerThs !== null) {
    if (!Number.isFinite(oldMiner.powerThs) || oldMiner.powerThs < 0) {
      return "Некорректная мощность старого майнера.";
    }
    if (!Number.isFinite(oldMiner.bonusPercent) || oldMiner.bonusPercent < 0) {
      return "Некорректный бонус старого майнера.";
    }
  }

  if (candidates.length === 0) {
    return "Добавьте хотя бы одного кандидата.";
  }

  for (const cand of candidates) {
    if (!Number.isFinite(cand.powerThs) || cand.powerThs < 0) {
      return `Кандидат #${cand.index}: некорректная мощность.`;
    }
    if (!Number.isFinite(cand.bonusPercent) || cand.bonusPercent < 0) {
      return `Кандидат #${cand.index}: некорректный бонус.`;
    }
    if (cand.price !== null && (!Number.isFinite(cand.price) || cand.price < 0)) {
      return `Кандидат #${cand.index}: некорректная цена.`;
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
  const hasPriceForAll = candidates.every((c) => c.price !== null && c.price > 0);

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
  const metricLabel = hasPriceForAll ? "По эффективности $ (gain/$)" : "По абсолютному приросту";
  const deltaPerDollarText =
    best.deltaPerDollar === null
      ? "не рассчитано"
      : `${formatPowerFromThs(best.deltaPerDollar)} / $1`;
  const rowsHtml = scored
    .map((cand) => {
      const deltaClass = cand.delta >= 0 ? "positive" : "negative";
      const perDollarText =
        cand.deltaPerDollar === null ? "—" : `${formatSignedPower(cand.deltaPerDollar)} / $1`;
      return `
        <tr>
          <td>#${cand.index}${cand.index === best.index ? " (лучший)" : ""}</td>
          <td class="${deltaClass}">${formatSignedPower(cand.delta)}</td>
          <td class="${deltaClass}">${perDollarText}</td>
        </tr>
      `;
    })
    .join("");

  resultContent.innerHTML = `
    <p class="best">Лучший кандидат: #${best.index}</p>
    <div class="result-grid">
      <div class="muted">Критерий выбора</div>
      <div>${metricLabel}</div>

      <div class="muted">Новая базовая мощность</div>
      <div>${formatPowerFromThs(best.baseNew)}</div>

      <div class="muted">Новый общий бонус</div>
      <div>${best.bonusNew.toLocaleString("ru-RU", { maximumFractionDigits: 4 })}%</div>

      <div class="muted">Новая общая мощность</div>
      <div>${formatPowerFromThs(best.totalNew)}</div>

      <div class="muted">Прирост общей мощности</div>
      <div>${formatPowerFromThs(best.delta)}</div>

      <div class="muted">Прирост на доллар</div>
      <div>${deltaPerDollarText}</div>
    </div>
    <table class="candidates-result-table">
      <thead>
        <tr>
          <th>Майнер</th>
          <th>Прирост общей мощности</th>
          <th>Прирост на доллар</th>
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

addCandidateBtn.addEventListener("click", () => {
  addCandidate();
  recalculateLive();
});
calculateBtn.addEventListener("click", recalculateLive);
candidatesBody.addEventListener("input", recalculateLive);
candidatesBody.addEventListener("change", recalculateLive);
document.addEventListener("input", (event) => {
  if (event.target.closest(".card")) {
    recalculateLive();
  }
});
document.addEventListener("change", (event) => {
  if (event.target.closest(".card")) {
    recalculateLive();
  }
});

addCandidate();
updateCurrentStats();
