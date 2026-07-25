import { formatMarketValue, formatPowerFromEhs } from "../lib/power";
import { MinerVisual } from "./MinerVisual";

function buildMinerIdList(miners) {
  const ids = (Array.isArray(miners) ? miners : [])
    .map((miner) => String(miner?.id || "").trim())
    .filter(Boolean);
  if (ids.length === 0) return "";

  const visibleIds = ids.slice(0, 6).join(", ");
  return ids.length > 6 ? `${visibleIds}, +${ids.length - 6}` : visibleIds;
}

function DuplicateGroupMinerCell({ group }) {
  const miner = group.representative || group.miners?.[0] || {};
  return (
    <div className="market-miner-cell">
      <MinerVisual miner={miner} />
      <div className="market-miner-copy">
        <div>{miner.name || group.name}</div>
        <div className="market-miner-subcopy">{buildMinerIdList(group.miners)}</div>
      </div>
    </div>
  );
}

export function DuplicateMinersSection({ duplicateAnalysis, market, displayUnit, actions, i18n }) {
  const { t, rt } = i18n;
  const groups = Array.isArray(duplicateAnalysis?.duplicateGroups)
    ? duplicateAnalysis.duplicateGroups
    : [];
  const hasRoomMiners = Number(duplicateAnalysis?.totalMiners) > 0;

  return (
    <section className="card duplicate-miners-card">
      <div className="workspace-section-heading">
        <div>
          <p className="panel-eyebrow">{t("duplicates_eyebrow")}</p>
          <h2>{t("duplicates_title")}</h2>
          <p className="section-subtitle">{t("duplicates_subtitle")}</p>
        </div>
        <div className="card-actions">
          <button
            type="button"
            className="primary"
            onClick={actions.loadRoomMiners}
            disabled={market.roomMinersLoadInFlight}
          >
            {market.roomMinersLoadInFlight ? t("auth_checking") : t("load_room_miners")}
          </button>
        </div>
      </div>

      <div className="merge-summary-grid duplicate-summary-grid">
        <article className="insight-card insight-card-metric">
          <span className="insight-label">{t("duplicates_total_room")}</span>
          <div className="insight-value">{duplicateAnalysis.totalMiners}</div>
        </article>
        <article className="insight-card insight-card-metric">
          <span className="insight-label">{t("duplicates_groups")}</span>
          <div className={groups.length > 0 ? "insight-value positive" : "insight-value"}>{duplicateAnalysis.duplicateGroupCount}</div>
        </article>
        <article className="insight-card insight-card-metric">
          <span className="insight-label">{t("duplicates_extra_copies")}</span>
          <div className={duplicateAnalysis.duplicateExtraCopies > 0 ? "insight-value positive" : "insight-value"}>{duplicateAnalysis.duplicateExtraCopies}</div>
        </article>
        <article className="insight-card insight-card-metric">
          <span className="insight-label">{t("duplicates_incomplete")}</span>
          <div className={duplicateAnalysis.incompleteCount > 0 ? "insight-value warning" : "insight-value"}>{duplicateAnalysis.incompleteCount}</div>
        </article>
      </div>

      <p className="status-line">
        {hasRoomMiners
          ? t("duplicates_status_loaded", {
            eligible: duplicateAnalysis.strictEligibleCount,
            total: duplicateAnalysis.totalMiners,
          })
          : rt(market.roomMinersStatus)}
      </p>

      <div className="table-shell table-shell-large duplicate-table-shell">
        <table className="candidates-result-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t("miner")}</th>
              <th>{t("duplicates_copies")}</th>
              <th>{t("duplicates_level")}</th>
              <th>{t("power_unit_header", { unit: displayUnit })}</th>
              <th>{t("bonus_percent_header")}</th>
              <th>{t("width_header")}</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 ? (
              <tr>
                <td colSpan="7" className="muted">
                  {hasRoomMiners ? t("duplicates_empty") : t("duplicates_load_room_first")}
                </td>
              </tr>
            ) : (
              groups.map((group, index) => (
                <tr key={group.key}>
                  <td>{index + 1}</td>
                  <td><DuplicateGroupMinerCell group={group} /></td>
                  <td>{group.count}</td>
                  <td>L{group.level}</td>
                  <td>{formatPowerFromEhs(group.representative?.power, displayUnit)}</td>
                  <td>{formatMarketValue(group.representative?.bonusPercent, 2)}%</td>
                  <td>{group.width}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
