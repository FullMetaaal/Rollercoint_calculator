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
    cheaperUpgradeItems: [],
    maxPowerUpgradeItems: [],
    marketSummary: "",
    replacementEnabled: false,
    replacementPendingRoomLoad: false,
    replacementRequested: false,
    replacementStrategy: "off",
    recommendationMode: "budget",
    sortMode: "gainPerPrice",
    budget: null,
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
  const marketRef = useRef(market);
  const currentSystemRef = useRef(currentSystem);
  const startupAutomationStartedRef = useRef(false);
  const deferredRoomSearch = useDeferredValue(market.settings.roomMinersSearch);

  useEffect(() => {
    persistCurrentSystem(currentSystem);
  }, [currentSystem]);

  useEffect(() => {
    currentSystemRef.current = currentSystem;
  }, [currentSystem]);

  useEffect(() => {
    persistCurrentSystemHistory(currentSystemHistory);
  }, [currentSystemHistory]);

  useEffect(() => {
    marketRef.current = market;
  }, [market]);

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
        field === "budget" ||
        field === "maxMinerPrice" ||
        field === "sortMode" ||
        field === "topN" ||
        field === "roomWidthMode" ||
        field === "recommendationMode" ||
        field === "replacementStrategy"
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

  async function checkAuth(silent = false, options = {}) {
    const cookieHeader =
      typeof options.cookieHeader === "string"
        ? options.cookieHeader.trim()
        : marketRef.current.cookieHeader;

    setMarket((prev) => ({
      ...prev,
      authChecking: true,
      authStatus: "checking",
      authMessage: "Checking RollerCoin session...",
    }));

    try {
      const authResult = await invokeAuthStatus(cookieHeader);
      if (authResult?.authenticated) {
        setMarket((prev) => ({
          ...prev,
          cookieHeader: cookieHeader || prev.cookieHeader,
          authChecking: false,
          authStatus: "valid",
          authMessage: "Session is active.",
          marketStatus: silent ? prev.marketStatus : "RollerCoin session is active. Market loading is available.",
        }));
        return {
          authenticated: true,
          cookieHeader: cookieHeader || marketRef.current.cookieHeader,
          ...authResult,
        };
      } else {
        setMarket((prev) => ({
          ...prev,
          cookieHeader: cookieHeader || prev.cookieHeader,
          authChecking: false,
          authStatus: "invalid",
          authMessage: authResult?.message || "RollerCoin session is not authorized. Login is required.",
          marketStatus: silent ? prev.marketStatus : "RollerCoin login is required before loading market miners.",
        }));
        return {
          authenticated: false,
          cookieHeader: cookieHeader || marketRef.current.cookieHeader,
          ...authResult,
        };
      }
    } catch (error) {
      setMarket((prev) => ({
        ...prev,
        cookieHeader: cookieHeader || prev.cookieHeader,
        authChecking: false,
        authStatus: "invalid",
        authMessage: `Auth check failed: ${error.message}`,
        marketStatus: silent ? prev.marketStatus : `Auth check failed: ${error.message}`,
      }));
      return {
        authenticated: false,
        cookieHeader: cookieHeader || marketRef.current.cookieHeader,
        message: `Auth check failed: ${error.message}`,
      };
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
    setMarket((prev) => ({
      ...prev,
      authChecking: true,
      authStatus: "checking",
      authMessage: "Opening RollerCoin login window...",
      marketStatus: "RollerCoin login is required. Opening the login window...",
    }));

    try {
      const loginSessionInfo = await invokeAuthLogin();
      const sessionInfo =
        loginSessionInfo && typeof loginSessionInfo === "object"
          ? loginSessionInfo
          : await invokeAuthSession();
      const cookieHeader =
        sessionInfo && typeof sessionInfo.cookieHeader === "string"
          ? sessionInfo.cookieHeader.trim()
          : "";
      setMarket((prev) => ({
        ...prev,
        cookieHeader,
        authStatus: cookieHeader ? "checking" : "invalid",
        authChecking: false,
        authMessage: cookieHeader ? "Saved RollerCoin session restored. Click Check auth to verify it." : "No saved RollerCoin session. Login is required.",
      }));
      if (cookieHeader) {
        return checkAuth(true, { cookieHeader });
      }
      return {
        authenticated: false,
        cookieHeader: "",
        message: "No saved RollerCoin session. Login is required.",
      };
    } catch (error) {
      setMarket((prev) => ({
        ...prev,
        authChecking: false,
        authStatus: "invalid",
        authMessage: `Login failed: ${error.message}`,
        marketStatus: `Login error: ${error.message}`,
      }));
      return {
        authenticated: false,
        cookieHeader: "",
        message: `Login failed: ${error.message}`,
      };
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

  async function loadRoomMiners(options = {}) {
    const cookieHeader =
      typeof options.cookieHeader === "string"
        ? options.cookieHeader.trim()
        : marketRef.current.cookieHeader;

    setMarket((prev) => ({
      ...prev,
      roomMinersLoadInFlight: true,
      roomMinersStatus: "Loading room miners from RollerCoin...",
    }));

    try {
      const roomResult = await invokeRoomConfig(cookieHeader);
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
      return {
        success: true,
        roomMiners: normalizedRoomMiners,
        roomMinersSourceInfo: {
          endpoint: roomResult.endpoint || "https://rollercoin.com/api/game/room-config/",
          roomConfigId: roomResult.roomConfigId || "",
          loadedAt: Date.now(),
        },
      };
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
      return {
        success: false,
        roomMiners: [],
        roomMinersSourceInfo: null,
        error: error.message,
      };
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

  async function loadMarketMiners(options = {}) {
    const marketState = marketRef.current;
    const requestId = `market-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const refreshPlan = buildMarketRefreshPlan(marketState.marketSourceInfo);
    const previousCatalog = marketState.marketCatalog;
    const previousMiners = marketState.marketMiners;
    const previousSourceInfo = marketState.marketSourceInfo;
    const cookieHeader =
      typeof options.cookieHeader === "string"
        ? options.cookieHeader.trim()
        : marketState.cookieHeader;

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
      let mergedActiveMiners = previousMiners;
      let hadSuccess = false;

      for (const phase of refreshPlan) {
        setMarket((prev) => ({
          ...prev,
          marketLogs: appendMarketLog(prev.marketLogs, `${phase.label} started.`, "info"),
          marketStatus: `${phase.label} in progress. Direct mode runs first, browser mode is the fallback...`,
        }));

        const loadResult = await invokeMarketFetch(cookieHeader, requestId, {
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
        mergedActiveMiners = merged.activeMiners;
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
      return {
        success: true,
        marketCatalog: mergedCatalog,
        marketMiners: mergedActiveMiners,
        marketSourceInfo: normalizeMarketSourceInfo({
          ...mergedSourceInfo,
          catalogCount: mergedCatalog.length,
          activeCount: mergedActiveMiners.length,
        }, mergedActiveMiners.length),
      };
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
      return {
        success: false,
        marketCatalog: previousCatalog,
        marketMiners: previousMiners,
        marketSourceInfo: previousSourceInfo,
        error: error.message,
      };
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

  function findBestMarketOptions(options = {}) {
    const marketState = marketRef.current;
    const nextRecommendations = buildMarketRecommendations({
      currentSystemState: options.currentSystemState || currentSystemRef.current,
      marketMiners: Array.isArray(options.marketMiners) ? options.marketMiners : marketState.marketMiners,
      roomMiners: Array.isArray(options.roomMiners) ? options.roomMiners : marketState.roomMiners,
      marketSettings: {
        ...(options.marketSettings || marketState.settings),
        roomMinersSearch: deferredRoomSearch,
      },
      marketSourceInfo: options.marketSourceInfo || marketState.marketSourceInfo,
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
        (Array.isArray(options.marketMiners) ? options.marketMiners.length : prev.marketMiners.length) === 0
          ? "Load market miners first."
          : nextRecommendations.error
            ? `Filter error: ${nextRecommendations.error}`
            : `Recommendations updated. ${nextRecommendations.upgradeItems.length} profitable option(s) found.`,
    }));
    return nextRecommendations;
  }

  useEffect(() => {
    let cancelled = false;
    if (startupAutomationStartedRef.current) return undefined;
    startupAutomationStartedRef.current = true;

    async function runStartupAutomation() {
      try {
        setMarket((prev) => ({
          ...prev,
          authChecking: true,
          authStatus: "checking",
          authMessage: "Checking RollerCoin session...",
          marketStatus: "Starting automatic RollerCoin sync...",
        }));

        const sessionInfo = await invokeAuthSession();
        if (cancelled) return;

        const restoredCookieHeader =
          sessionInfo && typeof sessionInfo.cookieHeader === "string"
            ? sessionInfo.cookieHeader.trim()
            : "";

        if (restoredCookieHeader) {
          setMarket((prev) => ({
            ...prev,
            cookieHeader: restoredCookieHeader,
            authStatus: "checking",
            authMessage: "Saved RollerCoin session restored. Checking authorization automatically...",
            currentPowerSyncStatus: "RollerCoin power sync is available after login.",
          }));
        }

        let authResult = await checkAuth(true, { cookieHeader: restoredCookieHeader });
        if (cancelled) return;

        if (!authResult?.authenticated) {
          authResult = await loginToRollerCoin();
          if (cancelled) return;
        }

        if (!authResult?.authenticated) {
          setMarket((prev) => ({
            ...prev,
            authChecking: false,
            authStatus: "invalid",
            authMessage: authResult?.message || "RollerCoin session is not authorized. Login is required.",
            marketStatus: authResult?.message || "RollerCoin login is required before loading market miners.",
          }));
          return;
        }

        const activeCookieHeader =
          typeof authResult.cookieHeader === "string" && authResult.cookieHeader.trim()
            ? authResult.cookieHeader.trim()
            : marketRef.current.cookieHeader;

        setMarket((prev) => ({
          ...prev,
          cookieHeader: activeCookieHeader,
          authChecking: false,
          authStatus: "valid",
          authMessage: "Session is active.",
          marketStatus: "Authorization confirmed. Loading room miners automatically...",
        }));

        const roomLoadResult = await loadRoomMiners({ cookieHeader: activeCookieHeader });
        if (cancelled) return;

        setMarket((prev) => ({
          ...prev,
          marketStatus: roomLoadResult.success
            ? "Room miners loaded. Refreshing market automatically..."
            : `Room miners auto-load failed: ${roomLoadResult.error || "unknown error"}. Refreshing market automatically...`,
        }));

        const marketLoadResult = await loadMarketMiners({ cookieHeader: activeCookieHeader });
        if (cancelled) return;

        if (!marketLoadResult?.success) {
          setMarket((prev) => ({
            ...prev,
            marketStatus: `Automatic market refresh failed: ${marketLoadResult?.error || "unknown error"}`,
          }));
          return;
        }

        const nextRecommendations = findBestMarketOptions({
          marketMiners: marketLoadResult.marketMiners,
          roomMiners: roomLoadResult.success ? roomLoadResult.roomMiners : marketRef.current.roomMiners,
          marketSourceInfo: marketLoadResult.marketSourceInfo,
        });
        if (cancelled) return;

        setMarket((prev) => ({
          ...prev,
          marketStatus: nextRecommendations.error
            ? `Automatic refresh completed with filter error: ${nextRecommendations.error}`
            : `Automatic refresh completed. ${nextRecommendations.upgradeItems.length} profitable option(s) found.`,
        }));
      } catch (error) {
        if (cancelled) return;
        writeRendererLog("startup automation failed", { message: error?.message || String(error) });
        setMarket((prev) => ({
          ...prev,
          authChecking: false,
          marketStatus: `Automatic startup sync failed: ${error?.message || String(error)}`,
        }));
      }
    }

    void runStartupAutomation();
    return () => {
      cancelled = true;
    };
  }, []);

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
