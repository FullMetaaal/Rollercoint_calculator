import "../../styles.css";
import { useEffect, useMemo, useState } from "react";
import { AuthBanner } from "./components/AuthBanner";
import { ComparisonSection } from "./components/ComparisonSection";
import { CurrentSystemSection } from "./components/CurrentSystemSection";
import { DuplicateMinersSection } from "./components/DuplicateMinersSection";
import { MarketSection } from "./components/MarketSection";
import { MergePlannerSection } from "./components/MergePlannerSection";
import { ProfitabilitySection } from "./components/ProfitabilitySection";
import { useAppController } from "./hooks/useAppController";
import { createI18n, persistLocale, restoreLocale } from "./lib/i18n";
import { writeRendererLog } from "./lib/runtime";

function scrollToId(targetId) {
  const element = document.getElementById(targetId);
  if (!element) return;
  element.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function App() {
  const {
    currentSystem,
    currentSystemHistory,
    isPowerHistoryExpanded,
    market,
    comparison,
    comparisonAnalysis,
    duplicateAnalysis,
    mergePlanner,
    mergeAnalysis,
    profitability,
    profitabilityHistory,
    recommendations,
    actions,
  } = useAppController();
  const [locale, setLocale] = useState(() => restoreLocale());
  const i18n = useMemo(() => createI18n(locale), [locale]);
  const { t } = i18n;

  useEffect(() => {
    writeRendererLog("React App mounted");
  }, []);

  useEffect(() => {
    persistLocale(locale);
  }, [locale]);

  const workspaceNavKey =
    market.primaryTab === "comparison"
      ? "comparison"
      : market.primaryTab === "profitability"
        ? "profitability"
      : market.primaryTab === "duplicates"
        ? "duplicates"
      : market.primaryTab === "merge"
        ? "merge"
        : "market";
  return (
    <main className="container">
      <section className="workspace-shell">
        <header className="workspace-header">
          <div className="workspace-brand">
            <div className="brand-mark" aria-hidden="true">RC</div>
            <div className="brand-copy">
              <span className="brand-label">RollerCoin Calculator</span>
              <span className="brand-subtitle">{t("brand_subtitle")}</span>
            </div>
          </div>

          <div className="workspace-header-side">
            <nav className="workspace-nav" aria-label="Sections">
              <button
                type="button"
                className={`workspace-nav-link ${workspaceNavKey === "currentSystem" ? "is-active" : ""}`}
                onClick={() => scrollToId("currentSystemSection")}
              >
                {t("nav_current_system")}
              </button>
              <button
                type="button"
                className={`workspace-nav-link ${workspaceNavKey === "market" ? "is-active" : ""}`}
                onClick={() => {
                  actions.setPrimaryTab("market");
                  scrollToId("marketTabPanel");
                }}
              >
                {t("nav_market_scanner")}
              </button>
              <button
                type="button"
                className={`workspace-nav-link ${workspaceNavKey === "duplicates" ? "is-active" : ""}`}
                onClick={() => {
                  actions.setPrimaryTab("duplicates");
                  scrollToId("duplicatesTabPanel");
                }}
              >
                {t("nav_duplicates")}
              </button>
              <button
                type="button"
                className={`workspace-nav-link ${workspaceNavKey === "merge" ? "is-active" : ""}`}
                onClick={() => {
                  actions.setPrimaryTab("merge");
                  scrollToId("mergeTabPanel");
                }}
              >
                {t("nav_merge_planner")}
              </button>
              <button
                type="button"
                className={`workspace-nav-link ${workspaceNavKey === "profitability" ? "is-active" : ""}`}
                onClick={() => {
                  actions.setPrimaryTab("profitability");
                  scrollToId("profitabilityTabPanel");
                }}
              >
                {t("nav_profitability")}
              </button>
              <button
                type="button"
                className={`workspace-nav-link ${workspaceNavKey === "comparison" ? "is-active" : ""}`}
                onClick={() => {
                  actions.setPrimaryTab("comparison");
                  scrollToId("candidatesTabPanel");
                }}
              >
                {t("nav_comparison")}
              </button>
            </nav>
            <div className="workspace-header-actions">
              <div className="workspace-language-switch" role="group" aria-label={t("language")}>
                <button
                  type="button"
                  className={`workspace-language-btn ${locale === "en" ? "is-active" : ""}`}
                  onClick={() => setLocale("en")}
                >
                  {t("language_en")}
                </button>
                <button
                  type="button"
                  className={`workspace-language-btn ${locale === "ru" ? "is-active" : ""}`}
                  onClick={() => setLocale("ru")}
                >
                  {t("language_ru")}
                </button>
              </div>
            </div>
          </div>
        </header>

        <AuthBanner
          market={market}
          onAuthAction={actions.handleAuthAction}
          onCheckUpdates={actions.checkForUpdates}
          i18n={i18n}
        />

        <CurrentSystemSection
          currentSystem={currentSystem}
          history={currentSystemHistory}
          isHistoryExpanded={isPowerHistoryExpanded}
          currentTotalText={comparisonAnalysis.currentTotalText}
          currentBonusText={comparisonAnalysis.currentBonusText}
          onFieldChange={actions.updateCurrentSystemField}
          onCommitHistory={actions.commitCurrentSystemHistory}
          onSyncPower={actions.syncCurrentPower}
          onClearHistory={actions.clearHistory}
          onToggleHistory={() => actions.setIsPowerHistoryExpanded((value) => !value)}
          syncStatus={market.currentPowerSyncStatus}
          syncing={market.currentPowerSyncInFlight}
          i18n={i18n}
        />

        <section className="app-tabs">
          <div className="workspace-section-heading workspace-section-heading-tabs">
            <div>
              <p className="panel-eyebrow">{t("tools")}</p>
              <h2>{t("calculation_workspace")}</h2>
            </div>
            <div className="tab-list" role="tablist" aria-label="Tools">
              <button
                id="marketTabBtn"
                type="button"
                className={`tab-button ${market.primaryTab === "market" ? "is-active" : ""}`}
                onClick={() => actions.setPrimaryTab("market")}
              >
                {t("nav_market_scanner")}
              </button>
              <button
                id="duplicatesTabBtn"
                type="button"
                className={`tab-button ${market.primaryTab === "duplicates" ? "is-active" : ""}`}
                onClick={() => actions.setPrimaryTab("duplicates")}
              >
                {t("nav_duplicates")}
              </button>
              <button
                id="mergeTabBtn"
                type="button"
                className={`tab-button ${market.primaryTab === "merge" ? "is-active" : ""}`}
                onClick={() => actions.setPrimaryTab("merge")}
              >
                {t("nav_merge_planner")}
              </button>
              <button
                id="profitabilityTabBtn"
                type="button"
                className={`tab-button ${market.primaryTab === "profitability" ? "is-active" : ""}`}
                onClick={() => actions.setPrimaryTab("profitability")}
              >
                {t("nav_profitability")}
              </button>
              <button
                id="candidatesTabBtn"
                type="button"
                className={`tab-button ${market.primaryTab === "comparison" ? "is-active" : ""}`}
                onClick={() => actions.setPrimaryTab("comparison")}
              >
                {t("candidate_comparison")}
              </button>
            </div>
          </div>

          <section id="marketTabPanel" className={`tab-panel ${market.primaryTab === "market" ? "is-active" : ""}`} hidden={market.primaryTab !== "market"}>
            <MarketSection
              market={market}
              recommendations={recommendations}
              displayUnit={currentSystem.displayUnit}
              actions={actions}
              i18n={i18n}
            />
          </section>

          <section id="duplicatesTabPanel" className={`tab-panel ${market.primaryTab === "duplicates" ? "is-active" : ""}`} hidden={market.primaryTab !== "duplicates"}>
            <DuplicateMinersSection
              duplicateAnalysis={duplicateAnalysis}
              market={market}
              displayUnit={currentSystem.displayUnit}
              actions={actions}
              i18n={i18n}
            />
          </section>

          <section id="mergeTabPanel" className={`tab-panel ${market.primaryTab === "merge" ? "is-active" : ""}`} hidden={market.primaryTab !== "merge"}>
            <MergePlannerSection
              mergePlanner={mergePlanner}
              mergeAnalysis={mergeAnalysis}
              displayUnit={currentSystem.displayUnit}
              actions={actions}
              i18n={i18n}
            />
          </section>

          <section id="profitabilityTabPanel" className={`tab-panel ${market.primaryTab === "profitability" ? "is-active" : ""}`} hidden={market.primaryTab !== "profitability"}>
            <ProfitabilitySection
              profitability={profitability}
              profitabilityHistory={profitabilityHistory}
              actions={actions}
              i18n={i18n}
            />
          </section>

          <section id="candidatesTabPanel" className={`tab-panel ${market.primaryTab === "comparison" ? "is-active" : ""}`} hidden={market.primaryTab !== "comparison"}>
            <ComparisonSection
              comparison={comparison}
              comparisonAnalysis={comparisonAnalysis}
              actions={actions}
              i18n={i18n}
            />
          </section>
        </section>
      </section>
    </main>
  );
}
