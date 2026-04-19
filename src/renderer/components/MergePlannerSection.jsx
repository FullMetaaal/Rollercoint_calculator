import { formatMarketValue, formatPowerFromPhs } from "../lib/power";
import { MinerVisual } from "./MinerVisual";

function formatLoadedAt(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return "Not loaded yet";
  return new Date(Number(timestamp)).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSpend(value) {
  return Number.isFinite(Number(value)) ? `${formatMarketValue(value, 2)} RLT` : "Unknown";
}

function formatProjectedGain(value, displayUnit) {
  if (!Number.isFinite(Number(value))) {
    return "Unknown";
  }
  return `+${formatPowerFromPhs(Number(value), displayUnit)}`;
}

function buildResultMeta(miner, displayUnit) {
  const parts = [];
  if (Number.isFinite(Number(miner?.power)) && Number(miner.power) > 0) {
    parts.push(formatPowerFromPhs(miner.power, displayUnit));
  }
  if (Number.isFinite(Number(miner?.bonusPercent)) && Number(miner.bonusPercent) > 0) {
    parts.push(`${formatMarketValue(miner.bonusPercent, 2)}% bonus`);
  }
  if (Number.isFinite(Number(miner?.width)) && Number(miner.width) > 0) {
    parts.push(`W${Math.floor(Number(miner.width))}`);
  }
  if (Number.isFinite(Number(miner?.level)) && Number(miner.level) > 0) {
    parts.push(`L${Math.floor(Number(miner.level))}`);
  }
  return parts.join(" | ");
}

function RequirementList({ items, emptyText, type }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <div className="muted">{emptyText}</div>;
  }

  return (
    <div className="merge-requirement-list">
      {items.map((item, index) => (
        <div key={`${type}-${item.id || item.name}-${index}`} className="merge-requirement-item">
          <div className="market-miner-cell merge-requirement-visual">
            <MinerVisual miner={item} className="merge-requirement-thumb" />
            <div className="market-miner-copy">
              <div className="merge-requirement-name">{item.name}</div>
              <div className="merge-requirement-meta">
                Need {item.count} | Have {item.ownedCount}
                {item.missingCount > 0 ? ` | Missing ${item.missingCount}` : " | Complete"}
                {item.rarity ? ` | ${item.rarity}` : ""}
                {Number.isFinite(Number(item.level)) && Number(item.level) > 0 ? ` | L${Math.floor(Number(item.level))}` : ""}
                {type === "miner" && Number.isFinite(Number(item.marketPrice)) && item.missingCount > 0
                  ? ` | ${formatMarketValue(item.marketPrice, 2)} RLT each`
                  : ""}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ tone, label }) {
  return (
    <span className={`merge-status-badge merge-status-${tone || "neutral"}`}>
      {label}
    </span>
  );
}

function DiagnosticsCard({ title, diagnostics }) {
  if (!diagnostics || typeof diagnostics !== "object") {
    return null;
  }

  return (
    <article className="merge-diagnostic-card">
      <div className="merge-diagnostic-title">{title}</div>
      <div className="merge-diagnostic-meta">
        Payload: {diagnostics.payloadCount || 0}
        {diagnostics.sourcePath ? ` | Source: ${diagnostics.sourcePath}` : ""}
        {diagnostics.selectedAuthVariant ? ` | Auth: ${diagnostics.selectedAuthVariant}` : ""}
        {Number.isFinite(Number(diagnostics.cookieCount)) ? ` | Cookies: ${diagnostics.cookieCount}` : ""}
        {Number.isFinite(Number(diagnostics.tokenCount)) && diagnostics.tokenCount > 0 ? ` | Tokens: ${diagnostics.tokenCount}` : ""}
      </div>
      <div className="merge-diagnostic-meta">{diagnostics.attemptSummary || "No attempt metadata returned."}</div>
      {diagnostics.error ? <div className="error merge-diagnostic-error">{diagnostics.error}</div> : null}
    </article>
  );
}

function StageStatusLabel(state) {
  if (state === "loading") return "Loading";
  if (state === "success") return "Success";
  if (state === "error") return "Error";
  if (state === "warning") return "Partial";
  return "Idle";
}

function BudgetOpportunityCard({ item, displayUnit }) {
  return (
    <article className="merge-budget-card">
      <div className="merge-budget-card-top">
        <div className="merge-budget-miner">
          <MinerVisual miner={item.miner} />
          <div className="merge-budget-copy">
            <div className="merge-result-name">{item.name}</div>
            <div className="market-miner-subcopy">{buildResultMeta(item.miner, displayUnit) || "Miner stats unavailable"}</div>
          </div>
        </div>
        <StatusBadge tone={item.type === "craft" ? "positive" : "neutral"} label={item.label} />
      </div>
      <div className="merge-budget-metrics">
        <span>Spend: {formatSpend(item.spend)}</span>
        <span>Projected gain: {formatProjectedGain(item.gainPhs, displayUnit)}</span>
        <span>
          Gain / RLT: {Number.isFinite(Number(item.gainPerRlt)) && item.gainPerRlt !== Number.POSITIVE_INFINITY
            ? formatPowerFromPhs(item.gainPerRlt, displayUnit)
            : item.spend <= 0
              ? "Free"
              : "Unknown"}
        </span>
      </div>
      <div className="market-price-subcopy">{item.summary}</div>
      <div className="market-price-subcopy">{item.extra}</div>
      {Number.isFinite(Number(item.totalMissingMinerCopies)) ? (
        <div className="market-price-subcopy">
          Missing miner copies to finish: {Math.max(0, Math.floor(Number(item.totalMissingMinerCopies)))}
        </div>
      ) : null}
    </article>
  );
}

export function MergePlannerSection({ mergePlanner, mergeAnalysis, displayUnit, actions }) {
  return (
    <section className="card merge-planner-card">
      <div className="workspace-section-heading">
        <div>
          <p className="panel-eyebrow">Merge Planning</p>
          <h2>Merge Planner</h2>
          <p className="section-subtitle">
            Compare the real crafting path against the current market price so it is obvious what is better to craft
            and what is better to buy ready.
          </p>
        </div>
        <div className="card-actions">
          <button type="button" className="primary" onClick={actions.loadMergePlannerData} disabled={mergePlanner.loading}>
            {mergePlanner.loading ? "Loading..." : "Load merge data"}
          </button>
        </div>
      </div>

      <p className="inline-hint section-frame section-frame-copy">
        Craft spend is estimated from missing miner copies in the current market cache. Missing parts are shown, but not
        priced yet, so some decisions remain approximate.
      </p>

      <section className="merge-stage-panel">
        <div className="header-row">
          <div>
            <h3>Budget Advisor</h3>
            <p className="section-subtitle">
              Compare scanned merge crafts and direct market buys in one list to see what gives the best projected gain within your budget.
            </p>
          </div>
        </div>
        <div className="merge-budget-toolbar">
          <label className="merge-budget-label">
            Budget (RLT)
            <input
              id="mergeBudgetInput"
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 3"
              value={mergePlanner.budgetInput}
              onChange={(event) => actions.updateMergePlannerBudget(event.target.value)}
            />
          </label>
          <div className="merge-budget-summary muted">{mergeAnalysis.budgetSummaryText}</div>
        </div>
        <div className="merge-budget-grid">
          {Array.isArray(mergeAnalysis.budgetOpportunities) && mergeAnalysis.budgetOpportunities.length > 0 ? (
            mergeAnalysis.budgetOpportunities.map((item) => (
              <BudgetOpportunityCard key={item.id} item={item} displayUnit={displayUnit} />
            ))
          ) : (
            <div className="muted">No budget options yet. Load merge data, keep market data fresh, and enter a budget.</div>
          )}
        </div>
      </section>

      <div className="merge-summary-grid">
        <article className="insight-card">
          <span className="insight-label">Recipes</span>
          <div className="insight-value">{mergeAnalysis.items.length}</div>
        </article>
        <article className="insight-card">
          <span className="insight-label">Craft Now</span>
          <div className="insight-value positive">{mergeAnalysis.craftNowCount}</div>
        </article>
        <article className="insight-card">
          <span className="insight-label">Craft Cheaper</span>
          <div className="insight-value positive">{mergeAnalysis.craftCheaperCount}</div>
        </article>
        <article className="insight-card">
          <span className="insight-label">Buy Cheaper</span>
          <div className="insight-value">{mergeAnalysis.buyCheaperCount}</div>
        </article>
        <article className="insight-card">
          <span className="insight-label">Need Miners</span>
          <div className="insight-value">{mergeAnalysis.missingMinerCount}</div>
        </article>
        <article className="insight-card">
          <span className="insight-label">Need Parts</span>
          <div className="insight-value">{mergeAnalysis.missingPartCount}</div>
        </article>
      </div>

      <div className="status-stack">
        <p className="status-line">{mergePlanner.status}</p>
        <p className="status-line">{mergeAnalysis.summaryText}</p>
        <p className="status-line">
          Inventory miners: {mergePlanner.inventoryMinersStatus} | Parts: {mergePlanner.inventoryPartsStatus} | Recipes: {mergePlanner.recipesStatus}
        </p>
        <p className="status-line">Last merge refresh: {formatLoadedAt(mergePlanner.lastLoadedAt)}</p>
      </div>

      <div className="table-shell table-shell-large">
        <table className="candidates-result-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Result</th>
              <th>Craft Path</th>
              <th>Market Price</th>
              <th>Decision</th>
              <th>Recipe</th>
            </tr>
          </thead>
          <tbody>
            {mergeAnalysis.items.length === 0 ? (
              <tr>
                <td colSpan="6" className="muted">Merge recipes will appear here after loading merge planner data.</td>
              </tr>
            ) : (
              mergeAnalysis.items.map((item, index) => (
                <tr key={item.id}>
                  <td>{index + 1}</td>
                  <td>
                    <div className="market-miner-cell">
                      <MinerVisual miner={item.resultMiner} />
                      <div className="market-miner-copy">
                        <div className="merge-result-name">{item.resultMiner.name}</div>
                        <div className="market-miner-subcopy">
                          {buildResultMeta(item.resultMiner, displayUnit) || "Result stats unavailable"}
                        </div>
                        <div className="market-price-subcopy">
                          Projected gain: {formatProjectedGain(item.projectedGainPhs, displayUnit)}
                        </div>
                        <div className="market-price-subcopy">
                          Gain / RLT: {Number.isFinite(Number(item.projectedGainPerRlt)) && item.projectedGainPerRlt !== Number.POSITIVE_INFINITY
                            ? formatPowerFromPhs(item.projectedGainPerRlt, displayUnit)
                            : Number(item.craftSpendEstimate) <= 0 && Number.isFinite(Number(item.projectedGainPhs))
                              ? "Free"
                              : "Unknown"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <StatusBadge tone={item.statusTone} label={item.statusLabel} />
                    <div className="market-price-subcopy">Craft spend: {formatSpend(item.craftSpendEstimate)}</div>
                    <div className="market-price-subcopy">
                      Missing miners: {item.totalMissingMinerCopies} | Missing parts: {item.totalMissingParts}
                    </div>
                  </td>
                  <td>
                    <div>{formatSpend(item.marketSpendEstimate)}</div>
                    <div className="market-price-subcopy">
                      {Number.isFinite(Number(item.savingsVsMarket))
                        ? `Gap: ${formatMarketValue(item.savingsVsMarket, 2)} RLT`
                        : "Gap: unknown"}
                    </div>
                  </td>
                  <td>
                    <StatusBadge tone={item.decisionTone} label={item.decisionLabel} />
                    <div className={item.decisionTone === "positive" ? "positive" : item.decisionTone === "negative" ? "negative" : "muted"}>
                      {item.decisionSummary}
                    </div>
                  </td>
                  <td>
                    <details className="merge-details">
                      <summary>Show recipe</summary>
                      <div className="merge-details-body">
                        <div className="merge-details-group">
                          <div className="merge-details-title">Required miners</div>
                          <RequirementList items={item.requiredMiners} emptyText="No miner requirements parsed." type="miner" />
                        </div>
                        <div className="merge-details-group">
                          <div className="merge-details-title">Required parts</div>
                          <RequirementList items={item.requiredParts} emptyText="No part requirements parsed." type="part" />
                        </div>
                      </div>
                    </details>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <details className="merge-stage-panel merge-collapsible">
        <summary>Load stages</summary>
        <div className="merge-stage-grid">
          {Array.isArray(mergePlanner.stages) && mergePlanner.stages.map((stage) => (
            <article key={stage.id} className="merge-stage-card">
              <div className="merge-stage-card-top">
                <div className="merge-stage-title">{stage.label}</div>
                <StatusBadge tone={stage.state === "idle" ? "neutral" : stage.state} label={StageStatusLabel(stage.state)} />
              </div>
              <div className="merge-stage-detail">{stage.detail}</div>
            </article>
          ))}
        </div>
      </details>

      <details className="merge-stage-panel merge-collapsible">
        <summary>Endpoint diagnostics</summary>
        <div className="merge-diagnostic-grid">
          <DiagnosticsCard title="Room" diagnostics={mergePlanner.diagnostics?.room} />
          <DiagnosticsCard title="Inventory miners" diagnostics={mergePlanner.diagnostics?.inventoryMiners} />
          <DiagnosticsCard title="Inventory parts" diagnostics={mergePlanner.diagnostics?.inventoryParts} />
          <DiagnosticsCard title="Forge recipes" diagnostics={mergePlanner.diagnostics?.recipes} />
        </div>
      </details>

      <details className="merge-stage-panel merge-collapsible">
        <summary>Load log</summary>
        <pre className="market-logs-output muted">
          {Array.isArray(mergePlanner.logs) && mergePlanner.logs.length > 0
            ? mergePlanner.logs.join("\n")
            : "Logs will appear here after clicking Load merge data."}
        </pre>
      </details>
    </section>
  );
}
