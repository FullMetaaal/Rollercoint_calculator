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
}) {
  const visibleHistory = isHistoryExpanded
    ? history
    : history.slice(0, CURRENT_SYSTEM_HISTORY_VISIBLE_COUNT);

  return (
    <section className="card current-system-card" id="currentSystemSection">
      <div className="workspace-section-heading">
        <div>
          <p className="panel-eyebrow">Baseline Setup</p>
          <h2>Current System</h2>
          <p className="section-subtitle">
            Tune your current mining setup first so market upgrades and manual comparisons use the same baseline.
          </p>
        </div>
        <div className="card-actions">
          <button id="refreshCurrentPowerBtn" type="button" className="ghost" onClick={onSyncPower} disabled={syncing}>
            {syncing ? "Syncing..." : "Sync from RollerCoin"}
          </button>
        </div>
      </div>

      <div className="chip-row" aria-hidden="true">
        <span className="chip chip-active">Live baseline</span>
        <span className="chip">Saved snapshots</span>
        <span className="chip">Editable inputs</span>
      </div>

      <div className="calculator-layout">
        <div className="system-form">
          <div className="grid-3 section-frame">
            <label>
              Current Base Power
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
              Unit
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
              Current Total Bonus (%)
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

          <div className="header-row utility-row">
            <label className="utility-label">
              Display power unit
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
          </div>

          <p id="currentSystemSyncStatus" className="muted status-line">{syncStatus}</p>

          <section className="history-panel" aria-labelledby="powerHistoryTitle">
            <div className="header-row history-header">
              <div>
                <h3 id="powerHistoryTitle">Power History</h3>
                <p className="section-subtitle">Saved by date when you sync from RollerCoin or change current system values.</p>
              </div>
              <button id="clearPowerHistoryBtn" type="button" className="ghost" onClick={onClearHistory}>
                Clear history
              </button>
            </div>
            <div className="table-shell table-shell-compact history-table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Base power</th>
                    <th>Bonus</th>
                    <th>Total power</th>
                    <th className="history-growth-column">Growth</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody id="powerHistoryBody">
                  {visibleHistory.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="muted">Power history will appear here after the first saved snapshot.</td>
                    </tr>
                  ) : (
                    visibleHistory.map((entry, index) => (
                      <tr key={`${entry.recordedAt}-${index}`}>
                        <td>{formatHistoryDateTime(entry.recordedAt)}</td>
                        <td>{entry.basePhs}</td>
                        <td>{entry.bonusPercent}%</td>
                        <td>{entry.totalPhs}</td>
                        <td className="history-growth-column">{formatHistoryGrowthPercent(entry, visibleHistory[index + 1] || null)}</td>
                        <td>{getCurrentSystemHistorySourceLabel(entry.source)}</td>
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
                {isHistoryExpanded ? "Show recent entries" : "Show older entries"}
              </button>
            </div>
          </section>
        </div>

        <aside className="summary-column">
          <article className="insight-card insight-card-metric insight-card-main">
            <span className="insight-label">Current Total Power</span>
            <div className="insight-value" id="currentTotalPowerStat">{currentTotalText}</div>
          </article>

          <article className="insight-card insight-card-metric">
            <span className="insight-label">Bonus Power</span>
            <div className="insight-value" id="currentBonusPowerStat">{currentBonusText}</div>
          </article>

        </aside>
      </div>
    </section>
  );
}
