import { useEffect, useState } from "react";
import { formatMarketValue, formatPowerFromPhs } from "../lib/power";

function buildMinerMeta(miner) {
  const parts = [];
  if (Number.isFinite(Number(miner?.level)) && Number(miner.level) > 0) {
    parts.push(`L${Math.floor(Number(miner.level))}`);
  }
  if (Number.isFinite(Number(miner?.width)) && Number(miner.width) > 0) {
    parts.push(`Width ${Math.floor(Number(miner.width))}`);
  }
  if (Number.isFinite(Number(miner?.bonusPercent))) {
    parts.push(`${formatMarketValue(miner.bonusPercent, 2)}% bonus`);
  }
  return parts.join(" • ");
}

function buildBudgetLabel(recommendations) {
  return Number.isFinite(Number(recommendations?.budget))
    ? `Budget: ${formatMarketValue(recommendations.budget, 2)} RLT`
    : "Budget: not set";
}

function formatSignedPercent(value, fractionDigits = 1) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "-";
  const sign = numericValue > 0 ? "+" : "";
  return `${sign}${formatMarketValue(numericValue, fractionDigits)}%`;
}

function buildFairPriceDetailText(item) {
  const referencePrice = Number(item?.fairPriceReferencePrice);
  const samples = Number(item?.fairPriceHistorySamples ?? item?.priceHistoryStats?.totalSamples);
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    return "Not enough local history yet";
  }

  const deltaText = formatSignedPercent(item?.fairPriceDeltaPercent, 1);
  const sampleText = Number.isFinite(samples) && samples > 0 ? ` | ${samples} sample${samples === 1 ? "" : "s"}` : "";
  return `Median ${formatMarketValue(referencePrice, 2)} RLT | ${deltaText} vs median${sampleText}`;
}

function toRomanNumeral(value) {
  const numericValue = Math.floor(Number(value));
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return "";
  }

  const romanMap = [
    ["M", 1000],
    ["CM", 900],
    ["D", 500],
    ["CD", 400],
    ["C", 100],
    ["XC", 90],
    ["L", 50],
    ["XL", 40],
    ["X", 10],
    ["IX", 9],
    ["V", 5],
    ["IV", 4],
    ["I", 1],
  ];

  let remainder = numericValue;
  let result = "";

  romanMap.forEach(([symbol, amount]) => {
    while (remainder >= amount) {
      result += symbol;
      remainder -= amount;
    }
  });

  return result;
}

function getMinerLevelLabel(miner) {
  if (!Number.isFinite(Number(miner?.level)) || Number(miner.level) <= 0) {
    return "";
  }
  return toRomanNumeral(miner.level);
}

function MinerVisual({ miner, className = "" }) {
  const imageSources = [...new Set(
    [
      miner?.imageUrl,
      ...(Array.isArray(miner?.imageCandidates) ? miner.imageCandidates : []),
    ].filter((entry) => typeof entry === "string" && entry.trim()),
  )];
  const sourcesKey = imageSources.join("|");
  const [sourceIndex, setSourceIndex] = useState(0);

  useEffect(() => {
    setSourceIndex(0);
  }, [sourcesKey]);

  const currentSource = imageSources[sourceIndex] || "";
  const showImage = Boolean(currentSource) && sourceIndex < imageSources.length;
  const levelLabel = getMinerLevelLabel(miner);

  return (
    <div className={`market-miner-thumb-wrap ${className}`.trim()}>
      {showImage ? (
        <img
          className="market-miner-thumb"
          src={currentSource}
          alt={miner?.name || "Miner"}
          loading="lazy"
          onError={() => {
            setSourceIndex((prev) => (prev + 1 < imageSources.length ? prev + 1 : imageSources.length));
          }}
        />
      ) : (
        <div className="market-miner-thumb placeholder">
          {String(miner?.name || "M").slice(0, 1).toUpperCase()}
        </div>
      )}
      {levelLabel ? (
        <span className="market-miner-level-badge" aria-label={`Level ${Math.floor(Number(miner.level))}`}>
          {levelLabel}
        </span>
      ) : null}
    </div>
  );
}

function MinerCard({ miner, tone = "buy", displayUnit = "Ph/s", showPrice = false }) {
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
            {formatMarketValue(miner.bonusPercent, 2)}% bonus
          </span>
          {Number.isFinite(Number(miner.width)) ? <span className="muted">W{Math.floor(Number(miner.width))}</span> : null}
        </div>
      </div>
    </div>
  );
}

function SuggestionItem({ item, index, displayUnit }) {
  const purchaseMiners = Array.isArray(item.purchaseMiners) && item.purchaseMiners.length > 0
    ? item.purchaseMiners
    : [item];
  const replacementMiners = Array.isArray(item.replacementMiners) ? item.replacementMiners : [];
  const showBundleMinerPrices = purchaseMiners.length > 1;

  return (
    <li className="suggestion-item">
      <div className="suggestion-line">
        <span className="suggestion-rank">{index + 1}.</span>
        <div className="suggestion-block">
          <span className="suggestion-label">Buy</span>
          <div className="suggestion-value suggestion-buy-list">
            {purchaseMiners.map((miner, minerIndex) => (
              <MinerCard
                key={`${miner.id || miner.name}-${minerIndex}`}
                miner={miner}
                tone="buy"
                displayUnit={displayUnit}
                showPrice={showBundleMinerPrices}
              />
            ))}
          </div>
          <span className="suggestion-label suggestion-label-remove">Remove</span>
          <div className="suggestion-value">
            {replacementMiners.length > 0 ? (
              <div className="suggestion-remove-list">
                {replacementMiners.map((miner, minerIndex) => (
                  <MinerCard
                    key={`${miner.id || miner.name}-${minerIndex}`}
                    miner={miner}
                    tone="remove"
                    displayUnit={displayUnit}
                  />
                ))}
              </div>
            ) : (
              item.replaceText
            )}
          </div>
        </div>
      </div>
      <div className="suggestion-metrics">
        <span>Price: {formatMarketValue(item.price, 2)} {item.currency || "RLT"}</span>
        <span>Gain: +{formatPowerFromPhs(item.gainPower, displayUnit)}</span>
        <span>
          Gain / RLT: {Number.isFinite(item.gainPerPrice) ? formatPowerFromPhs(item.gainPerPrice, displayUnit) : "-"}
        </span>
      </div>
    </li>
  );
}

function SuggestionGroup({ title, items, displayUnit, emptyText }) {
  return (
    <div className="suggestion-group">
      <div className="suggestion-title">{title}</div>
      <ol className="suggestion-list">
        {items.length > 0 ? (
          items.map((item, index) => (
            <SuggestionItem
              key={`${item.bundleKey || item.offerKey || item.name}-${index}`}
              item={item}
              index={index}
              displayUnit={displayUnit}
            />
          ))
        ) : (
          <li className="muted">{emptyText}</li>
        )}
      </ol>
    </div>
  );
}

function UpgradeSuggestions({ recommendations, displayUnit }) {
  const cheaperItems = Array.isArray(recommendations.cheaperUpgradeItems) ? recommendations.cheaperUpgradeItems : [];
  const maxPowerItems = Array.isArray(recommendations.maxPowerUpgradeItems) ? recommendations.maxPowerUpgradeItems : [];

  if (cheaperItems.length === 0 && maxPowerItems.length === 0) {
    return (
      <div id="roomReplacementSuggestions" className="room-replacement-suggestions muted">
        Replacement suggestions will appear here after finding market options.
      </div>
    );
  }

  const budgetLabel = buildBudgetLabel(recommendations);

  return (
    <div id="roomReplacementSuggestions" className="room-replacement-suggestions">
      <SuggestionGroup
        title={`Cheaper upgrades (${budgetLabel})`}
        items={cheaperItems}
        displayUnit={displayUnit}
        emptyText="No upgrade suggestions."
      />
      <SuggestionGroup
        title={`Maximum power within budget (${budgetLabel})`}
        items={maxPowerItems}
        displayUnit={displayUnit}
        emptyText="No power suggestions."
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

function RoomMinersTable({ market, recommendations, displayUnit, onShowMore }) {
  const rows = recommendations.roomMinersSorted.slice(0, market.visibleRoomMinersCount);

  return (
    <>
      <div className="market-sort-row">
        <label>
          Search room miners
          <input
            id="roomMinersSearch"
            type="text"
            placeholder="name, L2, width 2..."
            value={market.settings.roomMinersSearch}
            onChange={(event) => market.actions.updateMarketSetting("roomMinersSearch", event.target.value)}
          />
        </label>
        <label>
          Sort room miners by
          <select
            id="roomMinersSortMode"
            value={market.settings.roomMinersSortMode}
            onChange={(event) => market.actions.updateMarketSetting("roomMinersSortMode", event.target.value)}
          >
            <option value="powerDesc">Power (high to low)</option>
            <option value="bonusDesc">Bonus (high to low)</option>
            <option value="widthAsc">Width (small to large)</option>
            <option value="nameAsc">Name (A-Z)</option>
          </select>
        </label>
        <span id="roomMinersCountInfo" className="muted">
          {recommendations.roomMinersSorted.length} total
        </span>
      </div>
      <div className="table-shell">
        <table id="roomMinersTable" className="candidates-result-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Room miner</th>
              <th id="roomMinersPowerHeader">Power ({displayUnit})</th>
              <th>Bonus (%)</th>
              <th>Width</th>
            </tr>
          </thead>
          <tbody id="roomMinersBody">
            {rows.length === 0 ? (
              <tr>
                <td colSpan="5" className="muted">Room miners will appear here after loading the current room.</td>
              </tr>
            ) : (
              rows.map((miner, index) => (
                <tr key={miner.id}>
                  <td>{index + 1}</td>
                  <td>
                    <MinerCell miner={miner} subtitle={buildMinerMeta(miner)} />
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
          Show 25 more
        </button>
      </div>
    </>
  );
}

function MarketResultsTable({ market, recommendations, displayUnit, onShowMore }) {
  const rows = recommendations.items.slice(0, market.visibleMarketResultsCount);

  return (
    <>
      <div className="market-sort-row">
        <label>
          Sort market results by
          <select
            id="marketSortMode"
            value={market.settings.sortMode}
            onChange={(event) => market.actions.updateMarketSetting("sortMode", event.target.value)}
          >
            <option value="gainPerPrice">Gain / RLT</option>
            <option id="marketSortGainPowerOption" value="gainPower">Gain ({displayUnit})</option>
            <option value="fairPrice">Fair price</option>
          </select>
        </label>
        <span id="marketResultsCountInfo" className="muted">
          {recommendations.items.length} visible recommendations
        </span>
      </div>
      <div className="table-shell table-shell-large">
        <table id="marketResultsTable" className="candidates-result-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Miner</th>
              <th>Price</th>
              <th id="marketResultsPowerHeader">Power ({displayUnit})</th>
              <th>Bonus (%)</th>
              <th>Width</th>
              <th id="marketResultsGainHeader">Gain ({displayUnit})</th>
              <th id="marketResultsGainPerPriceHeader">Gain / RLT ({displayUnit})</th>
              <th>Fair Price</th>
            </tr>
          </thead>
          <tbody id="marketResultsBody">
            {rows.length === 0 ? (
              <tr>
                <td colSpan="9" className="muted">Best market candidates will appear here after loading.</td>
              </tr>
            ) : (
              rows.map((miner, index) => {
                const leadMiner =
                  Array.isArray(miner.purchaseMiners) && miner.purchaseMiners.length > 0
                    ? miner.purchaseMiners[0]
                    : miner;
                const subtitle = miner.purchaseCount > 1
                  ? `Bundle of ${miner.purchaseCount}: ${miner.purchaseMiners.map((entry) => entry.name).join(" + ")}`
                  : buildMinerMeta(leadMiner);

                return (
                  <tr key={`${miner.bundleKey || miner.offerKey || miner.name}-${index}`}>
                    <td>{index + 1}</td>
                    <td>
                      <MinerCell miner={leadMiner} subtitle={subtitle} />
                    </td>
                    <td>
                      <div>{formatMarketValue(miner.price, 2)}</div>
                      <div className="market-price-subcopy">{buildFairPriceDetailText(miner)}</div>
                    </td>
                    <td>{formatPowerFromPhs(miner.power, displayUnit)}</td>
                    <td>{formatMarketValue(miner.bonusPercent, 2)}%</td>
                    <td>{miner.widthDisplay || miner.width || "-"}</td>
                    <td>{formatPowerFromPhs(miner.gainPower, displayUnit)}</td>
                    <td>{Number.isFinite(miner.gainPerPrice) ? formatPowerFromPhs(miner.gainPerPrice, displayUnit) : "-"}</td>
                    <td>
                      <div className={`market-fair-price-badge market-fair-price-${miner.fairPriceCategory || "no-history"}`}>
                        {miner.fairPriceLabel || "New"}
                      </div>
                      <div className="market-price-subcopy">
                        {Number.isFinite(Number(miner.fairPriceDeltaPercent))
                          ? `${formatSignedPercent(miner.fairPriceDeltaPercent, 1)} vs median`
                          : "Waiting for more samples"}
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
          Show 25 more
        </button>
      </div>
    </>
  );
}

function MarketLogs({ logs }) {
  return (
    <div className="market-logs">
      <div className="header-row">
        <h3>Load Logs</h3>
      </div>
      <pre id="marketLogsOutput" className="market-logs-output muted">
        {logs.length === 0 ? 'Logs will appear here after clicking "Load miners from market".' : logs.join("\n")}
      </pre>
    </div>
  );
}

export function MarketSection({ market, recommendations, displayUnit, actions }) {
  return (
    <section className="card card-market" id="marketCard">
      <div className="workspace-section-heading market-heading">
        <div>
          <p className="panel-eyebrow">Scanner</p>
          <h2>Market Scanner (RollerCoin)</h2>
          <p className="section-subtitle">Load live market data, inspect your room, and generate replacement suggestions.</p>
        </div>
      </div>

      <input id="rollercoinCookie" type="hidden" value={market.cookieHeader} readOnly />

      <div className="market-top-stack">
        <p className="inline-hint section-frame section-frame-copy">
          RollerCoin session and current room are detected automatically after login.
        </p>

        <div className="grid-3 section-frame">
          <label>
            Replace by width
            <select id="marketRoomWidthMode" value={market.settings.roomWidthMode} onChange={(event) => actions.updateMarketSetting("roomWidthMode", event.target.value)}>
              <option value="any">Any width</option>
              <option value="1">Small (1)</option>
              <option value="2">Large (2)</option>
            </select>
          </label>
          <label>
            Room miners
            <button id="loadRoomMinersBtn" type="button" className="ghost" onClick={actions.loadRoomMiners} disabled={market.roomMinersLoadInFlight}>
              {market.roomMinersLoadInFlight ? "Loading..." : "Load room miners"}
            </button>
          </label>
          <label>
            Recommendation mode
            <select id="marketRecommendationMode" value={market.settings.recommendationMode} onChange={(event) => actions.updateMarketSetting("recommendationMode", event.target.value)}>
              <option value="single">Single purchase</option>
              <option value="budget">Budget combinations</option>
            </select>
          </label>
        </div>

        <div className="grid-3 section-frame">
          <label>
            Replacement behavior
            <select id="marketReplacementStrategy" value={market.settings.replacementStrategy} onChange={(event) => actions.updateMarketSetting("replacementStrategy", event.target.value)}>
              <option value="off">Off</option>
              <option value="strict">Strict same width</option>
              <option value="flex">Flexible slots</option>
            </select>
          </label>
        </div>

        <p className="inline-hint section-frame section-frame-copy">
          Flexible slots: one width 2 miner can be replaced by two width 1 miners.
        </p>

        <div className="grid-3 section-frame">
          <label>
            Budget (RLT)
            <input id="marketBudget" type="number" min="0" step="0.01" placeholder="e.g. 1000" value={market.settings.budget} onChange={(event) => actions.updateMarketSetting("budget", event.target.value)} />
          </label>
          <label>
            Max price per miner (RLT)
            <input id="marketMaxMinerPrice" type="number" min="0" step="0.01" placeholder="optional" value={market.settings.maxMinerPrice} onChange={(event) => actions.updateMarketSetting("maxMinerPrice", event.target.value)} />
          </label>
          <label>
            Top results
            <input id="marketTopN" type="number" min="1" step="1" placeholder="empty = all" value={market.settings.topN} onChange={(event) => actions.updateMarketSetting("topN", event.target.value)} />
          </label>
        </div>

        <div className="actions market-actions section-frame">
          <button id="loadMarketMinersBtn" type="button" className="ghost" onClick={actions.loadMarketMiners} disabled={market.marketLoading}>
            {market.marketLoading ? "Loading..." : "Load miners from market"}
          </button>
          <button id="findBestMarketBtn" type="button" className="primary" onClick={actions.findBestMarketOptions}>
            Find best options
          </button>
        </div>
      </div>

      <div className="status-stack">
        <p id="marketStatus" className="muted status-line">{market.marketStatus}</p>
        <p id="marketSummary" className="muted status-line">{recommendations.marketSummary || market.marketSummary}</p>
        <p id="roomMinersStatus" className="muted status-line">{market.roomMinersStatus}</p>
      </div>

      <div className="market-subtabs">
        <div className="tab-list tab-list-compact" role="tablist" aria-label="Market views">
          <button id="marketUpgradesTabBtn" type="button" className={`tab-button ${market.marketViewTab === "upgrades" ? "is-active" : ""}`} onClick={() => actions.setMarketViewTab("upgrades")}>Upgrades</button>
          <button id="marketRoomMinersTabBtn" type="button" className={`tab-button ${market.marketViewTab === "roomMiners" ? "is-active" : ""}`} onClick={() => actions.setMarketViewTab("roomMiners")}>Room Miners</button>
          <button id="marketResultsTabBtn" type="button" className={`tab-button ${market.marketViewTab === "results" ? "is-active" : ""}`} onClick={() => actions.setMarketViewTab("results")}>Market Results</button>
          <button id="marketLogsTabBtn" type="button" className={`tab-button ${market.marketViewTab === "logs" ? "is-active" : ""}`} onClick={() => actions.setMarketViewTab("logs")}>Load Logs</button>
        </div>

        {market.marketViewTab === "upgrades" && <UpgradeSuggestions recommendations={recommendations} displayUnit={displayUnit} />}
        {market.marketViewTab === "roomMiners" && (
          <RoomMinersTable
            market={{ ...market, actions }}
            recommendations={recommendations}
            displayUnit={displayUnit}
            onShowMore={actions.showMoreRoomMiners}
          />
        )}
        {market.marketViewTab === "results" && (
          <MarketResultsTable
            market={{ ...market, actions }}
            recommendations={recommendations}
            displayUnit={displayUnit}
            onShowMore={actions.showMoreMarketResults}
          />
        )}
        {market.marketViewTab === "logs" && <MarketLogs logs={market.marketLogs} />}
      </div>
    </section>
  );
}
