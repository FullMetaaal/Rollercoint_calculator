import { getCurrentSystemSnapshot, getCurrentTotal, POWER_MULTIPLIER } from "./power";
import { getIpcRenderer } from "./runtime";

export const MERGE_PLANNER_STAGE_ORDER = [
  { id: "auth", label: "Auth" },
  { id: "room", label: "Room miners" },
  { id: "inventoryMiners", label: "Inventory miners" },
  { id: "inventoryParts", label: "Inventory parts" },
  { id: "recipes", label: "Forge recipes" },
];

export function createDefaultMergePlannerStages() {
  return MERGE_PLANNER_STAGE_ORDER.map((stage) => ({
    ...stage,
    state: "idle",
    detail: "Waiting to start.",
  }));
}

export function createDefaultMergePlannerState() {
  return {
    loading: false,
    status: "Load room, inventory miners, parts, and forge recipes to analyze merge paths.",
    inventoryMinersStatus: "Inventory miners are not loaded.",
    inventoryPartsStatus: "Inventory parts are not loaded.",
    recipesStatus: "Forge recipes are not loaded.",
    rawInventoryMiners: [],
    rawInventoryParts: [],
    rawRecipes: [],
    lastLoadedAt: null,
    partial: false,
    budgetInput: "",
    stages: createDefaultMergePlannerStages(),
    logs: [],
    diagnostics: {},
  };
}

export function createEmptyMergePlannerAnalysis() {
  return {
    items: [],
    readyCount: 0,
    missingMinerCount: 0,
    missingPartCount: 0,
    craftNowCount: 0,
    craftCheaperCount: 0,
    buyCheaperCount: 0,
    unclearCount: 0,
    budget: null,
    budgetOpportunities: [],
    budgetSummaryText: "Enter a budget to compare scanned crafts and market miners by projected gain.",
    marketComparisonAvailable: false,
    ownedMinerStacksCount: 0,
    ownedPartStacksCount: 0,
    summaryText: "Merge recipes will appear here after loading forge and inventory data.",
  };
}

export function invokeInventoryMiners(cookieHeader) {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) throw new Error("IPC is unavailable.");
  return ipcRenderer.invoke("rollercoin-inventory-miners-fetch", { cookieHeader });
}

export function invokeInventoryParts(cookieHeader) {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) throw new Error("IPC is unavailable.");
  return ipcRenderer.invoke("rollercoin-inventory-parts-fetch", { cookieHeader });
}

export function invokeMergeCraftingList(cookieHeader) {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) throw new Error("IPC is unavailable.");
  return ipcRenderer.invoke("rollercoin-merge-crafting-fetch", { cookieHeader });
}

export function buildMergePlannerAttemptSummary(result) {
  const attempts = Array.isArray(result?.attempts) ? result.attempts : [];
  if (attempts.length === 0) {
    return "No attempt metadata returned.";
  }

  const statusAttempts = attempts.filter((entry) => Number.isFinite(Number(entry?.status)));
  const variants = [...new Set(attempts.map((entry) => String(entry?.variant || "").trim()).filter(Boolean))];
  const lastAttempt = attempts[attempts.length - 1];
  const statusSummary = statusAttempts.length > 0
    ? statusAttempts.map((entry) => `${entry.status}${entry.variant ? ` ${entry.variant}` : ""}`).slice(-4).join(" -> ")
    : "";
  const errorCount = attempts.filter((entry) => entry?.error).length;

  return [
    `Attempts: ${attempts.length}`,
    variants.length > 0 ? `Variants: ${variants.join(", ")}` : "",
    statusSummary ? `Statuses: ${statusSummary}` : "",
    errorCount > 0 ? `Errors: ${errorCount}` : "",
    lastAttempt?.step ? `Last step: ${lastAttempt.step}` : "",
  ].filter(Boolean).join(" | ");
}

export function buildMergePlannerDiagnostics(result, payloadKey) {
  const payload = payloadKey && Array.isArray(result?.[payloadKey]) ? result[payloadKey] : [];
  return {
    success: Boolean(result?.success),
    sourcePath: result?.sourcePath || "",
    selectedAuthVariant: result?.selectedAuthVariant || "",
    cookieCount: Number.isFinite(Number(result?.cookieCount)) ? Number(result.cookieCount) : 0,
    tokenCount: Number.isFinite(Number(result?.tokenCount)) ? Number(result.tokenCount) : 0,
    payloadCount: payload.length,
    unauthorized: Boolean(result?.unauthorized),
    partial: Boolean(result?.partial),
    error: result?.error || "",
    attemptSummary: buildMergePlannerAttemptSummary(result),
  };
}

function getByPath(obj, path) {
  return String(path || "")
    .split(".")
    .reduce((current, part) => (current && typeof current === "object" ? current[part] : undefined), obj);
}

function pickText(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  return String(value.en || value.us || value.ru || value.title || value.name || "").trim();
}

function firstFinite(values) {
  for (const value of values) {
    const parsed = Number(typeof value === "string" ? value.trim().replaceAll(" ", "").replace(",", ".") : value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return NaN;
}

function normalizePowerEhs(value) {
  const parsed = firstFinite([value]);
  if (!Number.isFinite(parsed) || parsed <= 0) return NaN;
  if (parsed < 1) return parsed;
  if (parsed >= 100000) return parsed / 1000000000;
  return parsed / 1000;
}

function normalizeInventoryPowerEhs(value) {
  const parsed = firstFinite([value]);
  if (!Number.isFinite(parsed) || parsed <= 0) return NaN;
  if (!Number.isInteger(parsed) && parsed < 1) return parsed;
  if (!Number.isInteger(parsed)) return parsed / 1000;
  return parsed / 1000000000;
}

function normalizeBonusPercent(value) {
  const parsed = firstFinite([value]);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  if (parsed >= 1000000) return parsed / 10000;
  if (Number.isInteger(parsed) && parsed >= 100) return parsed / 100;
  return parsed;
}

function normalizeInventoryBonusPercent(value) {
  const parsed = firstFinite([value]);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed / 100;
}

function normalizeUrl(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:")) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `https://rollercoin.com${trimmed}`;
  return "";
}

function extractWidth(entity) {
  const width = firstFinite([
    entity?.width,
    entity?.size,
    entity?.slot_size,
    entity?.slotSize,
    entity?.cell_width,
    entity?.slots,
    getByPath(entity, "item_data.width"),
    getByPath(entity, "prev_item_info.width"),
    getByPath(entity, "item.width"),
    getByPath(entity, "item.size"),
    getByPath(entity, "item.slot_size"),
    getByPath(entity, "item.slotSize"),
    getByPath(entity, "product.width"),
    getByPath(entity, "product.size"),
    getByPath(entity, "miner.width"),
    getByPath(entity, "miner.size"),
  ]);
  if (Number.isFinite(width) && width > 0) return Math.floor(width);

  const textValues = [
    entity?.width,
    entity?.size,
    entity?.slot_size,
    entity?.slotSize,
    getByPath(entity, "item_data.width"),
    getByPath(entity, "prev_item_info.width"),
    getByPath(entity, "item.width"),
    getByPath(entity, "item.size"),
    getByPath(entity, "product.width"),
    getByPath(entity, "product.size"),
  ];

  for (const value of textValues) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) continue;
    if (["small", "s", "1", "1x1"].includes(normalized)) return 1;
    if (["large", "l", "2", "2x1"].includes(normalized)) return 2;
  }

  return null;
}

function extractLevel(entity) {
  const parsed = firstFinite([
    entity?.level,
    entity?.lvl,
    entity?.lv,
    entity?.merge_level,
    entity?.mergeLevel,
    entity?.item_level,
    entity?.itemLevel,
    getByPath(entity, "item_data.level"),
    getByPath(entity, "prev_item_info.level"),
    getByPath(entity, "item.level"),
    getByPath(entity, "item.lvl"),
    getByPath(entity, "product.level"),
    getByPath(entity, "product.lvl"),
    getByPath(entity, "miner.level"),
    getByPath(entity, "miner.lvl"),
    getByPath(entity, "result.level"),
    getByPath(entity, "reward.level"),
  ]);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed) + 1;
}

function extractImageCandidates(entity) {
  const candidates = [
    entity?.imageUrl,
    entity?.image_url,
    entity?.image,
    entity?.img,
    entity?.icon,
    getByPath(entity, "item_data.image"),
    getByPath(entity, "item_data.image_url"),
    getByPath(entity, "prev_item_info.image"),
    getByPath(entity, "prev_item_info.image_url"),
    getByPath(entity, "item.image"),
    getByPath(entity, "item.image_url"),
    getByPath(entity, "product.image"),
    getByPath(entity, "miner.image"),
    getByPath(entity, "result.image"),
    getByPath(entity, "reward.image"),
  ];

  return [...new Set(candidates.map((candidate) => normalizeUrl(candidate)).filter(Boolean))];
}

function buildMinerImageKeyFromName(name) {
  const safeName = String(name || "").trim().toLowerCase();
  if (!safeName) return "";
  return safeName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildMarketMinerImageCandidates(assetNames, versions, templateUrl = "") {
  const normalizedNames = [...new Set(
    (Array.isArray(assetNames) ? assetNames : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .map((value) => value.split("?")[0].split("#")[0])
      .map((value) => value.split("/").pop() || "")
      .filter(Boolean)
      .map((value) => value.replace(/\.(gif|png|webp)$/i, "")),
  )];
  if (normalizedNames.length === 0) {
    return [];
  }

  const normalizedVersions = [...new Set(
    (Array.isArray(versions) ? versions : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];
  const exts = [".gif", ".png", ".webp"];
  const bases = [
    "https://static.rollercoin.com/static/img/market/miners/",
    "https://rollercoin.com/static/img/market/miners/",
    "https://static.rollercoin.com/static/img/storage/miners/",
    "https://rollercoin.com/static/img/storage/miners/",
    "https://static.rollercoin.com/static/img/collections/miners/",
    "https://rollercoin.com/static/img/collections/miners/",
  ];
  const candidates = [];

  normalizedNames.forEach((name) => {
    bases.forEach((base) => {
      exts.forEach((ext) => {
        const baseUrl = `${base}${encodeURIComponent(name)}${ext}`;
        candidates.push(baseUrl);
        normalizedVersions.forEach((version) => {
          candidates.push(`${baseUrl}?v=${encodeURIComponent(version)}`);
        });
      });
    });
  });

  if (templateUrl) {
    try {
      const parsed = new URL(templateUrl);
      normalizedNames.forEach((name) => {
        exts.forEach((ext) => {
          const templated = new URL(parsed.toString());
          templated.pathname = templated.pathname.replace(/[^/]+\.[a-zA-Z0-9]+$/, `${name}${ext}`);
          candidates.unshift(templated.toString());
          normalizedVersions.forEach((version) => {
            const versioned = new URL(templated.toString());
            versioned.searchParams.set("v", version);
            candidates.unshift(versioned.toString());
          });
        });
      });
    } catch {
      // Ignore malformed template URLs.
    }
  }

  return [...new Set(candidates)];
}

function extractMinerImageCandidates(entity) {
  const subject = entity && typeof entity === "object"
    ? (
      entity.item ||
      entity.product ||
      entity.miner ||
      entity.result ||
      entity.reward ||
      entity.output ||
      entity
    )
    : null;

  const genericCandidates = extractImageCandidates(subject || entity);
  const templateUrl =
    genericCandidates[0] ||
    normalizeUrl(subject?.image_url) ||
    normalizeUrl(subject?.image) ||
    normalizeUrl(entity?.image_url) ||
    normalizeUrl(entity?.image) ||
    "";
  const staticCandidates = buildMarketMinerImageCandidates(
    [
      subject?.filename,
      subject?.file_name,
      subject?.image_name,
      subject?.imageName,
      subject?.slug,
      subject?.code,
      subject?.code_name,
      subject?.codeName,
      getByPath(subject, "item_data.filename"),
      getByPath(subject, "item_data.file_name"),
      getByPath(subject, "prev_item_info.filename"),
      getByPath(subject, "prev_item_info.file_name"),
      buildMinerImageKeyFromName(
        pickText(getByPath(subject, "name")) ||
        pickText(getByPath(subject, "title")) ||
        pickText(subject?.name) ||
        pickText(subject?.title) ||
        pickText(getByPath(subject, "prev_item_info.name")),
      ),
      entity?.filename,
      entity?.file_name,
      entity?.slug,
      entity?.code,
      entity?.code_name,
      entity?.codeName,
      getByPath(entity, "item_data.filename"),
      getByPath(entity, "item_data.file_name"),
      getByPath(entity, "prev_item_info.filename"),
      getByPath(entity, "prev_item_info.file_name"),
    ],
    [
      subject?.img_ver,
      subject?.imgVer,
      subject?.image_ver,
      subject?.imageVer,
      getByPath(subject, "item_data.img_ver"),
      getByPath(subject, "item_data.imgVer"),
      getByPath(subject, "prev_item_info.img_ver"),
      getByPath(subject, "prev_item_info.imgVer"),
      entity?.img_ver,
      entity?.imgVer,
      entity?.image_ver,
      entity?.imageVer,
      getByPath(entity, "item_data.img_ver"),
      getByPath(entity, "item_data.imgVer"),
      getByPath(entity, "prev_item_info.img_ver"),
      getByPath(entity, "prev_item_info.imgVer"),
    ],
    templateUrl,
  );

  return [...new Set([...genericCandidates, ...staticCandidates])];
}

function buildStaticAssetImageCandidates(directory, assetNames, versions) {
  const normalizedNames = [...new Set(
    (Array.isArray(assetNames) ? assetNames : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .map((value) => value.split("?")[0].split("#")[0])
      .map((value) => value.split("/").pop() || "")
      .filter(Boolean)
      .map((value) => (/\.[a-z0-9]+$/i.test(value) ? value : `${value}.png`)),
  )];
  if (normalizedNames.length === 0) {
    return [];
  }

  const normalizedVersions = [...new Set(
    (Array.isArray(versions) ? versions : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];
  const hosts = ["https://static.rollercoin.com", "https://rollercoin.com"];
  const candidates = [];

  normalizedNames.forEach((name) => {
    hosts.forEach((host) => {
      const baseUrl = `${host}/static/img/storage/${directory}/${name}`;
      candidates.push(baseUrl);
      normalizedVersions.forEach((version) => {
        candidates.push(`${baseUrl}?v=${encodeURIComponent(version)}`);
      });
    });
  });

  return [...new Set(candidates)];
}

function extractPartImageCandidates(entity) {
  const subject = entity && typeof entity === "object"
    ? (
      entity.item ||
      entity.product ||
      entity.part ||
      entity.resource ||
      entity.requirement ||
      entity
    )
    : null;

  const genericCandidates = extractImageCandidates(subject || entity);
  const staticCandidates = buildStaticAssetImageCandidates(
    "mutation_components",
    [
      subject?.id,
      subject?._id,
      subject?.item_id,
      subject?.part_id,
      subject?.asset_id,
      subject?.filename,
      subject?.file_name,
      subject?.image_name,
      subject?.imageName,
      subject?.icon_name,
      subject?.iconName,
      subject?.image,
      subject?.img,
      subject?.icon,
      entity?.id,
      entity?._id,
      entity?.filename,
      entity?.file_name,
    ],
    [
      subject?.img_ver,
      subject?.imgVer,
      subject?.image_ver,
      subject?.imageVer,
      entity?.img_ver,
      entity?.imgVer,
      entity?.image_ver,
      entity?.imageVer,
      "1.0.1",
    ],
  );

  return [...new Set([...genericCandidates, ...staticCandidates])];
}

function normalizeIdentityName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function extractEntityCount(entity, fallback = 1) {
  const parsed = firstFinite([
    entity?.count,
    entity?.quantity,
    entity?.qty,
    entity?.amount,
    entity?.value,
    entity?.required,
    entity?.need,
    entity?.needed,
    getByPath(entity, "count"),
    getByPath(entity, "quantity"),
    getByPath(entity, "amount"),
    getByPath(entity, "require.count"),
    getByPath(entity, "required.count"),
  ]);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function normalizeMinerEntity(entity, fallbackName = "Miner", options = {}) {
  if (!entity || typeof entity !== "object") return null;

  const subject =
    entity.item ||
    entity.product ||
    entity.miner ||
    entity.result ||
    entity.reward ||
    entity.output ||
    entity;

  const name =
    pickText(getByPath(subject, "name")) ||
    pickText(getByPath(subject, "title")) ||
    pickText(getByPath(subject, "prev_item_info.name")) ||
    pickText(subject?.name) ||
    pickText(subject?.title) ||
    pickText(entity?.name) ||
    fallbackName;
  if (!name) return null;

  const rawPower = firstFinite([
    subject?.power,
    subject?.hashrate,
    subject?.hash_rate,
    getByPath(subject, "item_data.power"),
    getByPath(subject, "prev_item_info.power"),
    getByPath(subject, "item.power"),
    getByPath(subject, "product.power"),
    getByPath(subject, "miner.power"),
    getByPath(subject, "market_hashrate"),
  ]);
  const power = options.inventoryScale === true
    ? normalizeInventoryPowerEhs(rawPower)
    : normalizePowerEhs(rawPower);

  const rawBonusPercent = firstFinite([
    subject?.bonusPercent,
    subject?.bonus_percent,
    subject?.miner_bonus,
    subject?.percent_bonus,
    subject?.percent,
    subject?.bonus,
    getByPath(subject, "item_data.percent"),
    getByPath(subject, "item_data.bonus_percent"),
    getByPath(subject, "prev_item_info.percent"),
    getByPath(subject, "prev_item_info.bonus_percent"),
    getByPath(subject, "bonus.power_percent"),
    getByPath(subject, "item.bonus_percent"),
    getByPath(subject, "product.bonus_percent"),
    getByPath(subject, "miner.bonus_percent"),
  ]);
  const bonusPercent = options.inventoryScale === true
    ? normalizeInventoryBonusPercent(rawBonusPercent)
    : normalizeBonusPercent(rawBonusPercent);

  const level = extractLevel(subject);
  const width = extractWidth(subject);
  const imageCandidates = extractMinerImageCandidates(entity);
  const count = extractEntityCount(entity, 1);
  const id = String(
    subject?.id ||
    subject?._id ||
    subject?.item_id ||
    subject?.offer_id ||
    entity?.id ||
    entity?._id ||
    name,
  );

  return {
    id,
    name: String(name),
    power,
    bonusPercent,
    level,
    width,
    imageUrl: imageCandidates[0] || "",
    imageCandidates,
    count,
  };
}

function normalizePartEntity(entity, fallbackName = "Part") {
  if (!entity || typeof entity !== "object") return null;

  const subject =
    entity.item ||
    entity.product ||
    entity.part ||
    entity.resource ||
    entity.requirement ||
    entity;

  const name =
    pickText(getByPath(subject, "name")) ||
    pickText(getByPath(subject, "title")) ||
    pickText(subject?.name) ||
    pickText(entity?.name) ||
    fallbackName;
  if (!name) return null;

  const count = extractEntityCount(entity, 1);
  const rarity =
    pickText(subject?.rarity) ||
    pickText(getByPath(subject, "meta.rarity")) ||
    pickText(entity?.rarity) ||
    "";
  const level = extractLevel(subject);
  const imageCandidates = extractPartImageCandidates(entity);

  return {
    id: String(subject?.id || subject?._id || entity?.id || entity?._id || name),
    name: String(name),
    rarity,
    level,
    count,
    imageUrl: imageCandidates[0] || "",
    imageCandidates,
  };
}

function buildMinerKey(entity) {
  const normalizedName = normalizeIdentityName(entity?.name);
  if (!normalizedName) return "";

  const power = Number(entity?.power);
  const bonusPercent = Number(entity?.bonusPercent);
  const width = Number(entity?.width);
  const level = Number(entity?.level);
  if (Number.isFinite(power) && power > 0) {
    const roundedPower = Math.round(power * 1000000000);
    const roundedBonus = Number.isFinite(bonusPercent) ? Math.round(bonusPercent * 100) : 0;
    const roundedWidth = Number.isFinite(width) ? Math.floor(width) : 0;
    const roundedLevel = Number.isFinite(level) ? Math.floor(level) : 0;
    return `${normalizedName}::p${roundedPower}::b${roundedBonus}::w${roundedWidth}::l${roundedLevel}`;
  }
  if (Number.isFinite(level) && level > 0) {
    return `${normalizedName}::l${Math.floor(level)}`;
  }
  return normalizedName;
}

function buildMinerLookupKeys(entity) {
  const normalizedName = normalizeIdentityName(entity?.name);
  if (!normalizedName) return [];
  const primaryKey = buildMinerKey(entity);
  const keys = new Set([primaryKey, normalizedName]);
  const level = Number(entity?.level);
  if (Number.isFinite(level) && level > 0) {
    keys.add(`${normalizedName}::l${Math.floor(level)}`);
  }
  return [...keys].filter(Boolean);
}

function buildPartKey(entity) {
  const name = normalizeIdentityName(entity?.name);
  const rarity = normalizeIdentityName(entity?.rarity);
  const level = Number(entity?.level);
  if (!name) return "";
  const parts = [name];
  if (rarity) parts.push(`r${rarity}`);
  if (Number.isFinite(level) && level > 0) parts.push(`l${Math.floor(level)}`);
  return parts.join("::");
}

function buildPartLookupKeys(entity) {
  const exactKey = buildPartKey(entity);
  if (!exactKey) return [];

  const keys = new Set([exactKey]);
  const name = normalizeIdentityName(entity?.name);
  const rarity = normalizeIdentityName(entity?.rarity);
  const level = Number(entity?.level);

  if (name && rarity) {
    keys.add(`${name}::r${rarity}`);
  }
  if (name && Number.isFinite(level) && level > 0) {
    keys.add(`${name}::l${Math.floor(level)}`);
  }
  if (name && !rarity && (!Number.isFinite(level) || level <= 0)) {
    keys.add(name);
  }

  return [...keys];
}

function aggregateMiners(miners, options = {}) {
  const byKey = new Map();
  (Array.isArray(miners) ? miners : []).forEach((miner) => {
    const normalized = normalizeMinerEntity(miner, "Miner", options);
    if (!normalized) return;
    const key = buildMinerKey(normalized);
    if (!key) return;
    const existing = byKey.get(key);
    byKey.set(key, {
      ...(existing || normalized),
      count: (existing?.count || 0) + (normalized.count || 1),
    });
  });
  return [...byKey.values()];
}

export function normalizeInventoryMiners(miners) {
  return aggregateMiners(miners, { inventoryScale: true });
}

function aggregateParts(parts) {
  const byKey = new Map();
  (Array.isArray(parts) ? parts : []).forEach((part) => {
    const normalized = normalizePartEntity(part, "Part");
    if (!normalized) return;
    const key = buildPartKey(normalized);
    if (!key) return;
    const existing = byKey.get(key);
    byKey.set(key, {
      ...(existing || normalized),
      count: (existing?.count || 0) + (normalized.count || 1),
    });
  });
  return [...byKey.values()];
}

function classifyRequirement(entity) {
  const signatures = [
    entity?.type,
    entity?.item_type,
    entity?.itemType,
    entity?.category,
    entity?.kind,
    entity?.group,
    entity?.group_code,
    entity?.resource_type,
    getByPath(entity, "item.type"),
    getByPath(entity, "item.item_type"),
    getByPath(entity, "product.type"),
    getByPath(entity, "product.group_code"),
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");

  if (signatures.includes("part")) return "part";
  if (signatures.includes("miner")) return "miner";
  if (entity?.part || entity?.resource || entity?.part_id || entity?.resource_id) return "part";
  if (entity?.miner || entity?.miner_id || entity?.power || entity?.hashrate || entity?.hash_rate) return "miner";
  return Number.isFinite(normalizePowerEhs(entity?.power || entity?.hashrate || entity?.hash_rate)) ? "miner" : "part";
}

function extractRequirementArrays(recipe) {
  const candidates = [
    recipe?.requirements,
    recipe?.required_items,
    recipe?.requiredItems,
    recipe?.need_items,
    recipe?.needItems,
    recipe?.resources,
    recipe?.items,
    recipe?.recipe_items,
    recipe?.recipeItems,
    getByPath(recipe, "recipe.requirements"),
    getByPath(recipe, "recipe.required_items"),
    getByPath(recipe, "recipe.need_items"),
    getByPath(recipe, "recipe.resources"),
    getByPath(recipe, "ingredients"),
  ].filter((entry) => Array.isArray(entry) && entry.length > 0);

  if (candidates.length > 0) {
    return candidates;
  }

  const bestArray = [];
  const seen = new Set();
  const queue = [recipe];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      if (current.length > bestArray.length) {
        bestArray.splice(0, bestArray.length, ...current);
      }
      continue;
    }
    Object.values(current).forEach((value) => {
      if (value && typeof value === "object") {
        queue.push(value);
      }
    });
  }

  return bestArray.length > 0 ? [bestArray] : [];
}

function extractRecipeResultCandidate(recipe) {
  const directCandidates = [
    recipe?.result,
    recipe?.reward,
    recipe?.output,
    recipe?.result_item,
    recipe?.reward_item,
    recipe?.crafted_item,
    recipe?.item,
    recipe?.product,
    recipe?.miner,
    getByPath(recipe, "recipe.result"),
    getByPath(recipe, "recipe.result_item"),
    getByPath(recipe, "recipe.output"),
    getByPath(recipe, "recipe.reward"),
    recipe,
  ];

  for (const candidate of directCandidates) {
    const normalized = normalizeMinerEntity(candidate, "");
    if (normalized && normalized.name) {
      return normalized;
    }
  }
  return null;
}

function aggregateRequirements(requirements, keyBuilder, normalizer) {
  const byKey = new Map();
  requirements.forEach((entry) => {
    const normalized = normalizer(entry);
    if (!normalized) return;
    const key = keyBuilder(normalized);
    if (!key) return;
    const existing = byKey.get(key);
    byKey.set(key, {
      ...(existing || normalized),
      count: (existing?.count || 0) + (normalized.count || 1),
    });
  });
  return [...byKey.values()];
}

function parseBudget(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().replaceAll(" ", "").replace(",", ".");
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return NaN;
  return parsed;
}

function calculateProjectedGainEhs(currentSystemSnapshot, miner) {
  if (!currentSystemSnapshot || !miner) return NaN;
  const minerPowerEhs = Number(miner.power);
  const minerBonusPercent = Number(miner.bonusPercent) || 0;
  if (!Number.isFinite(minerPowerEhs) || minerPowerEhs <= 0) return NaN;

  const boughtPowerThs = minerPowerEhs * POWER_MULTIPLIER["Eh/s"];
  const currentTotalThs = getCurrentTotal(currentSystemSnapshot.baseThs, currentSystemSnapshot.bonusPercent);
  const nextTotalThs = getCurrentTotal(
    currentSystemSnapshot.baseThs + boughtPowerThs,
    currentSystemSnapshot.bonusPercent + minerBonusPercent,
  );
  return (nextTotalThs - currentTotalThs) / POWER_MULTIPLIER["Eh/s"];
}

function buildBudgetOpportunities({ budget, currentSystemSnapshot, marketMiners, craftItems }) {
  if (!Number.isFinite(budget) || budget < 0) {
    return {
      budgetOpportunities: [],
      budgetSummaryText: "Enter a valid non-negative budget to compare scanned crafts and market miners.",
    };
  }

  const directMarketItems = (Array.isArray(marketMiners) ? marketMiners : [])
    .filter((miner) => Number.isFinite(Number(miner?.price)) && Number(miner.price) <= budget)
    .map((miner) => {
      const gainEhs = calculateProjectedGainEhs(currentSystemSnapshot, miner);
      const price = Number(miner.price);
      return {
        id: `market-${miner.id || miner.name}`,
        type: "market",
        label: "Buy on market",
        name: miner.name,
        miner,
        spend: price,
        gainEhs,
        gainPerRlt: price > 0 && Number.isFinite(gainEhs) ? gainEhs / price : NaN,
        summary: `Buy ready for ${price.toFixed(2)} RLT.`,
        extra: Number.isFinite(Number(miner.bonusPercent)) && Number(miner.bonusPercent) > 0
          ? `${Number(miner.bonusPercent).toFixed(2)}% bonus included.`
          : "Direct market purchase.",
      };
    });

  const craftCandidates = (Array.isArray(craftItems) ? craftItems : [])
    .filter((item) =>
      Number.isFinite(Number(item?.craftSpendEstimate)) &&
      Number(item.craftSpendEstimate) <= budget &&
      Number(item.totalMissingParts) <= 0,
    )
    .map((item) => {
      const spend = Number(item.craftSpendEstimate) || 0;
      const gainEhs = calculateProjectedGainEhs(currentSystemSnapshot, item.resultMiner);
      return {
        id: `craft-${item.id}`,
        type: "craft",
        label: spend <= 0 ? "Craft now" : "Craft via inputs",
        name: item.resultMiner?.name || item.name,
        miner: item.resultMiner,
        spend,
        gainEhs,
        gainPerRlt: spend > 0 && Number.isFinite(gainEhs) ? gainEhs / spend : Number.POSITIVE_INFINITY,
        summary: spend <= 0
          ? "You already own all required ingredients."
          : `Finish craft for about ${spend.toFixed(2)} RLT in missing miners.`,
        extra: Number.isFinite(Number(item.readyBuyPrice))
          ? `Ready-buy market price: ${Number(item.readyBuyPrice).toFixed(2)} RLT.`
          : "Ready-buy price is not in the current market cache.",
        savingsVsMarket: item.savingsVsMarket,
        decisionLabel: item.decisionLabel,
        totalMissingMinerCopies: item.totalMissingMinerCopies,
      };
    });

  const budgetOpportunities = [...craftCandidates, ...directMarketItems]
    .sort((left, right) => {
      const leftGain = Number.isFinite(left.gainEhs) ? left.gainEhs : -Infinity;
      const rightGain = Number.isFinite(right.gainEhs) ? right.gainEhs : -Infinity;
      if (rightGain !== leftGain) return rightGain - leftGain;
      const leftTypeRank = left.type === "craft" ? 0 : 1;
      const rightTypeRank = right.type === "craft" ? 0 : 1;
      if (leftTypeRank !== rightTypeRank) return leftTypeRank - rightTypeRank;
      const leftFree = Number(left.spend) <= 0 ? 1 : 0;
      const rightFree = Number(right.spend) <= 0 ? 1 : 0;
      if (rightFree !== leftFree) return rightFree - leftFree;
      const leftEfficiency = Number.isFinite(left.gainPerRlt) ? left.gainPerRlt : -Infinity;
      const rightEfficiency = Number.isFinite(right.gainPerRlt) ? right.gainPerRlt : -Infinity;
      if (rightEfficiency !== leftEfficiency) return rightEfficiency - leftEfficiency;
      return Number(left.spend) - Number(right.spend);
    })
    .slice(0, 12);

  if (budgetOpportunities.length === 0) {
    return {
      budgetOpportunities: [],
      budgetSummaryText: `No reliable crafts or market miners found within ${budget.toFixed(2)} RLT. Missing parts are still excluded from craft ranking.`,
    };
  }

  const craftCount = budgetOpportunities.filter((item) => item.type === "craft").length;
  const marketCount = budgetOpportunities.filter((item) => item.type === "market").length;
  return {
    budgetOpportunities,
    budgetSummaryText:
      `Within ${budget.toFixed(2)} RLT found ${budgetOpportunities.length} options: crafts ${craftCount}, market ${marketCount}. Sorted by projected gain to your current total power.`,
  };
}

function buildDecisionModel({ statusTone, totalMissingParts, knownMissingMinerCost, readyBuyPrice }) {
  if (statusTone === "ready") {
    if (Number.isFinite(readyBuyPrice) && readyBuyPrice > 0) {
      return {
        decisionTone: "positive",
        decisionLabel: "Craft now",
        decisionSummary: `You already own the full recipe. Buying ready would cost ${readyBuyPrice.toFixed(2)} RLT.`,
        savingsVsMarket: readyBuyPrice,
        craftSpendEstimate: 0,
        marketSpendEstimate: readyBuyPrice,
        sortRank: 0,
      };
    }
    return {
      decisionTone: "positive",
      decisionLabel: "Craft now",
      decisionSummary: "You already own the full recipe and there is no ready-buy price in the current market cache.",
      savingsVsMarket: NaN,
      craftSpendEstimate: 0,
      marketSpendEstimate: NaN,
      sortRank: 1,
    };
  }

  if (Number.isFinite(knownMissingMinerCost) && Number.isFinite(readyBuyPrice) && totalMissingParts <= 0) {
    const delta = readyBuyPrice - knownMissingMinerCost;
    if (delta > 0.000001) {
      return {
        decisionTone: "positive",
        decisionLabel: "Craft after buying inputs",
        decisionSummary: `Buying missing recipe miners looks cheaper than buying the ready result.`,
        savingsVsMarket: delta,
        craftSpendEstimate: knownMissingMinerCost,
        marketSpendEstimate: readyBuyPrice,
        sortRank: 2,
      };
    }
    if (delta < -0.000001) {
      return {
        decisionTone: "negative",
        decisionLabel: "Buy on market",
        decisionSummary: "The ready result looks cheaper than buying the missing recipe miners.",
        savingsVsMarket: Math.abs(delta),
        craftSpendEstimate: knownMissingMinerCost,
        marketSpendEstimate: readyBuyPrice,
        sortRank: 5,
      };
    }
    return {
      decisionTone: "neutral",
      decisionLabel: "Price tie",
      decisionSummary: "Buying inputs and buying the ready result cost about the same.",
      savingsVsMarket: 0,
      craftSpendEstimate: knownMissingMinerCost,
      marketSpendEstimate: readyBuyPrice,
      sortRank: 4,
    };
  }

  if (Number.isFinite(knownMissingMinerCost) && Number.isFinite(readyBuyPrice) && totalMissingParts > 0) {
    if (knownMissingMinerCost >= readyBuyPrice) {
      return {
        decisionTone: "negative",
        decisionLabel: "Likely buy on market",
        decisionSummary: "Missing recipe miners already cost at least as much as the ready result, and parts are still missing.",
        savingsVsMarket: knownMissingMinerCost - readyBuyPrice,
        craftSpendEstimate: knownMissingMinerCost,
        marketSpendEstimate: readyBuyPrice,
        sortRank: 6,
      };
    }
    return {
      decisionTone: "warning",
      decisionLabel: "Need parts to compare",
      decisionSummary: "Missing recipe miners look cheaper than the ready result, but missing parts are not priced yet.",
      savingsVsMarket: readyBuyPrice - knownMissingMinerCost,
      craftSpendEstimate: knownMissingMinerCost,
      marketSpendEstimate: readyBuyPrice,
      sortRank: 3,
    };
  }

  if (!Number.isFinite(readyBuyPrice) && Number.isFinite(knownMissingMinerCost)) {
    return {
      decisionTone: "warning",
      decisionLabel: "No market result",
      decisionSummary: "Ready-buy price is not in the market cache. Crafting may be the only visible path.",
      savingsVsMarket: NaN,
      craftSpendEstimate: knownMissingMinerCost,
      marketSpendEstimate: NaN,
      sortRank: 3,
    };
  }

  if (Number.isFinite(readyBuyPrice) && !Number.isFinite(knownMissingMinerCost)) {
    return {
      decisionTone: "warning",
      decisionLabel: "Incomplete craft estimate",
      decisionSummary: "A ready-buy price exists, but the planner could not price all missing recipe miners yet.",
      savingsVsMarket: NaN,
      craftSpendEstimate: NaN,
      marketSpendEstimate: readyBuyPrice,
      sortRank: 4,
    };
  }

  return {
    decisionTone: "neutral",
    decisionLabel: "Need more data",
    decisionSummary: "The planner needs more market or recipe data before it can compare craft and buy paths.",
    savingsVsMarket: NaN,
    craftSpendEstimate: knownMissingMinerCost,
    marketSpendEstimate: readyBuyPrice,
    sortRank: 7,
  };
}

export function buildMergePlannerAnalysis({
  roomMiners,
  rawInventoryMiners,
  rawInventoryParts,
  rawRecipes,
  marketMiners,
  currentSystemState,
  budgetInput,
}) {
  if (!Array.isArray(rawRecipes) || rawRecipes.length === 0) {
    return createEmptyMergePlannerAnalysis();
  }

  const ownedRoomMiners = aggregateMiners((Array.isArray(roomMiners) ? roomMiners : []).map((miner) => ({ ...miner, count: 1 })));
  const inventoryMiners = normalizeInventoryMiners(rawInventoryMiners);
  const ownedMiners = aggregateMiners([...ownedRoomMiners, ...inventoryMiners]);
  const ownedParts = aggregateParts(rawInventoryParts);

  const ownedMinerCounts = new Map();
  ownedMiners.forEach((miner) => {
    const count = Math.max(1, Number(miner.count) || 1);
    buildMinerLookupKeys(miner).forEach((key) => {
      ownedMinerCounts.set(key, Math.max(ownedMinerCounts.get(key) || 0, count));
    });
  });

  const ownedPartCounts = new Map();
  ownedParts.forEach((part) => {
    const count = Math.max(1, Number(part.count) || 1);
    buildPartLookupKeys(part).forEach((key) => {
      ownedPartCounts.set(key, Math.max(ownedPartCounts.get(key) || 0, count));
    });
  });

  const marketOfferMap = new Map();
  (Array.isArray(marketMiners) ? marketMiners : []).forEach((miner) => {
    if (!miner || typeof miner !== "object") return;
    const price = Number(miner.price);
    if (!Number.isFinite(price) || price <= 0) return;
    buildMinerLookupKeys(miner).forEach((key) => {
      const existing = marketOfferMap.get(key);
      if (!existing || price < existing.price) {
        marketOfferMap.set(key, miner);
      }
    });
  });

  const items = [];
  const currentSystemSnapshot = getCurrentSystemSnapshot(currentSystemState);

  rawRecipes.forEach((recipe, index) => {
    const resultMiner = extractRecipeResultCandidate(recipe);
    const requirementArrays = extractRequirementArrays(recipe);
    const flattenedRequirements = requirementArrays.flatMap((entry) => (Array.isArray(entry) ? entry : []));
    const minerRequirements = aggregateRequirements(
      flattenedRequirements.filter((entry) => classifyRequirement(entry) === "miner"),
      buildMinerKey,
      (entry) => normalizeMinerEntity(entry, "Required miner"),
    );
    const partRequirements = aggregateRequirements(
      flattenedRequirements.filter((entry) => classifyRequirement(entry) === "part"),
      buildPartKey,
      (entry) => normalizePartEntity(entry, "Required part"),
    );

    if (!resultMiner && minerRequirements.length === 0 && partRequirements.length === 0) {
      return;
    }

    const requiredMiners = minerRequirements.map((requiredMiner) => {
      const keys = buildMinerLookupKeys(requiredMiner);
      const ownedCount = keys.reduce((best, key) => Math.max(best, ownedMinerCounts.get(key) || 0), 0);
      const missingCount = Math.max(0, (requiredMiner.count || 1) - ownedCount);
      const bestMarketOffer = keys.map((key) => marketOfferMap.get(key)).find(Boolean) || null;
      return {
        ...requiredMiner,
        ownedCount,
        missingCount,
        marketPrice: Number.isFinite(Number(bestMarketOffer?.price)) ? Number(bestMarketOffer.price) : NaN,
      };
    });

    const requiredParts = partRequirements.map((requiredPart) => {
      const lookupKeys = buildPartLookupKeys(requiredPart);
      const ownedCount = lookupKeys.reduce((best, key) => Math.max(best, ownedPartCounts.get(key) || 0), 0);
      const missingCount = Math.max(0, (requiredPart.count || 1) - ownedCount);
      return {
        ...requiredPart,
        ownedCount,
        missingCount,
      };
    });

    const totalMissingMinerCopies = requiredMiners.reduce((sum, item) => sum + item.missingCount, 0);
    const totalMissingParts = requiredParts.reduce((sum, item) => sum + item.missingCount, 0);
    const readyMarketOffer = resultMiner
      ? buildMinerLookupKeys(resultMiner).map((key) => marketOfferMap.get(key)).find(Boolean) || null
      : null;
    const knownMissingMinerCost = requiredMiners.reduce((sum, item) => {
      if (item.missingCount <= 0) return sum;
      if (!Number.isFinite(item.marketPrice) || item.marketPrice <= 0) return NaN;
      return Number.isFinite(sum) ? sum + (item.marketPrice * item.missingCount) : NaN;
    }, 0);
    const readyBuyPrice = Number.isFinite(Number(readyMarketOffer?.price)) ? Number(readyMarketOffer.price) : NaN;

    let statusTone = "ready";
    let statusLabel = "Ready now";
    if (totalMissingMinerCopies > 0 && totalMissingParts > 0) {
      statusTone = "blocked";
      statusLabel = "Need miners and parts";
    } else if (totalMissingMinerCopies > 0) {
      statusTone = "miners";
      statusLabel = "Need miner copies";
    } else if (totalMissingParts > 0) {
      statusTone = "parts";
      statusLabel = "Need parts";
    }

    const decision = buildDecisionModel({
      statusTone,
      totalMissingParts,
      knownMissingMinerCost,
      readyBuyPrice,
    });
    const projectedGainEhs = calculateProjectedGainEhs(currentSystemSnapshot, resultMiner);
    const projectedGainPerRlt =
      Number.isFinite(Number(decision.craftSpendEstimate)) && Number(decision.craftSpendEstimate) > 0 && Number.isFinite(projectedGainEhs)
        ? projectedGainEhs / Number(decision.craftSpendEstimate)
        : Number(decision.craftSpendEstimate) <= 0 && Number.isFinite(projectedGainEhs)
          ? Number.POSITIVE_INFINITY
          : NaN;

    items.push({
      id: String(recipe?.id || recipe?._id || resultMiner?.id || `merge-${index + 1}`),
      resultMiner: resultMiner || normalizeMinerEntity(recipe, "Merge result") || {
        id: `merge-${index + 1}`,
        name: `Merge recipe #${index + 1}`,
        power: NaN,
        bonusPercent: 0,
        level: null,
        width: null,
        imageUrl: "",
        imageCandidates: [],
      },
      requiredMiners,
      requiredParts,
      totalMissingMinerCopies,
      totalMissingParts,
      statusTone,
      statusLabel,
      comparisonText: decision.decisionSummary,
      comparisonTone: decision.decisionTone,
      decisionTone: decision.decisionTone,
      decisionLabel: decision.decisionLabel,
      decisionSummary: decision.decisionSummary,
      craftSpendEstimate: decision.craftSpendEstimate,
      marketSpendEstimate: decision.marketSpendEstimate,
      savingsVsMarket: decision.savingsVsMarket,
      projectedGainEhs,
      projectedGainPerRlt,
      sortRank: decision.sortRank,
      readyBuyPrice,
      missingMinerCopiesCost: knownMissingMinerCost,
      rawCraftable: Boolean(recipe?.is_craftable || recipe?.isCraftable),
    });
  });

  items.sort((left, right) => {
    const rankDiff = (Number(left.sortRank) || 99) - (Number(right.sortRank) || 99);
    if (rankDiff !== 0) return rankDiff;
    const leftSavings = Number(left.savingsVsMarket);
    const rightSavings = Number(right.savingsVsMarket);
    const leftSavingsSort = Number.isFinite(leftSavings) ? leftSavings : -Infinity;
    const rightSavingsSort = Number.isFinite(rightSavings) ? rightSavings : -Infinity;
    if (rightSavingsSort !== leftSavingsSort) return rightSavingsSort - leftSavingsSort;
    if (left.totalMissingParts !== right.totalMissingParts) {
      return left.totalMissingParts - right.totalMissingParts;
    }
    if (left.totalMissingMinerCopies !== right.totalMissingMinerCopies) {
      return left.totalMissingMinerCopies - right.totalMissingMinerCopies;
    }
    return String(left.resultMiner?.name || "").localeCompare(String(right.resultMiner?.name || ""), "en", { sensitivity: "base" });
  });

  const readyCount = items.filter((item) => item.statusTone === "ready").length;
  const missingMinerCount = items.filter((item) => item.totalMissingMinerCopies > 0).length;
  const missingPartCount = items.filter((item) => item.totalMissingParts > 0).length;
  const craftNowCount = items.filter((item) => item.decisionLabel === "Craft now").length;
  const craftCheaperCount = items.filter((item) => item.decisionLabel === "Craft after buying inputs").length;
  const buyCheaperCount = items.filter((item) => item.decisionLabel === "Buy on market" || item.decisionLabel === "Likely buy on market").length;
  const unclearCount = items.length - craftNowCount - craftCheaperCount - buyCheaperCount;
  const marketComparisonAvailable = Array.isArray(marketMiners) && marketMiners.length > 0;
  const budget = parseBudget(budgetInput);
  const { budgetOpportunities, budgetSummaryText } = buildBudgetOpportunities({
    budget,
    currentSystemSnapshot,
    marketMiners,
    craftItems: items,
  });

  return {
    items,
    readyCount,
    missingMinerCount,
    missingPartCount,
    craftNowCount,
    craftCheaperCount,
    buyCheaperCount,
    unclearCount,
    budget,
    budgetOpportunities,
    budgetSummaryText,
    marketComparisonAvailable,
    ownedMinerStacksCount: ownedMiners.length,
    ownedPartStacksCount: ownedParts.length,
    summaryText:
      `Recipes: ${items.length}; craft now: ${craftNowCount}; craft looks cheaper: ${craftCheaperCount}; ` +
      `buy looks cheaper: ${buyCheaperCount}; unclear: ${unclearCount}; ready now: ${readyCount}; ` +
      `market comparison: ${marketComparisonAvailable ? "available" : "load market scanner first"}.`,
  };
}
