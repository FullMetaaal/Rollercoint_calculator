import {
  CURRENT_SYSTEM_HISTORY_VISIBLE_COUNT,
  formatHistoryDateTime,
  formatHistoryGrowthPercent,
  getCurrentSystemHistorySourceLabel,
} from "../lib/power";

export function CurrentSystemSection({
  currentSystem,
  history,
  isHistoryExpanded,
  currentTotalText,
  currentBonusText,
  onFieldChange,
  onCommitHistory,
  onSyncPower,
  onClearHistory,
  onToggleHistory,
  syncStatus,
  syncing,
  i18n,
}) {
  const { t, rt, locale } = i18n;
  const visibleHistory = isHistoryExpanded
    ? history
    : history.slice(0, CURRENT_SYSTEM_HISTORY_VISIBLE_COUNT);

  return (
    <section className="card current-system-card" id="currentSystemSection">
      <div className="workspace-section-heading">
        <div>
          <p className="panel-eyebrow">{t("current_baseline_eyebrow")}</p>
          <h2>{t("current_system_title")}</h2>
          <p className="section-subtitle">
            {t("current_system_subtitle")}
          </p>
        </div>
        <div className="card-actions">
          <button id="refreshCurrentPowerBtn" type="button" className="ghost" onClick={onSyncPower} disabled={syncing}>
            {syncing ? t("auth_checking") : t("sync_from_rollercoin")}
          </button>
        </div>
      </div>

      <div className="chip-row" aria-hidden="true">
        <span className="chip chip-active">{t("chip_live_baseline")}</span>
        <span className="chip">{t("chip_saved_snapshots")}</span>
        <span className="chip">{t("chip_editable_inputs")}</span>
      </div>

      <div className="calculator-layout">
        <div className="system-form">
          <div className="system-control-grid">
            <section className="system-control-card system-control-card-primary">
              <div className="control-card-head">
                <div>
                  <h3>{t("baseline_inputs_title")}</h3>
                  <p className="control-card-copy">{t("baseline_inputs_copy")}</p>
                </div>
              </div>
              <div className="grid-3">
                <label>
                  {t("current_base_power")}
                  <input
                    id="currentBasePowerValue"
                    type="number"
                    min="0"
                    step="0.001"
                    value={currentSystem.baseValue}
                    onChange={(event) => onFieldChange("baseValue", event.target.value)}
                    onBlur={() => onCommitHistory("manual")}
                  />
                </label>
                <label>
                  {t("unit")}
                  <select
                    id="currentBasePowerUnit"
                    value={currentSystem.baseUnit}
                    onChange={(event) => onFieldChange("baseUnit", event.target.value)}
                    onBlur={() => onCommitHistory("manual")}
                  >
                    <option>Gh/s</option>
                    <option>Th/s</option>
                    <option>Ph/s</option>
                    <option>Eh/s</option>
                    <option>Zh/s</option>
                  </select>
                </label>
                <label>
                  {t("current_total_bonus")}
                  <input
                    id="currentBonusPercent"
                    type="number"
                    min="0"
                    step="0.01"
                    value={currentSystem.bonusPercent}
                    onChange={(event) => onFieldChange("bonusPercent", event.target.value)}
                    onBlur={() => onCommitHistory("manual")}
                  />
                </label>
              </div>
            </section>

            <section className="system-control-card">
              <div className="control-card-head">
                <div>
                  <h3>{t("display_sync_title")}</h3>
                  <p className="control-card-copy">{t("display_sync_copy")}</p>
                </div>
              </div>
              <div className="system-control-stack">
                <label className="utility-label">
                  {t("display_power_unit")}
                  <select
                    id="displayPowerUnit"
                    value={currentSystem.displayUnit}
                    onChange={(event) => onFieldChange("displayUnit", event.target.value)}
                  >
                    <option>Gh/s</option>
                    <option>Th/s</option>
                    <option>Ph/s</option>
                    <option>Eh/s</option>
                    <option>Zh/s</option>
                  </select>
                </label>
                <p className="inline-hint system-inline-hint">
                  {t("current_system_hint")}
                </p>
                <p id="currentSystemSyncStatus" className="muted status-line">{rt(syncStatus)}</p>
              </div>
            </section>
          </div>

          <section className="history-panel" aria-labelledby="powerHistoryTitle">
            <div className="header-row history-header">
              <div>
                <h3 id="powerHistoryTitle">{t("power_history")}</h3>
                <p className="section-subtitle">{t("power_history_subtitle")}</p>
              </div>
              <button id="clearPowerHistoryBtn" type="button" className="ghost" onClick={onClearHistory}>
                {t("clear_history")}
              </button>
            </div>
            <div className="table-shell table-shell-compact history-table-shell">
              <table>
                <thead>
                  <tr>
                    <th>{t("history_date")}</th>
                    <th>{t("history_base_power")}</th>
                    <th>{t("history_bonus")}</th>
                    <th>{t("history_total_power")}</th>
                    <th className="history-growth-column">{t("history_growth")}</th>
                    <th>{t("history_source")}</th>
                  </tr>
                </thead>
                <tbody id="powerHistoryBody">
                  {visibleHistory.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="muted">{t("power_history_empty")}</td>
                    </tr>
                  ) : (
                    visibleHistory.map((entry, index) => (
                      <tr key={`${entry.recordedAt}-${index}`}>
                        <td>{formatHistoryDateTime(entry.recordedAt, locale)}</td>
                        <td>{entry.basePhs}</td>
                        <td>{entry.bonusPercent}%</td>
                        <td>{entry.totalPhs}</td>
                        <td className="history-growth-column">{formatHistoryGrowthPercent(entry, visibleHistory[index + 1] || null)}</td>
                        <td>{getCurrentSystemHistorySourceLabel(entry.source, locale)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="table-pagination">
              <button
                id="togglePowerHistoryBtn"
                type="button"
                className="ghost"
                hidden={history.length <= CURRENT_SYSTEM_HISTORY_VISIBLE_COUNT}
                onClick={onToggleHistory}
              >
                {isHistoryExpanded ? t("show_recent_entries") : t("show_older_entries")}
              </button>
            </div>
          </section>
        </div>

        <aside className="summary-column">
          <article className="insight-card insight-card-metric insight-card-main">
            <span className="insight-label">{t("stat_current_total_power")}</span>
            <div className="insight-value" id="currentTotalPowerStat">{currentTotalText}</div>
          </article>

          <article className="insight-card insight-card-metric">
            <span className="insight-label">{t("stat_bonus_power")}</span>
            <div className="insight-value" id="currentBonusPowerStat">{currentBonusText}</div>
          </article>

        </aside>
      </div>
    </section>
  );
}
