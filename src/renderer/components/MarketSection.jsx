import { POWER_MULTIPLIER, formatMarketValue, formatPowerFromPhs } from "../lib/power";
import { MinerVisual } from "./MinerVisual";

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

function buildBudgetLabel(recommendations, t) {
  if (recommendations?.recommendationMode === "budget" && !Number.isFinite(Number(recommendations?.budget))) {
    return t("budget_unlimited");
  }
  return Number.isFinite(Number(recommendations?.budget))
    ? `${t("budget_rlt")}: ${formatMarketValue(recommendations.budget, 2)} RLT`
    : t("budget_not_set");
}

function buildFilterChipValue(value, fallback = "Any") {
  const normalized = String(value || "").trim();
  return normalized ? normalized : fallback;
}

function getRoomWidthModeLabel(value, t) {
  if (value === "1") return t("small_width");
  if (value === "2") return t("large_width");
  return t("any_width");
}

function getReplacementStrategyLabel(value, t) {
  if (value === "flex") return t("replacement_flex");
  if (value === "strict") return t("replacement_strict");
  return t("replacement_off");
}

function getRecommendationModeLabel(value, t) {
  return value === "budget" ? t("recommendation_budget") : t("recommendation_single");
}

function formatSignedPercent(value, fractionDigits = 1) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "-";
  const sign = numericValue > 0 ? "+" : "";
  return `${sign}${formatMarketValue(numericValue, fractionDigits)}%`;
}

function formatSignedPower(value, displayUnit) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "-";
  const sign = numericValue > 0 ? "+" : "";
  return `${sign}${formatPowerFromPhs(numericValue, displayUnit)}`;
}

function buildFairPriceDetailText(item, t) {
  const referencePrice = Number(item?.fairPriceReferencePrice);
  const samples = Number(item?.fairPriceHistorySamples ?? item?.priceHistoryStats?.totalSamples);
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    return t("not_enough_history");
  }

  const deltaText = formatSignedPercent(item?.fairPriceDeltaPercent, 1);
  const sampleText = Number.isFinite(samples) && samples > 0
    ? ` | ${t("samples", { count: samples, suffix: samples === 1 ? "" : "s" })}`
    : "";
  return t("fair_price_median", {
    price: formatMarketValue(referencePrice, 2),
    delta: deltaText,
    sampleText,
  });
}

function buildFairPriceReasonText(item, t) {
  const delta = Number(item?.fairPriceDeltaPercent);
  if (!Number.isFinite(delta)) return "";
  if (delta <= -8) return t("fair_price_reason_cheap", { delta: formatSignedPercent(delta, 1) });
  if (delta >= 8) return t("fair_price_reason_overpriced", { delta: formatSignedPercent(delta, 1) });
  return t("fair_price_reason_near", { delta: formatSignedPercent(delta, 1) });
}

function sumMinerWidths(miners) {
  return (Array.isArray(miners) ? miners : []).reduce((sum, miner) => {
    const width = Number(miner?.width);
    return Number.isFinite(width) && width > 0 ? sum + Math.floor(width) : sum;
  }, 0);
}

function buildRankingReasonText(item, reasonMode, displayUnit, t) {
  const totalGainText = formatSignedPower(item?.finalTotalPowerGain ?? item?.gainPower, displayUnit);
  const efficiencyText = Number.isFinite(Number(item?.gainPerPrice))
    ? formatPowerFromPhs(item.gainPerPrice, displayUnit)
    : "-";
  const priceText = `${formatMarketValue(item?.price, 2)} ${item?.currency || "RLT"}`;
  const fairPriceText = buildFairPriceReasonText(item, t);

  if (reasonMode === "gainPower") {
    return t("rank_reason_gain_power", {
      totalGain: totalGainText,
      price: priceText,
      efficiency: efficiencyText,
      fairPriceText,
    }).trim();
  }

  return t("rank_reason_gain_per_price", {
    efficiency: efficiencyText,
    totalGain: totalGainText,
    price: priceText,
    fairPriceText,
  }).trim();
}

function buildReplacementReasonText(item, displayUnit, t, rt) {
  const replacementMiners = Array.isArray(item?.replacementMiners) ? item.replacementMiners : [];
  if (replacementMiners.length === 0) {
    if (typeof item?.replaceText === "string" && item.replaceText && item.replaceText !== "-") {
      return rt(item.replaceText);
    }
    return t("replace_reason_no_room");
  }

  const freedWidth = sumMinerWidths(replacementMiners);
  const removedBasePower = Number(item?.removedPowerThs) / POWER_MULTIPLIER["Ph/s"];
  const removedBonusPercent = Number(item?.removedBonusPercent) || 0;
  const slotText = freedWidth > 0 ? t("slot_text_width", { width: freedWidth }) : t("slot_text_generic");
  return t("replace_reason_with_loss", {
    slotText,
    removedPower: formatPowerFromPhs(removedBasePower, displayUnit),
    removedBonus: `${formatMarketValue(removedBonusPercent, 2)}%`,
  });
}

function MinerCard({ miner, tone = "buy", displayUnit = "Ph/s", showPrice = false, i18n }) {
  const { t } = i18n;
  const hasPrice = showPrice && Number.isFinite(Number(miner?.price)) && Number(miner.price) > 0;
  const currency = typeof miner?.currency === "string" && miner.currency ? miner.currency : "RLT";

  return (
    <div className={`suggestion-miner-card suggestion-miner-card-${tone}`}>
      <MinerVisual miner={miner} className="suggestion-miner-visual" />
      <div className="suggestion-miner-copy">
        <div className="suggestion-miner-name">{miner.name}</div>
        <div className="suggestion-miner-meta">
          {hasPrice ? (
            <span className="suggestion-miner-price">
              {formatMarketValue(miner.price, 2)} {currency}
            </span>
          ) : null}
          <span className="positive">{formatPowerFromPhs(miner.power, displayUnit)}</span>
          <span className={Number(miner.bonusPercent) > 0 ? "positive" : "muted"}>
            {formatMarketValue(miner.bonusPercent, 2)}% {t("history_bonus").toLowerCase()}
          </span>
          {Number.isFinite(Number(miner.width)) ? <span className="muted">W{Math.floor(Number(miner.width))}</span> : null}
        </div>
      </div>
    </div>
  );
}

function BreakdownCard({ label, value, detail, tone = "neutral" }) {
  return (
    <div className={`suggestion-breakdown-card suggestion-breakdown-card-${tone}`}>
      <span className="suggestion-breakdown-label">{label}</span>
      <strong className="suggestion-breakdown-value">{value}</strong>
      <span className="suggestion-breakdown-detail">{detail}</span>
    </div>
  );
}

function SuggestionItem({ item, index, displayUnit, reasonMode, currentTotalPower, i18n }) {
  const { t, rt } = i18n;
  const purchaseMiners = Array.isArray(item.purchaseMiners) && item.purchaseMiners.length > 0
    ? item.purchaseMiners
    : [item];
  const replacementMiners = Array.isArray(item.replacementMiners) ? item.replacementMiners : [];
  const showBundleMinerPrices = purchaseMiners.length > 1;
  const currentTotalText = Number.isFinite(Number(currentTotalPower))
    ? formatPowerFromPhs(currentTotalPower, displayUnit)
    : "-";
  const projectedTotalText = formatPowerFromPhs(item.projectedTotalPower, displayUnit);
  const projectedBaseText = formatPowerFromPhs(item.projectedBasePower, displayUnit);
  const efficiencyText = Number.isFinite(Number(item.gainPerPrice))
    ? formatPowerFromPhs(item.gainPerPrice, displayUnit)
    : "-";
  const fairPriceText = item?.fairPriceLabel
    ? `${item.fairPriceLabel}${Number.isFinite(Number(item?.fairPriceDeltaPercent)) ? ` (${formatSignedPercent(item.fairPriceDeltaPercent, 1)})` : ""}`
    : rt("New");

  return (
    <li className="suggestion-item">
      <div className="suggestion-line">
        <span className="suggestion-rank">{index + 1}.</span>
        <div className="suggestion-block">
          <div className="suggestion-header">
            <div className="suggestion-header-row">
              <span className={`suggestion-badge ${item.isBundle ? "suggestion-badge-bundle" : "suggestion-badge-single"}`}>
                {item.isBundle ? t("miners_count", { count: item.purchaseCount }) : t("single_miner")}
              </span>
              <span className="suggestion-badge suggestion-badge-price">
                {formatMarketValue(item.price, 2)} {item.currency || "RLT"}
              </span>
            </div>
            <p className="suggestion-why">{buildRankingReasonText(item, reasonMode, displayUnit, t)}</p>
          </div>

          <div className="suggestion-panels">
            <div className="suggestion-panel">
              <span className="suggestion-label">{t("buy")}</span>
              <div className="suggestion-value suggestion-buy-list">
                {purchaseMiners.map((miner, minerIndex) => (
                  <MinerCard
                    key={`${miner.id || miner.name}-${minerIndex}`}
                    miner={miner}
                    tone="buy"
                    displayUnit={displayUnit}
                    showPrice={showBundleMinerPrices}
                    i18n={i18n}
                  />
                ))}
              </div>
            </div>

            <div className="suggestion-panel suggestion-panel-remove">
              <span className="suggestion-label suggestion-label-remove">{t("replace")}</span>
              <div className="suggestion-value">
                {replacementMiners.length > 0 ? (
                  <div className="suggestion-remove-list">
                    {replacementMiners.map((miner, minerIndex) => (
                      <MinerCard
                        key={`${miner.id || miner.name}-${minerIndex}`}
                        miner={miner}
                        tone="remove"
                        displayUnit={displayUnit}
                        i18n={i18n}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="suggestion-empty-slot">{rt(item.replaceText) || t("no_replacement_needed")}</div>
                )}
              </div>
              <p className="suggestion-panel-note">{buildReplacementReasonText(item, displayUnit, t, rt)}</p>
            </div>
          </div>

          <div className="suggestion-breakdown">
            <BreakdownCard
              label={t("breakdown_base_gain")}
              value={formatSignedPower(item.basePowerGain, displayUnit)}
              detail={t("raw_base_delta", { value: formatSignedPower(item.basePowerDelta, displayUnit) })}
              tone="positive"
            />
            <BreakdownCard
              label={t("breakdown_bonus_gain")}
              value={formatSignedPower(item.bonusPowerGain, displayUnit)}
              detail={t("bonus_change", { value: formatSignedPercent(item.bonusPercentDelta, 2) })}
              tone="neutral"
            />
            <BreakdownCard
              label={t("breakdown_final_gain")}
              value={formatSignedPower(item.finalTotalPowerGain ?? item.gainPower, displayUnit)}
              detail={t("current_to_projected", { current: currentTotalText, projected: projectedTotalText })}
              tone="accent"
            />
          </div>

          <div className="suggestion-metrics">
            <span>{t("gain_per_rlt", { value: efficiencyText })}</span>
            <span>{t("projected_base", { value: projectedBaseText })}</span>
            <span>{t("projected_bonus", { value: `${formatMarketValue(item.projectedBonusPercent, 2)}%` })}</span>
            <span>{t("fair_price", { value: rt(fairPriceText) })}</span>
          </div>
        </div>
      </div>
    </li>
  );
}

function SuggestionGroup({ title, description, items, displayUnit, emptyText, reasonMode, currentTotalPower, i18n }) {
  return (
    <div className="suggestion-group">
      <div className="suggestion-title-row">
        <div className="suggestion-title">{title}</div>
        {description ? <p className="suggestion-group-description">{description}</p> : null}
      </div>
      <ol className="suggestion-list">
        {items.length > 0 ? (
          items.map((item, index) => (
            <SuggestionItem
              key={`${item.bundleKey || item.offerKey || item.name}-${index}`}
              item={item}
              index={index}
              displayUnit={displayUnit}
              reasonMode={reasonMode}
              currentTotalPower={currentTotalPower}
              i18n={i18n}
            />
          ))
        ) : (
          <li className="muted">{emptyText}</li>
        )}
      </ol>
    </div>
  );
}

function UpgradeSuggestions({ recommendations, displayUnit, i18n }) {
  const { t } = i18n;
  const cheaperItems = Array.isArray(recommendations.cheaperUpgradeItems) ? recommendations.cheaperUpgradeItems : [];
  const maxPowerItems = Array.isArray(recommendations.maxPowerUpgradeItems) ? recommendations.maxPowerUpgradeItems : [];

  if (cheaperItems.length === 0 && maxPowerItems.length === 0) {
    return (
      <div id="roomReplacementSuggestions" className="room-replacement-suggestions muted">
        {t("replacement_suggestions_empty")}
      </div>
    );
  }

  const budgetLabel = buildBudgetLabel(recommendations, t);

  return (
    <div id="roomReplacementSuggestions" className="room-replacement-suggestions">
      <div className="suggestion-summary-bar">
        <span>{budgetLabel}</span>
        <span>{t("dashboard_stat_current_total")}: {formatPowerFromPhs(recommendations.currentTotalPower, displayUnit)}</span>
        <span>{t("profitable_options_count", { count: recommendations.recommendedCount })}</span>
      </div>
      <SuggestionGroup
        title={t("best_value_upgrades")}
        description={t("best_value_upgrades_copy")}
        items={cheaperItems}
        displayUnit={displayUnit}
        emptyText={t("no_upgrade_suggestions")}
        reasonMode="gainPerPrice"
        currentTotalPower={recommendations.currentTotalPower}
        i18n={i18n}
      />
      <SuggestionGroup
        title={t("highest_total_upgrades")}
        description={t("highest_total_upgrades_copy")}
        items={maxPowerItems}
        displayUnit={displayUnit}
        emptyText={t("no_power_suggestions")}
        reasonMode="gainPower"
        currentTotalPower={recommendations.currentTotalPower}
        i18n={i18n}
      />
    </div>
  );
}

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

function RoomMinersTable({ market, recommendations, displayUnit, onShowMore, i18n }) {
  const { t } = i18n;
  const rows = recommendations.roomMinersSorted.slice(0, market.visibleRoomMinersCount);

  return (
    <>
      <div className="market-sort-row">
        <label>
          {t("search_room_miners")}
          <input
            id="roomMinersSearch"
            type="text"
            placeholder={t("room_miners_placeholder")}
            value={market.settings.roomMinersSearch}
            onChange={(event) => market.actions.updateMarketSetting("roomMinersSearch", event.target.value)}
          />
        </label>
        <label>
          {t("sort_room_miners_by")}
          <select
            id="roomMinersSortMode"
            value={market.settings.roomMinersSortMode}
            onChange={(event) => market.actions.updateMarketSetting("roomMinersSortMode", event.target.value)}
          >
            <option value="powerDesc">{t("sort_power_desc")}</option>
            <option value="bonusDesc">{t("sort_bonus_desc")}</option>
            <option value="widthAsc">{t("sort_width_asc")}</option>
            <option value="nameAsc">{t("sort_name_asc")}</option>
          </select>
        </label>
        <span id="roomMinersCountInfo" className="muted">
          {t("total_count", { count: recommendations.roomMinersSorted.length })}
        </span>
      </div>
      <div className="table-shell">
        <table id="roomMinersTable" className="candidates-result-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t("room_miners")}</th>
              <th id="roomMinersPowerHeader">{t("power_unit_header", { unit: displayUnit })}</th>
              <th>{t("bonus_percent_header")}</th>
              <th>{t("width_header")}</th>
            </tr>
          </thead>
          <tbody id="roomMinersBody">
            {rows.length === 0 ? (
              <tr>
                <td colSpan="5" className="muted">{t("room_miners_empty")}</td>
              </tr>
            ) : (
              rows.map((miner, index) => (
                <tr key={miner.id}>
                  <td>{index + 1}</td>
                  <td>
                    <MinerCell miner={miner} subtitle={buildMinerMeta(miner, t)} />
                  </td>
                  <td>{formatPowerFromPhs(miner.power, displayUnit)}</td>
                  <td>{formatMarketValue(miner.bonusPercent, 2)}%</td>
                  <td>{miner.width || "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="table-pagination">
        <button
          id="showMoreRoomMinersBtn"
          type="button"
          className="ghost"
          hidden={market.visibleRoomMinersCount >= recommendations.roomMinersSorted.length}
          onClick={onShowMore}
        >
          {t("show_more_25")}
        </button>
      </div>
    </>
  );
}

function MarketResultsTable({ market, recommendations, displayUnit, onShowMore, i18n }) {
  const { t, rt } = i18n;
  const rows = recommendations.items.slice(0, market.visibleMarketResultsCount);

  return (
    <>
      <div className="market-sort-row">
        <label>
          {t("sort_market_results_by")}
          <select
            id="marketSortMode"
            value={market.settings.sortMode}
            onChange={(event) => market.actions.updateMarketSetting("sortMode", event.target.value)}
          >
            <option value="gainPerPrice">{t("gain_sort_rlt")}</option>
            <option id="marketSortGainPowerOption" value="gainPower">{t("gain_sort_power", { unit: displayUnit })}</option>
            <option value="fairPrice">{t("gain_sort_fair_price")}</option>
          </select>
        </label>
        <span id="marketResultsCountInfo" className="muted">
          {t("visible_recommendations", { count: recommendations.items.length })}
        </span>
      </div>
      <div className="table-shell table-shell-large">
        <table id="marketResultsTable" className="candidates-result-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t("miner")}</th>
              <th>{t("market_price")}</th>
              <th id="marketResultsPowerHeader">{t("power_unit_header", { unit: displayUnit })}</th>
              <th>{t("bonus_percent_header")}</th>
              <th>{t("width_header")}</th>
              <th id="marketResultsGainHeader">{t("gain_unit_header", { unit: displayUnit })}</th>
              <th id="marketResultsGainPerPriceHeader">{t("gain_per_rlt_header", { unit: displayUnit })}</th>
              <th>{t("fair_price_header")}</th>
            </tr>
          </thead>
          <tbody id="marketResultsBody">
            {rows.length === 0 ? (
              <tr>
                <td colSpan="9" className="muted">{t("market_candidates_empty")}</td>
              </tr>
            ) : (
              rows.map((miner, index) => {
                const leadMiner =
                  Array.isArray(miner.purchaseMiners) && miner.purchaseMiners.length > 0
                    ? miner.purchaseMiners[0]
                    : miner;
                const subtitle = miner.purchaseCount > 1
                  ? t("bundle_of", { count: miner.purchaseCount, names: miner.purchaseMiners.map((entry) => entry.name).join(" + ") })
                  : buildMinerMeta(leadMiner, t);

                return (
                  <tr key={`${miner.bundleKey || miner.offerKey || miner.name}-${index}`}>
                    <td>{index + 1}</td>
                    <td>
                      <MinerCell miner={leadMiner} subtitle={subtitle} />
                    </td>
                    <td>
                      <div>{formatMarketValue(miner.price, 2)}</div>
                      <div className="market-price-subcopy">{buildFairPriceDetailText(miner, t)}</div>
                    </td>
                    <td>{formatPowerFromPhs(miner.power, displayUnit)}</td>
                    <td>{formatMarketValue(miner.bonusPercent, 2)}%</td>
                    <td>{miner.widthDisplay || miner.width || "-"}</td>
                    <td>{formatPowerFromPhs(miner.gainPower, displayUnit)}</td>
                    <td>{Number.isFinite(miner.gainPerPrice) ? formatPowerFromPhs(miner.gainPerPrice, displayUnit) : "-"}</td>
                    <td>
                      <div className={`market-fair-price-badge market-fair-price-${miner.fairPriceCategory || "no-history"}`}>
                        {rt(miner.fairPriceLabel || "New")}
                      </div>
                      <div className="market-price-subcopy">
                        {Number.isFinite(Number(miner.fairPriceDeltaPercent))
                          ? `${formatSignedPercent(miner.fairPriceDeltaPercent, 1)} ${rt("vs median")}`
                          : t("waiting_for_samples")}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="table-pagination">
        <button
          id="showMoreMarketResultsBtn"
          type="button"
          className="ghost"
          hidden={market.visibleMarketResultsCount >= recommendations.items.length}
          onClick={onShowMore}
        >
          {t("show_more_25")}
        </button>
      </div>
    </>
  );
}

function MarketLogs({ logs, i18n }) {
  const { t, log } = i18n;
  return (
    <div className="market-logs">
      <div className="header-row">
        <h3>{t("load_logs_title")}</h3>
      </div>
      <pre id="marketLogsOutput" className="market-logs-output muted">
        {logs.length === 0 ? t("load_logs_empty_market") : logs.map((entry) => log(entry)).join("\n")}
      </pre>
    </div>
  );
}

export function MarketSection({ market, recommendations, displayUnit, actions, i18n }) {
  const { t, rt } = i18n;
  const marketControlChips = [
    t("market_filter_room_width", { value: getRoomWidthModeLabel(market.settings.roomWidthMode, t) }),
    t("market_filter_replacement", { value: getReplacementStrategyLabel(market.settings.replacementStrategy, t) }),
    t("market_filter_mode", { value: getRecommendationModeLabel(market.settings.recommendationMode, t) }),
    t("market_filter_budget", { value: buildFilterChipValue(market.settings.budget, rt("Unlimited")) }),
    t("market_filter_max_price", { value: buildFilterChipValue(market.settings.maxMinerPrice, rt("No cap")) }),
    t("market_filter_top_results", { value: buildFilterChipValue(market.settings.topN, t("all_results")) }),
  ];

  return (
    <section className="card card-market" id="marketCard">
      <div className="workspace-section-heading market-heading">
        <div>
          <p className="panel-eyebrow">{t("market_eyebrow")}</p>
          <h2>{t("market_title")}</h2>
          <p className="section-subtitle">{t("market_subtitle")}</p>
        </div>
      </div>

      <input id="rollercoinCookie" type="hidden" value={market.cookieHeader} readOnly />

      <div className="market-top-stack">
        <div className="market-control-grid">
          <article className="tool-control-card">
            <div className="control-card-head">
              <div>
                <h3>{t("room_context_title")}</h3>
                <p className="control-card-copy">{t("room_context_copy")}</p>
              </div>
            </div>
            <div className="grid-3">
              <label>
                {t("replace_by_width")}
                <select id="marketRoomWidthMode" value={market.settings.roomWidthMode} onChange={(event) => actions.updateMarketSetting("roomWidthMode", event.target.value)}>
                  <option value="any">{t("any_width")}</option>
                  <option value="1">{t("small_width")}</option>
                  <option value="2">{t("large_width")}</option>
                </select>
              </label>
              <label>
                {t("room_miners")}
                <button id="loadRoomMinersBtn" type="button" className="ghost" onClick={actions.loadRoomMiners} disabled={market.roomMinersLoadInFlight}>
                  {market.roomMinersLoadInFlight ? t("auth_checking") : t("load_room_miners")}
                </button>
              </label>
              <label>
                {t("replacement_behavior")}
                <select id="marketReplacementStrategy" value={market.settings.replacementStrategy} onChange={(event) => actions.updateMarketSetting("replacementStrategy", event.target.value)}>
                  <option value="off">{t("replacement_off")}</option>
                  <option value="strict">{t("replacement_strict")}</option>
                  <option value="flex">{t("replacement_flex")}</option>
                </select>
              </label>
            </div>
            <p className="tool-control-note">
              {t("room_context_note")}
            </p>
          </article>

          <article className="tool-control-card">
            <div className="control-card-head">
              <div>
                <h3>{t("planning_filters_title")}</h3>
                <p className="control-card-copy">{t("planning_filters_copy")}</p>
              </div>
            </div>
            <div className="grid-3">
              <label>
                {t("recommendation_mode")}
                <select id="marketRecommendationMode" value={market.settings.recommendationMode} onChange={(event) => actions.updateMarketSetting("recommendationMode", event.target.value)}>
                  <option value="single">{t("recommendation_single")}</option>
                  <option value="budget">{t("recommendation_budget")}</option>
                </select>
              </label>
              <label>
                {t("budget_rlt")}
                <input id="marketBudget" type="number" min="0" step="0.01" placeholder="e.g. 1000" value={market.settings.budget} onChange={(event) => actions.updateMarketSetting("budget", event.target.value)} />
              </label>
              <label>
                {t("max_price_per_miner")}
                <input id="marketMaxMinerPrice" type="number" min="0" step="0.01" placeholder="optional" value={market.settings.maxMinerPrice} onChange={(event) => actions.updateMarketSetting("maxMinerPrice", event.target.value)} />
              </label>
            </div>
            <div className="grid-3 market-control-grid-compact">
              <label>
                {t("top_results")}
                <input id="marketTopN" type="number" min="1" step="1" placeholder="empty = all" value={market.settings.topN} onChange={(event) => actions.updateMarketSetting("topN", event.target.value)} />
              </label>
            </div>
          </article>

          <article className="tool-control-card tool-control-card-accent">
            <div className="control-card-head">
              <div>
                <h3>{t("actions_title")}</h3>
                <p className="control-card-copy">{t("actions_copy")}</p>
              </div>
            </div>
            <div className="tool-action-stack">
              <button id="loadMarketMinersBtn" type="button" className="ghost" onClick={actions.loadMarketMiners} disabled={market.marketLoading}>
                {market.marketLoading ? t("auth_checking") : t("load_market_miners")}
              </button>
              <button id="findBestMarketBtn" type="button" className="primary" onClick={actions.findBestMarketOptions}>
                {t("find_best_options")}
              </button>
            </div>
            <p className="inline-hint tool-inline-hint">
              {t("market_actions_hint")}
            </p>
          </article>
        </div>

        <div className="market-filter-summary">
          {marketControlChips.map((chip) => (
            <span key={chip} className="market-filter-chip">{chip}</span>
          ))}
        </div>
      </div>

      <div className="status-stack">
        <p id="marketStatus" className="muted status-line">{rt(market.marketStatus)}</p>
        <p id="marketSummary" className="muted status-line">{rt(recommendations.marketSummary || market.marketSummary)}</p>
        <p id="roomMinersStatus" className="muted status-line">{rt(market.roomMinersStatus)}</p>
      </div>

      <div className="market-subtabs">
        <div className="tab-list tab-list-compact" role="tablist" aria-label="Market views">
          <button id="marketUpgradesTabBtn" type="button" className={`tab-button ${market.marketViewTab === "upgrades" ? "is-active" : ""}`} onClick={() => actions.setMarketViewTab("upgrades")}>{t("market_view_upgrades")}</button>
          <button id="marketRoomMinersTabBtn" type="button" className={`tab-button ${market.marketViewTab === "roomMiners" ? "is-active" : ""}`} onClick={() => actions.setMarketViewTab("roomMiners")}>{t("market_view_room_miners")}</button>
          <button id="marketResultsTabBtn" type="button" className={`tab-button ${market.marketViewTab === "results" ? "is-active" : ""}`} onClick={() => actions.setMarketViewTab("results")}>{t("market_view_results")}</button>
          <button id="marketLogsTabBtn" type="button" className={`tab-button ${market.marketViewTab === "logs" ? "is-active" : ""}`} onClick={() => actions.setMarketViewTab("logs")}>{t("market_view_logs")}</button>
        </div>

        {market.marketViewTab === "upgrades" && <UpgradeSuggestions recommendations={recommendations} displayUnit={displayUnit} i18n={i18n} />}
        {market.marketViewTab === "roomMiners" && (
          <RoomMinersTable
            market={{ ...market, actions }}
            recommendations={recommendations}
            displayUnit={displayUnit}
            onShowMore={actions.showMoreRoomMiners}
            i18n={i18n}
          />
        )}
        {market.marketViewTab === "results" && (
          <MarketResultsTable
            market={{ ...market, actions }}
            recommendations={recommendations}
            displayUnit={displayUnit}
            onShowMore={actions.showMoreMarketResults}
            i18n={i18n}
          />
        )}
        {market.marketViewTab === "logs" && <MarketLogs logs={market.marketLogs} i18n={i18n} />}
      </div>
    </section>
  );
}
