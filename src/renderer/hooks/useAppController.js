import { useDeferredValue, useEffect, useRef, useState } from "react";
import { calculateComparisonAnalysis, createEmptyCandidateRow } from "../lib/comparison";
import {
  appendMarketLog,
  buildMarketRecommendations,
  buildMarketRefreshPlan,
  createDefaultMarketState,
  invokeAppUpdateCheck,
  invokeAuthLogin,
  invokeAuthSession,
  invokeAuthStatus,
  invokeCurrentPower,
  invokeMarketFetch,
  invokeRoomConfig,
  mergeMarketMinerCatalog,
  normalizeMarketSourceInfo,
  normalizeRoomMiners,
  restoreMarketMinersCache,
  saveMarketMinersCache,
  sortRoomMinersCollection,
  subscribeMarketProgress,
  TABLE_RENDER_BATCH_SIZE,
} from "../lib/market";
import {
  createCurrentSystemHistoryEntry,
  formatPowerFromThs,
  getCurrentSystemSnapshot,
  persistCurrentSystem,
  persistCurrentSystemHistory,
  recordCurrentSystemHistory,
  restoreCurrentSystemHistory,
  restoreCurrentSystemState,
} from "../lib/power";
import { writeRendererLog } from "../lib/runtime";

const DEFAULT_COMPARISON = {
  oldMinerPowerValue: "",
  oldMinerPowerUnit: "Ph/s",
  oldMinerBonusPercent: "",
  candidates: [createEmptyCandidateRow()],
};

function createEmptyMarketRecommendationsState() {
  return {
    error: null,
    items: [],
    allItems: [],
    upgradeItems: [],
    marketSummary: "",
    replacementEnabled: false,
    replacementPendingRoomLoad: false,
    bundleCount: 0,
    recommendedCount: 0,
    totalMatched: 0,
    roomMinersCount: 0,
    filteredMarketMinersCount: 0,
    overlappingOwnedCount: 0,
  };
}

export function useAppController() {
  const [currentSystem, setCurrentSystem] = useState(() => restoreCurrentSystemState());
  const [currentSystemHistory, setCurrentSystemHistory] = useState(() => restoreCurrentSystemHistory());
  const [isPowerHistoryExpanded, setIsPowerHistoryExpanded] = useState(false);
  const [market, setMarket] = useState(() => {
    const initial = createDefaultMarketState();
    const restored = restoreMarketMinersCache();
    if (restored) {
      initial.marketCatalog = restored.catalog;
      initial.marketMiners = restored.activeMiners;
      initial.marketSourceInfo = restored.sourceInfo;
      initial.marketStatus = `Restored ${restored.activeMiners.length} cached market miners.`;
    }
    return initial;
  });
  const [comparison, setComparison] = useState(DEFAULT_COMPARISON);
  const [marketRecommendations, setMarketRecommendations] = useState(() => createEmptyMarketRecommendationsState());
  const marketHeartbeatRef = useRef(null);
  const deferredRoomSearch = useDeferredValue(market.settings.roomMinersSearch);

  useEffect(() => {
    persistCurrentSystem(currentSystem);
  }, [currentSystem]);

  useEffect(() => {
    persistCurrentSystemHistory(currentSystemHistory);
  }, [currentSystemHistory]);

  useEffect(() => {
    if (market.marketCatalog.length > 0 && market.marketSourceInfo) {
      saveMarketMinersCache(market.marketCatalog, market.marketSourceInfo);
    }
  }, [market.marketCatalog, market.marketSourceInfo]);

  useEffect(() => {
    const unsubscribe = subscribeMarketProgress((payload) => {
      if (!payload || typeof payload !== "object") return;
      setMarket((prev) => {
        if (!prev.activeRequestId) return prev;
        if (payload.requestId && payload.requestId !== prev.activeRequestId) return prev;
        return {
          ...prev,
          marketLogs: appendMarketLog(prev.marketLogs, payload.message || "No message", payload.level || "info", payload.timestamp),
        };
      });
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initializeSession() {
      try {
        const sessionInfo = await invokeAuthSession();
        const cookieHeader =
          sessionInfo && typeof sessionInfo.cookieHeader === "string"
            ? sessionInfo.cookieHeader.trim()
            : "";

        if (!cancelled && cookieHeader) {
          setMarket((prev) => ({
            ...prev,
            cookieHeader,
            authStatus: "checking",
            authMessage: "Saved RollerCoin session restored. Click Check auth to verify it.",
            marketStatus:
              prev.marketMiners.length === 0
                ? "Saved RollerCoin session restored. Verification is now manual to avoid extra startup windows."
                : prev.marketStatus,
            currentPowerSyncStatus: "RollerCoin power sync is available after login.",
          }));
        }
      } catch (error) {
        writeRendererLog("initializeSession failed", { message: error?.message || String(error) });
      }
    }

    void initializeSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    if (marketHeartbeatRef.current) {
      clearInterval(marketHeartbeatRef.current);
    }
  }, []);

  const comparisonAnalysis = calculateComparisonAnalysis(currentSystem, comparison);
  const roomMinersSorted = sortRoomMinersCollection(
    market.roomMiners,
    market.settings.roomMinersSortMode,
    deferredRoomSearch,
  );
  const recommendations = {
    ...createEmptyMarketRecommendationsState(),
    ...marketRecommendations,
    roomMinersSorted,
  };

  function clearMarketRecommendations() {
    setMarketRecommendations(createEmptyMarketRecommendationsState());
  }

  function commitCurrentSystemHistory(source = "manual") {
    const snapshot = getCurrentSystemSnapshot(currentSystem);
    if (!snapshot) return;
    setCurrentSystemHistory((prev) => recordCurrentSystemHistory(prev, snapshot, source));
  }

  function updateCurrentSystemField(field, value) {
    setCurrentSystem((prev) => ({ ...prev, [field]: value }));
    if (field !== "displayUnit") {
      clearMarketRecommendations();
      setMarket((prev) => ({
        ...prev,
        marketSummary: "",
      }));
    }
  }

  function clearHistory() {
    setCurrentSystemHistory([]);
  }

  function updateComparisonField(field, value) {
    setComparison((prev) => ({ ...prev, [field]: value }));
  }

  function addCandidate() {
    setComparison((prev) => ({
      ...prev,
      candidates: [...prev.candidates, createEmptyCandidateRow()],
    }));
  }

  function removeCandidate(candidateId) {
    setComparison((prev) => {
      const nextCandidates = prev.candidates.filter((candidate) => candidate.id !== candidateId);
      return {
        ...prev,
        candidates: nextCandidates.length > 0 ? nextCandidates : [createEmptyCandidateRow()],
      };
    });
  }

  function updateCandidate(candidateId, field, value) {
    setComparison((prev) => ({
      ...prev,
      candidates: prev.candidates.map((candidate) =>
        candidate.id === candidateId ? { ...candidate, [field]: value } : candidate),
    }));
  }

  function setPrimaryTab(primaryTab) {
    setMarket((prev) => ({ ...prev, primaryTab }));
  }

  function setMarketViewTab(marketViewTab) {
    setMarket((prev) => ({ ...prev, marketViewTab }));
  }

  function updateMarketSetting(field, value) {
    const shouldResetRecommendations = !["roomMinersSearch", "roomMinersSortMode"].includes(field);
    if (shouldResetRecommendations) {
      clearMarketRecommendations();
    }

    setMarket((prev) => ({
      ...prev,
      settings: { ...prev.settings, [field]: value },
      marketSummary: shouldResetRecommendations ? "" : prev.marketSummary,
      marketStatus:
        shouldResetRecommendations && prev.marketMiners.length > 0
          ? "Filters changed. Click Find best options to refresh recommendations."
          : prev.marketStatus,
      visibleRoomMinersCount: field === "roomMinersSearch" || field === "roomMinersSortMode" ? TABLE_RENDER_BATCH_SIZE : prev.visibleRoomMinersCount,
      visibleMarketResultsCount:
        field === "budget" || field === "maxMinerPrice" || field === "sortMode" || field === "topN" || field === "roomWidthMode"
          ? TABLE_RENDER_BATCH_SIZE
          : prev.visibleMarketResultsCount,
    }));
  }

  function showMoreRoomMiners() {
    setMarket((prev) => ({
      ...prev,
      visibleRoomMinersCount: prev.visibleRoomMinersCount + TABLE_RENDER_BATCH_SIZE,
    }));
  }

  function showMoreMarketResults() {
    setMarket((prev) => ({
      ...prev,
      visibleMarketResultsCount: prev.visibleMarketResultsCount + TABLE_RENDER_BATCH_SIZE,
    }));
  }

  async function checkAuth(silent = false) {
    setMarket((prev) => ({
      ...prev,
      authChecking: true,
      authStatus: "checking",
      authMessage: "Checking RollerCoin session...",
    }));

    try {
      const authResult = await invokeAuthStatus(market.cookieHeader);
      if (authResult?.authenticated) {
        setMarket((prev) => ({
          ...prev,
          authChecking: false,
          authStatus: "valid",
          authMessage: "Session is active.",
          marketStatus: silent ? prev.marketStatus : "RollerCoin session is active. Market loading is available.",
        }));
      } else {
        setMarket((prev) => ({
          ...prev,
          authChecking: false,
          authStatus: "invalid",
          authMessage: authResult?.message || "RollerCoin session is not authorized. Login is required.",
          marketStatus: silent ? prev.marketStatus : "RollerCoin login is required before loading market miners.",
        }));
      }
    } catch (error) {
      setMarket((prev) => ({
        ...prev,
        authChecking: false,
        authStatus: "invalid",
        authMessage: `Auth check failed: ${error.message}`,
        marketStatus: silent ? prev.marketStatus : `Auth check failed: ${error.message}`,
      }));
    }
  }

  async function handleAuthAction() {
    if (market.authStatus === "invalid") {
      await loginToRollerCoin();
      return;
    }
    await checkAuth(false);
  }

  async function loginToRollerCoin() {
    try {
      await invokeAuthLogin();
      const sessionInfo = await invokeAuthSession();
      const cookieHeader =
        sessionInfo && typeof sessionInfo.cookieHeader === "string"
          ? sessionInfo.cookieHeader.trim()
          : "";
      setMarket((prev) => ({
        ...prev,
        cookieHeader,
        authStatus: cookieHeader ? "checking" : "invalid",
        authMessage: cookieHeader ? "Saved RollerCoin session restored. Click Check auth to verify it." : "No saved RollerCoin session. Login is required.",
      }));
      if (cookieHeader) {
        await checkAuth(true);
      }
    } catch (error) {
      setMarket((prev) => ({
        ...prev,
        authStatus: "invalid",
        authMessage: `Login failed: ${error.message}`,
        marketStatus: `Login error: ${error.message}`,
      }));
    }
  }

  async function syncCurrentPower() {
    setMarket((prev) => ({
      ...prev,
      currentPowerSyncInFlight: true,
      currentPowerSyncStatus: "Syncing current power from RollerCoin...",
    }));

    try {
      const powerResult = await invokeCurrentPower(market.cookieHeader);
      if (!powerResult?.success) {
        throw new Error(powerResult?.error || powerResult?.message || "Failed to load current RollerCoin power.");
      }

      setCurrentSystem((prev) => ({
        ...prev,
        baseValue: String(powerResult.basePowerPhs),
        baseUnit: "Ph/s",
        bonusPercent: String(powerResult.bonusPercent),
      }));

      const snapshot = {
        baseValue: String(powerResult.basePowerPhs),
        baseUnit: "Ph/s",
        bonusPercent: String(powerResult.bonusPercent),
        displayUnit: currentSystem.displayUnit,
      };
      const parsedSnapshot = getCurrentSystemSnapshot(snapshot);
      if (parsedSnapshot) {
        setCurrentSystemHistory((prev) => recordCurrentSystemHistory(prev, parsedSnapshot, "rollercoin-sync"));
      }

      setMarket((prev) => ({
        ...prev,
        currentPowerSyncInFlight: false,
        currentPowerSyncStatus: `Synced from RollerCoin: ${powerResult.basePowerPhs} Ph/s base, ${powerResult.bonusPercent}% bonus.`,
        marketStatus: prev.marketMiners.length > 0 ? "Current system synced. Click Find best options to refresh recommendations." : prev.marketStatus,
        marketSummary: "",
      }));
      clearMarketRecommendations();
    } catch (error) {
      setMarket((prev) => ({
        ...prev,
        currentPowerSyncInFlight: false,
        currentPowerSyncStatus: `Current power sync failed: ${error.message}`,
        marketStatus: `Current power sync failed: ${error.message}`,
      }));
    }
  }

  async function loadRoomMiners() {
    setMarket((prev) => ({
      ...prev,
      roomMinersLoadInFlight: true,
      roomMinersStatus: "Loading room miners from RollerCoin...",
    }));

    try {
      const roomResult = await invokeRoomConfig(market.cookieHeader);
      if (!roomResult?.success || !Array.isArray(roomResult.miners)) {
        throw new Error(roomResult?.error || "Failed to load room miners.");
      }
      const normalizedRoomMiners = normalizeRoomMiners(roomResult.miners);
      if (normalizedRoomMiners.length === 0) {
        throw new Error("Room config returned no parseable miners.");
      }

      setMarket((prev) => ({
        ...prev,
        roomMinersLoadInFlight: false,
        roomMiners: normalizedRoomMiners,
        roomMinersSourceInfo: {
          endpoint: roomResult.endpoint || "https://rollercoin.com/api/game/room-config/",
          roomConfigId: roomResult.roomConfigId || "",
          loadedAt: Date.now(),
        },
        roomMinersStatus: `Loaded ${normalizedRoomMiners.length} room miners.`,
        marketStatus: prev.marketMiners.length > 0 ? "Room miners loaded. Click Find best options to refresh recommendations." : prev.marketStatus,
        visibleRoomMinersCount: TABLE_RENDER_BATCH_SIZE,
        marketSummary: "",
        marketLogs: appendMarketLog(prev.marketLogs, `Loaded ${normalizedRoomMiners.length} room miners.`, "success"),
      }));
      clearMarketRecommendations();
    } catch (error) {
      setMarket((prev) => ({
        ...prev,
        roomMinersLoadInFlight: false,
        roomMiners: [],
        roomMinersSourceInfo: null,
        roomMinersStatus: `Room miners load failed: ${error.message}`,
        marketStatus: `Room miners load failed: ${error.message}`,
        marketSummary: "",
      }));
      clearMarketRecommendations();
    }
  }

  async function checkForUpdates() {
    setMarket((prev) => ({ ...prev, appUpdateChecking: true, appUpdateMessage: "Checking for updates..." }));
    try {
      const result = await invokeAppUpdateCheck();
      setMarket((prev) => ({
        ...prev,
        appUpdateChecking: false,
        appUpdateMessage: result?.message || "App update check finished.",
        marketStatus: result?.message || prev.marketStatus,
      }));
    } catch (error) {
      setMarket((prev) => ({
        ...prev,
        appUpdateChecking: false,
        appUpdateMessage: `App update check failed: ${error.message}`,
        marketStatus: `App update check failed: ${error.message}`,
      }));
    }
  }

  async function loadMarketMiners() {
    const requestId = `market-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const refreshPlan = buildMarketRefreshPlan(market.marketSourceInfo);
    const previousCatalog = market.marketCatalog;
    const previousMiners = market.marketMiners;
    const previousSourceInfo = market.marketSourceInfo;

    if (marketHeartbeatRef.current) {
      clearInterval(marketHeartbeatRef.current);
    }

    setMarket((prev) => ({
      ...prev,
      marketLoading: true,
      activeRequestId: requestId,
      marketLogs: [
        `[${new Date().toLocaleTimeString("en-US", { hour12: false })}] [INFO] Load miners requested by user.`,
        `[${new Date().toLocaleTimeString("en-US", { hour12: false })}] [INFO] Request ID: ${requestId}`,
      ],
      marketStatus:
        prev.marketMiners.length > 0
          ? `Refreshing market using cached data (${prev.marketMiners.length} miners).`
          : "Loading miners from market API. Direct mode runs first, browser mode is the fallback...",
      marketSummary: "",
      visibleMarketResultsCount: TABLE_RENDER_BATCH_SIZE,
    }));
    clearMarketRecommendations();

    marketHeartbeatRef.current = setInterval(() => {
      setMarket((prev) => ({
        ...prev,
        marketLogs: appendMarketLog(prev.marketLogs, "Loading is still in progress...", "info"),
      }));
    }, 15000);

    try {
      let mergedCatalog = previousCatalog;
      let mergedSourceInfo = previousSourceInfo;
      let hadSuccess = false;

      for (const phase of refreshPlan) {
        setMarket((prev) => ({
          ...prev,
          marketLogs: appendMarketLog(prev.marketLogs, `${phase.label} started.`, "info"),
          marketStatus: `${phase.label} in progress. Direct mode runs first, browser mode is the fallback...`,
        }));

        const loadResult = await invokeMarketFetch(market.cookieHeader, requestId, {
          refreshMode: phase.mode,
          maxPages: phase.maxPages,
          includeAttempts: phase.includeAttempts,
        });

        const rawMiners = Array.isArray(loadResult?.marketplaceOffers)
          ? loadResult.marketplaceOffers
          : Array.isArray(loadResult?.miners)
            ? loadResult.miners
            : [];

        if (!loadResult?.success || rawMiners.length === 0) {
          throw new Error(loadResult?.error || "Market refresh returned no valid miners.");
        }

        const merged = mergeMarketMinerCatalog(mergedCatalog, rawMiners, {
          mode: phase.mode,
          sourceInfo: loadResult,
          previousSourceInfo: mergedSourceInfo,
        });
        mergedCatalog = merged.catalog;
        mergedSourceInfo = merged.sourceInfo;
        hadSuccess = true;

        setMarket((prev) => ({
          ...prev,
          marketCatalog: merged.catalog,
          marketMiners: merged.activeMiners,
          marketSourceInfo: normalizeMarketSourceInfo({
            ...merged.sourceInfo,
            catalogCount: merged.catalog.length,
            activeCount: merged.activeMiners.length,
          }, merged.activeMiners.length),
          marketStatus:
            phase.mode === "quick"
              ? `Quick refresh updated ${merged.activeMiners.length} cached market miners.`
              : `Full refresh confirmed ${merged.activeMiners.length} market miners.`,
          marketSummary: "",
          marketLogs: appendMarketLog(
            prev.marketLogs,
            `${phase.label} completed: scan=${rawMiners.length}, active=${merged.activeMiners.length}, catalog=${merged.catalog.length}.`,
            "success",
          ),
        }));
      }

      if (!hadSuccess) {
        throw new Error("Market refresh returned no valid miners.");
      }
    } catch (error) {
      setMarket((prev) => ({
        ...prev,
        marketCatalog: previousCatalog,
        marketMiners: previousMiners,
        marketSourceInfo: previousSourceInfo,
        marketStatus:
          previousMiners.length > 0
            ? `Refresh failed: ${error.message}. Showing cached miners.`
            : `Failed to load market miners: ${error.message}`,
        marketSummary: "",
        marketLogs: appendMarketLog(prev.marketLogs, `Load miners failed: ${error.message}`, "error"),
      }));
    } finally {
      if (marketHeartbeatRef.current) {
        clearInterval(marketHeartbeatRef.current);
        marketHeartbeatRef.current = null;
      }
      setMarket((prev) => ({
        ...prev,
        marketLoading: false,
        activeRequestId: null,
      }));
    }
  }

  function findBestMarketOptions() {
    const nextRecommendations = buildMarketRecommendations({
      currentSystemState: currentSystem,
      marketMiners: market.marketMiners,
      roomMiners: market.roomMiners,
      marketSettings: {
        ...market.settings,
        roomMinersSearch: deferredRoomSearch,
      },
      marketSourceInfo: market.marketSourceInfo,
    });

    setMarketRecommendations({
      ...createEmptyMarketRecommendationsState(),
      ...nextRecommendations,
    });

    setMarket((prev) => ({
      ...prev,
      marketSummary: nextRecommendations.marketSummary || "",
      visibleMarketResultsCount: TABLE_RENDER_BATCH_SIZE,
      marketStatus:
        prev.marketMiners.length === 0
          ? "Load market miners first."
          : nextRecommendations.error
            ? `Filter error: ${nextRecommendations.error}`
            : `Recommendations updated. ${nextRecommendations.upgradeItems.length} profitable option(s) found.`,
    }));
  }

  return {
    currentSystem,
    currentSystemHistory,
    isPowerHistoryExpanded,
    market,
    comparison,
    comparisonAnalysis,
    recommendations,
    actions: {
      updateCurrentSystemField,
      commitCurrentSystemHistory,
      clearHistory,
      setIsPowerHistoryExpanded,
      updateComparisonField,
      addCandidate,
      removeCandidate,
      updateCandidate,
      setPrimaryTab,
      setMarketViewTab,
      updateMarketSetting,
      showMoreRoomMiners,
      showMoreMarketResults,
      handleAuthAction,
      checkAuth,
      loginToRollerCoin,
      syncCurrentPower,
      loadRoomMiners,
      checkForUpdates,
      loadMarketMiners,
      findBestMarketOptions,
    },
  };
}
