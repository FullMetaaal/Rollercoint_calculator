export function ComparisonSection({ comparison, comparisonAnalysis, actions, i18n }) {
  const { t, rt } = i18n;
  return (
    <>
      <section className="card">
        <div className="workspace-section-heading">
          <div>
            <p className="panel-eyebrow">{t("comparison_baseline_eyebrow")}</p>
            <h2>{t("comparison_baseline_title")}</h2>
            <p className="section-subtitle">
              {t("comparison_baseline_subtitle")}
            </p>
          </div>
        </div>

        <div className="grid-3 section-frame">
          <label>
            {t("old_miner_power")}
            <input id="oldMinerPowerValue" type="number" min="0" step="0.001" value={comparison.oldMinerPowerValue} onChange={(event) => actions.updateComparisonField("oldMinerPowerValue", event.target.value)} />
          </label>
          <label>
            {t("unit")}
            <select id="oldMinerPowerUnit" value={comparison.oldMinerPowerUnit} onChange={(event) => actions.updateComparisonField("oldMinerPowerUnit", event.target.value)}>
              <option>Gh/s</option>
              <option>Th/s</option>
              <option>Ph/s</option>
              <option>Eh/s</option>
              <option>Zh/s</option>
            </select>
          </label>
          <label>
            {t("old_miner_bonus")}
            <input id="oldMinerBonusPercent" type="number" min="0" step="0.01" value={comparison.oldMinerBonusPercent} onChange={(event) => actions.updateComparisonField("oldMinerBonusPercent", event.target.value)} />
          </label>
        </div>
      </section>

      <section className="secondary-layout">
        <section className="card">
          <div className="workspace-section-heading">
            <div>
              <p className="panel-eyebrow">{t("manual_comparison_eyebrow")}</p>
              <h2>{t("candidates_title")}</h2>
              <p className="section-subtitle">
                {t("candidates_subtitle")}
                <span id="candidateCountStat"> {comparison.candidates.length}</span>
              </p>
            </div>
            <button id="addCandidateBtn" type="button" className="ghost" onClick={actions.addCandidate}>{t("add_candidate")}</button>
          </div>

          <div className="table-shell table-shell-compact">
            <table id="candidatesTable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("history_base_power")}</th>
                  <th>{t("unit")}</th>
                  <th>{t("history_bonus")} %</th>
                  <th>{t("candidate_price")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="candidatesBody">
                {comparison.candidates.map((candidate, index) => (
                  <tr key={candidate.id} className={comparisonAnalysis.bestIndex === index + 1 ? "best-row" : ""}>
                    <td className="candidate-index">{index + 1}</td>
                    <td><input type="number" min="0" step="0.001" className="cand-power" value={candidate.powerValue} onChange={(event) => actions.updateCandidate(candidate.id, "powerValue", event.target.value)} /></td>
                    <td>
                      <select className="cand-unit" value={candidate.unit} onChange={(event) => actions.updateCandidate(candidate.id, "unit", event.target.value)}>
                        <option>Gh/s</option>
                        <option>Th/s</option>
                        <option>Ph/s</option>
                        <option>Eh/s</option>
                        <option>Zh/s</option>
                      </select>
                    </td>
                    <td><input type="number" min="0" step="0.01" className="cand-bonus" value={candidate.bonusPercent} onChange={(event) => actions.updateCandidate(candidate.id, "bonusPercent", event.target.value)} /></td>
                    <td><input type="number" min="0" step="0.01" className="cand-price" value={candidate.price} onChange={(event) => actions.updateCandidate(candidate.id, "price", event.target.value)} /></td>
                    <td><button type="button" className="remove-btn" onClick={() => actions.removeCandidate(candidate.id)}>{t("delete")}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="header-actions">
            <button id="calculateBtn" type="button">{t("calculate_best")}</button>
          </div>
        </section>

        <section className="card result-card" id="resultCard">
          <div className="workspace-section-heading">
            <div>
              <p className="panel-eyebrow">{t("output_eyebrow")}</p>
              <h2>{t("result_title")}</h2>
            </div>
          </div>
          <div id="resultContent">
            {comparisonAnalysis.error ? (
              <p className="error">{rt(comparisonAnalysis.error)}</p>
            ) : comparisonAnalysis.summary ? (
              <>
                <p className="best">{t("best_candidate", { index: comparisonAnalysis.summary.bestIndex })}</p>
                <div className="result-grid">
                  <div className="muted">{t("selection_metric")}</div>
                  <div>{rt(comparisonAnalysis.metricLabel)}</div>
                  <div className="muted">{t("new_base_power")}</div>
                  <div>{comparisonAnalysis.summary.baseNewText}</div>
                  <div className="muted">{t("new_total_bonus")}</div>
                  <div>{comparisonAnalysis.summary.bonusNewText}</div>
                  <div className="muted">{t("new_total_power")}</div>
                  <div>{comparisonAnalysis.summary.totalNewText}</div>
                  <div className="muted">{t("total_power_gain")}</div>
                  <div>{comparisonAnalysis.summary.deltaText}</div>
                  <div className="muted">{t("gain_per_dollar")}</div>
                  <div>{rt(comparisonAnalysis.summary.deltaPerDollarText)}</div>
                </div>
                <table className="candidates-result-table">
                  <thead>
                    <tr>
                      <th>{t("miner")}</th>
                      <th>{t("result_table_gain")}</th>
                      <th>{t("result_table_gain_per_dollar")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonAnalysis.rows.map((row) => (
                      <tr key={row.id}>
                        <td>#{row.index}{comparisonAnalysis.bestIndex === row.index ? t("best_suffix") : ""}</td>
                        <td>{row.deltaText}</td>
                        <td>{rt(row.deltaPerDollarText)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              t("add_at_least_one_candidate")
            )}
          </div>
        </section>
      </section>
    </>
  );
}
