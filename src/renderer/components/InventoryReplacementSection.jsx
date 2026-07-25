import { formatMarketValue, formatPowerFromEhs } from "../lib/power";
import { MinerVisual } from "./MinerVisual";

function MinerCell({ miner, subtitle }) {
  return (
    <div className="market-miner-cell">
      <MinerVisual miner={miner} />
      <div className="market-miner-copy">
        <div>{miner.name}</div>
        {subtitle ? <div className="market-miner-subcopy">{subtitle}</div> : null}
      </div>
    </div>
  );
}

function buildMinerMeta(miner, t) {
  const parts = [];
  if (Number.isFinite(Number(miner?.level)) && Number(miner.level) > 0) {
    parts.push(`L${Math.floor(Number(miner.level))}`);
  }
  if (Number.isFinite(Number(miner?.width)) && Number(miner.width) > 0) {
    parts.push(`${t("width_header")} ${Math.floor(Number(miner.width))}`);
  }
  if (Number.isFinite(Number(miner?.bonusPercent))) {
    parts.push(`${formatMarketValue(miner.bonusPercent, 2)}% ${t("history_bonus").toLowerCase()}`);
  }
  return parts.join(" | ");
}

function ReplacementList({ miners, displayUnit, i18n }) {
  const { t } = i18n;
  const replacementMiners = Array.isArray(miners) ? miners : [];
  return (
    <div className="inventory-replacement-list">
      {replacementMiners.map((miner, index) => (
        <MinerCell
          key={`${miner.id || miner.name}-${index}`}
          miner={miner}
          subtitle={`${formatPowerFromEhs(miner.power, displayUnit)} | ${buildMinerMeta(miner, t)}`}
        />
      ))}
    </div>
  );
}

export function InventoryReplacementSection({ inventory, inventoryAnalysis, displayUnit, actions, i18n }) {
  const { t, rt } = i18n;
  const items = Array.isArray(inventoryAnalysis?.items) ? inventoryAnalysis.items : [];
  const hasInventory = Number(inventoryAnalysis?.totalInventoryCount) > 0;

  return (
    <section className="card inventory-replacement-card">
      <div className="workspace-section-heading">
        <div>
          <p className="panel-eyebrow">{t("inventory_replacement_eyebrow")}</p>
          <h2>{t("inventory_replacement_title")}</h2>
          <p className="section-subtitle">{t("inventory_replacement_subtitle")}</p>
        </div>
        <div className="card-actions">
          <button
            type="button"
            className="primary"
            onClick={actions.loadInventoryReplacementData}
            disabled={inventory.loading}
          >
            {inventory.loading ? t("auth_checking") : t("load_inventory_replacements")}
          </button>
        </div>
      </div>

      <div className="merge-summary-grid inventory-summary-grid">
        <article className="insight-card insight-card-metric">
          <span className="insight-label">{t("inventory_replacement_inventory")}</span>
          <div className="insight-value">{inventoryAnalysis.totalInventoryCount}</div>
        </article>
        <article className="insight-card insight-card-metric">
          <span className="insight-label">{t("inventory_replacement_room")}</span>
          <div className="insight-value">{inventoryAnalysis.roomMinersCount}</div>
        </article>
        <article className="insight-card insight-card-metric">
          <span className="insight-label">{t("inventory_replacement_profitable")}</span>
          <div className={items.length > 0 ? "insight-value positive" : "insight-value"}>{inventoryAnalysis.profitableCount}</div>
        </article>
        <article className="insight-card insight-card-metric">
          <span className="insight-label">{t("inventory_replacement_duplicate_aware")}</span>
          <div className={inventoryAnalysis.duplicateAwareCount > 0 ? "insight-value warning" : "insight-value"}>{inventoryAnalysis.duplicateAwareCount}</div>
        </article>
      </div>

      <p className="status-line">{rt(inventory.status)}</p>
      {inventoryAnalysis.error ? <p className="error">{rt(inventoryAnalysis.error)}</p> : null}

      <div className="table-shell table-shell-large inventory-table-shell">
        <table className="candidates-result-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t("inventory_replacement_put")}</th>
              <th>{t("inventory_replacement_remove")}</th>
              <th>{t("gain_unit_header", { unit: displayUnit })}</th>
              <th>{t("inventory_replacement_base_delta")}</th>
              <th>{t("inventory_replacement_bonus_delta")}</th>
              <th>{t("inventory_replacement_projected")}</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan="7" className="muted">
                  {hasInventory ? t("inventory_replacement_empty") : t("inventory_replacement_load_first")}
                </td>
              </tr>
            ) : (
              items.map((item, index) => (
                <tr key={item.key}>
                  <td>{index + 1}</td>
                  <td>
                    <MinerCell
                      miner={item.inventoryMiner}
                      subtitle={`${formatPowerFromEhs(item.inventoryMiner.power, displayUnit)} | ${buildMinerMeta(item.inventoryMiner, t)} | ${t("inventory_replacement_count", { count: item.inventoryCount })}`}
                    />
                  </td>
                  <td>
                    <ReplacementList miners={item.replacementMiners} displayUnit={displayUnit} i18n={i18n} />
                  </td>
                  <td className="positive">{formatPowerFromEhs(item.gainPower, displayUnit)}</td>
                  <td>{formatPowerFromEhs(item.basePowerDelta, displayUnit)}</td>
                  <td>{formatMarketValue(item.bonusPercentDelta, 2)}%</td>
                  <td>
                    <div>{formatPowerFromEhs(item.projectedTotalPower, displayUnit)}</div>
                    <div className="market-miner-subcopy">{formatMarketValue(item.projectedBonusPercent, 2)}%</div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
