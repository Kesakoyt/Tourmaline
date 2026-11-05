/* ==========================================================================
   Tourmaline — Application controller
   ========================================================================== */

import {
  BIAS_META,
  CATEGORY_META,
  DEFAULT_SOURCES,
  ICON_BASE,
  classifyUrgency,
  escapeHtml,
  fetchLiveNews,
  filterArticles,
  formatLongDate,
  formatRelativeTime,
  formatShortDate,
  getBiasDistribution,
  getBiasMeta,
  getCategoryMeta,
  getCountryMeta,
  getDemoArticles,
  getSummaryCandidates,
  hashString,
  htmlToText,
  isLast24Hours,
  mergeArticles,
  readFeedCache,
  safeHttpUrl,
  sanitizeHtml,
  sortArticles,
  truncate,
  writeFeedCache
} from "./news-service.js";
import {
  KEY_DEFAULTS,
  generateDailySummary,
  summaryToMarkdown
} from "./ai-summarizer.js";
import { isFirebaseConfigured } from "./firebase-config.js";
import {
  authErrorMessage,
  deleteArticleFromCloud,
  deleteRssSource,
  loadDailySummary,
  loadUserCloudData,
  saveArticleToCloud,
  saveDailySummary,
  saveRssSource,
  saveUserPreferences,
  sendPasswordReset,
  signInWithEmail,
  signOutUser,
  signUpWithEmail,
  startAuthListener
} from "./firebase-service.js";

const APP_VERSION = "1.0.0";

const STORAGE = {
  preferences: "tourmaline.preferences.v1",
  sources: "tourmaline.sources.v1",
  saved: "tourmaline.saved.v1",
  summaryPrefix: "tourmaline.summary."
};

const VIEW_META = {
  home: { title: "Accueil", kicker: "Fil en direct", document: "L'actualité en clair" },
  urgent: { title: "Urgent", kicker: "Cellule veille", document: "Alertes des dernières 24 h" },
  summary: { title: "Résumé", kicker: "Synthèse IA quotidienne", document: "Le résumé du jour" },
  investigations: { title: "Enquêtes", kicker: "Journalisme d'enquête", document: "Enquêtes & longs formats" },
  me: { title: "Moi", kicker: "Profil & préférences", document: "Mon espace" }
};

const DEFAULT_PREFERENCES = {
  defaultBias: 0,
  balanced: true,
  autoRefresh: true,
  apiKeys: {
    geminiKey: KEY_DEFAULTS.geminiKey || "",
    newsApiKey: KEY_DEFAULTS.newsApiKey || "",
    gnewsKey: KEY_DEFAULTS.gnewsKey || "",
    rss2jsonKey: ""
  }
};

const state = {
  activeView: "home",
  articles: [],
  sources: [],
  saved: new Map(),
  preferences: structuredClone(DEFAULT_PREFERENCES),
  filters: {
    category: "all",
    country: "all",
    bias: null,
    sort: "recent"
  },
  summary: null,
  summaryLoading: false,
  summaryProviderLabel: "",
  user: null,
  cloudReady: false,
  cloudStatus: isFirebaseConfigured ? "idle" : "local",
  lastSync: null,
  loading: false,
  initialLoadDone: false,
  demoMode: false,
  stale: false,
  lastUpdated: null,
  fetchErrors: [],
  successfulSources: [],
  installPrompt: null,
  readArticleId: null,
  visibleCount: 12,
  authMode: "login",
  authBusy: false,
  searchIndex: -1,
  searchResults: [],
  autoRefreshTimer: null,
  summaryDateKey: "",
  lastFocusBeforeOverlay: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/* --------------------------------------------------------------------------
   Stockage local
   -------------------------------------------------------------------------- */

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`[Tourmaline] Lecture locale impossible (${key}) :`, error);
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[Tourmaline] Écriture locale impossible (${key}) :`, error);
  }
}

function loadPreferences() {
  const stored = readJson(STORAGE.preferences, {});
  return {
    ...structuredClone(DEFAULT_PREFERENCES),
    ...(stored && typeof stored === "object" ? stored : {}),
    apiKeys: {
      ...DEFAULT_PREFERENCES.apiKeys,
      ...(stored?.apiKeys && typeof stored.apiKeys === "object" ? stored.apiKeys : {})
    }
  };
}

function savePreferences() {
  writeJson(STORAGE.preferences, state.preferences);
}

function loadSources() {
  const stored = readJson(STORAGE.sources, null);
  if (!Array.isArray(stored) || !stored.length) {
    return DEFAULT_SOURCES.map((source) => ({ ...source }));
  }

  const storedMap = new Map(stored.map((source) => [source.id, source]));
  const defaults = DEFAULT_SOURCES.map((source) => {
    const saved = storedMap.get(source.id);
    return saved
      ? { ...source, ...saved, isDefault: true }
      : { ...source };
  });

  const defaultIds = new Set(DEFAULT_SOURCES.map((source) => source.id));
  const custom = stored
    .filter((source) => source.id && !defaultIds.has(source.id))
    .map((source) => ({ ...source, isDefault: false }));

  return [...defaults, ...custom];
}

function saveSources() {
  writeJson(STORAGE.sources, state.sources);
}

function loadSavedArticles() {
  const stored = readJson(STORAGE.saved, []);
  if (!Array.isArray(stored)) return new Map();
  return new Map(stored.filter((article) => article?.id).map((article) => [article.id, article]));
}

function saveSavedArticles() {
  writeJson(STORAGE.saved, [...state.saved.values()]);
}

function getApiSettings() {
  return {
    geminiKey: state.preferences.apiKeys.geminiKey || "",
    newsApiKey: state.preferences.apiKeys.newsApiKey || "",
    gnewsKey: state.preferences.apiKeys.gnewsKey || "",
    rss2jsonKey: state.preferences.apiKeys.rss2jsonKey || ""
  };
}

function preferencesForCloud() {
  return {
    defaultBias: state.preferences.defaultBias,
    balanced: state.preferences.balanced,
    autoRefresh: state.preferences.autoRefresh
  };
}

/* --------------------------------------------------------------------------
   Helpers UI
   -------------------------------------------------------------------------- */

function iconUrl(name) {
  return `${ICON_BASE}/${name}.png`;
}

function icon(name, size = 18, className = "") {
  return `<img src="${iconUrl(name)}" alt="" width="${size}" height="${size}"${className ? ` class="${className}"` : ""} loading="lazy">`;
}

function initials(value = "Tourmaline") {
  return String(value)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "T";
}

function sourceInitials(source = "T") {
  const cleaned = String(source).replace(/^the\s+/i, "").trim();
  return (cleaned[0] || "T").toUpperCase();
}

function biasBadge(bias, extraClass = "") {
  const meta = getBiasMeta(bias);
  const extreme = Math.abs(Number(bias)) === 2 ? " bias-badge--extreme" : "";
  return `<span class="bias-badge bias-badge--${meta.className}${extreme}${extraClass ? ` ${extraClass}` : ""}">${escapeHtml(meta.label)}</span>`;
}

function showToast(message, { type = "info", title = "", duration = 4200 } = {}) {
  const stack = $("#toast-stack");
  if (!stack) return;
  const toast = document.createElement("div");
  toast.className = `toast${type === "error" ? " toast--error" : type === "urgent" ? " toast--urgent" : ""}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");

  const iconName = type === "error" ? "error" : type === "urgent" ? "fire-element" : type === "success" ? "approval" : "info";
  toast.innerHTML = `
    ${icon(iconName, 20)}
    <p>${title ? `<strong>${escapeHtml(title)}</strong>` : ""}${escapeHtml(message)}</p>
  `;
  stack.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("is-leaving");
    setTimeout(() => toast.remove(), 280);
  }, duration);
}

function setButtonLoading(button, loading) {
  if (!button) return;
  button.classList.toggle("is-loading", loading);
  button.disabled = loading;
}

function sanitizeFilename(value = "tourmaline-article") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80) || "tourmaline-article";
}

function downloadBlob(content, filename, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function getTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function getInitialsAvatarName() {
  if (state.user) {
    return state.user.displayName || state.user.email || "Utilisateur";
  }
  return "Mode invité";
}

function articleIcon(article) {
  return getCategoryMeta(article.category).icon || "news";
}

function setTopbar(view) {
  const meta = VIEW_META[view] || VIEW_META.home;
  const title = $("#topbar-title");
  const kicker = $("#topbar-kicker");
  if (title) title.textContent = meta.title;
  if (kicker) kicker.textContent = meta.kicker;
  document.title = `${meta.document} · Tourmaline`;
}

/* --------------------------------------------------------------------------
   Navigation
   -------------------------------------------------------------------------- */

function showView(view, { updateHash = true } = {}) {
  if (!VIEW_META[view]) return;

  state.activeView = view;
  $$("[data-view]").forEach((section) => {
    const isActive = section.dataset.view === view;
    section.hidden = !isActive;
    section.classList.toggle("view--active", isActive);
  });

  $$("[data-nav]").forEach((button) => {
    const isActive = button.dataset.nav === view;
    button.classList.toggle("is-active", isActive);
    if (isActive) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  setTopbar(view);

  if (updateHash) {
    const nextHash = `#${view}`;
    if (window.location.hash !== nextHash) {
      history.replaceState(null, "", nextHash);
    }
  }

  renderActiveView();

  if (view === "summary" && !state.summary && !state.summaryLoading) {
    const candidates = getSummaryCandidates(state.articles);
    if (candidates.eligible.length) generateSummary();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderActiveView() {
  switch (state.activeView) {
    case "urgent":
      renderUrgent();
      break;
    case "summary":
      renderSummary();
      break;
    case "investigations":
      renderInvestigations();
      break;
    case "me":
      renderProfile();
      break;
    case "home":
    default:
      renderHome();
      break;
  }
}

function updateSidebarUser() {
  const name = state.user?.displayName || state.user?.email?.split("@")[0] || "Mode invité";
  const status = state.user
    ? (state.cloudReady ? "Synchronisé avec Firebase" : "Synchronisation…")
    : (isFirebaseConfigured ? "Non connecté" : "Synchronisation locale");
  const sidebarName = $("#sidebar-user-name");
  const sidebarStatus = $("#sidebar-user-status");
  const avatar = $("#sidebar-avatar");
  const topbarAvatar = $("#topbar-avatar");

  if (sidebarName) sidebarName.textContent = name;
  if (sidebarStatus) sidebarStatus.textContent = status;
  if (avatar) avatar.textContent = initials(name);
  if (topbarAvatar) topbarAvatar.textContent = initials(name);
  document.body.classList.toggle("is-authenticated", Boolean(state.user));
}

/* --------------------------------------------------------------------------
   Firebase Auth & synchronisation
   -------------------------------------------------------------------------- */

async function initFirebase() {
  if (!isFirebaseConfigured) {
    state.cloudStatus = "local";
    updateSidebarUser();
    renderAuthState();
    return;
  }

  state.cloudStatus = "idle";
  try {
    await startAuthListener(async (user) => {
      state.user = user;
      await handleAuthChange(user);
    });
  } catch (error) {
    console.error("[Tourmaline] Firebase Auth :", error);
    state.cloudStatus = "error";
    updateSidebarUser();
    renderAuthState();
    showToast("Connexion Firebase impossible. Le mode local reste actif.", { type: "error" });
  }
}

async function handleAuthChange(user) {
  state.user = user;
  updateSidebarUser();

  if (!user) {
    state.cloudReady = false;
    state.cloudStatus = isFirebaseConfigured ? "signed-out" : "local";
    state.lastSync = null;
    renderAuthState();
    return;
  }

  state.cloudStatus = "loading";
  state.cloudReady = false;
  renderAuthState();

  try {
    const cloudData = await loadUserCloudData(user.uid);
    mergeCloudData(cloudData, user);
    state.cloudReady = true;
    state.cloudStatus = "synced";
    state.lastSync = new Date();

    // Synchronise les éléments locaux qui ne sont pas encore dans le cloud.
    await migrateLocalDataToCloud(user.uid, cloudData);

    savePreferences();
    saveSources();
    saveSavedArticles();
    scheduleAutoRefresh();
    updateSidebarUser();
    renderAuthState();
    renderProfileData();
    renderActiveView();
    await refreshSummaryFromCloud();
    showToast("Votre espace est synchronisé.", { type: "success" });
  } catch (error) {
    console.error("[Tourmaline] Synchronisation cloud :", error);
    state.cloudStatus = "error";
    state.cloudReady = false;
    updateSidebarUser();
    renderAuthState();
    showToast(authErrorMessage(error), { type: "error", title: "Synchronisation impossible" });
  }
}

function mergeCloudData(cloudData, user) {
  const remotePreferences = cloudData.profile?.preferences;
  if (remotePreferences && typeof remotePreferences === "object") {
    state.preferences = {
      ...state.preferences,
      ...remotePreferences,
      apiKeys: state.preferences.apiKeys
    };
  }

  if (!state.user?.displayName && cloudData.profile?.displayName) {
    user.displayName = cloudData.profile.displayName;
  }

  if (Array.isArray(cloudData.sources) && cloudData.sources.length) {
    const localById = new Map(state.sources.map((source) => [source.id, source]));
    cloudData.sources.forEach((remoteSource) => {
      if (!remoteSource?.id) return;
      const local = localById.get(remoteSource.id);
      localById.set(remoteSource.id, {
        ...(local || {}),
        ...remoteSource,
        isDefault: Boolean(local?.isDefault || DEFAULT_SOURCES.some((source) => source.id === remoteSource.id))
      });
    });
    state.sources = [...localById.values()];
  }

  if (Array.isArray(cloudData.saved) && cloudData.saved.length) {
    cloudData.saved.forEach((article) => {
      if (article?.id) state.saved.set(article.id, article);
    });
  }
}

async function migrateLocalDataToCloud(uid, cloudData) {
  const remoteSourceIds = new Set((cloudData.sources || []).map((source) => source.id));
  const remoteSavedIds = new Set((cloudData.saved || []).map((article) => article.id));

  const sourceTasks = state.sources
    .filter((source) => !remoteSourceIds.has(source.id))
    .map((source) => saveRssSource(uid, source).catch(() => null));
  const savedTasks = [...state.saved.values()]
    .filter((article) => !remoteSavedIds.has(article.id))
    .map((article) => saveArticleToCloud(uid, article).catch(() => null));

  await Promise.allSettled([
    saveUserPreferences(uid, preferencesForCloud(), state.user?.displayName || ""),
    ...sourceTasks,
    ...savedTasks
  ]);
}

async function syncPreferencesToCloud() {
  if (!state.user || !state.cloudReady) return;
  try {
    await saveUserPreferences(
      state.user.uid,
      preferencesForCloud(),
      state.user.displayName || state.user.email || ""
    );
    state.lastSync = new Date();
  } catch (error) {
    console.warn("[Tourmaline] Préférences non synchronisées :", error);
  }
}

async function syncSourceToCloud(source) {
  if (!state.user || !state.cloudReady) return;
  try {
    await saveRssSource(state.user.uid, source);
    state.lastSync = new Date();
  } catch (error) {
    console.warn("[Tourmaline] Source non synchronisée :", error);
  }
}

async function removeSourceFromCloud(sourceId) {
  if (!state.user || !state.cloudReady) return;
  try {
    await deleteRssSource(state.user.uid, sourceId);
    state.lastSync = new Date();
  } catch (error) {
    console.warn("[Tourmaline] Source cloud non supprimée :", error);
  }
}

async function syncSavedToCloud(article) {
  if (!state.user || !state.cloudReady) return;
  try {
    await saveArticleToCloud(state.user.uid, article);
    state.lastSync = new Date();
  } catch (error) {
    console.warn("[Tourmaline] Favori non synchronisé :", error);
  }
}

async function removeSavedFromCloud(articleId) {
  if (!state.user || !state.cloudReady) return;
  try {
    await deleteArticleFromCloud(state.user.uid, articleId);
    state.lastSync = new Date();
  } catch (error) {
    console.warn("[Tourmaline] Favori cloud non supprimé :", error);
  }
}

async function syncEverything() {
  if (!state.user) {
    showToast("Connectez-vous pour synchroniser vos données.", { type: "info" });
    return;
  }
  if (!state.cloudReady) {
    showToast("La synchronisation est déjà en cours.", { type: "info" });
    return;
  }

  const button = $("#sync-now");
  setButtonLoading(button, true);
  try {
    await saveUserPreferences(
      state.user.uid,
      preferencesForCloud(),
      state.user.displayName || state.user.email || ""
    );
    await Promise.allSettled([
      ...state.sources.map((source) => saveRssSource(state.user.uid, source)),
      ...[...state.saved.values()].map((article) => saveArticleToCloud(state.user.uid, article))
    ]);
    state.lastSync = new Date();
    renderAuthState();
    showToast("Toutes vos données sont à jour.", { type: "success", title: "Synchronisation terminée" });
  } catch (error) {
    showToast(authErrorMessage(error), { type: "error" });
  } finally {
    setButtonLoading(button, false);
  }
}

/* End of app part 1 ------------------------------------------------------- */

/* --------------------------------------------------------------------------
   Rendu des flux
   -------------------------------------------------------------------------- */

function interleaveByBias(articles, preferredBias = 0) {
  const buckets = new Map();
  articles.forEach((article) => {
    const bias = String(getBiasMeta(article.bias).value);
    if (!buckets.has(bias)) buckets.set(bias, []);
    buckets.get(bias).push(article);
  });

  const order = ["-2", "-1", "0", "1", "2"]
    .filter((bias) => buckets.has(bias))
    .sort((a, b) => Math.abs(Number(a) - preferredBias) - Math.abs(Number(b) - preferredBias));

  const mixed = [];
  let index = 0;
  let added = true;
  while (added) {
    added = false;
    order.forEach((bias) => {
      const bucket = buckets.get(bias);
      const article = bucket[index];
      if (article) {
        mixed.push(article);
        added = true;
      }
    });
    index += 1;
  }
  return mixed;
}

function getFeedArticles(view) {
  const filtered = filterArticles(
    state.articles,
    {
      ...state.filters,
      view
    },
    Date.now()
  );

  const mode = view === "urgent" ? "urgent" : state.filters.sort;
  const sorted = sortArticles(filtered, mode, state.preferences.defaultBias);
  const shouldBalance = view === "home"
    && state.preferences.balanced
    && state.filters.bias === null
    && state.filters.sort === "recent";

  return shouldBalance ? interleaveByBias(sorted, state.preferences.defaultBias) : sorted;
}

function skeletonGrid(count = 4) {
  return Array.from({ length: count }, (_, index) => `
    <div class="skeleton-card" aria-hidden="true">
      <div class="skeleton-card__media"></div>
      <div class="skeleton-card__body">
        <div class="skeleton-line skeleton-line--short"></div>
        <div class="skeleton-line skeleton-line--title"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line skeleton-line--medium"></div>
      </div>
    </div>
  `).join("");
}

function emptyState({ title, text, iconName = "news", action = "" }) {
  return `
    <div class="empty-state">
      ${icon(iconName, 46)}
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text)}</p>
      ${action}
    </div>
  `;
}

function demoBanner() {
  if (!state.demoMode) return "";
  return `
    <div class="demo-banner">
      ${icon("info", 22)}
      <div>
        <strong>Mode démonstration</strong>
        <p>Les flux externes sont momentanément indisponibles. Ces contenus illustrent l'interface. Ajoutez vos clés API ou activez d'autres sources dans l'onglet Moi.</p>
      </div>
      <button class="btn btn--ghost btn--small" type="button" data-nav="me" data-focus="rss-title">Gérer les sources</button>
    </div>
  `;
}

function articleImageMarkup(article, className = "article-card__media") {
  const categoryIcon = articleIcon(article);
  return `
    <div class="${className} ${article.image ? "has-image" : ""}">
      <div class="article-card__fallback">${icon(categoryIcon, 48)}</div>
      ${article.image ? `<img class="article-card__image" src="${escapeHtml(article.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-article-image>` : ""}
    </div>
  `;
}

function articleCard(article, index = 0) {
  const isLead = index === 0;
  const saved = state.saved.has(article.id);
  const bias = getBiasMeta(article.bias);
  const sourceMark = escapeHtml(sourceInitials(article.source));
  const description = article.description || htmlToText(article.content).slice(0, 220);

  return `
    <article class="article-card${isLead ? " article-card--lead" : ""}"
      data-article-id="${escapeHtml(article.id)}"
      tabindex="0"
      aria-label="${escapeHtml(`Lire : ${article.title} — ${article.source} — ${bias.label}`)}"
      style="animation-delay:${Math.min(index * 35, 280)}ms">
      ${articleImageMarkup(article)}
      <div class="article-card__body">
        <div class="article-card__meta">
          ${biasBadge(article.bias)}
          <span class="article-card__meta-dot"></span>
          <span class="article-card__time">${escapeHtml(formatRelativeTime(article.publishedAt))}</span>
          <span class="article-card__meta-dot"></span>
          <span class="article-card__category">${escapeHtml(article.categoryLabel || getCategoryMeta(article.category).label)}</span>
        </div>
        <h3>${escapeHtml(article.title)}</h3>
        ${description ? `<p class="article-card__excerpt">${escapeHtml(description)}</p>` : ""}
        <div class="article-card__foot">
          <span class="article-card__source">
            <span class="source-mark">${sourceMark}</span>
            <span>${escapeHtml(article.source)}</span>
          </span>
          <button class="card-save${saved ? " is-saved" : ""}" type="button"
            data-save-article="${escapeHtml(article.id)}"
            aria-label="${saved ? "Retirer des articles sauvegardés" : "Sauvegarder cet article"}"
            aria-pressed="${saved}">
            ${icon("bookmark", 16)}
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderHome() {
  const feed = $("#home-feed");
  if (!feed) return;

  const articles = getFeedArticles("home");
  const visibleArticles = articles.slice(0, state.visibleCount);
  const sourceCount = new Set(articles.map((article) => article.source)).size;
  const isInitialLoading = state.loading && !state.articles.length;

  feed.setAttribute("aria-busy", String(isInitialLoading));

  if (isInitialLoading) {
    feed.innerHTML = skeletonGrid(4);
  } else if (!articles.length) {
    feed.innerHTML = emptyState({
      title: "Aucun article dans ce filtre",
      text: state.articles.length
        ? "Élargissez la ligne éditoriale, la catégorie ou le pays pour retrouver davantage de sources."
        : "Le fil est en cours de chargement. Vérifiez votre connexion ou activez des sources dans votre espace.",
      iconName: "search",
      action: `<button class="btn btn--ghost btn--small" type="button" data-action="reset-filters">Réinitialiser les filtres</button>`
    });
  } else {
    feed.innerHTML = `${demoBanner()}${visibleArticles.map(articleCard).join("")}`;
  }

  const count = $("#home-count");
  if (count) {
    count.textContent = isInitialLoading
      ? "Chargement du fil…"
      : `${articles.length} article${articles.length > 1 ? "s" : ""} · ${sourceCount} source${sourceCount > 1 ? "s" : ""}`;
  }

  const loadMore = $("#load-more");
  if (loadMore) {
    loadMore.hidden = visibleArticles.length >= articles.length;
    loadMore.textContent = `Charger ${Math.min(12, articles.length - visibleArticles.length)} articles supplémentaires`;
  }

  renderFilters();
  renderHomeRail(articles);
  updateFeedMeta();
  updateUrgentBadge();
}

function renderHomeRail(articles) {
  const analyzed = state.summary?.analyzedCount || 0;
  const excluded = state.summary?.excludedCount || 0;
  const teaser = $("#summary-teaser");
  const teaserAnalyzed = $("#teaser-analyzed");
  const teaserExcluded = $("#teaser-excluded");
  const sidebarSummaryText = $("#sidebar-summary-text");

  if (teaser) {
    teaser.textContent = state.summary?.intro
      ? truncate(state.summary.intro, 180)
      : "Une synthèse neutre de l'actualité, générée sans les sources extrêmes.";
  }
  if (teaserAnalyzed) teaserAnalyzed.textContent = analyzed || "—";
  if (teaserExcluded) teaserExcluded.textContent = excluded || "—";
  if (sidebarSummaryText) {
    sidebarSummaryText.textContent = state.summary?.headline
      ? truncate(state.summary.headline, 120)
      : "La synthèse équilibrée des dernières 24 heures, sans les extrêmes.";
  }

  const chart = $("#balance-chart");
  if (chart) {
    const distribution = getBiasDistribution(articles);
    const total = Math.max(1, distribution.reduce((sum, item) => sum + item.count, 0));
    chart.innerHTML = distribution.map((item) => {
      const width = (item.count / total) * 100;
      return `<span class="seg-${item.meta.className}" style="width:${width}%;opacity:${item.count ? 1 : 0}" title="${escapeHtml(item.meta.label)} : ${item.count}"></span>`;
    }).join("");
  }

  const trending = $("#trending-list");
  if (trending) {
    const sorted = [...articles]
      .sort((a, b) => (b.urgencyScore || 0) - (a.urgencyScore || 0) || new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, 4);

    trending.innerHTML = sorted.length
      ? sorted.map((article, index) => `
        <div class="trending-item" role="button" tabindex="0" data-article-id="${escapeHtml(article.id)}">
          <span class="trending-item__index">${String(index + 1).padStart(2, "0")}</span>
          <span class="trending-item__copy">
            <strong>${escapeHtml(truncate(article.title, 100))}</strong>
            <small>${escapeHtml(article.source)} · ${escapeHtml(formatRelativeTime(article.publishedAt))}</small>
          </span>
        </div>
      `).join("")
      : `<p class="muted">Aucune tendance disponible.</p>`;
  }
}

function renderFilters() {
  $$("#category-chips [data-category]").forEach((chip) => {
    chip.classList.toggle("chip--active", chip.dataset.category === state.filters.category);
  });

  const country = $("#country-filter");
  if (country) country.value = state.filters.country;
  const sort = $("#sort-filter");
  if (sort) sort.value = state.filters.sort;

  const biasAll = $("#bias-all-home");
  if (biasAll) biasAll.checked = state.filters.bias === null;

  const slider = $("#bias-slider-home");
  if (slider) {
    slider.value = state.filters.bias === null ? state.preferences.defaultBias : state.filters.bias;
  }

  $$("#home-spectrum .spectrum__markers span").forEach((marker) => {
    const isSelected = state.filters.bias !== null
      && Number(marker.dataset.bias) === Number(state.filters.bias);
    marker.classList.toggle("is-selected", isSelected);
  });

  const activeFilterCount = [
    state.filters.category !== "all",
    state.filters.country !== "all",
    state.filters.bias !== null,
    state.filters.sort !== "recent"
  ].filter(Boolean).length;

  const filterCount = $("#filter-count");
  if (filterCount) {
    filterCount.textContent = String(activeFilterCount);
    filterCount.hidden = activeFilterCount === 0;
  }
  $("#filter-toggle")?.classList.toggle("is-active", activeFilterCount > 0);
}

function updateFeedMeta() {
  const lastUpdated = $("#last-updated");
  const liveStatus = $("#live-status");

  if (lastUpdated) {
    if (!state.lastUpdated) {
      lastUpdated.textContent = state.loading ? "Mise à jour en cours" : "En attente de mise à jour";
    } else if (state.demoMode) {
      lastUpdated.textContent = "Contenus de démonstration";
    } else if (state.stale) {
      lastUpdated.textContent = `Cache local · ${formatRelativeTime(state.lastUpdated)}`;
    } else {
      lastUpdated.textContent = `Actualisé ${formatRelativeTime(state.lastUpdated).toLowerCase()}`;
    }
  }

  if (liveStatus) {
    liveStatus.textContent = state.demoMode
      ? "Démo"
      : !navigator.onLine
        ? "Hors ligne"
        : state.stale
          ? "Cache"
          : "Direct";
  }
}

function updateUrgentBadge() {
  const urgentCount = state.articles.filter((article) => (
    article.isUrgent && isLast24Hours(article)
  )).length;
  const badge = $("#urgent-nav-badge");
  if (badge) badge.hidden = urgentCount === 0;
}

function urgentCard(article, index = 0) {
  const isLead = index === 0;
  const reason = article.urgencyReasons?.[0] || "Signal fort";
  const description = article.description || htmlToText(article.content).slice(0, 220);
  const imageMarkup = article.image
    ? `<img src="${escapeHtml(article.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-article-image>`
    : `<div class="article-card__fallback">${icon(articleIcon(article), 46)}</div>`;

  return `
    <article class="urgent-card${isLead ? " urgent-card--lead" : ""}"
      data-article-id="${escapeHtml(article.id)}"
      tabindex="0"
      aria-label="${escapeHtml(`Alerte : ${article.title} — ${article.source}`)}">
      <div class="urgent-card__media">
        ${imageMarkup}
        <span class="urgent-card__bias">${biasBadge(article.bias)}</span>
      </div>
      <div class="urgent-card__body">
        <span class="urgent-card__flag">${escapeHtml(reason)} · ${escapeHtml(formatRelativeTime(article.publishedAt))}</span>
        <h3>${escapeHtml(article.title)}</h3>
        ${description ? `<p>${escapeHtml(description)}</p>` : ""}
        <div class="urgent-card__foot">
          <span class="urgent-card__source">${escapeHtml(article.source)}</span>
          <span class="urgent-card__ago">${escapeHtml(article.categoryLabel || getCategoryMeta(article.category).label)}</span>
        </div>
      </div>
    </article>
  `;
}

function renderUrgent() {
  const feed = $("#urgent-feed");
  if (!feed) return;

  const articles = getFeedArticles("urgent");
  const alertCount = articles.length;
  const sources = new Set(articles.map((article) => article.source));
  const last = articles[0]?.publishedAt;

  const alerts = $("#urgent-alerts");
  const sourcesCount = $("#urgent-sources");
  const lastSignal = $("#urgent-last");
  const dateLabel = $("#urgent-date");

  if (alerts) alerts.textContent = alertCount ? String(alertCount).padStart(2, "0") : "00";
  if (sourcesCount) sourcesCount.textContent = String(sources.size);
  if (lastSignal) {
    lastSignal.textContent = last
      ? new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(last))
      : "—";
  }
  if (dateLabel) dateLabel.textContent = formatLongDate();

  if (state.loading && !state.articles.length) {
    feed.innerHTML = skeletonGrid(3);
  } else if (!articles.length) {
    feed.innerHTML = emptyState({
      title: "Aucun signal critique sur 24 h",
      text: "La veille est active. Aucun article ne franchit actuellement le seuil d'urgence défini par Tourmaline.",
      iconName: "shield"
    });
  } else {
    feed.innerHTML = articles.slice(0, 12).map(urgentCard).join("");
  }
}

function investigationCard(article, index = 0) {
  const isLead = index === 0;
  const description = article.description || htmlToText(article.content).slice(0, 220);
  const imageMarkup = articleImageMarkup(article, "investigation-card__media");

  return `
    <article class="investigation-card${isLead ? " investigation-card--lead" : ""}"
      data-article-id="${escapeHtml(article.id)}"
      tabindex="0"
      aria-label="${escapeHtml(`Lire l'enquête : ${article.title} — ${article.source}`)}">
      ${imageMarkup}
      <div class="investigation-card__body">
        <div class="investigation-card__kicker">
          ${biasBadge(article.bias)}
          <span>Enquête</span>
          <span>·</span>
          <span>${article.readingMinutes} min</span>
        </div>
        <h3>${escapeHtml(article.title)}</h3>
        ${description ? `<p>${escapeHtml(description)}</p>` : ""}
        <div class="investigation-card__foot">
          <span class="investigation-card__source">${escapeHtml(article.source)}</span>
          <span class="investigation-card__length">${escapeHtml(formatRelativeTime(article.publishedAt))}</span>
        </div>
      </div>
    </article>
  `;
}

function renderInvestigations() {
  const feed = $("#investigation-feed");
  if (!feed) return;

  const articles = getFeedArticles("investigations");
  const count = $("#investigation-count");
  if (count) count.textContent = String(articles.length);

  if (state.loading && !state.articles.length) {
    feed.innerHTML = skeletonGrid(3);
  } else if (!articles.length) {
    feed.innerHTML = emptyState({
      title: "Aucune enquête disponible",
      text: "Activez Mediapart, ProPublica ou un flux marqué « enquête » dans vos sources pour alimenter cette section.",
      iconName: "microscope",
      action: `<button class="btn btn--ghost btn--small" type="button" data-nav="me" data-focus="rss-title">Gérer les sources</button>`
    });
  } else {
    feed.innerHTML = `${demoBanner()}${articles.slice(0, 12).map(investigationCard).join("")}`;
  }
}

function renderFeedViews() {
  renderHome();
  renderUrgent();
  renderInvestigations();
  if (state.activeView === "summary") renderSummary();
}

/* End of app part 2a ------------------------------------------------------ */

/* --------------------------------------------------------------------------
   Rendu de la synthèse
   -------------------------------------------------------------------------- */

function loadLocalSummary() {
  const key = STORAGE.summaryPrefix + getTodayKey();
  const summary = readJson(key, null);
  if (summary?.generatedAt && Array.isArray(summary.sections)) {
    state.summary = summary;
    state.summaryDateKey = getTodayKey();
    return summary;
  }
  return null;
}

async function refreshSummaryFromCloud() {
  if (state.summary) return state.summary;
  try {
    const remote = await loadDailySummary(getTodayKey());
    if (remote?.generatedAt && Array.isArray(remote.sections)) {
      state.summary = remote;
      state.summaryDateKey = getTodayKey();
      writeJson(STORAGE.summaryPrefix + getTodayKey(), {
        ...remote,
        savedAt: undefined
      });
      renderSummary();
      renderHomeRail(getFeedArticles("home"));
      return remote;
    }
  } catch (error) {
    console.warn("[Tourmaline] Résumé cloud indisponible :", error);
  }
  return null;
}

function providerIcon(providerKey = "") {
  if (providerKey === "gemini") return "artificial-intelligence";
  if (providerKey === "browser-ai") return "robot";
  return "time-machine";
}

function renderSummary() {
  const dateLabel = $("#summary-date");
  if (dateLabel) dateLabel.textContent = formatLongDate();

  const provider = $("#summary-provider");
  const analyzed = $("#summary-analyzed");
  const excluded = $("#summary-excluded");
  const content = $("#summary-content");
  const stamp = $("#summary-updated");
  const sources = $("#summary-sources");
  const sourceChips = $("#summary-source-chips");
  const sourceCount = $("#summary-source-count");
  const paper = $("#summary-paper");
  const generateButton = $("#generate-summary");

  if (generateButton) {
    generateButton.disabled = state.summaryLoading;
    generateButton.classList.toggle("is-loading", state.summaryLoading);
    generateButton.innerHTML = state.summaryLoading
      ? `${icon("artificial-intelligence", 19)}<span>Génération en cours…</span>`
      : `${icon("artificial-intelligence", 19)}<span>${state.summary ? "Régénérer le résumé" : "Générer le résumé"}</span>`;
  }

  paper?.classList.toggle("is-generating", state.summaryLoading);

  if (!state.summary) {
    if (provider) {
      provider.innerHTML = `${icon(providerIcon(), 15)} ${state.summaryLoading ? "Génération…" : "En attente"}`;
    }
    if (analyzed) analyzed.textContent = "0";
    if (excluded) excluded.textContent = "0";
    if (stamp) stamp.textContent = state.summaryLoading ? "Génération en cours" : "Non générée";
    if (content) {
      content.innerHTML = state.summaryLoading
        ? `<div class="summary-empty"><h3>Tourmaline prépare la synthèse</h3><p>Les sources non extrêmes des dernières 24 heures sont en cours d'analyse.</p></div>`
        : `
          <div class="summary-empty">
            ${icon("artificial-intelligence", 44)}
            <h3>Votre synthèse se prépare</h3>
            <p>Tourmaline agrège les articles récents et écarte les positions extrêmes avant de générer une lecture équilibrée.</p>
            <button class="btn btn--primary" type="button" data-action="generate-summary">Générer maintenant</button>
          </div>
        `;
    }
    if (sources) sources.innerHTML = "";
    if (sourceChips) sourceChips.innerHTML = `<p class="muted">Aucune synthèse générée.</p>`;
    if (sourceCount) sourceCount.textContent = "0";
    return;
  }

  const summary = state.summary;
  if (provider) {
    provider.innerHTML = `${icon(providerIcon(summary.providerKey), 15)} ${escapeHtml(summary.provider || "Synthèse locale")}`;
  }
  if (analyzed) analyzed.textContent = String(summary.analyzedCount || 0);
  if (excluded) excluded.textContent = String(summary.excludedCount || 0);
  if (stamp) {
    const generatedAt = summary.generatedAt ? new Date(summary.generatedAt) : new Date();
    stamp.textContent = `Généré à ${new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(generatedAt)}`;
  }

  if (content) {
    const sections = Array.isArray(summary.sections) ? summary.sections : [];
    const keyPoints = Array.isArray(summary.keyPoints) ? summary.keyPoints : [];
    content.innerHTML = `
      <div class="summary-body">
        <h2 class="summary-body__headline">${escapeHtml(summary.headline || "L'essentiel des dernières 24 heures")}</h2>
        <p class="summary-body__intro">${escapeHtml(summary.intro || "")}</p>
        ${sections.map((section) => `
          <section class="summary-section">
            <h3>${escapeHtml(section.title || "")}</h3>
            <p>${escapeHtml(section.body || "").replace(/\n/g, "<br>")}</p>
          </section>
        `).join("")}
        ${keyPoints.length ? `
          <div class="summary-keypoints">
            <h3>Points clés</h3>
            <ul>${keyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>
          </div>
        ` : ""}
        ${summary.watch ? `
          <div class="summary-watch">
            ${icon("info", 18)}
            <p><strong>À surveiller — </strong>${escapeHtml(summary.watch)}</p>
          </div>
        ` : ""}
      </div>
    `;
  }

  const sourceList = Array.isArray(summary.sources) ? summary.sources : [];
  const sourceMarkup = sourceList.map((source) => `<span>${escapeHtml(source)}</span>`).join("");
  if (sources) sources.innerHTML = sourceMarkup;
  if (sourceChips) {
    sourceChips.innerHTML = sourceMarkup || `<p class="muted">Sources non disponibles.</p>`;
  }
  if (sourceCount) sourceCount.textContent = String(sourceList.length);
  renderHomeRail(getFeedArticles("home"));
}

/* --------------------------------------------------------------------------
   Profil, authentification et réglages
   -------------------------------------------------------------------------- */

function renderProfile() {
  renderAuthState();
  renderProfileData();
}

function renderProfileData() {
  renderPreferencesUI();
  renderApiKeysUI();
  renderRssSources();
  renderSavedArticles();
  renderInstallUI();
}

function renderAuthState() {
  const guest = $("#auth-guest");
  const userPanel = $("#auth-user");
  const warning = $("#firebase-warning");
  const status = $("#firebase-status");

  if (warning) warning.hidden = isFirebaseConfigured;
  if (guest) guest.hidden = Boolean(state.user);
  if (userPanel) userPanel.hidden = !state.user;

  if (status) {
    if (state.user) {
      if (!state.cloudReady) {
        status.className = "status-dot status-dot--local";
        status.innerHTML = "<i></i> Synchronisation…";
      } else if (state.cloudStatus === "error") {
        status.className = "status-dot status-dot--local";
        status.innerHTML = "<i></i> Erreur de sync";
      } else {
        status.className = "status-dot status-dot--synced";
        status.innerHTML = "<i></i> Synchronisé";
      }
    } else if (isFirebaseConfigured) {
      status.className = "status-dot status-dot--local";
      status.innerHTML = "<i></i> Non connecté";
    } else {
      status.className = "status-dot status-dot--local";
      status.innerHTML = "<i></i> Mode invité";
    }
  }

  if (state.user) {
    const name = state.user.displayName || state.user.email?.split("@")[0] || "Utilisateur";
    const profileName = $("#profile-name");
    const profileEmail = $("#profile-email");
    const profileAvatar = $("#profile-avatar");
    if (profileName) profileName.textContent = name;
    if (profileEmail) profileEmail.textContent = state.user.email || "";
    if (profileAvatar) profileAvatar.textContent = initials(name);

    const syncStatus = $("#sync-status");
    if (syncStatus) {
      const lastSyncLabel = state.lastSync
        ? new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(state.lastSync)
        : "en attente";
      syncStatus.innerHTML = `
        <span class="status-dot ${state.cloudReady ? "status-dot--synced" : "status-dot--local"}"><i></i>${state.cloudReady ? "Synchronisé" : "Synchronisation…"}</span>
        <small>Dernière sync : ${escapeHtml(lastSyncLabel)}</small>
      `;
    }
  }

  setAuthMode(state.authMode, { focus: false });
  updateSidebarUser();
}

function setAuthMode(mode, { focus = true } = {}) {
  state.authMode = mode === "signup" ? "signup" : "login";
  $$("[data-auth-tab]").forEach((tab) => {
    const active = tab.dataset.authTab === state.authMode;
    tab.classList.toggle("auth-tab--active", active);
    tab.setAttribute("aria-selected", String(active));
  });

  const nameField = $("#auth-name-field");
  const submit = $("#auth-submit");
  const password = $("#auth-password");
  const error = $("#auth-error");

  if (nameField) nameField.hidden = state.authMode !== "signup";
  if (submit) {
    submit.innerHTML = `${state.authMode === "signup" ? "Créer mon compte" : "Se connecter"}${icon("chevron-right", 16)}`;
  }
  if (password) {
    password.autocomplete = state.authMode === "signup" ? "new-password" : "current-password";
  }
  if (error) error.textContent = "";

  if (focus) {
    (state.authMode === "signup" ? $("#auth-name") : $("#auth-email"))?.focus();
  }
}

function renderPreferencesUI() {
  const slider = $("#pref-bias-slider");
  const value = $("#pref-bias-value");
  const balanced = $("#pref-balanced");
  const autoRefresh = $("#pref-autorefresh");

  if (slider) slider.value = state.preferences.defaultBias;
  if (value) value.textContent = getBiasMeta(state.preferences.defaultBias).label;
  if (balanced) balanced.checked = Boolean(state.preferences.balanced);
  if (autoRefresh) autoRefresh.checked = Boolean(state.preferences.autoRefresh);

  $$("#profile-spectrum .spectrum__markers span").forEach((marker) => {
    marker.classList.toggle(
      "is-selected",
      Number(marker.dataset.bias) === Number(state.preferences.defaultBias)
    );
  });
}

function renderApiKeysUI() {
  const keys = state.preferences.apiKeys;
  const mapping = {
    "#api-gemini": keys.geminiKey,
    "#api-newsapi": keys.newsApiKey,
    "#api-gnews": keys.gnewsKey,
    "#api-rss2json": keys.rss2jsonKey
  };
  Object.entries(mapping).forEach(([selector, value]) => {
    const input = $(selector);
    if (input && document.activeElement !== input) input.value = value || "";
  });
}

function renderRssSources() {
  const list = $("#rss-list");
  const activeCount = $("#rss-active-count");
  if (activeCount) {
    activeCount.textContent = String(state.sources.filter((source) => source.active).length);
  }
  if (!list) return;

  list.innerHTML = state.sources.map((source) => {
    const bias = getBiasMeta(source.bias);
    const category = getCategoryMeta(source.category).label;
    const country = getCountryMeta(source.country).label;
    return `
      <div class="rss-source${source.active ? "" : " is-inactive"}" data-source-id="${escapeHtml(source.id)}">
        <span class="rss-source__mark">${escapeHtml(sourceInitials(source.name))}</span>
        <div class="rss-source__copy">
          <strong>${escapeHtml(source.name)}</strong>
          <span class="rss-source__meta">
            ${biasBadge(source.bias)}
            <span>${escapeHtml(category)}</span>
            <span>·</span>
            <span>${escapeHtml(country)}</span>
            ${source.investigation ? "<span>· Enquête</span>" : ""}
          </span>
        </div>
        <div class="rss-source__actions">
          <label class="switch" title="${source.active ? "Désactiver" : "Activer"} ${escapeHtml(source.name)}">
            <input type="checkbox" data-toggle-source="${escapeHtml(source.id)}" ${source.active ? "checked" : ""} aria-label="Activer ${escapeHtml(source.name)}">
            <span class="switch__track"><span class="switch__thumb"></span></span>
          </label>
          ${source.isDefault ? "" : `
            <button class="rss-source__delete" type="button" data-delete-source="${escapeHtml(source.id)}" aria-label="Supprimer ${escapeHtml(source.name)}" title="Supprimer la source">
              ${icon("delete-sign", 16)}
            </button>
          `}
        </div>
      </div>
    `;
  }).join("") || `<p class="muted">Aucune source configurée.</p>`;
}

function renderSavedArticles() {
  const list = $("#saved-list");
  const count = $("#saved-count");
  if (count) count.textContent = String(state.saved.size);
  if (!list) return;

  const articles = [...state.saved.values()].sort((a, b) => {
    const dateA = new Date(a.savedAt?.toDate?.() || a.savedAt || a.publishedAt || 0);
    const dateB = new Date(b.savedAt?.toDate?.() || b.savedAt || b.publishedAt || 0);
    return dateB - dateA;
  });

  if (!articles.length) {
    list.innerHTML = `<p class="muted">Vos articles sauvegardés apparaîtront ici. Cliquez sur le signet d'une carte pour les retrouver.</p>`;
    return;
  }

  list.innerHTML = articles.slice(0, 10).map((article) => `
    <div class="saved-item" role="button" tabindex="0" data-article-id="${escapeHtml(article.id)}" aria-label="Ouvrir ${escapeHtml(article.title)}">
      <span class="saved-item__icon">${icon(articleIcon(article), 18)}</span>
      <span class="saved-item__copy">
        <strong>${escapeHtml(article.title)}</strong>
        <small>${escapeHtml(article.source || "Source")} · ${escapeHtml(formatRelativeTime(article.publishedAt))}</small>
      </span>
      <button class="saved-item__remove" type="button" data-remove-saved="${escapeHtml(article.id)}" aria-label="Retirer des articles sauvegardés">
        ${icon("delete-sign", 14)}
      </button>
    </div>
  `).join("");
}

function renderInstallUI() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const installButton = $("#install-btn");
  const topbarInstall = $("#install-topbar");
  const hint = $("#install-hint");

  if (standalone) {
    if (installButton) {
      installButton.disabled = true;
      installButton.innerHTML = `${icon("checkmark", 16)} Application installée`;
    }
    if (topbarInstall) topbarInstall.hidden = true;
    if (hint) hint.textContent = "Tourmaline fonctionne en mode application autonome.";
    return;
  }

  if (installButton) {
    installButton.disabled = false;
    installButton.innerHTML = `${icon("download", 16)} Installer l'application`;
  }
  if (topbarInstall) topbarInstall.hidden = !state.installPrompt;
  if (hint) {
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    hint.textContent = isIos
      ? "Sur iOS : Partager → Sur l'écran d'accueil."
      : state.installPrompt
        ? "Installation disponible depuis ce navigateur."
        : "Utilisez le menu de votre navigateur → Installer Tourmaline.";
  }
}

/* End of app part 2b ------------------------------------------------------ */

/* --------------------------------------------------------------------------
   Chargement du fil
   -------------------------------------------------------------------------- */

let preferencesSyncTimer = null;
let searchDebounceTimer = null;

function recentArticles(articles, maxDays = 7) {
  const cutoff = Date.now() - maxDays * 86400000;
  return articles.filter((article) => {
    const time = new Date(article.publishedAt).getTime();
    return Number.isNaN(time) || time >= cutoff;
  });
}

function setRefreshBusy(busy) {
  const iconButton = $("#refresh-btn");
  if (iconButton) {
    iconButton.classList.toggle("is-spinning", busy);
    iconButton.setAttribute("aria-busy", String(busy));
  }
  $$('[data-action="refresh"]').forEach((button) => {
    button.disabled = busy;
    button.classList.toggle("is-loading", busy);
  });
}

async function loadNews({ manual = false, silent = false } = {}) {
  if (state.loading) return;

  if (!navigator.onLine) {
    const hasArticles = state.articles.length > 0;
    state.loading = false;
    state.initialLoadDone = true;
    state.stale = hasArticles;
    state.demoMode = !hasArticles;
    if (!hasArticles) {
      state.articles = getDemoArticles();
      state.lastUpdated = new Date();
      writeFeedCache(state.articles, { demoMode: true });
    }
    updateConnectionUI();
    renderFeedViews();
    updateFeedMeta();
    if (manual || !hasArticles) {
      showToast(
        hasArticles
          ? "Vous êtes hors ligne. Les articles disponibles restent consultables."
          : "Vous êtes hors ligne. Des contenus de démonstration sont affichés.",
        { type: "info" }
      );
    }
    return;
  }

  const wasInitial = !state.initialLoadDone;
  state.loading = true;
  state.fetchErrors = [];
  setRefreshBusy(true);

  const progressLabel = $("#last-updated");
  if (progressLabel && !state.articles.length) progressLabel.textContent = "Connexion aux sources…";
  if (wasInitial) renderActiveView();

  let demoTimer = null;
  if (wasInitial && !state.articles.length) {
    demoTimer = setTimeout(() => {
      if (state.articles.length) return;
      state.articles = getDemoArticles();
      state.demoMode = true;
      state.lastUpdated = new Date();
      renderFeedViews();
      updateFeedMeta();
      updateUrgentBadge();
    }, 4000);
  }

  const partialArticles = [];

  try {
    const result = await fetchLiveNews({
      sources: state.sources,
      settings: getApiSettings(),
      options: { deadlineMs: 15000 },
      onProgress: ({ completed, total, result: sourceResult }) => {
        if (progressLabel && !silent) {
          progressLabel.textContent = `Sources ${completed}/${total}…`;
        }
        if (!sourceResult?.articles?.length) return;
        if (demoTimer) {
          clearTimeout(demoTimer);
          demoTimer = null;
        }
        if (silent) return;

        partialArticles.push(...sourceResult.articles);
        const cached = recentArticles(state.articles.filter((article) => !article.isDemo));
        state.articles = mergeArticles(partialArticles, cached);
        state.demoMode = false;
        state.stale = false;
        state.lastUpdated = new Date();
        renderFeedViews();
        updateFeedMeta();
        updateUrgentBadge();
      }
    });

    const liveArticles = result.articles.filter((article) => !article.isDemo);
    const cachedArticles = recentArticles(state.articles.filter((article) => !article.isDemo));
    state.fetchErrors = Array.isArray(result.errors) ? result.errors : [];

    if (liveArticles.length) {
      state.articles = mergeArticles(liveArticles, cachedArticles);
      state.demoMode = false;
      state.stale = false;
      state.lastUpdated = new Date();
      state.successfulSources = result.successfulSources || [];
      writeFeedCache(state.articles, {
        demoMode: false,
        successfulSources: state.successfulSources,
        errors: state.fetchErrors.slice(0, 6)
      });
    } else if (cachedArticles.length) {
      state.articles = mergeArticles(cachedArticles);
      state.demoMode = false;
      state.stale = true;
      state.lastUpdated = new Date();
    } else {
      state.articles = getDemoArticles();
      state.demoMode = true;
      state.stale = false;
      state.lastUpdated = new Date();
      writeFeedCache(state.articles, { demoMode: true });
    }
  } catch (error) {
    console.error("[Tourmaline] Chargement du fil :", error);
    state.fetchErrors = [{ source: "Réseau", message: error.message || "Erreur inconnue" }];
    const cachedArticles = recentArticles(state.articles.filter((article) => !article.isDemo));
    if (cachedArticles.length) {
      state.articles = mergeArticles(cachedArticles);
      state.demoMode = false;
      state.stale = true;
      state.lastUpdated = new Date();
    } else {
      state.articles = getDemoArticles();
      state.demoMode = true;
      state.stale = false;
      state.lastUpdated = new Date();
    }
  } finally {
    if (demoTimer) clearTimeout(demoTimer);
    state.loading = false;
    state.initialLoadDone = true;
    setRefreshBusy(false);
    renderFeedViews();
    renderProfile();
    updateFeedMeta();
    updateUrgentBadge();

    if (manual) {
      if (state.demoMode) {
        showToast("Les flux externes sont indisponibles. Le mode démonstration reste actif.", {
          type: "error",
          title: "Veille interrompue"
        });
      } else if (state.fetchErrors.length) {
        showToast(
          `${state.articles.length} articles chargés · ${state.fetchErrors.length} source(s) en échec.`,
          { type: "info", title: "Mise à jour partielle" }
        );
      } else {
        showToast(`${state.articles.length} articles issus de ${state.successfulSources.length} source(s).`, {
          type: "success",
          title: "Fil actualisé"
        });
      }
    } else if (wasInitial && state.demoMode) {
      showToast("Flux externes indisponibles : contenus de démonstration affichés.", {
        type: "info",
        title: "Mode démonstration"
      });
    }
  }
}

function updateConnectionUI() {
  const online = navigator.onLine;
  const pill = $("#connection-pill");
  const label = $("#connection-label");
  pill?.classList.toggle("is-offline", !online);
  if (label) label.textContent = online ? "En ligne" : "Hors ligne";
  if (pill) pill.title = online ? "Connexion active" : "Aucune connexion réseau";
  updateFeedMeta();
}

/* --------------------------------------------------------------------------
   Synthèse IA
   -------------------------------------------------------------------------- */

async function generateSummary() {
  if (state.summaryLoading) return;

  const { eligible } = getSummaryCandidates(state.articles);
  if (!eligible.length) {
    showToast("Aucun article éligible dans les dernières 24 heures. Actualisez le fil ou activez d'autres sources.", {
      type: "info",
      title: "Synthèse impossible"
    });
    return;
  }

  state.summaryLoading = true;
  state.summaryProviderLabel = "";
  renderSummary();

  try {
    const summary = await generateDailySummary({
      articles: state.articles,
      geminiKey: state.preferences.apiKeys.geminiKey || "",
      allowBrowserAI: true,
      onProvider: (provider) => {
        state.summaryProviderLabel = provider;
        const providerEl = $("#summary-provider");
        if (providerEl) {
          const key = provider === "Gemini" ? "gemini" : provider === "IA locale" ? "browser-ai" : "extractive";
          providerEl.innerHTML = `${icon(providerIcon(key), 15)} ${escapeHtml(provider)}…`;
        }
      }
    });

    state.summary = summary;
    state.summaryDateKey = getTodayKey();
    writeJson(STORAGE.summaryPrefix + state.summaryDateKey, summary);

    if (state.user) {
      saveDailySummary(state.summaryDateKey, summary).catch((error) => {
        console.warn("[Tourmaline] Résumé non publié dans Firestore :", error);
      });
    }

    renderSummary();
    renderHomeRail(getFeedArticles("home"));
    updateUrgentBadge();

    showToast(
      `${summary.provider} · ${summary.analyzedCount || 0} articles analysés · ${summary.excludedCount || 0} exclus.`,
      { type: "success", title: "Synthèse prête" }
    );
  } catch (error) {
    console.error("[Tourmaline] Synthèse :", error);
    showToast("La synthèse n'a pas pu être générée. Réessayez dans un instant.", {
      type: "error",
      title: "Échec de la synthèse"
    });
  } finally {
    state.summaryLoading = false;
    state.summaryProviderLabel = "";
    renderSummary();
  }
}

async function copyText(value) {
  const text = String(value || "");
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    console.warn("[Tourmaline] Presse-papiers indisponible :", error);
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

async function copySummary() {
  if (!state.summary) {
    showToast("Générez d'abord la synthèse du jour.", { type: "info" });
    return;
  }
  const copied = await copyText(summaryToMarkdown(state.summary));
  showToast(copied ? "La synthèse est dans votre presse-papiers." : "Copie impossible dans ce navigateur.", {
    type: copied ? "success" : "error",
    title: copied ? "Copié" : "Erreur"
  });
}

/* --------------------------------------------------------------------------
   Favoris
   -------------------------------------------------------------------------- */

function findArticle(articleId) {
  if (!articleId) return null;
  return state.articles.find((article) => article.id === articleId)
    || state.saved.get(articleId)
    || null;
}

function updateReaderSaveState(article) {
  const button = $("#reader-save");
  if (!button || !article) return;
  const saved = state.saved.has(article.id);
  button.classList.toggle("is-saved", saved);
  button.setAttribute("aria-pressed", String(saved));
  button.setAttribute("aria-label", saved ? "Retirer des articles sauvegardés" : "Sauvegarder l'article");
  const label = button.querySelector("span");
  if (label) label.textContent = saved ? "Sauvegardé" : "Sauver";
}

function toggleSaveArticle(articleId) {
  const article = findArticle(articleId);
  if (!article) return;

  if (state.saved.has(article.id)) {
    state.saved.delete(article.id);
    removeSavedFromCloud(article.id);
    showToast("Article retiré de votre bibliothèque.", { type: "info" });
  } else {
    state.saved.set(article.id, { ...article, savedAt: new Date().toISOString() });
    syncSavedToCloud(article);
    showToast("Article ajouté à votre bibliothèque.", { type: "success", title: "Sauvegardé" });
  }

  saveSavedArticles();
  renderActiveView();
  renderSavedArticles();
  updateReaderSaveState(article);
}

/* --------------------------------------------------------------------------
   Lecteur d'article
   -------------------------------------------------------------------------- */

function openArticle(articleId) {
  const article = findArticle(articleId);
  if (!article) {
    showToast("Cet article n'est plus disponible dans le fil.", { type: "error" });
    return;
  }

  const reader = $("#reader");
  if (!reader) return;

  state.readArticleId = article.id;
  state.lastFocusBeforeOverlay = document.activeElement;

  const bias = getBiasMeta(article.bias);
  const biasEl = $("#reader-bias");
  if (biasEl) {
    biasEl.className = `bias-badge bias-badge--${bias.className}${Math.abs(Number(article.bias)) === 2 ? " bias-badge--extreme" : ""}`;
    biasEl.textContent = bias.label;
  }

  const dateEl = $("#reader-date");
  if (dateEl) dateEl.textContent = `Publié le ${formatShortDate(article.publishedAt)}`;
  const readingEl = $("#reader-reading-time");
  if (readingEl) readingEl.textContent = `${article.readingMinutes || 1} min de lecture`;
  const titleEl = $("#reader-title");
  if (titleEl) titleEl.textContent = article.title;
  const dekEl = $("#reader-dek");
  if (dekEl) {
    dekEl.textContent = article.description || "";
    dekEl.hidden = !article.description;
  }

  const sourceEl = $("#reader-source");
  if (sourceEl) sourceEl.textContent = article.source || "Source";
  const authorEl = $("#reader-author");
  if (authorEl) authorEl.textContent = article.author || bias.label;
  const sourceAvatar = $("#reader-source-avatar");
  if (sourceAvatar) sourceAvatar.textContent = sourceInitials(article.source);
  const sourceLine = $("#reader-source-line");
  if (sourceLine) sourceLine.textContent = article.source || "Tourmaline";

  const image = safeHttpUrl(article.image);
  const figure = $("#reader-figure");
  const imageEl = $("#reader-image");
  const caption = $("#reader-caption");
  if (figure && imageEl) {
    if (image) {
      imageEl.src = image;
      imageEl.alt = article.title;
      if (caption) caption.textContent = `Illustration · ${article.source || "Source"}`;
      figure.hidden = false;
    } else {
      imageEl.removeAttribute("src");
      figure.hidden = true;
    }
  }

  const body = $("#reader-body");
  if (body) {
    const content = article.content || (article.description
      ? `<p>${escapeHtml(article.description)}</p>`
      : "<p>Contenu partiel. Consultez l'article original pour lire l'intégralité.</p>");
    const safeContent = sanitizeHtml(content) || `<p>${escapeHtml(htmlToText(content))}</p>`;
    const partial = htmlToText(content).length < 320
      ? `<p class="reader__partial">${icon("info", 17)} Aperçu limité : retrouvez l'intégralité de cet article chez ${escapeHtml(article.source || "la source")}.</p>`
      : "";
    body.innerHTML = `${safeContent}${partial}`;
  }

  const originalUrl = safeHttpUrl(article.url);
  const original = $("#reader-original");
  const originalEnd = $("#reader-original-end");
  [original, originalEnd].forEach((link) => {
    if (!link) return;
    link.hidden = !originalUrl;
    link.href = originalUrl || "#";
  });
  const sourceEnd = $("#reader-source-end");
  if (sourceEnd) sourceEnd.textContent = article.source || "la source";

  updateReaderSaveState(article);
  toggleDownloadMenu(false);
  reader.hidden = false;
  updateBodyOverlayState();

  const scroll = $("#reader-scroll");
  if (scroll) scroll.scrollTop = 0;
  const progress = $("#reader-progress-bar");
  if (progress) progress.style.width = "0%";

  requestAnimationFrame(() => {
    $("#reader-article")?.setAttribute("tabindex", "-1");
    $("#reader-article")?.focus({ preventScroll: true });
  });
}

function closeReader() {
  const reader = $("#reader");
  if (!reader || reader.hidden) return;
  reader.hidden = true;
  state.readArticleId = null;
  toggleDownloadMenu(false);
  updateBodyOverlayState();
  state.lastFocusBeforeOverlay?.focus?.();
}

function toggleDownloadMenu(force) {
  const menu = $("#download-menu");
  const button = $("#reader-download");
  if (!menu || !button) return;
  const shouldOpen = typeof force === "boolean" ? force : menu.hidden;
  menu.hidden = !shouldOpen;
  button.setAttribute("aria-expanded", String(shouldOpen));
}

function updateReaderProgress() {
  const scroll = $("#reader-scroll");
  const bar = $("#reader-progress-bar");
  if (!scroll || !bar) return;
  const max = scroll.scrollHeight - scroll.clientHeight;
  const percent = max > 0 ? (scroll.scrollTop / max) * 100 : 0;
  bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function textOf(element) {
  return (element?.textContent || "").replace(/\s+/g, " ").trim();
}

function htmlToMarkdown(html = "") {
  if (!html) return "";
  if (typeof DOMParser === "undefined") return htmlToText(html);
  const doc = new DOMParser().parseFromString(`<div id="md-root">${html}</div>`, "text/html");
  const root = doc.getElementById("md-root");
  if (!root) return htmlToText(html);
  const blocks = [];

  function walk(container) {
    [...container.children].forEach((child) => {
      const tag = child.tagName.toLowerCase();
      if (tag === "h2" || tag === "h3" || tag === "h4") {
        blocks.push(`${"#".repeat(Number(tag[1]))} ${textOf(child)}`);
        return;
      }
      if (tag === "p") {
        if (textOf(child)) blocks.push(textOf(child));
        return;
      }
      if (tag === "blockquote") {
        if (textOf(child)) blocks.push(`> ${textOf(child)}`);
        return;
      }
      if (tag === "ul" || tag === "ol") {
        [...child.querySelectorAll(":scope > li")].forEach((item, index) => {
          const marker = tag === "ol" ? `${index + 1}.` : "-";
          blocks.push(`${marker} ${textOf(item)}`);
        });
        return;
      }
      if (tag === "figure" || tag === "figcaption" || tag === "hr") return;
      walk(child);
    });
  }

  walk(root);
  if (!blocks.length) blocks.push(htmlToText(html));
  return blocks.filter(Boolean).join("\n\n");
}

function articleToMarkdown(article) {
  if (!article) return "";
  const bias = getBiasMeta(article.bias);
  const lines = [
    `# ${article.title}`,
    "",
    article.description ? `> ${article.description}` : null,
    "",
    `**Source :** ${article.source || "Source inconnue"}  `,
    `**Ligne éditoriale :** ${bias.label}  `,
    `**Publié le :** ${formatShortDate(article.publishedAt)}  `,
    article.author ? `**Auteur :** ${article.author}` : null,
    article.url ? `**Article original :** ${article.url}` : null,
    "",
    "---",
    "",
    htmlToMarkdown(article.content),
    "",
    "---",
    "",
    `Exporté depuis Tourmaline le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(new Date())}.`
  ];

  return lines.filter((line) => line !== null).join("\n").replace(/\n{3,}/g, "\n\n");
}

async function downloadArticlePdf(article) {
  if (!article) return;
  if (typeof window.html2pdf !== "function") {
    showToast("Le moteur PDF n'est pas encore chargé. Utilisez « Imprimer » puis « Enregistrer en PDF ».", {
      type: "info",
      title: "PDF indisponible"
    });
    return;
  }

  const source = $("#reader-article");
  if (!source) return;

  const clone = source.cloneNode(true);
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
  clone.querySelectorAll("img, .reader__figure, .reader__end .btn").forEach((element) => element.remove());
  clone.classList.add("pdf-export__article");

  const wrapper = document.createElement("div");
  wrapper.className = "pdf-export";
  const footer = document.createElement("p");
  footer.className = "pdf-export__footer";
  footer.textContent = `Exporté depuis Tourmaline le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(new Date())} · ${article.source || ""}`;
  wrapper.appendChild(clone);
  wrapper.appendChild(footer);
  document.body.appendChild(wrapper);

  try {
    await window.html2pdf().set({
      margin: [12, 14, 14, 14],
      filename: `${sanitizeFilename(article.title)}.pdf`,
      image: { type: "jpeg", quality: 0.96 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"] }
    }).from(wrapper).save();
    showToast("Le PDF a été téléchargé.", { type: "success", title: "Export terminé" });
  } catch (error) {
    console.error("[Tourmaline] Export PDF :", error);
    showToast("L'export PDF a échoué. Essayez l'impression puis « Enregistrer en PDF ».", { type: "error" });
  } finally {
    setTimeout(() => wrapper.remove(), 600);
  }
}

function downloadArticle(kind) {
  const article = findArticle(state.readArticleId);
  if (!article) return;
  toggleDownloadMenu(false);

  if (kind === "md") {
    downloadBlob(articleToMarkdown(article), `${sanitizeFilename(article.title)}.md`, "text/markdown;charset=utf-8");
    showToast("Le fichier Markdown a été téléchargé.", { type: "success", title: "Export terminé" });
    return;
  }

  downloadArticlePdf(article);
}

/* --------------------------------------------------------------------------
   Recherche
   -------------------------------------------------------------------------- */

function updateBodyOverlayState() {
  const reader = $("#reader");
  const search = $("#search-overlay");
  document.body.classList.toggle("reader-open", Boolean(reader && !reader.hidden));
  document.body.classList.toggle("overlay-open", Boolean(search && !search.hidden));
}

function openSearch() {
  const overlay = $("#search-overlay");
  const input = $("#search-input");
  if (!overlay) return;

  state.lastFocusBeforeOverlay = document.activeElement;
  state.searchResults = [];
  state.searchIndex = -1;
  overlay.hidden = false;
  updateBodyOverlayState();
  if (input) input.value = "";
  renderSearchResults([]);

  requestAnimationFrame(() => {
    input?.focus();
    const hint = $("#search-hints");
    if (hint) hint.hidden = false;
  });
}

function closeSearch() {
  const overlay = $("#search-overlay");
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  updateBodyOverlayState();
  state.searchIndex = -1;
  state.searchResults = [];
  state.lastFocusBeforeOverlay?.focus?.();
}

function articleMatchesQuery(article, terms) {
  const haystack = [
    article.title,
    article.description,
    article.source,
    article.author,
    article.categoryLabel,
    getCategoryMeta(article.category).label
  ].join(" ").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function scoreArticle(article, terms) {
  const title = String(article.title || "").toLowerCase();
  const source = String(article.source || "").toLowerCase();
  const description = String(article.description || "").toLowerCase();
  let score = 0;
  terms.forEach((term) => {
    if (title.includes(term)) score += 8;
    if (source.includes(term)) score += 4;
    if (description.includes(term)) score += 2;
  });
  return score;
}

function runSearch(rawQuery) {
  const query = String(rawQuery || "").trim();
  const resultsEl = $("#search-results");
  if (!resultsEl) return;

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) {
    state.searchResults = [];
    state.searchIndex = -1;
    resultsEl.innerHTML = `<p class="search-empty">Tapez quelques lettres pour explorer le fil, une source ou une catégorie.</p>`;
    return;
  }

  const results = state.articles
    .filter((article) => articleMatchesQuery(article, terms))
    .map((article) => ({ article, score: scoreArticle(article, terms) }))
    .sort((a, b) => b.score - a.score || new Date(b.article.publishedAt) - new Date(a.article.publishedAt))
    .slice(0, 10)
    .map((entry) => entry.article);

  state.searchResults = results;
  state.searchIndex = results.length ? 0 : -1;

  if (!results.length) {
    resultsEl.innerHTML = `<p class="search-empty">Aucun résultat pour « ${escapeHtml(query)} ». Essayez un mot plus large.</p>`;
    return;
  }

  resultsEl.innerHTML = results.map((article, index) => {
    const media = article.image
      ? `<img src="${escapeHtml(article.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : icon(articleIcon(article), 21);
    return `
      <div class="search-result${index === 0 ? " is-focused" : ""}"
        role="option"
        tabindex="-1"
        aria-selected="${index === 0}"
        data-search-result="${index}"
        data-article-id="${escapeHtml(article.id)}">
        <span class="search-result__icon">${media}</span>
        <span class="search-result__copy">
          <strong>${escapeHtml(article.title)}</strong>
          <small>${escapeHtml(article.source)} · ${escapeHtml(formatRelativeTime(article.publishedAt))}</small>
        </span>
        <span class="search-result__bias">${biasBadge(article.bias)}</span>
      </div>
    `;
  }).join("");
}

function renderSearchResults(results) {
  const resultsEl = $("#search-results");
  if (!resultsEl) return;
  if (!results.length) {
    resultsEl.innerHTML = `<p class="search-empty">Tapez quelques lettres pour explorer le fil, une source ou une catégorie.</p>`;
  }
}

function moveSearchFocus(direction) {
  if (!state.searchResults.length) return;
  const next = (state.searchIndex + direction + state.searchResults.length) % state.searchResults.length;
  state.searchIndex = next;
  $$("#search-results .search-result").forEach((element, index) => {
    const focused = index === next;
    element.classList.toggle("is-focused", focused);
    element.setAttribute("aria-selected", String(focused));
    if (focused) element.scrollIntoView({ block: "nearest" });
  });
}

function activateSearchSelection() {
  const article = state.searchResults[state.searchIndex] || state.searchResults[0];
  if (!article) return;
  closeSearch();
  openArticle(article.id);
}

function handleSearchKeydown(event) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveSearchFocus(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveSearchFocus(-1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    activateSearchSelection();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeSearch();
  }
}

/* --------------------------------------------------------------------------
   Authentification et réglages
   -------------------------------------------------------------------------- */

function setAuthError(message) {
  const error = $("#auth-error");
  if (error) error.textContent = message || "";
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  setAuthError("");

  if (!isFirebaseConfigured) {
    const message = "Firebase n'est pas configuré. Le mode invité reste disponible.";
    setAuthError(message);
    showToast(message, { type: "info" });
    return;
  }

  const email = $("#auth-email")?.value.trim() || "";
  const password = $("#auth-password")?.value || "";
  const name = $("#auth-name")?.value.trim() || "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setAuthError("Saisissez une adresse e-mail valide.");
    return;
  }
  if (password.length < 6) {
    setAuthError("Le mot de passe doit contenir au moins 6 caractères.");
    return;
  }

  const submit = $("#auth-submit");
  setButtonLoading(submit, true);
  state.authBusy = true;

  try {
    if (state.authMode === "signup") {
      await signUpWithEmail(name || email.split("@")[0], email, password);
      showToast("Bienvenue dans Tourmaline. Votre espace est prêt.", { type: "success", title: "Compte créé" });
    } else {
      await signInWithEmail(email, password);
      showToast("Votre espace est reconnecté.", { type: "success", title: "Connexion réussie" });
    }
    const form = $("#auth-form");
    form?.reset();
  } catch (error) {
    console.error("[Tourmaline] Authentification :", error);
    const message = authErrorMessage(error);
    setAuthError(message);
    showToast(message, { type: "error", title: "Connexion impossible" });
  } finally {
    state.authBusy = false;
    setButtonLoading(submit, false);
  }
}

async function handleForgotPassword() {
  if (!isFirebaseConfigured) {
    showToast("Configurez Firebase pour réinitialiser un mot de passe.", { type: "info" });
    return;
  }
  const email = $("#auth-email")?.value.trim() || "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setAuthError("Saisissez votre adresse e-mail pour recevoir le lien de réinitialisation.");
    $("#auth-email")?.focus();
    return;
  }
  try {
    await sendPasswordReset(email);
    setAuthError("");
    showToast("Consultez votre boîte e-mail pour réinitialiser le mot de passe.", {
      type: "success",
      title: "E-mail envoyé"
    });
  } catch (error) {
    const message = authErrorMessage(error);
    setAuthError(message);
    showToast(message, { type: "error" });
  }
}

async function handleSignOut() {
  try {
    await signOutUser();
    showToast("Vous êtes déconnecté. Le mode invité reste actif.", { type: "info" });
  } catch (error) {
    showToast(authErrorMessage(error), { type: "error" });
  }
}

function schedulePreferencesCloudSync() {
  if (!state.user || !state.cloudReady) return;
  clearTimeout(preferencesSyncTimer);
  preferencesSyncTimer = setTimeout(() => {
    syncPreferencesToCloud();
  }, 900);
}

function handleApiSubmit(event) {
  event.preventDefault();
  state.preferences.apiKeys = {
    geminiKey: $("#api-gemini")?.value.trim() || "",
    newsApiKey: $("#api-newsapi")?.value.trim() || "",
    gnewsKey: $("#api-gnews")?.value.trim() || "",
    rss2jsonKey: $("#api-rss2json")?.value.trim() || ""
  };
  savePreferences();
  schedulePreferencesCloudSync();
  renderApiKeysUI();
  showToast("Les clés sont conservées dans ce navigateur uniquement.", {
    type: "success",
    title: "Clés API enregistrées"
  });
}

function handleRssSubmit(event) {
  event.preventDefault();
  const errorEl = $("#rss-error");
  if (errorEl) errorEl.textContent = "";

  const name = $("#rss-name")?.value.trim() || "";
  const rawUrl = $("#rss-url")?.value.trim() || "";
  const url = safeHttpUrl(rawUrl);

  if (!name) {
    if (errorEl) errorEl.textContent = "Indiquez le nom du média.";
    return;
  }
  if (!url || !/^https?:\/\//i.test(url)) {
    if (errorEl) errorEl.textContent = "Indiquez une URL de flux RSS valide (http ou https).";
    return;
  }

  const duplicate = state.sources.find((source) => (
    source.url === url || source.name.toLowerCase() === name.toLowerCase()
  ));
  if (duplicate) {
    if (errorEl) errorEl.textContent = "Cette source est déjà présente dans votre liste.";
    return;
  }

  const source = {
    id: `custom_${hashString(url)}`,
    name,
    url,
    bias: Number($("#rss-bias")?.value || 0),
    category: $("#rss-category")?.value || "monde",
    country: $("#rss-country")?.value || "FR",
    investigation: Boolean($("#rss-investigation")?.checked),
    active: true,
    isDefault: false
  };

  state.sources.push(source);
  saveSources();
  syncSourceToCloud(source);
  renderRssSources();
  $("#rss-form")?.reset();
  if (errorEl) errorEl.textContent = "";

  showToast(`« ${name} » a été ajouté à vos sources.`, { type: "success", title: "Source ajoutée" });
  if (navigator.onLine) loadNews({ silent: true });
}

function toggleSource(sourceId, active) {
  const source = state.sources.find((item) => item.id === sourceId);
  if (!source) return;
  source.active = Boolean(active);
  saveSources();
  syncSourceToCloud(source);
  renderRssSources();
  showToast(
    source.active ? `« ${source.name} » est activé.` : `« ${source.name} » est désactivé.`,
    { type: "info" }
  );
  if (source.active && navigator.onLine) loadNews({ silent: true });
}

function deleteSource(sourceId) {
  const index = state.sources.findIndex((source) => source.id === sourceId);
  if (index < 0) return;
  const source = state.sources[index];
  if (source.isDefault) {
    showToast("Les sources Tourmaline peuvent être désactivées mais pas supprimées.", { type: "info" });
    return;
  }
  if (!window.confirm(`Supprimer la source « ${source.name} » ?`)) return;

  state.sources.splice(index, 1);
  saveSources();
  removeSourceFromCloud(sourceId);
  renderRssSources();
  showToast(`« ${source.name} » a été supprimé.`, { type: "info" });
}

/* --------------------------------------------------------------------------
   Installation PWA
   -------------------------------------------------------------------------- */

async function promptInstall() {
  if (!state.installPrompt) {
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    showToast(
      isIos
        ? "Sur iOS : bouton Partager → « Sur l'écran d'accueil »."
        : "Utilisez le menu de votre navigateur → « Installer Tourmaline ».",
      { type: "info", title: "Installation" }
    );
    renderInstallUI();
    return;
  }

  const prompt = state.installPrompt;
  state.installPrompt = null;
  prompt.prompt();
  try {
    const choice = await prompt.userChoice;
    if (choice?.outcome === "accepted") {
      showToast("Tourmaline est installée. Retrouvez-la dans votre menu Démarrer.", {
        type: "success",
        title: "Application installée"
      });
    }
  } catch (error) {
    console.warn("[Tourmaline] Installation :", error);
  } finally {
    renderInstallUI();
  }
}

/* --------------------------------------------------------------------------
   Événements
   -------------------------------------------------------------------------- */

function handleDocumentClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const actionElement = target.closest("[data-action]");
  if (actionElement) {
    const action = actionElement.dataset.action;
    if (action === "refresh") {
      event.preventDefault();
      loadNews({ manual: true });
      return;
    }
    if (action === "close-filters") {
      const panel = $("#filter-panel");
      if (panel) panel.hidden = true;
      $("#filter-toggle")?.setAttribute("aria-expanded", "false");
      return;
    }
    if (action === "generate-summary") {
      event.preventDefault();
      if (state.activeView !== "summary") showView("summary");
      generateSummary();
      return;
    }
    if (action === "copy-summary") {
      event.preventDefault();
      copySummary();
      return;
    }
    if (action === "close-reader") {
      closeReader();
      return;
    }
    if (action === "close-search") {
      closeSearch();
      return;
    }
    if (action === "reset-filters") {
      state.filters = { category: "all", country: "all", bias: null, sort: "recent" };
      state.visibleCount = 12;
      renderHome();
      return;
    }
  }

  const categoryChip = target.closest("[data-category]");
  if (categoryChip) {
    state.filters.category = categoryChip.dataset.category;
    state.visibleCount = 12;
    renderHome();
    return;
  }

  if (target.closest("#filter-toggle")) {
    const panel = $("#filter-panel");
    const toggle = $("#filter-toggle");
    if (panel && toggle) {
      const opening = panel.hidden;
      panel.hidden = !opening;
      toggle.setAttribute("aria-expanded", String(opening));
    }
    return;
  }

  if (target.closest("#load-more")) {
    state.visibleCount += 12;
    renderHome();
    return;
  }

  const navElement = target.closest("[data-nav]");
  if (navElement) {
    const view = navElement.dataset.nav;
    if (VIEW_META[view]) {
      showView(view);
      const focusId = navElement.dataset.focus;
      if (focusId) {
        setTimeout(() => {
          const focusTarget = document.getElementById(focusId);
          if (!focusTarget) return;
          focusTarget.scrollIntoView({ behavior: "smooth", block: "center" });
          const input = focusTarget.matches("input, select, textarea")
            ? focusTarget
            : focusTarget.querySelector("input, select, textarea");
          input?.focus({ preventScroll: true });
        }, 180);
      }
    }
    return;
  }

  const downloadElement = target.closest("[data-download]");
  if (downloadElement) {
    event.preventDefault();
    downloadArticle(downloadElement.dataset.download);
    return;
  }

  const authTab = target.closest("[data-auth-tab]");
  if (authTab) {
    setAuthMode(authTab.dataset.authTab);
    return;
  }

  const passwordToggle = target.closest("[data-toggle-password]");
  if (passwordToggle) {
    event.preventDefault();
    const input = document.getElementById(passwordToggle.dataset.togglePassword);
    if (input) {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      passwordToggle.setAttribute("aria-label", show ? "Masquer la clé" : "Afficher la clé");
    }
    return;
  }

  const searchHint = target.closest("[data-search-hint]");
  if (searchHint) {
    const input = $("#search-input");
    if (input) {
      input.value = searchHint.dataset.searchHint;
      input.focus();
      runSearch(input.value);
    }
    return;
  }

  const sourceDelete = target.closest("[data-delete-source]");
  if (sourceDelete) {
    event.preventDefault();
    deleteSource(sourceDelete.dataset.deleteSource);
    return;
  }

  const removeSaved = target.closest("[data-remove-saved]");
  if (removeSaved) {
    event.preventDefault();
    event.stopPropagation();
    toggleSaveArticle(removeSaved.dataset.removeSaved);
    return;
  }

  const saveButton = target.closest("[data-save-article]");
  if (saveButton) {
    event.preventDefault();
    event.stopPropagation();
    toggleSaveArticle(saveButton.dataset.saveArticle);
    return;
  }

  if (target.closest("#refresh-btn")) {
    loadNews({ manual: true });
    return;
  }
  if (target.closest("#global-search-btn")) {
    openSearch();
    return;
  }
  if (target.closest("#generate-summary")) {
    generateSummary();
    return;
  }
  if (target.closest("#reader-print")) {
    window.print();
    return;
  }
  if (target.closest("#reader-download")) {
    event.stopPropagation();
    toggleDownloadMenu();
    return;
  }
  if (target.closest("#reader-save")) {
    if (state.readArticleId) toggleSaveArticle(state.readArticleId);
    return;
  }
  if (target.closest("#install-btn, #install-topbar")) {
    promptInstall();
    return;
  }
  if (target.closest("#sync-now")) {
    syncEverything();
    return;
  }
  if (target.closest("#sign-out")) {
    handleSignOut();
    return;
  }
  if (target.closest("#forgot-password")) {
    handleForgotPassword();
    return;
  }

  if (!target.closest(".download-menu-wrap")) {
    toggleDownloadMenu(false);
  }

  const searchResult = target.closest("[data-search-result]");
  if (searchResult) {
    event.preventDefault();
    const article = state.searchResults[Number(searchResult.dataset.searchResult)];
    if (article) {
      closeSearch();
      openArticle(article.id);
    }
    return;
  }

  const articleElement = target.closest("[data-article-id]");
  if (articleElement) {
    if (target.closest("#search-overlay")) closeSearch();
    openArticle(articleElement.dataset.articleId);
  }
}

function handleDocumentChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;

  if (target.id === "bias-all-home") {
    state.filters.bias = target.checked ? null : Number($("#bias-slider-home")?.value || 0);
    state.visibleCount = 12;
    renderHome();
    return;
  }

  if (target.id === "country-filter") {
    state.filters.country = target.value;
    state.visibleCount = 12;
    renderHome();
    return;
  }

  if (target.id === "sort-filter") {
    state.filters.sort = target.value;
    state.visibleCount = 12;
    renderHome();
    return;
  }

  if (target.matches("[data-toggle-source]")) {
    toggleSource(target.dataset.toggleSource, target.checked);
    return;
  }

  if (target.id === "pref-balanced") {
    state.preferences.balanced = target.checked;
    savePreferences();
    schedulePreferencesCloudSync();
    renderHome();
    showToast(
      target.checked ? "Les sensibilités sont mélangées dans l'accueil." : "Le fil suit de nouveau l'ordre chronologique.",
      { type: "info" }
    );
    return;
  }

  if (target.id === "pref-autorefresh") {
    state.preferences.autoRefresh = target.checked;
    savePreferences();
    schedulePreferencesCloudSync();
    scheduleAutoRefresh();
    showToast(
      target.checked ? "Le fil sera actualisé toutes les 15 minutes." : "L'actualisation automatique est désactivée.",
      { type: "info" }
    );
  }
}

function handleDocumentInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  if (target.id === "bias-slider-home") {
    state.filters.bias = Number(target.value);
    state.visibleCount = 12;
    const allToggle = $("#bias-all-home");
    if (allToggle) allToggle.checked = false;
    renderFilters();
    renderHome();
    return;
  }

  if (target.id === "pref-bias-slider") {
    state.preferences.defaultBias = Number(target.value);
    const label = $("#pref-bias-value");
    if (label) label.textContent = getBiasMeta(state.preferences.defaultBias).label;
    $$("#profile-spectrum .spectrum__markers span").forEach((marker) => {
      marker.classList.toggle("is-selected", Number(marker.dataset.bias) === state.preferences.defaultBias);
    });
    savePreferences();
    schedulePreferencesCloudSync();
    if (state.preferences.balanced) renderHome();
    return;
  }

  if (target.id === "search-input") {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => runSearch(target.value), 110);
  }
}

function handleDocumentSubmit(event) {
  const target = event.target;
  if (!(target instanceof HTMLFormElement)) return;

  if (target.id === "auth-form") {
    handleAuthSubmit(event);
  } else if (target.id === "api-form") {
    handleApiSubmit(event);
  } else if (target.id === "rss-form") {
    handleRssSubmit(event);
  }
}

function handleGlobalKeydown(event) {
  const target = event.target;

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if ($("#search-overlay")?.hidden) openSearch();
    else closeSearch();
    return;
  }

  if (event.key === "Escape") {
    if (!$("#download-menu")?.hidden) {
      toggleDownloadMenu(false);
      return;
    }
    if (!$("#search-overlay")?.hidden) {
      closeSearch();
      return;
    }
    if (!$("#reader")?.hidden) {
      closeReader();
      return;
    }
  }

  if (event.key === "/" && !target.closest("input, textarea, select, [contenteditable='true']")) {
    event.preventDefault();
    openSearch();
    return;
  }

  if ((event.key === "Enter" || event.key === " ") && target instanceof Element) {
    const interactive = target.closest("[role='button'][data-article-id], [data-article-id][tabindex='0']");
    if (interactive && !target.closest("button, a, input, select, textarea")) {
      event.preventDefault();
      if (target.closest("#search-overlay")) closeSearch();
      openArticle(interactive.dataset.articleId);
    }
  }
}

function handleTopbarScroll() {
  const topbar = $("#topbar");
  if (!topbar) return;
  topbar.classList.toggle("is-scrolled", window.scrollY > 12);
}

function bindEvents() {
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("change", handleDocumentChange);
  document.addEventListener("input", handleDocumentInput);
  document.addEventListener("submit", handleDocumentSubmit);
  document.addEventListener("keydown", handleGlobalKeydown);
  $("#search-input")?.addEventListener("keydown", handleSearchKeydown);
  $("#reader-scroll")?.addEventListener("scroll", updateReaderProgress, { passive: true });

  window.addEventListener("scroll", handleTopbarScroll, { passive: true });
  window.addEventListener("online", () => {
    updateConnectionUI();
    showToast("Connexion rétablie. Tourmaline actualise le fil.", { type: "success" });
    loadNews({ silent: true });
  });
  window.addEventListener("offline", () => {
    updateConnectionUI();
    showToast("Vous êtes hors ligne. Les contenus déjà chargés restent disponibles.", { type: "info" });
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    renderInstallUI();
  });
  window.addEventListener("appinstalled", () => {
    state.installPrompt = null;
    renderInstallUI();
    showToast("Tourmaline est maintenant installée.", { type: "success", title: "Installation réussie" });
  });

  window.addEventListener("hashchange", () => {
    const view = window.location.hash.replace("#", "");
    if (VIEW_META[view] && view !== state.activeView) showView(view, { updateHash: false });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || state.loading) return;
    const last = state.lastUpdated ? new Date(state.lastUpdated).getTime() : 0;
    if (navigator.onLine && Date.now() - last > 20 * 60 * 1000) {
      loadNews({ silent: true });
    }
  });
}

/* --------------------------------------------------------------------------
   Actualisation automatique et service worker
   -------------------------------------------------------------------------- */

function scheduleAutoRefresh() {
  clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = null;
  if (!state.preferences.autoRefresh) return;
  state.autoRefreshTimer = setInterval(() => {
    if (document.visibilityState === "visible" && navigator.onLine && !state.loading) {
      loadNews({ silent: true });
    }
  }, 15 * 60 * 1000);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(window.location.protocol)) return;
  try {
    const scope = new URL("./", document.baseURI).pathname;
    const registration = await navigator.serviceWorker.register(new URL("sw.js", document.baseURI), { scope });
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          showToast("Une nouvelle version de Tourmaline est prête. Rechargez pour en profiter.", {
            type: "info",
            title: "Mise à jour disponible"
          });
        }
      });
    });
  } catch (error) {
    console.warn("[Tourmaline] Service worker non enregistré :", error);
  }
}

/* --------------------------------------------------------------------------
   Démarrage
   -------------------------------------------------------------------------- */

function hydrateFromLocal() {
  state.preferences = loadPreferences();
  state.sources = loadSources();
  state.saved = loadSavedArticles();
  loadLocalSummary();

  const cache = readFeedCache();
  if (cache?.articles?.length) {
    state.articles = mergeArticles(cache.articles);
    state.lastUpdated = cache.savedAt ? new Date(cache.savedAt) : null;
    state.stale = true;
    state.demoMode = Boolean(cache.demoMode || state.articles.every((article) => article.isDemo));
  }
}

function setDateLabels() {
  const label = formatLongDate().replace(/^./, (character) => character.toUpperCase());
  ["#home-date", "#urgent-date", "#summary-date"].forEach((selector) => {
    const element = $(selector);
    if (element) element.textContent = label;
  });
}

function hideLoader() {
  const loader = $("#app-loader");
  if (!loader) return;
  requestAnimationFrame(() => {
    loader.classList.add("is-hidden");
    setTimeout(() => loader.remove(), 900);
  });
}

function init() {
  hydrateFromLocal();
  setDateLabels();
  bindEvents();
  updateConnectionUI();

  const hashView = window.location.hash.replace("#", "");
  const initialView = VIEW_META[hashView] ? hashView : "home";
  showView(initialView, { updateHash: false });

  renderProfile();
  updateSidebarUser();
  renderAuthState();
  hideLoader();

  initFirebase();
  registerServiceWorker();
  scheduleAutoRefresh();

  setTimeout(() => loadNews(), 120);
}

init();


