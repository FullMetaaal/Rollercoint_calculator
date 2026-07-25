import { formatMarketValue, formatPowerFromEhs } from "../lib/power";
import { MinerVisual } from "./MinerVisual";

function formatLoadedAt(timestamp, locale, t) {
  if (!Number.isFinite(Number(timestamp))) return t("not_loaded_yet");
  return new Date(Number(timestamp)).toLocaleString(locale === "ru" ? "ru-RU" : "en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSpend(value, t) {
  return Number.isFinite(Number(value)) ? `${formatMarketValue(value, 2)} RLT` : t("unknown");
}

function formatProjectedGain(value, displayUnit, t) {
  if (!Number.isFinite(Number(value))) {
    return t("unknown");
  }
  return `+${formatPowerFromEhs(Number(value), displayUnit)}`;
}

function buildResultMeta(miner, displayUnit, t) {
  const parts = [];
  if (Number.isFinite(Number(miner?.power)) && Number(miner.power) > 0) {
    parts.push(formatPowerFromEhs(miner.power, displayUnit));
  }
  if (Number.isFinite(Number(miner?.bonusPercent)) && Number(miner.bonusPercent) > 0) {
    parts.push(`${formatMarketValue(miner.bonusPercent, 2)}% ${t("history_bonus").toLowerCase()}`);
  }
  if (Number.isFinite(Number(miner?.width)) && Number(miner.width) > 0) {
    parts.push(`W${Math.floor(Number(miner.width))}`);
  }
  if (Number.isFinite(Number(miner?.level)) && Number(miner.level) > 0) {
    parts.push(`L${Math.floor(Number(miner.level))}`);
  }
  return parts.join(" | ");
}

function RequirementList({ items, emptyText, type, i18n }) {
  const { t } = i18n;
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
                {t("need_have_missing", {
                  need: item.count,
                  have: item.ownedCount,
                  missing: item.missingCount > 0 ? t("missing_suffix", { value: item.missingCount }) : t("complete_suffix"),
                })}
                {item.rarity ? ` | ${item.rarity}` : ""}
                {Number.isFinite(Number(item.level)) && Number(item.level) > 0 ? ` | L${Math.floor(Number(item.level))}` : ""}
                {type === "miner" && Number.isFinite(Number(item.marketPrice)) && item.missingCount > 0
                  ? ` | ${t("each_price", { value: formatMarketValue(item.marketPrice, 2) })}`
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

function DiagnosticsCard({ title, diagnostics, i18n }) {
  const { t, rt } = i18n;
  if (!diagnostics || typeof diagnostics !== "object") {
    return null;
  }

  return (
    <article className="merge-diagnostic-card">
      <div className="merge-diagnostic-title">{title}</div>
      <div className="merge-diagnostic-meta">
        {t("payload")}: {diagnostics.payloadCount || 0}
        {diagnostics.sourcePath ? ` | ${t("source")}: ${diagnostics.sourcePath}` : ""}
        {diagnostics.selectedAuthVariant ? ` | ${t("auth_short")}: ${diagnostics.selectedAuthVariant}` : ""}
        {Number.isFinite(Number(diagnostics.cookieCount)) ? ` | ${t("cookies")}: ${diagnostics.cookieCount}` : ""}
        {Number.isFinite(Number(diagnostics.tokenCount)) && diagnostics.tokenCount > 0 ? ` | ${t("tokens")}: ${diagnostics.tokenCount}` : ""}
      </div>
      <div className="merge-diagnostic-meta">{rt(diagnostics.attemptSummary || t("no_attempt_metadata"))}</div>
      {diagnostics.error ? <div className="error merge-diagnostic-error">{rt(diagnostics.error)}</div> : null}
    </article>
  );
}

function StageStatusLabel(state, t) {
  if (state === "loading") return t("stage_loading");
  if (state === "success") return t("stage_success");
  if (state === "error") return t("stage_error");
  if (state === "warning") return t("stage_partial");
  return t("stage_idle");
}

function BudgetOpportunityCard({ item, displayUnit, i18n }) {
  const { t, rt } = i18n;
  return (
    <article className="merge-budget-card">
      <div className="merge-budget-card-top">
        <div className="merge-budget-miner">
          <MinerVisual miner={item.miner} />
          <div className="merge-budget-copy">
            <div className="merge-result-name">{item.name}</div>
            <div className="market-miner-subcopy">{buildResultMeta(item.miner, displayUnit, t) || t("result_stats_unavailable")}</div>
          </div>
        </div>
        <StatusBadge tone={item.type === "craft" ? "positive" : "neutral"} label={rt(item.label)} />
      </div>
      <div className="merge-budget-metrics">
        <span>{t("spend", { value: formatSpend(item.spend, t) })}</span>
        <span>{t("projected_gain", { value: formatProjectedGain(item.gainEhs, displayUnit, t) })}</span>
        <span>
          {t("gain_per_rlt_value", { value: Number.isFinite(Number(item.gainPerRlt)) && item.gainPerRlt !== Number.POSITIVE_INFINITY
            ? formatPowerFromEhs(item.gainPerRlt, displayUnit)
            : item.spend <= 0
              ? t("free_label")
              : t("unknown") })}
        </span>
      </div>
      <div className="market-price-subcopy">{rt(item.summary)}</div>
      <div className="market-price-subcopy">{rt(item.extra)}</div>
      {Number.isFinite(Number(item.totalMissingMinerCopies)) ? (
        <div className="market-price-subcopy">
          {t("missing_miner_copies", { count: Math.max(0, Math.floor(Number(item.totalMissingMinerCopies))) })}
        </div>
      ) : null}
    </article>
  );
}

export function MergePlannerSection({ mergePlanner, mergeAnalysis, displayUnit, actions, i18n }) {
  const { t, rt, log, locale } = i18n;
  return (
    <section className="card merge-planner-card">
      <div className="workspace-section-heading">
        <div>
          <p className="panel-eyebrow">{t("merge_eyebrow")}</p>
          <h2>{t("merge_title")}</h2>
          <p className="section-subtitle">
            {t("merge_subtitle")}
          </p>
        </div>
        <div className="card-actions">
          <button type="button" className="primary" onClick={actions.loadMergePlannerData} disabled={mergePlanner.loading}>
            {mergePlanner.loading ? t("auth_checking") : t("load_merge_data")}
          </button>
        </div>
      </div>

      <p className="inline-hint section-frame section-frame-copy">
        {t("merge_hint")}
      </p>

      <section className="merge-stage-panel">
        <div className="header-row">
          <div>
            <h3>{t("budget_advisor")}</h3>
            <p className="section-subtitle">{t("budget_advisor_copy")}</p>
          </div>
        </div>
        <div className="merge-budget-toolbar">
          <label className="merge-budget-label">
            {t("budget_rlt")}
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
          <div className="merge-budget-summary muted">{rt(mergeAnalysis.budgetSummaryText)}</div>
        </div>
        <div className="merge-budget-grid">
          {Array.isArray(mergeAnalysis.budgetOpportunities) && mergeAnalysis.budgetOpportunities.length > 0 ? (
            mergeAnalysis.budgetOpportunities.map((item) => (
              <BudgetOpportunityCard key={item.id} item={item} displayUnit={displayUnit} i18n={i18n} />
            ))
          ) : (
            <div className="muted">{t("no_budget_options")}</div>
          )}
        </div>
      </section>

      <div className="merge-summary-grid">
        <article className="insight-card">
          <span className="insight-label">{t("recipes")}</span>
          <div className="insight-value">{mergeAnalysis.items.length}</div>
        </article>
        <article className="insight-card">
          <span className="insight-label">{t("craft_now")}</span>
          <div className="insight-value positive">{mergeAnalysis.craftNowCount}</div>
        </article>
        <article className="insight-card">
          <span className="insight-label">{t("craft_cheaper")}</span>
          <div className="insight-value positive">{mergeAnalysis.craftCheaperCount}</div>
        </article>
        <article className="insight-card">
          <span className="insight-label">{t("buy_cheaper")}</span>
          <div className="insight-value">{mergeAnalysis.buyCheaperCount}</div>
        </article>
        <article className="insight-card">
          <span className="insight-label">{t("need_miners")}</span>
          <div className="insight-value">{mergeAnalysis.missingMinerCount}</div>
        </article>
        <article className="insight-card">
          <span className="insight-label">{t("need_parts")}</span>
          <div className="insight-value">{mergeAnalysis.missingPartCount}</div>
        </article>
      </div>

      <div className="status-stack">
        <p className="status-line">{rt(mergePlanner.status)}</p>
        <p className="status-line">{rt(mergeAnalysis.summaryText)}</p>
        <p className="status-line">
          {t("inventory_miners_status")}: {rt(mergePlanner.inventoryMinersStatus)} | {t("parts_status")}: {rt(mergePlanner.inventoryPartsStatus)} | {t("recipes_status")}: {rt(mergePlanner.recipesStatus)}
        </p>
        <p className="status-line">{t("last_merge_refresh", { value: formatLoadedAt(mergePlanner.lastLoadedAt, locale, t) })}</p>
      </div>

      <div className="table-shell table-shell-large">
        <table className="candidates-result-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t("result")}</th>
              <th>{t("craft_path")}</th>
              <th>{t("market_price")}</th>
              <th>{t("decision")}</th>
              <th>{t("recipe")}</th>
            </tr>
          </thead>
          <tbody>
            {mergeAnalysis.items.length === 0 ? (
              <tr>
                <td colSpan="6" className="muted">{t("merge_empty")}</td>
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
                          {buildResultMeta(item.resultMiner, displayUnit, t) || t("result_stats_unavailable")}
                        </div>
                        <div className="market-price-subcopy">
                          {t("projected_gain", { value: formatProjectedGain(item.projectedGainEhs, displayUnit, t) })}
                        </div>
                        <div className="market-price-subcopy">
                          {t("gain_per_rlt_value", { value: Number.isFinite(Number(item.projectedGainPerRlt)) && item.projectedGainPerRlt !== Number.POSITIVE_INFINITY
                            ? formatPowerFromEhs(item.projectedGainPerRlt, displayUnit)
                            : Number(item.craftSpendEstimate) <= 0 && Number.isFinite(Number(item.projectedGainEhs))
                              ? t("free_label")
                              : t("unknown") })}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <StatusBadge tone={item.statusTone} label={rt(item.statusLabel)} />
                    <div className="market-price-subcopy">{t("craft_spend", { value: formatSpend(item.craftSpendEstimate, t) })}</div>
                    <div className="market-price-subcopy">
                      {t("missing_miners_parts", { miners: item.totalMissingMinerCopies, parts: item.totalMissingParts })}
                    </div>
                  </td>
                  <td>
                    <div>{formatSpend(item.marketSpendEstimate, t)}</div>
                    <div className="market-price-subcopy">
                      {Number.isFinite(Number(item.savingsVsMarket))
                        ? t("gap_value", { value: formatMarketValue(item.savingsVsMarket, 2) })
                        : t("gap_unknown")}
                    </div>
                  </td>
                  <td>
                    <StatusBadge tone={item.decisionTone} label={rt(item.decisionLabel)} />
                    <div className={item.decisionTone === "positive" ? "positive" : item.decisionTone === "negative" ? "negative" : "muted"}>
                      {rt(item.decisionSummary)}
                    </div>
                  </td>
                  <td>
                    <details className="merge-details">
                      <summary>{t("show_recipe")}</summary>
                      <div className="merge-details-body">
                        <div className="merge-details-group">
                          <div className="merge-details-title">{t("required_miners")}</div>
                          <RequirementList items={item.requiredMiners} emptyText={t("no_miner_requirements")} type="miner" i18n={i18n} />
                        </div>
                        <div className="merge-details-group">
                          <div className="merge-details-title">{t("required_parts")}</div>
                          <RequirementList items={item.requiredParts} emptyText={t("no_part_requirements")} type="part" i18n={i18n} />
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
        <summary>{t("load_stages")}</summary>
        <div className="merge-stage-grid">
          {Array.isArray(mergePlanner.stages) && mergePlanner.stages.map((stage) => (
            <article key={stage.id} className="merge-stage-card">
              <div className="merge-stage-card-top">
                <div className="merge-stage-title">{rt(stage.label)}</div>
                <StatusBadge tone={stage.state === "idle" ? "neutral" : stage.state} label={StageStatusLabel(stage.state, t)} />
              </div>
              <div className="merge-stage-detail">{rt(stage.detail)}</div>
            </article>
          ))}
        </div>
      </details>

      <details className="merge-stage-panel merge-collapsible">
        <summary>{t("endpoint_diagnostics")}</summary>
        <div className="merge-diagnostic-grid">
          <DiagnosticsCard title={t("room")} diagnostics={mergePlanner.diagnostics?.room} i18n={i18n} />
          <DiagnosticsCard title={t("inventory_miners_status")} diagnostics={mergePlanner.diagnostics?.inventoryMiners} i18n={i18n} />
          <DiagnosticsCard title={t("parts_status")} diagnostics={mergePlanner.diagnostics?.inventoryParts} i18n={i18n} />
          <DiagnosticsCard title={t("forge_recipes")} diagnostics={mergePlanner.diagnostics?.recipes} i18n={i18n} />
        </div>
      </details>

      <details className="merge-stage-panel merge-collapsible">
        <summary>{t("load_log")}</summary>
        <pre className="market-logs-output muted">
          {Array.isArray(mergePlanner.logs) && mergePlanner.logs.length > 0
            ? mergePlanner.logs.map((entry) => log(entry)).join("\n")
            : t("merge_logs_empty")}
        </pre>
      </details>
    </section>
  );
}
