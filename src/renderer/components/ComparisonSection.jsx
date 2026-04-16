export function ComparisonSection({ comparison, comparisonAnalysis, actions }) {
  return (
    <>
      <section className="card">
        <div className="workspace-section-heading">
          <div>
            <p className="panel-eyebrow">Replacement Baseline</p>
            <h2>Replaced Miner (Optional)</h2>
            <p className="section-subtitle">
              These fields are only needed for manual comparison when you are replacing a specific miner.
            </p>
          </div>
        </div>

        <div className="grid-3 section-frame">
          <label>
            Old Miner Power
            <input id="oldMinerPowerValue" type="number" min="0" step="0.001" value={comparison.oldMinerPowerValue} onChange={(event) => actions.updateComparisonField("oldMinerPowerValue", event.target.value)} />
          </label>
          <label>
            Unit
            <select id="oldMinerPowerUnit" value={comparison.oldMinerPowerUnit} onChange={(event) => actions.updateComparisonField("oldMinerPowerUnit", event.target.value)}>
              <option>Gh/s</option>
              <option>Th/s</option>
              <option>Ph/s</option>
              <option>Eh/s</option>
              <option>Zh/s</option>
            </select>
          </label>
          <label>
            Old Miner Bonus (%)
            <input id="oldMinerBonusPercent" type="number" min="0" step="0.01" value={comparison.oldMinerBonusPercent} onChange={(event) => actions.updateComparisonField("oldMinerBonusPercent", event.target.value)} />
          </label>
        </div>
      </section>

      <section className="secondary-layout">
        <section className="card">
          <div className="workspace-section-heading">
            <div>
              <p className="panel-eyebrow">Manual Comparison</p>
              <h2>Candidates</h2>
              <p className="section-subtitle">
                Compare several options manually. Currently in the list:
                <span id="candidateCountStat"> {comparison.candidates.length}</span>
              </p>
            </div>
            <button id="addCandidateBtn" type="button" className="ghost" onClick={actions.addCandidate}>Add Candidate</button>
          </div>

          <div className="table-shell table-shell-compact">
            <table id="candidatesTable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Power</th>
                  <th>Unit</th>
                  <th>Bonus %</th>
                  <th>Price ($)</th>
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
                    <td><button type="button" className="remove-btn" onClick={() => actions.removeCandidate(candidate.id)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="header-actions">
            <button id="calculateBtn" type="button">Calculate Best Option</button>
          </div>
        </section>

        <section className="card result-card" id="resultCard">
          <div className="workspace-section-heading">
            <div>
              <p className="panel-eyebrow">Output</p>
              <h2>Result</h2>
            </div>
          </div>
          <div id="resultContent">
            {comparisonAnalysis.error ? (
              <p className="error">{comparisonAnalysis.error}</p>
            ) : comparisonAnalysis.summary ? (
              <>
                <p className="best">Best candidate: #{comparisonAnalysis.summary.bestIndex}</p>
                <div className="result-grid">
                  <div className="muted">Selection metric</div>
                  <div>{comparisonAnalysis.metricLabel}</div>
                  <div className="muted">New base power</div>
                  <div>{comparisonAnalysis.summary.baseNewText}</div>
                  <div className="muted">New total bonus</div>
                  <div>{comparisonAnalysis.summary.bonusNewText}</div>
                  <div className="muted">New total power</div>
                  <div>{comparisonAnalysis.summary.totalNewText}</div>
                  <div className="muted">Total power gain</div>
                  <div>{comparisonAnalysis.summary.deltaText}</div>
                  <div className="muted">Gain per dollar</div>
                  <div>{comparisonAnalysis.summary.deltaPerDollarText}</div>
                </div>
                <table className="candidates-result-table">
                  <thead>
                    <tr>
                      <th>Miner</th>
                      <th>Total power gain</th>
                      <th>Gain per $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonAnalysis.rows.map((row) => (
                      <tr key={row.id}>
                        <td>#{row.index}{comparisonAnalysis.bestIndex === row.index ? " (best)" : ""}</td>
                        <td>{row.deltaText}</td>
                        <td>{row.deltaPerDollarText}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              "Add at least one candidate."
            )}
          </div>
        </section>
      </section>
    </>
  );
}
