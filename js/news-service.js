/* ==========================================================================
   Tourmaline — News ingestion service
   RSS (rss2json + proxy de secours), NewsAPI, GNews, normalisation,
   classification éditoriale, détection d'urgence et cache local.
   ========================================================================== */

export const BIAS_META = {
  "-2": {
    value: -2,
    label: "Extrême gauche",
    short: "Extrême gauche",
    className: "neg2",
    description: "Position politique très à gauche de l'échiquier."
  },
  "-1": {
    value: -1,
    label: "Centre gauche",
    short: "Centre gauche",
    className: "neg1",
    description: "Sensibilité de gauche modérée ou sociale-démocrate."
  },
  "0": {
    value: 0,
    label: "Centre",
    short: "Centre",
    className: "0",
    description: "Ligne éditoriale centriste ou généraliste."
  },
  "1": {
    value: 1,
    label: "Centre droit",
    short: "Centre droit",
    className: "1",
    description: "Sensibilité de droite modérée ou libérale."
  },
  "2": {
    value: 2,
    label: "Extrême droite",
    short: "Extrême droite",
    className: "2",
    description: "Position politique très à droite de l'échiquier."
  }
};

export const CATEGORY_META = {
  all: { label: "Tout", icon: "news" },
  monde: { label: "Monde", icon: "globe-earth" },
  politique: { label: "Politique", icon: "bank" },
  economie: { label: "Économie", icon: "money" },
  tech: { label: "Tech", icon: "rocket" },
  societe: { label: "Société", icon: "reading" },
  environnement: { label: "Environnement", icon: "leaf" },
  culture: { label: "Culture", icon: "music" },
  investigations: { label: "Enquêtes", icon: "microscope" }
};

export const COUNTRY_META = {
  FR: { label: "France", flag: "FR" },
  GB: { label: "Royaume-Uni", flag: "GB" },
  US: { label: "États-Unis", flag: "US" },
  INT: { label: "International", flag: "INT" }
};

export const ICON_BASE = "https://img.icons8.com/fluency/200";

/* Sources proposées par défaut. L'utilisateur peut les activer/désactiver
   et ajouter ses propres flux depuis l'onglet Moi. */
export const DEFAULT_SOURCES = Object.freeze([
  {
    id: "lemonde",
    name: "Le Monde",
    url: "https://www.lemonde.fr/rss/une.xml",
    bias: -1,
    category: "monde",
    country: "FR",
    active: true,
    investigation: false,
    isDefault: true
  },
  {
    id: "lefigaro",
    name: "Le Figaro",
    url: "https://www.lefigaro.fr/rss/figaro_actualites.xml",
    bias: 1,
    category: "politique",
    country: "FR",
    active: true,
    investigation: false,
    isDefault: true
  },
  {
    id: "franceinfo",
    name: "Franceinfo",
    url: "https://www.francetvinfo.fr/titres.rss",
    bias: 0,
    category: "societe",
    country: "FR",
    active: true,
    investigation: false,
    isDefault: true
  },
  {
    id: "mediapart",
    name: "Mediapart",
    url: "https://www.mediapart.fr/articles/feed",
    bias: -1,
    category: "investigations",
    country: "FR",
    active: true,
    investigation: true,
    isDefault: true
  },
  {
    id: "bbcworld",
    name: "BBC World",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    bias: 0,
    category: "monde",
    country: "GB",
    active: true,
    investigation: false,
    isDefault: true
  },
  {
    id: "guardianworld",
    name: "The Guardian",
    url: "https://www.theguardian.com/world/rss",
    bias: -1,
    category: "monde",
    country: "GB",
    active: false,
    investigation: false,
    isDefault: true
  },
  {
    id: "propublica",
    name: "ProPublica",
    url: "https://www.propublica.org/feeds/propublica/main",
    bias: 0,
    category: "investigations",
    country: "US",
    active: false,
    investigation: true,
    isDefault: true
  },
  {
    id: "aljazeera",
    name: "Al Jazeera",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    bias: 0,
    category: "monde",
    country: "INT",
    active: false,
    investigation: false,
    isDefault: true
  },
  {
    id: "revolutionpermanente",
    name: "Révolution permanente",
    url: "https://www.revolutionpermanente.fr/spip.php?page=backend",
    bias: -2,
    category: "politique",
    country: "FR",
    active: false,
    investigation: false,
    isDefault: true
  }
]);

const SOURCE_BIAS_LOOKUP = {
  "le monde": -1,
  "le figaro": 1,
  "franceinfo": 0,
  "france info": 0,
  "mediapart": -1,
  "libération": -1,
  "liberation": -1,
  "les échos": 1,
  "les echos": 1,
  "the guardian": -1,
  "the observer": -1,
  "bbc": 0,
  "bbc news": 0,
  "bbc world": 0,
  "reuters": 0,
  "associated press": 0,
  "ap news": 0,
  "al jazeera": 0,
  "the economist": 1,
  "the times": 1,
  "propublica": 0,
  "bellingcat": 0,
  "disclose": 0,
  "révolution permanente": -2,
  "revolution permanente": -2,
  "lutte ouvrière": -2,
  "boulevard voltaire": 2,
  "présent": 2,
  "present": 2,
  "rivarol": 2
};

const CATEGORY_KEYWORDS = {
  politique: /(élection|elections|président|premier ministre|parlement|gouvernement|sénat|assemblée|député|ministre|parti|scrutin|réforme|loi|budget)/i,
  economie: /(économie|inflation|bourse|entreprise|marché|banque|emploi|chômage|croissance|euro|dollar|budget|impôt|salaire|industrie)/i,
  tech: /(intelligence artificielle|numérique|technologie|start-up|startup|internet|cyber|robot|algorithme|smartphone|données|espace|satellite)/i,
  environnement: /(climat|environnement|biodiversité|énergie|sécheresse|canicule|inondation|océan|pollution|émission|carbone|nucléaire)/i,
  societe: /(société|santé|éducation|école|logement|transport|justice|police|famille|immigration|discrimination|mobilisation)/i,
  culture: /(culture|cinéma|musique|livre|exposition|festival|théâtre|patrimoine|série|film)/i,
  monde: /(guerre|conflit|international|diplomatie|onu|europe|afrique|asie|amérique|moyen-orient|ukraine|gaza|israël|chine|états-unis)/i
};

const URGENT_SIGNALS = [
  {
    pattern: /(guerre|invasion|offensive|frappe aérienne|bombardement|attentat|attaque terroriste|prise d'otages|cessez-le-feu|conflit armé)/i,
    weight: 3,
    reason: "Sécurité / conflit"
  },
  {
    pattern: /(séisme|tremblement de terre|tsunami|catastrophe naturelle|éruption|cyclone|ouragan|inondation majeure|incendie majeur|alerte rouge)/i,
    weight: 2.5,
    reason: "Alerte / catastrophe"
  },
  {
    pattern: /(mort|morts|blessés|victimes|urgence absolue|évacuation|crash|accident grave|naufrage)/i,
    weight: 1.4,
    reason: "Bilan humain"
  },
  {
    pattern: /(démission|renversement|coup d'état|sanctions|mobilisation nationale|grève générale|état d'urgence|dissolution)/i,
    weight: 1.2,
    reason: "Développement majeur"
  }
];

const MAX_CACHE_ARTICLES = 80;
const CACHE_KEY = "tourmaline.feed.v1";

/* --------------------------------------------------------------------------
   Utilitaires
   -------------------------------------------------------------------------- */

export function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function hashString(value = "") {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function makeArticleId(article = {}) {
  return `a_${hashString(`${article.source || ""}|${article.url || ""}|${article.title || ""}`)}`;
}

export function safeHttpUrl(value) {
  if (!value) return "";
  try {
    const base = globalThis.document?.baseURI || globalThis.location?.href || "https://tourmaline.local/";
    const url = new URL(String(value).trim(), base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.href;
  } catch {
    return "";
  }
}

export function htmlToText(html = "") {
  if (!html) return "";
  if (typeof DOMParser === "undefined") {
    return String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  try {
    const doc = new DOMParser().parseFromString(String(html), "text/html");
    doc.querySelectorAll("script, style, noscript, iframe, object, embed").forEach((el) => el.remove());
    return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  } catch {
    return String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
}

const ALLOWED_TAGS = new Set([
  "P", "BR", "H2", "H3", "H4", "UL", "OL", "LI", "STRONG", "B", "EM", "I",
  "A", "BLOCKQUOTE", "FIGURE", "FIGCAPTION", "IMG", "SPAN", "DIV", "HR", "CITE"
]);

const DANGEROUS_TAGS = "script,style,noscript,iframe,object,embed,form,input,button,textarea,select,option,svg,math,template,video,audio,source,track";

/**
 * Nettoie le HTML des flux RSS avant insertion dans le lecteur.
 * Seuls les liens http(s) et les images http(s) sont conservés.
 */
export function sanitizeHtml(html = "") {
  const input = String(html || "").trim();
  if (!input) return "";
  if (input.length > 60000) return sanitizeHtml(input.slice(0, 60000));
  if (typeof DOMParser === "undefined") {
    return `<p>${escapeHtml(htmlToText(input))}</p>`;
  }

  try {
    const doc = new DOMParser().parseFromString(`<div id="tourmaline-root">${input}</div>`, "text/html");
    const root = doc.getElementById("tourmaline-root");
    if (!root) return "";

    root.querySelectorAll(DANGEROUS_TAGS).forEach((node) => node.remove());
    root.querySelectorAll("*").forEach((element) => {
      if (!ALLOWED_TAGS.has(element.tagName)) {
        element.replaceWith(...element.childNodes);
        return;
      }

      [...element.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        if (element.tagName === "A" && name === "href") return;
        if (element.tagName === "IMG" && (name === "src" || name === "alt")) return;
        element.removeAttribute(attribute.name);
      });

      if (element.tagName === "A") {
        const href = safeHttpUrl(element.getAttribute("href"));
        if (!href) {
          element.replaceWith(...element.childNodes);
          return;
        }
        element.setAttribute("href", href);
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      }

      if (element.tagName === "IMG") {
        const src = safeHttpUrl(element.getAttribute("src"));
        if (!src) {
          element.remove();
          return;
        }
        element.setAttribute("src", src);
        element.setAttribute("loading", "lazy");
        element.setAttribute("referrerpolicy", "no-referrer");
        element.setAttribute("alt", element.getAttribute("alt") || "");
      }
    });

    return root.innerHTML.trim();
  } catch {
    return `<p>${escapeHtml(htmlToText(input))}</p>`;
  }
}

export function truncate(value = "", max = 260) {
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

export function estimateReadingMinutes(text = "") {
  const words = htmlToText(text).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 190));
}

export function getBiasMeta(bias) {
  return BIAS_META[String(Math.max(-2, Math.min(2, Number(bias) || 0)))] || BIAS_META["0"];
}

export function inferSourceBias(sourceName = "") {
  const name = String(sourceName).toLowerCase().trim();
  if (!name) return 0;
  if (SOURCE_BIAS_LOOKUP[name] !== undefined) return SOURCE_BIAS_LOOKUP[name];
  const entry = Object.entries(SOURCE_BIAS_LOOKUP).find(([key]) => name.includes(key));
  return entry ? entry[1] : 0;
}

export function inferCategory(text = "", fallback = "monde") {
  const haystack = String(text);
  for (const [category, pattern] of Object.entries(CATEGORY_KEYWORDS)) {
    if (pattern.test(haystack)) return category;
  }
  return CATEGORY_META[fallback] ? fallback : "monde";
}

export function parseDate(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function ageInHours(dateValue, now = Date.now()) {
  const time = new Date(dateValue).getTime();
  if (Number.isNaN(time)) return 999;
  return Math.max(0, (now - time) / 3600000);
}

export function isLast24Hours(article, now = Date.now()) {
  return ageInHours(article.publishedAt, now) <= 24;
}

export function getUrgencySignals(article) {
  const text = `${article.title || ""} ${article.description || ""}`.replace(/\s+/g, " ");
  const reasons = [];
  let score = 0;

  URGENT_SIGNALS.forEach((signal) => {
    if (signal.pattern.test(text)) {
      score += signal.weight;
      reasons.push(signal.reason);
    }
  });

  const age = ageInHours(article.publishedAt);
  if (age <= 6) score += 0.7;
  else if (age <= 12) score += 0.35;

  return {
    score: Math.round(score * 10) / 10,
    reasons: [...new Set(reasons)],
    isUrgent: age <= 24 && score >= 2.4
  };
}

export function formatRelativeTime(dateValue, now = Date.now()) {
  const time = new Date(dateValue).getTime();
  if (Number.isNaN(time)) return "Date inconnue";
  const minutes = Math.max(0, Math.round((now - time) / 60000));
  if (minutes < 1) return "À l'instant";
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Hier";
  if (days < 7) return `Il y a ${days} jours`;
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(new Date(time));
}

export function formatLongDate(dateValue = Date.now()) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date(dateValue));
}

export function formatShortDate(dateValue = Date.now()) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(dateValue));
}

export function getCategoryMeta(category) {
  return CATEGORY_META[category] || CATEGORY_META.monde;
}

export function getCountryMeta(country) {
  return COUNTRY_META[country] || COUNTRY_META.INT;
}

/* --------------------------------------------------------------------------
   Détection d'urgence, filtres et tri
   -------------------------------------------------------------------------- */

export function classifyUrgency(article) {
  const urgency = getUrgencySignals(article);
  return {
    ...article,
    urgencyScore: urgency.score,
    urgencyReasons: urgency.reasons,
    isUrgent: urgency.isUrgent
  };
}

export function filterArticles(articles, filters = {}, now = Date.now()) {
  const {
    category = "all",
    country = "all",
    bias = null,
    search = "",
    view = "home",
    includeExtremes = true
  } = filters;

  const query = String(search).trim().toLowerCase();

  return articles.filter((article) => {
    if (view === "urgent" && !(article.isUrgent && isLast24Hours(article, now))) return false;
    if (view === "investigations" && !article.isInvestigation) return false;
    if (view === "summary" && !isLast24Hours(article, now)) return false;
    if (view === "summary" && Math.abs(article.bias) === 2) return false;
    if (!includeExtremes && Math.abs(article.bias) === 2) return false;
    if (category !== "all" && article.category !== category) return false;
    if (country !== "all" && article.country !== country) return false;
    if (bias !== null && Number(article.bias) !== Number(bias)) return false;

    if (query) {
      const haystack = `${article.title} ${article.description} ${article.source} ${article.author || ""} ${article.categoryLabel || ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}

export function sortArticles(articles, mode = "recent", preferredBias = 0) {
  const list = [...articles];
  if (mode === "urgent") {
    return list.sort((a, b) => {
      const urgency = (b.urgencyScore || 0) - (a.urgencyScore || 0);
      if (urgency !== 0) return urgency;
      return new Date(b.publishedAt) - new Date(a.publishedAt);
    });
  }
  if (mode === "balanced") {
    return list.sort((a, b) => {
      const distanceA = Math.abs(Number(a.bias) - Number(preferredBias));
      const distanceB = Math.abs(Number(b.bias) - Number(preferredBias));
      if (distanceA !== distanceB) return distanceA - distanceB;
      return new Date(b.publishedAt) - new Date(a.publishedAt);
    });
  }
  return list.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

export function getSummaryCandidates(articles, now = Date.now()) {
  const recent = articles.filter((article) => isLast24Hours(article, now));
  const excluded = recent.filter((article) => Math.abs(Number(article.bias)) === 2);
  const eligible = recent
    .filter((article) => Math.abs(Number(article.bias)) !== 2)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  return {
    eligible,
    excluded,
    totalRecent: recent.length
  };
}

export function getBiasDistribution(articles) {
  return ["-2", "-1", "0", "1", "2"].map((bias) => ({
    bias,
    meta: BIAS_META[bias],
    count: articles.filter((article) => String(article.bias) === bias).length
  }));
}

/* --------------------------------------------------------------------------
   Normalisation d'un article
   -------------------------------------------------------------------------- */

export function normalizeArticle(raw = {}, source = {}) {
  const title = htmlToText(raw.title || raw.name || "").trim();
  if (!title) return null;

  const rawDescription = raw.description || raw.summary || raw.contentSnippet || "";
  const rawContent = raw.content || raw.fullContent || rawDescription;
  const description = truncate(htmlToText(rawDescription), 420);
  const sanitizedContent = sanitizeHtml(rawContent);
  const textContent = htmlToText(rawContent);
  const sourceName = String(source.name || raw.sourceName || "Source inconnue").trim();
  const category = raw.category || source.category || inferCategory(`${title} ${description}`);
  const country = raw.country || source.country || "INT";
  const bias = Number.isFinite(Number(source.bias))
    ? Math.max(-2, Math.min(2, Number(source.bias)))
    : inferSourceBias(sourceName);

  const formattedContent = sanitizedContent || (description
    ? `<p>${escapeHtml(description)}</p>`
    : "<p>Contenu partiel. Consultez l'article original pour lire l'intégralité.</p>");

  const article = {
    id: "",
    title,
    description,
    content: formattedContent,
    url: safeHttpUrl(raw.url || raw.link || ""),
    image: safeHttpUrl(raw.image || raw.thumbnail || raw.enclosure || raw.urlToImage || ""),
    author: htmlToText(raw.author || raw.creator || "").trim(),
    source: sourceName,
    sourceId: source.id || "",
    publishedAt: parseDate(raw.publishedAt || raw.pubDate || raw.published_date || raw.date),
    category,
    categoryLabel: getCategoryMeta(category).label,
    country,
    bias,
    biasLabel: getBiasMeta(bias).label,
    readingMinutes: estimateReadingMinutes(textContent || description),
    investigation: Boolean(source.investigation || category === "investigations"),
    isInvestigation: Boolean(source.investigation || category === "investigations"),
    isDemo: Boolean(source.isDemo || raw.isDemo),
    fetchedAt: new Date().toISOString()
  };

  article.id = raw.id ? String(raw.id) : makeArticleId(article);
  return classifyUrgency(article);
}

export function mergeArticles(...collections) {
  const map = new Map();
  collections.flat().filter(Boolean).forEach((article) => {
    const existing = map.get(article.id);
    if (!existing) {
      map.set(article.id, article);
      return;
    }
    // Conserve la version la plus riche.
    const prefersNew = (article.content?.length || 0) > (existing.content?.length || 0);
    map.set(article.id, prefersNew ? { ...existing, ...article } : { ...article, ...existing });
  });
  return [...map.values()].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

/* --------------------------------------------------------------------------
   Cache local du fil (utilisé par l'app et par le service worker)
   -------------------------------------------------------------------------- */

export function readFeedCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.articles)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeFeedCache(articles, meta = {}) {
  try {
    const compact = articles.slice(0, MAX_CACHE_ARTICLES).map((article) => ({
      ...article,
      content: String(article.content || "").slice(0, 14000)
    }));
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      articles: compact,
      savedAt: new Date().toISOString(),
      ...meta
    }));
    return true;
  } catch (error) {
    console.warn("[Tourmaline] Cache du fil indisponible :", error);
    return false;
  }
}

/* --------------------------------------------------------------------------
   Articles de démonstration (uniquement si aucun flux n'est disponible)
   -------------------------------------------------------------------------- */

export function getDemoArticles() {
  const now = Date.now();
  const base = {
    source: "Tourmaline · Démonstration",
    sourceId: "demo",
    bias: 0,
    country: "FR",
    isDemo: true,
    author: "La rédaction Tourmaline"
  };

  const items = [
    {
      title: "Climat : comprendre les nouveaux équilibres de la transition énergétique",
      description: "Des villes aux réseaux électriques, la transition énergétique redessine les priorités industrielles et sociales. Les points clés pour suivre le débat.",
      category: "environnement",
      image: "assets/news/climate.jpg",
      minutesAgo: 18,
      content: "<p>La transition énergétique n'est plus seulement une question d'objectifs climatiques : elle devient un choix d'infrastructures, de souveraineté industrielle et d'équité sociale.</p><h2>Trois angles pour comprendre</h2><p>Le financement des réseaux, la rénovation des bâtiments et la place des énergies renouvelables structurent les débats des prochains mois. Les décisions prises aujourd'hui détermineront la trajectoire des prochaines décennies.</p><blockquote>Une démonstration éditoriale : cet article illustre le lecteur Tourmaline lorsque les flux externes sont indisponibles.</blockquote>"
    },
    {
      title: "Intelligence artificielle : ce qui change vraiment dans les services publics",
      description: "Derrière les annonces, des usages concrets se déploient dans l'administration, la santé et l'éducation. Tour d'horizon des promesses et des garde-fous.",
      category: "tech",
      image: "assets/news/technology.jpg",
      minutesAgo: 47,
      content: "<p>L'intelligence artificielle générative entre dans les services publics par petites touches : aide à la rédaction, tri de dossiers, traduction ou assistance aux agents.</p><p>Les questions de transparence, de protection des données et de contrôle humain restent centrales. Cet article de démonstration présente les enjeux sans se substituer à une enquête originale.</p>"
    },
    {
      title: "Budget européen : les lignes de fracture à surveiller",
      description: "Les discussions budgétaires révèlent des visions différentes de la solidarité européenne. Décryptage des positions en présence.",
      category: "economie",
      image: "assets/news/economy.jpg",
      minutesAgo: 96,
      content: "<p>Les négociations budgétaires européennes opposent plusieurs conceptions de la dépense publique, de la discipline fiscale et des priorités communes.</p><p>Cet article de démonstration montre comment Tourmaline rend les désaccords lisibles, sans prendre parti.</p>"
    },
    {
      title: "Enquête : comment nos données personnelles circulent entre applications",
      description: "Permissions, traceurs, courtiers de données : une plongée pédagogique dans les circuits de la donnée personnelle et les moyens de reprendre la main.",
      category: "investigations",
      image: "assets/news/archive.jpg",
      minutesAgo: 160,
      investigation: true,
      content: "<p>Chaque application peut collecter, croiser et transmettre des informations. Ce dossier de démonstration explique les mécanismes à l'œuvre et les questions à poser avant d'installer un service.</p><h2>Reprendre la main</h2><p>Vérifier les permissions, limiter la publicité personnalisée et privilégier les services qui documentent leurs pratiques sont des premiers gestes utiles.</p>"
    },
    {
      title: "Villes et chaleur : les solutions qui font leurs preuves",
      description: "Îlots de fraîcheur, végétalisation, horaires adaptés : les collectivités testent de nouvelles réponses aux épisodes de canicule.",
      category: "societe",
      image: "assets/news/city.jpg",
      minutesAgo: 250,
      content: "<p>Les épisodes de chaleur posent des questions d'urbanisme, de santé publique et de solidarité. Certaines solutions sont déjà évaluées à l'échelle locale.</p><p>Ce contenu de démonstration illustre la mise en forme d'un article de fond dans Tourmaline.</p>"
    },
    {
      title: "Médias et confiance : comment lire plusieurs sources sans s'épuiser",
      description: "Comparer les lignes éditoriales, distinguer faits et commentaires, revenir aux documents : une méthode simple pour une veille plus sereine.",
      category: "culture",
      image: "assets/news/newspapers.jpg",
      minutesAgo: 390,
      content: "<p>La surinformation n'est pas seulement un problème de volume. Elle brouille aussi les repères entre information, analyse et opinion.</p><p>Cette démonstration éditoriale décrit la méthode proposée par Tourmaline : plusieurs sources, un badge de ligne éditoriale et un accès direct aux originaux.</p>"
    },
    {
      title: "Océans : pourquoi la protection des zones marines fait débat",
      description: "Entre engagements internationaux et réalités locales, la protection des océans se heurte à des arbitrages économiques et scientifiques.",
      category: "environnement",
      image: "assets/news/ocean.jpg",
      minutesAgo: 620,
      content: "<p>Les aires marines protégées font l'objet de discussions sur leur niveau de protection réel, leur financement et leur gouvernance.</p><p>Un article de démonstration pour découvrir le format lecture longue de Tourmaline.</p>"
    },
    {
      title: "Institutions : le rôle du Parlement dans les textes d'urgence",
      description: "Procédure accélérée, amendements et contrôle : le parlementarisme à l'épreuve des crises et des majorités fragiles.",
      category: "politique",
      image: "assets/news/parliament.jpg",
      minutesAgo: 780,
      content: "<p>Les textes d'urgence modifient l'équilibre entre rapidité de décision et débat démocratique. Les assemblées disposent de plusieurs outils de contrôle, souvent méconnus.</p><p>Contenu de démonstration : il ne rapporte pas d'actualité récente.</p>"
    }
  ];

  return items.map((item) => normalizeArticle({
    ...base,
    ...item,
    publishedAt: new Date(now - item.minutesAgo * 60000).toISOString(),
    content: `${item.content}<p><strong>Article de démonstration.</strong> Les flux d'actualité n'ont pas pu être chargés. Ajoutez vos clés API ou vérifiez votre connexion pour retrouver le fil en direct.</p>`
  }, {
    ...base,
    category: item.category,
    investigation: item.investigation || item.category === "investigations"
  })).filter(Boolean);
}

/* End of news service part 1 ---------------------------------------------- */

/* --------------------------------------------------------------------------
   Réseau : fetch avec délai maximum
   -------------------------------------------------------------------------- */

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchResponse(url, { timeout = 16000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers,
      credentials: "omit",
      cache: "no-store"
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetchResponse(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetchResponse(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

/* --------------------------------------------------------------------------
   Parsing XML RSS / Atom
   -------------------------------------------------------------------------- */

function directChildText(node, tagNames) {
  for (const tagName of tagNames) {
    const elements = node.getElementsByTagName(tagName);
    if (elements.length) {
      const value = elements[0].textContent?.trim();
      if (value) return value;
    }
  }
  return "";
}

function extractXmlImage(item, description = "") {
  const enclosure = item.getElementsByTagName("enclosure")[0];
  if (enclosure?.getAttribute("url")) return enclosure.getAttribute("url");

  const mediaContent = item.getElementsByTagName("media:content")[0];
  if (mediaContent?.getAttribute("url")) return mediaContent.getAttribute("url");

  const mediaThumbnail = item.getElementsByTagName("media:thumbnail")[0];
  if (mediaThumbnail?.getAttribute("url")) return mediaThumbnail.getAttribute("url");

  const imageTag = item.getElementsByTagName("image")[0];
  if (imageTag?.textContent?.trim()) return imageTag.textContent.trim();

  const match = String(description).match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : "";
}

export function parseRssXml(xmlText, source = {}) {
  if (!xmlText || /^\s*<!doctype html/i.test(xmlText)) {
    throw new Error("Le flux renvoyé n'est pas un document RSS.");
  }

  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Le flux RSS n'a pas pu être analysé.");
  }

  const nodes = [...doc.getElementsByTagName("item")];
  if (!nodes.length) {
    nodes.push(...[...doc.getElementsByTagName("entry")]);
  }

  return nodes.map((item) => {
    const isAtom = item.tagName.toLowerCase() === "entry";
    let link = directChildText(item, ["link"]);

    if (isAtom) {
      const links = [...item.getElementsByTagName("link")];
      const alternate = links.find((entry) => entry.getAttribute("rel") === "alternate") || links[0];
      link = alternate?.getAttribute("href") || link;
    }

    const description = directChildText(item, ["description", "summary", "content"]);
    const content = directChildText(item, ["content:encoded", "encoded"])
      || directChildText(item, ["content"])
      || description;

    const author = directChildText(item, ["dc:creator", "creator", "author", "name"]);
    const pubDate = directChildText(item, ["pubDate", "published", "updated", "dc:date"]);
    const title = directChildText(item, ["title"]);

    return normalizeArticle({
      title,
      description,
      content,
      url: link,
      image: extractXmlImage(item, description),
      author,
      publishedAt: pubDate
    }, source);
  }).filter(Boolean);
}

/* --------------------------------------------------------------------------
   RSS : rss2json (principal), puis proxies de secours
   -------------------------------------------------------------------------- */

async function fetchRssViaRss2Json(source, settings = {}) {
  const key = settings.rss2jsonKey ? `&api_key=${encodeURIComponent(settings.rss2jsonKey)}` : "";
  const endpoint = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(source.url)}&count=20${key}`;
  const data = await fetchJson(endpoint, { timeout: 18000 });
  if (data.status !== "ok" || !Array.isArray(data.items)) {
    throw new Error(data.message || data.error || "Flux RSS indisponible.");
  }

  return data.items.map((item) => normalizeArticle({
    title: item.title,
    description: item.description,
    content: item.content || item.description,
    url: item.link,
    image: item.thumbnail || item.enclosure?.link || item.enclosure || "",
    author: item.author,
    publishedAt: item.pubDate
  }, source)).filter(Boolean);
}

async function fetchRssViaProxy(source) {
  const target = encodeURIComponent(source.url);
  const proxies = [
    `https://api.allorigins.win/raw?url=${target}`,
    `https://api.codetabs.com/v1/proxy?quest=${target}`
  ];
  let lastError = null;

  for (const proxy of proxies) {
    try {
      const xml = await fetchText(proxy, { timeout: 14000 });
      return parseRssXml(xml, source);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Impossible de récupérer le flux RSS.");
}

export async function fetchRssSource(source, settings = {}) {
  try {
    const articles = await fetchRssViaRss2Json(source, settings);
    return { source, articles, provider: "rss2json", error: null };
  } catch (primaryError) {
    try {
      const articles = await fetchRssViaProxy(source);
      return { source, articles, provider: "proxy", error: null };
    } catch (fallbackError) {
      return {
        source,
        articles: [],
        provider: "none",
        error: fallbackError.message || primaryError.message || "Flux indisponible"
      };
    }
  }
}

/**
 * Récupère les sources actives avec une petite concurrence pour ménager
 * les services publics (rss2json notamment).
 */
export async function fetchAllSources(sources = [], settings = {}, options = {}) {
  const { maxSources = 14, concurrency = 2, onProgress = null } = options;
  const active = sources
    .filter((source) => source.active && !source.isDemo && source.url)
    .slice(0, maxSources);

  const results = [];
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (cursor < active.length) {
      const currentIndex = cursor;
      cursor += 1;
      const source = active[currentIndex];
      const result = await fetchRssSource(source, settings);
      results.push(result);
      completed += 1;
      onProgress?.({ completed, total: active.length, source, result });
      await delay(280);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, active.length));
  await Promise.all(Array.from({ length: workerCount }, worker));

  const articles = mergeArticles(...results.map((result) => result.articles));
  const errors = results
    .filter((result) => result.error)
    .map((result) => ({ source: result.source.name, message: result.error }));
  const successfulSources = results.filter((result) => result.articles.length > 0);

  return {
    articles,
    errors,
    successfulSources: successfulSources.map((result) => result.source.name),
    sourceCount: active.length,
    fetchedAt: new Date().toISOString()
  };
}

/* --------------------------------------------------------------------------
   NewsAPI
   -------------------------------------------------------------------------- */

export async function fetchNewsApi(settings = {}) {
  const apiKey = settings.newsApiKey;
  if (!apiKey) return { articles: [], error: null, skipped: true };

  try {
    const endpoint = `https://newsapi.org/v2/top-headlines?country=fr&pageSize=24&apiKey=${encodeURIComponent(apiKey)}`;
    const data = await fetchJson(endpoint, { timeout: 18000 });
    if (data.status !== "ok" || !Array.isArray(data.articles)) {
      throw new Error(data.message || "NewsAPI indisponible");
    }

    const articles = data.articles.map((item) => {
      const sourceName = item.source?.name || "NewsAPI";
      const source = {
        id: "newsapi",
        name: sourceName,
        bias: inferSourceBias(sourceName),
        category: inferCategory(`${item.title || ""} ${item.description || ""}`),
        country: "FR",
        investigation: false
      };
      return normalizeArticle({
        title: item.title,
        description: item.description,
        content: item.content || item.description,
        url: item.url,
        image: item.urlToImage,
        author: item.author,
        publishedAt: item.publishedAt
      }, source);
    }).filter(Boolean);

    return { articles, error: null, skipped: false };
  } catch (error) {
    return {
      articles: [],
      error: `NewsAPI : ${error.message}`,
      skipped: false
    };
  }
}

/* --------------------------------------------------------------------------
   GNews
   -------------------------------------------------------------------------- */

export async function fetchGNews(settings = {}) {
  const apiKey = settings.gnewsKey;
  if (!apiKey) return { articles: [], error: null, skipped: true };

  try {
    const endpoint = `https://gnews.io/api/v4/top-headlines?category=general&lang=fr&country=fr&max=24&apikey=${encodeURIComponent(apiKey)}`;
    const data = await fetchJson(endpoint, { timeout: 18000 });
    if (!Array.isArray(data.articles)) {
      throw new Error(data.errors?.[0] || "GNews indisponible");
    }

    const articles = data.articles.map((item) => {
      const sourceName = item.source?.name || "GNews";
      const source = {
        id: "gnews",
        name: sourceName,
        bias: inferSourceBias(sourceName),
        category: inferCategory(`${item.title || ""} ${item.description || ""}`),
        country: "FR",
        investigation: false
      };
      return normalizeArticle({
        title: item.title,
        description: item.description,
        content: item.content || item.description,
        url: item.url,
        image: item.image,
        author: item.source?.name ? "" : "GNews",
        publishedAt: item.publishedAt
      }, source);
    }).filter(Boolean);

    return { articles, error: null, skipped: false };
  } catch (error) {
    return {
      articles: [],
      error: `GNews : ${error.message}`,
      skipped: false
    };
  }
}

/* --------------------------------------------------------------------------
   Orchestrateur
   -------------------------------------------------------------------------- */

export async function fetchLiveNews({ sources = [], settings = {}, onProgress = null } = {}) {
  const [rssResult, newsApiResult, gNewsResult] = await Promise.allSettled([
    fetchAllSources(sources, settings, { onProgress }),
    fetchNewsApi(settings),
    fetchGNews(settings)
  ]);

  const rss = rssResult.status === "fulfilled"
    ? rssResult.value
    : { articles: [], errors: [{ source: "RSS", message: "Erreur inattendue" }], successfulSources: [] };
  const newsApi = newsApiResult.status === "fulfilled"
    ? newsApiResult.value
    : { articles: [], error: "NewsAPI : erreur inattendue" };
  const gNews = gNewsResult.status === "fulfilled"
    ? gNewsResult.value
    : { articles: [], error: "GNews : erreur inattendue" };

  const articles = mergeArticles(rss.articles, newsApi.articles, gNews.articles);
  const errors = [...(rss.errors || [])];
  if (newsApi.error) errors.push({ source: "NewsAPI", message: newsApi.error });
  if (gNews.error) errors.push({ source: "GNews", message: gNews.error });

  const apiSources = [newsApi.articles.length ? "NewsAPI" : "", gNews.articles.length ? "GNews" : ""].filter(Boolean);

  return {
    articles,
    errors,
    successfulSources: [...(rss.successfulSources || []), ...apiSources],
    sourceCount: (rss.sourceCount || 0) + (newsApi.skipped ? 0 : 1) + (gNews.skipped ? 0 : 1),
    fetchedAt: new Date().toISOString(),
    usedDemo: false
  };
}

