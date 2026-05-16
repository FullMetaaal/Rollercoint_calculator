import { useState } from "react";
import {
  formatCryptoAmount,
  formatLeaguePower,
  formatProfitabilityPercent,
  formatUsd,
} from "../lib/profitability";
import { formatMarketValue } from "../lib/power";

function formatDateTime(value, locale) {
  if (!Number.isFinite(Number(value))) return "-";
  return new Date(Number(value)).toLocaleString(locale === "ru" ? "ru-RU" : "en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ProfitabilityMetric({ label, value, detail, tone = "neutral" }) {
  return (
    <div className={`profitability-metric profitability-metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function buildCurrencyHistory(history, currency) {
  return (Array.isArray(history) ? history : [])
    .map((entry) => {
      const row = Array.isArray(entry?.rows)
        ? entry.rows.find((item) => item?.currency === currency)
        : null;
      return row ? { ...row, recordedAt: entry.recordedAt, leagueId: entry.leagueId } : null;
    })
    .filter(Boolean);
}

function ProfitabilityHistory({ entries, row, i18n }) {
  const { t, locale } = i18n;
  const visibleEntries = entries.slice(0, 8);

  return (
    <div className="profitability-history-panel">
      {visibleEntries.length === 0 ? (
        <div className="muted">{t("profitability_history_empty")}</div>
      ) : (
        <div className="profitability-history-list">
          {visibleEntries.map((entry, index) => (
            <div className="profitability-history-row" key={`${entry.recordedAt}-${row.currency}-${index}`}>
              <div>
                <strong>{formatDateTime(entry.recordedAt, locale)}</strong>
                <span>{formatProfitabilityPercent(entry.sharePercent)} | {formatUsd(entry.usdPrice, 6)}</span>
              </div>
              <div>
                <span>{t("profitability_my_block")}</span>
                <strong>{formatUsd(entry.usdPerBlock)}</strong>
                <small>{formatCryptoAmount(entry.rewardPerBlock, row.symbol, 10)}</small>
              </div>
              <div>
                <span>{t("profitability_my_day")}</span>
                <strong>{formatUsd(entry.usdPerDay)}</strong>
                <small>{formatCryptoAmount(entry.rewardPerDay, row.symbol, 8)}</small>
              </div>
              <div>
                <span>{t("profitability_month")}</span>
                <strong>{formatUsd(entry.usdPerMonth, 2)}</strong>
                <small>{formatLeaguePower(entry.userPower)}</small>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfitabilityCard({ row, rank, historyEntries, i18n }) {
  const { t, locale } = i18n;
  const [historyOpen, setHistoryOpen] = useState(false);
  const blockCreatedAt = row.blockCreated ? Date.parse(row.blockCreated) : NaN;

  return (
    <article className={`profitability-card ${rank === 0 ? "profitability-card-best" : ""}`}>
      <div className="profitability-card-head">
        <div className="profitability-currency">
          <img src={row.iconUrl} alt="" className="profitability-currency-icon" />
          <div>
            <div className="profitability-currency-title">
              <span>{row.symbol}</span>
              {row.isCurrentAllocation ? <span className="profitability-current-badge">{t("profitability_current")}</span> : null}
            </div>
            <div className="profitability-currency-name">{row.name}</div>
          </div>
        </div>
        <div className="profitability-card-side">
          <button
            type="button"
            className="profitability-history-button"
            onClick={() => setHistoryOpen((value) => !value)}
          >
            {t("profitability_history")}
          </button>
          <div className="profitability-card-rank">#{rank + 1}</div>
        </div>
      </div>

      <div className="profitability-hero-value">
        <span>{t("profitability_my_day")}</span>
        <strong>{formatUsd(row.usdPerDay)}</strong>
        <small>{formatCryptoAmount(row.rewardPerDay, row.symbol, 8)}</small>
      </div>

      <div className="profitability-block-overview">
        <div>
          <span>{t("profitability_full_block")}</span>
          <strong>{formatCryptoAmount(row.blockPayoutAmount, row.symbol, 10)}</strong>
          <small>{formatUsd(row.blockPayoutUsd)}</small>
        </div>
        <div>
          <span>{t("profitability_my_block")}</span>
          <strong>{formatCryptoAmount(row.rewardPerBlock, row.symbol, 10)}</strong>
          <small>{formatUsd(row.usdPerBlock)}</small>
        </div>
      </div>

      <div className="profitability-metric-grid">
        <ProfitabilityMetric
          label={t("profitability_share")}
          value={formatProfitabilityPercent(row.sharePercent)}
          detail={`${t("profitability_pool")}: ${formatLeaguePower(row.adjustedTotalPower)}`}
          tone="positive"
        />
        <ProfitabilityMetric
          value={formatUsd(row.usdPerBlock)}
          label={t("profitability_my_block")}
          detail={formatCryptoAmount(row.rewardPerBlock, row.symbol, 10)}
        />
        <ProfitabilityMetric
          label={t("profitability_hour")}
          value={formatUsd(row.usdPerHour)}
          detail={formatCryptoAmount(row.rewardPerHour, row.symbol, 8)}
        />
        <ProfitabilityMetric
          label={t("profitability_month")}
          value={formatUsd(row.usdPerMonth, 2)}
          detail={formatCryptoAmount(row.rewardPerMonth, row.symbol, 6)}
          tone="accent"
        />
      </div>

      <div className="profitability-card-footer">
        <span>{t("profitability_share")}: {formatProfitabilityPercent(row.sharePercent)}</span>
        <span>{t("profitability_price")}: {formatUsd(row.usdPrice, 6)}</span>
        <span>{t("profitability_users")}: {formatMarketValue(row.activeUsersCount, 0)}</span>
        <span>{t("profitability_block_number")}: {formatMarketValue(row.blockNumber, 0)}</span>
        <span>{t("profitability_pool")}: {formatLeaguePower(row.adjustedTotalPower)}</span>
        <span>{t("profitability_my_power")}: {formatLeaguePower(row.userPower)}</span>
        <span>{t("profitability_block_time")}: {formatDateTime(blockCreatedAt, locale)}</span>
      </div>

      {historyOpen ? (
        <ProfitabilityHistory entries={historyEntries} row={row} i18n={i18n} />
      ) : null}
    </article>
  );
}

export function ProfitabilitySection({ profitability, profitabilityHistory, actions, i18n }) {
  const { t, rt, locale } = i18n;
  const rows = Array.isArray(profitability.rows) ? profitability.rows : [];
  const summary = profitability.summary || {};
  const loadedAt = profitability.sourceInfo?.loadedAt;

  return (
    <section className="card card-market card-profitability" id="profitabilityCard">
      <div className="workspace-section-heading market-heading">
        <div>
          <p className="panel-eyebrow">{t("profitability_eyebrow")}</p>
          <h2>{t("profitability_title")}</h2>
          <p className="section-subtitle">{t("profitability_subtitle")}</p>
        </div>
      </div>

      <div className="market-top-stack">
        <div className="market-control-grid profitability-control-grid">
          <article className="tool-control-card">
            <div className="control-card-head">
              <div>
                <h3>{t("profitability_league_title")}</h3>
                <p className="control-card-copy">{t("profitability_league_copy")}</p>
              </div>
            </div>
            <label>
              {t("profitability_league_id")}
              <input
                id="profitabilityLeagueId"
                type="text"
                value={profitability.leagueId}
                onChange={(event) => actions.updateProfitabilityLeagueId(event.target.value)}
              />
            </label>
          </article>

          <article className="tool-control-card tool-control-card-accent">
            <div className="control-card-head">
              <div>
                <h3>{t("actions_title")}</h3>
                <p className="control-card-copy">{t("profitability_actions_copy")}</p>
              </div>
            </div>
            <button
              id="loadProfitabilityBtn"
              type="button"
              className="primary"
              onClick={actions.loadLeagueProfitability}
              disabled={profitability.loading}
            >
              {profitability.loading ? t("auth_checking") : t("profitability_refresh")}
            </button>
          </article>

          <article className="tool-control-card profitability-summary-card">
            <div className="profitability-summary-items">
              <div>
                <span>{t("profitability_best_day")}</span>
                <strong>{summary.best ? `${summary.best.symbol} ${formatUsd(summary.best.usdPerDay)}` : "-"}</strong>
              </div>
              <div>
                <span>{t("profitability_user_power")}</span>
                <strong>{formatLeaguePower(summary.userPower)}</strong>
              </div>
              <div>
                <span>{t("profitability_current_currency")}</span>
                <strong>{summary.currentCurrency || "-"}</strong>
              </div>
            </div>
          </article>
        </div>

        <div className="market-filter-summary">
          <span className="market-filter-chip">{t("profitability_priced")}: {formatMarketValue(summary.pricedRows, 0)} / {formatMarketValue(summary.totalRows, 0)}</span>
          <span className="market-filter-chip">{t("profitability_loaded")}: {loadedAt ? formatDateTime(loadedAt, locale) : t("not_loaded_yet")}</span>
          {profitability.priceError ? <span className="market-filter-chip market-filter-chip-warning">{profitability.priceError}</span> : null}
        </div>
      </div>

      <div className="status-stack">
        <p id="profitabilityStatus" className="muted status-line">{rt(profitability.status)}</p>
      </div>

      {rows.length === 0 ? (
        <div className="profitability-empty muted">{t("profitability_empty")}</div>
      ) : (
        <div className="profitability-grid">
          {rows.map((row, index) => (
            <ProfitabilityCard
              key={`${row.currency}-${row.blockNumber}-${index}`}
              row={row}
              rank={index}
              historyEntries={buildCurrencyHistory(profitabilityHistory, row.currency)}
              i18n={i18n}
            />
          ))}
        </div>
      )}
    </section>
  );
}
