import { useEffect, useState } from "react";

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

export function MinerVisual({ miner, className = "" }) {
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
