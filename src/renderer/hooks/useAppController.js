import { useDeferredValue, useEffect, useRef, useState } from "react";
import { calculateComparisonAnalysis, createEmptyCandidateRow } from "../lib/comparison";
import {
  buildMergePlannerDiagnostics,
  buildMergePlannerAnalysis,
  createDefaultMergePlannerState,
  invokeInventoryMiners,
  invokeInventoryParts,
  invokeMergeCraftingList,
} from "../lib/merge";
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
import {
  buildProfitabilityRows,
  buildProfitabilitySummary,
  DEFAULT_LEAGUE_ID,
  invokeLeagueProfitability,
  persistProfitabilityHistory,
  recordProfitabilityHistory,
  restoreProfitabilityHistory,
} from "../lib/profitability";
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
    currentBasePower: NaN,
    currentBonusPercent: NaN,
    currentTotalPower: NaN,
    roomMinersCount: 0,
    filteredMarketMinersCount: 0,
    overlappingOwnedCount: 0,
  };
}

function createDefaultProfitabilityState() {
  return {
    leagueId: DEFAULT_LEAGUE_ID,
    loading: false,
    status: "League profitability is not loaded.",
    rows: [],
    summary: buildProfitabilitySummary([], null),
    userDistribution: null,
    distribution: [],
    prices: {},
    sourceInfo: null,
    priceError: "",
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
  const [mergePlanner, setMergePlanner] = useState(() => createDefaultMergePlannerState());
  const [profitability, setProfitability] = useState(() => createDefaultProfitabilityState());
  const [profitabilityHistory, setProfitabilityHistory] = useState(() => restoreProfitabilityHistory());
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
    persistProfitabilityHistory(profitabilityHistory);
  }, [profitabilityHistory]);

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
  const mergeAnalysis = buildMergePlannerAnalysis({
    roomMiners: market.roomMiners,
    rawInventoryMiners: mergePlanner.rawInventoryMiners,
    rawInventoryParts: mergePlanner.rawInventoryParts,
    rawRecipes: mergePlanner.rawRecipes,
    marketMiners: market.marketMiners,
    currentSystemState: currentSystem,
    budgetInput: mergePlanner.budgetInput,
  });

  function clearMarketRecommendations() {
    setMarketRecommendations(createEmptyMarketRecommendationsState());
  }

  function appendMergeLog(message) {
    const timestamp = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setMergePlanner((prev) => ({
      ...prev,
      logs: [...prev.logs, `[${timestamp}] ${message}`].slice(-120),
    }));
  }

  function updateMergeStage(stageId, state, detail) {
    setMergePlanner((prev) => ({
      ...prev,
      stages: prev.stages.map((stage) =>
        stage.id === stageId
          ? { ...stage, state, detail: typeof detail === "string" && detail.trim() ? detail.trim() : stage.detail }
          : stage),
    }));
  }

  function updateMergePlannerBudget(value) {
    setMergePlanner((prev) => ({
      ...prev,
      budgetInput: value,
    }));
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

  function updateProfitabilityLeagueId(value) {
    setProfitability((prev) => ({
      ...prev,
      leagueId: value,
      status: prev.rows.length > 0 ? "League changed. Refresh profitability to update rewards." : prev.status,
    }));
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
    let authResult;
    if (market.authStatus === "invalid") {
      authResult = await loginToRollerCoin();
    } else {
      authResult = await checkAuth(false);
    }

    if (authResult?.authenticated) {
      const activeCookieHeader =
        typeof authResult.cookieHeader === "string" && authResult.cookieHeader.trim()
          ? authResult.cookieHeader.trim()
          : marketRef.current.cookieHeader;
      void refreshLeagueProfitabilityWithCookie(activeCookieHeader, {
        loadingStatus: "Loading profitability after login...",
        successPrefix: "Profitability loaded after login.",
        failurePrefix: "Profitability refresh after login failed",
      });
    }
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
      void refreshLeagueProfitabilityWithCookie(marketRef.current.cookieHeader || market.cookieHeader, {
        loadingStatus: "Refreshing profitability after power sync...",
        successPrefix: "Profitability recalculated after power sync.",
        failurePrefix: "Profitability refresh after power sync failed",
      });
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
    setMarket((prev) => ({
      ...prev,
      appUpdateChecking: true,
      appUpdateStatus: "checking",
      appUpdateMessage: "Checking for updates...",
    }));
    try {
      const result = await invokeAppUpdateCheck();
      setMarket((prev) => ({
        ...prev,
        appUpdateChecking: false,
        appUpdateStatus: result?.status || "idle",
        appUpdateMessage: result?.message || "App update check finished.",
        marketStatus: result?.message || prev.marketStatus,
      }));
    } catch (error) {
      setMarket((prev) => ({
        ...prev,
        appUpdateChecking: false,
        appUpdateStatus: "error",
        appUpdateMessage: `App update check failed: ${error.message}`,
        marketStatus: `App update check failed: ${error.message}`,
      }));
    }
  }

  async function loadMergePlannerData() {
    setMergePlanner((prev) => ({
      ...createDefaultMergePlannerState(),
      rawInventoryMiners: prev.rawInventoryMiners,
      rawInventoryParts: prev.rawInventoryParts,
      rawRecipes: prev.rawRecipes,
      budgetInput: prev.budgetInput,
      loading: true,
      status: "Checking RollerCoin session for merge planner...",
    }));
    updateMergeStage("auth", "loading", "Checking RollerCoin session...");
    appendMergeLog("Merge planner load requested.");

    try {
      let authResult = await checkAuth(true, { cookieHeader: marketRef.current.cookieHeader });
      appendMergeLog(authResult?.authenticated ? "Auth check succeeded." : `Auth check reported invalid session: ${authResult?.message || "unknown reason"}.`);
      if (!authResult?.authenticated) {
        updateMergeStage("auth", "loading", "Stored session was invalid. Opening login flow...");
        authResult = await loginToRollerCoin();
        appendMergeLog(authResult?.authenticated ? "Login flow restored session." : `Login flow did not restore session: ${authResult?.message || "unknown reason"}.`);
      }
      if (!authResult?.authenticated) {
        setMergePlanner((prev) => ({
          ...prev,
          loading: false,
          status: authResult?.message || "RollerCoin login is required before loading merge planner data.",
        }));
        updateMergeStage("auth", "error", authResult?.message || "Session is not authorized.");
        appendMergeLog(authResult?.message || "Merge planner stopped because session is not authorized.");
        return;
      }
      updateMergeStage("auth", "success", "RollerCoin session is active.");

      const activeCookieHeader =
        typeof authResult.cookieHeader === "string" && authResult.cookieHeader.trim()
          ? authResult.cookieHeader.trim()
          : marketRef.current.cookieHeader;

      setMergePlanner((prev) => ({
        ...prev,
        loading: true,
        status: "Loading room, inventory miners, parts, and forge recipes step by step...",
      }));

      let roomResult;
      updateMergeStage("room", "loading", marketRef.current.roomMiners.length > 0 ? "Reusing room miners already loaded in Market Scanner..." : "Loading room miners from RollerCoin...");
      appendMergeLog(marketRef.current.roomMiners.length > 0 ? "Reusing cached room miners from Market Scanner." : "Loading room miners from RollerCoin.");
      roomResult = marketRef.current.roomMiners.length > 0
        ? { success: true, roomMiners: marketRef.current.roomMiners, reused: true, sourcePath: "market-room-cache", cookieCount: 0, attempts: [] }
        : await loadRoomMiners({ cookieHeader: activeCookieHeader });
      updateMergeStage(
        "room",
        roomResult?.success ? "success" : "error",
        roomResult?.success
          ? `Loaded ${Array.isArray(roomResult.roomMiners) ? roomResult.roomMiners.length : marketRef.current.roomMiners.length} room miners${roomResult?.reused ? " from Market Scanner cache" : ""}.`
          : `Room miners load failed: ${roomResult?.error || "unknown error"}`,
      );
      appendMergeLog(roomResult?.success ? "Room miners step finished." : `Room miners step failed: ${roomResult?.error || "unknown error"}.`);

      updateMergeStage("inventoryMiners", "loading", "Loading inventory miners from storage...");
      appendMergeLog("Loading storage inventory miners.");
      const inventoryMinersResult = await invokeInventoryMiners(activeCookieHeader);
      updateMergeStage(
        "inventoryMiners",
        inventoryMinersResult?.success ? "success" : "error",
        inventoryMinersResult?.success
          ? `Loaded ${Array.isArray(inventoryMinersResult.items) ? inventoryMinersResult.items.length : 0} inventory miner entries.`
          : `Inventory miners load failed: ${inventoryMinersResult?.error || "unknown error"}`,
      );
      appendMergeLog(
        inventoryMinersResult?.success
          ? `Inventory miners loaded (${Array.isArray(inventoryMinersResult.items) ? inventoryMinersResult.items.length : 0} rows).`
          : `Inventory miners failed: ${inventoryMinersResult?.error || "unknown error"}.`,
      );

      updateMergeStage("inventoryParts", "loading", "Loading inventory parts from storage...");
      appendMergeLog("Loading storage inventory parts.");
      const inventoryPartsResult = await invokeInventoryParts(activeCookieHeader);
      updateMergeStage(
        "inventoryParts",
        inventoryPartsResult?.success ? "success" : "error",
        inventoryPartsResult?.success
          ? `Loaded ${Array.isArray(inventoryPartsResult.items) ? inventoryPartsResult.items.length : 0} inventory part entries.`
          : `Inventory parts load failed: ${inventoryPartsResult?.error || "unknown error"}`,
      );
      appendMergeLog(
        inventoryPartsResult?.success
          ? `Inventory parts loaded (${Array.isArray(inventoryPartsResult.items) ? inventoryPartsResult.items.length : 0} rows).`
          : `Inventory parts failed: ${inventoryPartsResult?.error || "unknown error"}.`,
      );

      updateMergeStage("recipes", "loading", "Loading merge recipes from forge...");
      appendMergeLog("Loading forge merge recipes.");
      const mergeRecipesResult = await invokeMergeCraftingList(activeCookieHeader);
      updateMergeStage(
        "recipes",
        mergeRecipesResult?.success ? (mergeRecipesResult?.partial ? "warning" : "success") : "error",
        mergeRecipesResult?.success
          ? `Loaded ${Array.isArray(mergeRecipesResult.recipes) ? mergeRecipesResult.recipes.length : 0} merge recipe entries${mergeRecipesResult?.partial ? " (partial)" : ""}.`
          : `Merge recipes load failed: ${mergeRecipesResult?.error || "unknown error"}`,
      );
      appendMergeLog(
        mergeRecipesResult?.success
          ? `Forge recipes loaded (${Array.isArray(mergeRecipesResult.recipes) ? mergeRecipesResult.recipes.length : 0} rows${mergeRecipesResult?.partial ? ", partial" : ""}).`
          : `Forge recipes failed: ${mergeRecipesResult?.error || "unknown error"}.`,
      );

      const partial = !roomResult?.success || !inventoryMinersResult?.success || !inventoryPartsResult?.success || !mergeRecipesResult?.success || Boolean(mergeRecipesResult?.partial);
      setMergePlanner((prev) => ({
        ...prev,
        loading: false,
        status: partial
          ? "Merge planner loaded with partial data. Review the source statuses below."
          : "Merge planner data loaded successfully.",
        inventoryMinersStatus: inventoryMinersResult?.success
          ? `Loaded ${Array.isArray(inventoryMinersResult.items) ? inventoryMinersResult.items.length : 0} inventory miner entries.`
          : `Inventory miners load failed: ${inventoryMinersResult?.error || "unknown error"}`,
        inventoryPartsStatus: inventoryPartsResult?.success
          ? `Loaded ${Array.isArray(inventoryPartsResult.items) ? inventoryPartsResult.items.length : 0} inventory part entries.`
          : `Inventory parts load failed: ${inventoryPartsResult?.error || "unknown error"}`,
        recipesStatus: mergeRecipesResult?.success
          ? `Loaded ${Array.isArray(mergeRecipesResult.recipes) ? mergeRecipesResult.recipes.length : 0} merge recipe entries.`
          : `Merge recipes load failed: ${mergeRecipesResult?.error || "unknown error"}`,
        rawInventoryMiners: inventoryMinersResult?.success && Array.isArray(inventoryMinersResult.items)
          ? inventoryMinersResult.items
          : prev.rawInventoryMiners,
        rawInventoryParts: inventoryPartsResult?.success && Array.isArray(inventoryPartsResult.items)
          ? inventoryPartsResult.items
          : prev.rawInventoryParts,
        rawRecipes: mergeRecipesResult?.success && Array.isArray(mergeRecipesResult.recipes)
          ? mergeRecipesResult.recipes
          : prev.rawRecipes,
        lastLoadedAt: Date.now(),
        partial,
        diagnostics: {
          room: {
            success: Boolean(roomResult?.success),
            sourcePath: roomResult?.sourcePath || (roomResult?.reused ? "market-room-cache" : ""),
            payloadCount: Array.isArray(roomResult?.roomMiners) ? roomResult.roomMiners.length : 0,
            error: roomResult?.error || "",
            attemptSummary: Array.isArray(roomResult?.attempts) && roomResult.attempts.length > 0
              ? `Attempts: ${roomResult.attempts.length}`
              : roomResult?.reused
                ? "Reused room miners from Market Scanner."
                : "No attempt metadata returned.",
          },
          inventoryMiners: buildMergePlannerDiagnostics(inventoryMinersResult, "items"),
          inventoryParts: buildMergePlannerDiagnostics(inventoryPartsResult, "items"),
          recipes: buildMergePlannerDiagnostics(mergeRecipesResult, "recipes"),
        },
      }));
      appendMergeLog(partial ? "Merge planner finished with partial data." : "Merge planner finished successfully.");
    } catch (error) {
      setMergePlanner((prev) => ({
        ...prev,
        loading: false,
        status: `Merge planner load failed: ${error.message}`,
      }));
      appendMergeLog(`Merge planner crashed: ${error.message}`);
    }
  }

  async function refreshLeagueProfitabilityWithCookie(cookieHeader, options = {}) {
    const leagueId = String(options.leagueId || profitability.leagueId || "").trim();
    const loadingStatus = options.loadingStatus || "Loading league power and crypto prices...";
    const successPrefix = options.successPrefix || "Profitability loaded.";
    const failurePrefix = options.failurePrefix || "Profitability load failed";

    setProfitability((prev) => ({
      ...prev,
      loading: true,
      status: loadingStatus,
      priceError: "",
    }));

    try {
      const result = await invokeLeagueProfitability(cookieHeader, leagueId);
      if (!result?.success) {
        throw new Error(result?.error || "Failed to load league profitability.");
      }

      const rows = buildProfitabilityRows(result.distribution, result.userDistribution, result.prices);
      const summary = buildProfitabilitySummary(rows, result.userDistribution);
      const bestText = summary.best
        ? ` Best daily estimate: ${summary.best.symbol} at $${Number(summary.best.usdPerDay).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}.`
        : Number.isFinite(Number(summary.userPower)) && Number(summary.userPower) > 0
          ? " No priced rewards were calculated."
          : " User power was not detected in the league response.";

      setProfitability((prev) => ({
        ...prev,
        loading: false,
        leagueId: result.leagueId || leagueId,
        status: `${successPrefix}${bestText}`,
        rows,
        summary,
        userDistribution: result.userDistribution || null,
        distribution: Array.isArray(result.distribution) ? result.distribution : [],
        prices: result.prices || {},
        sourceInfo: result.sourceInfo || null,
        priceError: result.priceError || "",
      }));
      setProfitabilityHistory((prev) => recordProfitabilityHistory(prev, rows, summary, {
        leagueId: result.leagueId || leagueId,
        source: options.historySource || "sync",
      }));
      return { success: true, rows, summary };
    } catch (error) {
      setProfitability((prev) => ({
        ...prev,
        loading: false,
        status: `${failurePrefix}: ${error.message}`,
      }));
      return { success: false, error: error.message };
    }
  }

  async function loadLeagueProfitability() {
    const leagueId = String(profitability.leagueId || "").trim();
    setProfitability((prev) => ({
      ...prev,
      loading: true,
      status: "Checking RollerCoin session for profitability...",
      priceError: "",
    }));

    try {
      let authResult = await checkAuth(true, { cookieHeader: marketRef.current.cookieHeader });
      if (!authResult?.authenticated) {
        authResult = await loginToRollerCoin();
      }
      if (!authResult?.authenticated) {
        throw new Error(authResult?.message || "RollerCoin session is not authorized.");
      }

      const activeCookieHeader =
        typeof authResult.cookieHeader === "string" && authResult.cookieHeader.trim()
          ? authResult.cookieHeader.trim()
          : marketRef.current.cookieHeader;

      return refreshLeagueProfitabilityWithCookie(activeCookieHeader, { leagueId });
    } catch (error) {
      setProfitability((prev) => ({
        ...prev,
        loading: false,
        status: `Profitability load failed: ${error.message}`,
      }));
      return { success: false, error: error.message };
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

        void refreshLeagueProfitabilityWithCookie(activeCookieHeader, {
          loadingStatus: "Loading profitability automatically after login...",
          successPrefix: "Profitability loaded automatically.",
          failurePrefix: "Automatic profitability refresh failed",
        });

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
    mergePlanner,
    mergeAnalysis,
    profitability,
    profitabilityHistory,
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
      updateProfitabilityLeagueId,
      setMarketViewTab,
      updateMarketSetting,
      showMoreRoomMiners,
      showMoreMarketResults,
      handleAuthAction,
      checkAuth,
      loginToRollerCoin,
      syncCurrentPower,
      loadRoomMiners,
      loadMergePlannerData,
      loadLeagueProfitability,
      updateMergePlannerBudget,
      checkForUpdates,
      loadMarketMiners,
      findBestMarketOptions,
    },
  };
}
