import "../../styles.css";
import { useEffect } from "react";
import { AuthBanner } from "./components/AuthBanner";
import { ComparisonSection } from "./components/ComparisonSection";
import { CurrentSystemSection } from "./components/CurrentSystemSection";
import { MarketSection } from "./components/MarketSection";
import { useAppController } from "./hooks/useAppController";
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
    recommendations,
    actions,
  } = useAppController();

  useEffect(() => {
    writeRendererLog("React App mounted");
  }, []);

  const workspaceNavKey = market.primaryTab === "comparison" ? "comparison" : "market";

  return (
    <main className="container">
      <section className="workspace-shell">
        <header className="workspace-header">
          <div className="workspace-brand">
            <div className="brand-mark" aria-hidden="true">RC</div>
            <div className="brand-copy">
              <span className="brand-label">RollerCoin Calculator</span>
              <span className="brand-subtitle">Production-style market and comparison console</span>
            </div>
          </div>

          <div className="workspace-header-side">
            <nav className="workspace-nav" aria-label="Sections">
              <button
                type="button"
                className={`workspace-nav-link ${workspaceNavKey === "currentSystem" ? "is-active" : ""}`}
                onClick={() => scrollToId("currentSystemSection")}
              >
                Current System
              </button>
              <button
                type="button"
                className={`workspace-nav-link ${workspaceNavKey === "market" ? "is-active" : ""}`}
                onClick={() => {
                  actions.setPrimaryTab("market");
                  scrollToId("marketTabPanel");
                }}
              >
                Market Scanner
              </button>
              <button
                type="button"
                className={`workspace-nav-link ${workspaceNavKey === "comparison" ? "is-active" : ""}`}
                onClick={() => {
                  actions.setPrimaryTab("comparison");
                  scrollToId("candidatesTabPanel");
                }}
              >
                Comparison
              </button>
            </nav>
          </div>
        </header>

        <AuthBanner
          market={market}
          onAuthAction={actions.handleAuthAction}
          onCheckUpdates={actions.checkForUpdates}
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
        />

        <section className="app-tabs">
          <div className="workspace-section-heading workspace-section-heading-tabs">
            <div>
              <p className="panel-eyebrow">Tools</p>
              <h2>Calculation Workspace</h2>
            </div>
            <div className="tab-list" role="tablist" aria-label="Tools">
              <button
                id="marketTabBtn"
                type="button"
                className={`tab-button ${market.primaryTab === "market" ? "is-active" : ""}`}
                onClick={() => actions.setPrimaryTab("market")}
              >
                Market Scanner
              </button>
              <button
                id="candidatesTabBtn"
                type="button"
                className={`tab-button ${market.primaryTab === "comparison" ? "is-active" : ""}`}
                onClick={() => actions.setPrimaryTab("comparison")}
              >
                Candidate Comparison
              </button>
            </div>
          </div>

          <section id="marketTabPanel" className={`tab-panel ${market.primaryTab === "market" ? "is-active" : ""}`} hidden={market.primaryTab !== "market"}>
            <MarketSection
              market={market}
              recommendations={recommendations}
              displayUnit={currentSystem.displayUnit}
              actions={actions}
            />
          </section>

          <section id="candidatesTabPanel" className={`tab-panel ${market.primaryTab === "comparison" ? "is-active" : ""}`} hidden={market.primaryTab !== "comparison"}>
            <ComparisonSection
              comparison={comparison}
              comparisonAnalysis={comparisonAnalysis}
              actions={actions}
            />
          </section>
        </section>
      </section>
    </main>
  );
}
