/* ==========================================================================
   Tourmaline — AI summarizer
   Stratégie double :
     1. Gemini REST API (gemini-1.5-flash, avec modèles de secours)
     2. API IA locale du navigateur (window.LanguageModel / window.ai)
     3. Synthèse extractive locale, toujours disponible hors ligne
   ========================================================================== */

import {
  BIAS_META,
  getCategoryMeta,
  getSummaryCandidates,
  htmlToText,
  isLast24Hours,
  truncate
} from "./news-service.js";

/* ==========================================================================
   🔑 EMPLACEMENT DES CLÉS API
   ==========================================================================
   Option recommandée : renseignez vos clés dans « Moi > Clés API ».
   Elles sont conservées dans le localStorage de ce navigateur.

   Pour un déploiement personnel, vous pouvez aussi les déclarer ci-dessous.
   ATTENTION : toute clé présente dans le code est visible par les visiteurs.
   N'utilisez cette méthode que pour un usage privé / une démonstration.
   ========================================================================== */

const DEFAULT_GEMINI_KEY = "";      // <-- Coller votre clé Gemini ici (AIza...)
const DEFAULT_NEWSAPI_KEY = "";     // <-- Coller votre clé NewsAPI ici
const DEFAULT_GNEWS_KEY = "";       // <-- Coller votre clé GNews ici

export const KEY_DEFAULTS = Object.freeze({
  geminiKey: DEFAULT_GEMINI_KEY,
  newsApiKey: DEFAULT_NEWSAPI_KEY,
  gnewsKey: DEFAULT_GNEWS_KEY
});

// Endpoint demandé par la spécification. En cas d'indisponibilité du modèle
// 1.5, Tourmaline tente automatiquement les modèles Flash plus récents.
const GEMINI_ENDPOINTS = [
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
];

const SYSTEM_PROMPT = `Tu es le rédacteur d'une synthèse d'actualité française nommée Tourmaline.
Ta mission : produire une synthèse neutre, factuelle et équilibrée des dernières 24 heures.
Règles absolues :
- Ne prends jamais position et n'ajoute aucune information qui ne figure pas dans les articles fournis.
- Les sources d'extrême gauche et d'extrême droite ont déjà été exclues. Ne cherche pas à les deviner ni à les mentionner.
- Distingue clairement les faits établis, les déclarations et les analyses.
- Si une information est incertaine, dis-le explicitement.
- Écris en français, dans un style clair, sobre et accessible.
- Réponds STRICTEMENT avec un objet JSON valide, sans balise Markdown, au format :
{
  "headline": "Titre de 6 à 12 mots",
  "intro": "2 à 3 phrases de contexte",
  "sections": [
    { "title": "Titre court de section", "body": "Un paragraphe de 2 à 4 phrases" }
  ],
  "keyPoints": ["3 à 4 points clés en une phrase"],
  "watch": "Un point à surveiller dans les prochaines heures, ou une chaîne vide"
}`;

/* --------------------------------------------------------------------------
   Gemini
   -------------------------------------------------------------------------- */

function buildArticlesPayload(articles) {
  return articles.slice(0, 28).map((article, index) => {
    const bias = BIAS_META[String(article.bias)] || BIAS_META["0"];
    return {
      n: index + 1,
      titre: truncate(article.title, 180),
      source: article.source,
      ligne_editoriale: bias.label,
      categorie: article.categoryLabel || getCategoryMeta(article.category).label,
      publie_le: article.publishedAt,
      resume: truncate(article.description || htmlToText(article.content), 420)
    };
  });
}

function buildGeminiPrompt(articles) {
  return `Voici les articles des dernières 24 heures, toutes sources non extrêmes confondues.
Construis une synthèse éditoriale équilibrée. Regroupe les informations proches, contextualise les enjeux,
et conserve une stricte neutralité. Ne cite pas de chiffre absent des résumés.

DONNÉES :
${JSON.stringify(buildArticlesPayload(articles), null, 2)}

Rappel : réponse JSON uniquement, en français, sans commentaire autour.`;
}

function cleanJsonResponse(text = "") {
  let cleaned = String(text).trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}

function withTimeout(promise, ms, message) {
  let timer = null;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function normalizeAiSummary(payload, fallback) {
  const headline = truncate(payload.headline || payload.title || fallback.headline, 140);
  const intro = truncate(payload.intro || payload.summary || payload.introduction || fallback.intro, 900);

  const rawSections = Array.isArray(payload.sections)
    ? payload.sections
    : (Array.isArray(payload.keyPoints) ? [] : []);
  const sections = rawSections
    .map((section) => ({
      title: truncate(section.title || section.heading || section.titre || "", 90),
      body: truncate(section.body || section.text || section.contenu || "", 1200)
    }))
    .filter((section) => section.title && section.body)
    .slice(0, 5);

  const keyPoints = (Array.isArray(payload.keyPoints) ? payload.keyPoints : [])
    .map((point) => truncate(typeof point === "string" ? point : point.text || "", 220))
    .filter(Boolean)
    .slice(0, 4);

  return {
    ...fallback,
    headline,
    intro,
    sections: sections.length ? sections : fallback.sections,
    keyPoints: keyPoints.length ? keyPoints : fallback.keyPoints,
    watch: truncate(payload.watch || payload.toWatch || fallback.watch || "", 320)
  };
}

async function callGemini(prompt, apiKey) {
  let lastError = null;

  for (const endpoint of GEMINI_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);

    try {
      const response = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.35,
            topP: 0.9,
            topK: 32,
            maxOutputTokens: 2200,
            responseMimeType: "application/json"
          }
        })
      });

      if (response.status === 404 || response.status === 400) {
        lastError = new Error(`Modèle Gemini indisponible (${response.status})`);
        continue;
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Gemini ${response.status}${detail ? ` · ${truncate(detail, 160)}` : ""}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
        .trim();

      if (!text) throw new Error("Réponse Gemini vide.");
      return cleanJsonResponse(text);
    } catch (error) {
      lastError = error;
      if (error.name === "AbortError") {
        throw new Error("Gemini n'a pas répondu dans le délai imparti.");
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error("Gemini est indisponible.");
}

/* --------------------------------------------------------------------------
   IA locale du navigateur (Chrome Built-in Prompt API)
   -------------------------------------------------------------------------- */

async function callBrowserAI(prompt) {
  const languageModel = globalThis.LanguageModel;

  if (languageModel?.availability && languageModel?.create) {
    const availability = await withTimeout(
      languageModel.availability(),
      2500,
      "L'IA locale met trop de temps à répondre."
    );
    if (!["available", "readily"].includes(availability)) {
      throw new Error("Le modèle d'IA locale n'est pas encore prêt.");
    }
    const session = await withTimeout(
      languageModel.create({
        systemPrompt: SYSTEM_PROMPT,
        temperature: 0.35,
        topK: 32
      }),
      5000,
      "Le modèle d'IA locale n'a pas pu démarrer."
    );
    try {
      const result = await withTimeout(
        session.prompt(prompt),
        8000,
        "L'IA locale met trop de temps à répondre."
      );
      return cleanJsonResponse(result);
    } finally {
      session.destroy?.();
    }
  }

  // Ancienne API window.ai
  const legacyAi = globalThis.ai;
  if (legacyAi) {
    if (typeof legacyAi.canCreateTextSession === "function") {
      const availability = await withTimeout(
        legacyAi.canCreateTextSession(),
        2500,
        "L'IA locale met trop de temps à répondre."
      );
      if (!["readily", "available"].includes(availability)) {
        throw new Error("Le modèle d'IA locale n'est pas encore prêt.");
      }
    }
    if (typeof legacyAi.createTextSession === "function") {
      const session = await withTimeout(
        legacyAi.createTextSession(),
        5000,
        "Le modèle d'IA locale n'a pas pu démarrer."
      );
      try {
        const result = await withTimeout(
          session.prompt(`${SYSTEM_PROMPT}\n\n${prompt}`),
          8000,
          "L'IA locale met trop de temps à répondre."
        );
        return cleanJsonResponse(result);
      } finally {
        session.destroy?.();
      }
    }
    if (legacyAi.languageModel?.create) {
      const session = await withTimeout(
        legacyAi.languageModel.create({ systemPrompt: SYSTEM_PROMPT }),
        5000,
        "Le modèle d'IA locale n'a pas pu démarrer."
      );
      try {
        const result = await withTimeout(
          session.prompt(prompt),
          8000,
          "L'IA locale met trop de temps à répondre."
        );
        return cleanJsonResponse(result);
      } finally {
        session.destroy?.();
      }
    }
  }

  throw new Error("Aucune IA locale disponible.");
}

/* --------------------------------------------------------------------------
   Synthèse extractive locale (fallback universel, hors ligne)
   -------------------------------------------------------------------------- */

function groupArticlesByCategory(articles) {
  const groups = new Map();
  articles.forEach((article) => {
    const category = article.category || "monde";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(article);
  });

  return [...groups.entries()]
    .map(([category, items]) => ({
      category,
      label: getCategoryMeta(category).label,
      items: items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    }))
    .sort((a, b) => b.items.length - a.items.length)
    .slice(0, 4);
}

function buildExtractiveSummary(eligible, excluded, now = Date.now()) {
  const sorted = [...eligible].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const groups = groupArticlesByCategory(sorted);
  const sources = [...new Set(sorted.map((article) => article.source))];
  const urgentCount = sorted.filter((article) => article.isUrgent).length;
  const topCategory = groups[0]?.label || "actualité";
  const topArticles = sorted.slice(0, 4);

  const headline = sorted.length
    ? `L'essentiel en ${topCategory.toLowerCase()} et au-delà`
    : "Le calme avant le prochain signal";

  const intro = sorted.length
    ? `Les dernières 24 heures ont été marquées par ${sorted.length} article${sorted.length > 1 ? "s" : ""} issu${sorted.length > 1 ? "s" : ""} de ${sources.length} source${sources.length > 1 ? "s" : ""} non extrême${sources.length > 1 ? "s" : ""}. ${urgentCount ? `${urgentCount} signal${urgentCount > 1 ? "aux" : ""} de priorité a été identifié. ` : ""}Voici les fils à retenir, sans hiérarchie partisane.`
    : "Aucun article éligible n'a été trouvé dans les dernières 24 heures. Le résumé sera enrichi dès que de nouvelles sources seront disponibles.";

  const sections = groups.map((group) => {
    const selected = group.items.slice(0, 3);
    const details = selected.map((article) => {
      const description = truncate(article.description || htmlToText(article.content), 210);
      return description
        ? `${article.title} — ${description} (${article.source})`
        : `${article.title} (${article.source})`;
    });
    return {
      title: group.label,
      body: details.join(" ")
    };
  });

  if (!sections.length) {
    sections.push({
      title: "En attente de sources",
      body: "Tourmaline n'a pas reçu d'articles éligibles. Activez davantage de flux RSS dans l'onglet Moi ou vérifiez votre connexion."
    });
  }

  const keyPoints = topArticles.map((article) => {
    const source = article.source ? ` — ${article.source}` : "";
    return `${truncate(article.title, 150)}${source}`;
  });

  const keyBiasLabels = [...new Set(sorted.map((article) => BIAS_META[String(article.bias)]?.short || "Centre"))];
  const watch = excluded.length
    ? `${excluded.length} article${excluded.length > 1 ? "s" : ""} provenant de sources classées extrêmes ${excluded.length > 1 ? "ont été écartés" : "a été écarté"} de cette synthèse, conformément à la règle éditoriale.`
    : `Aucune source classée extrême n'a été retenue dans la fenêtre de 24 heures. Lignes représentées : ${keyBiasLabels.join(", ") || "centre"}.`;

  return {
    headline,
    intro,
    sections,
    keyPoints,
    watch,
    provider: "Synthèse locale",
    providerKey: "extractive",
    isAi: false,
    analyzedCount: sorted.length,
    excludedCount: excluded.length,
    sources,
    excludedSources: [...new Set(excluded.map((article) => article.source))],
    articleIds: sorted.map((article) => article.id),
    generatedAt: new Date(now).toISOString()
  };
}

/* --------------------------------------------------------------------------
   API publique
   -------------------------------------------------------------------------- */

/**
 * Génère la synthèse quotidienne. Les extrêmes sont écartés AVANT tout appel
 * à un modèle, y compris pour l'IA locale.
 *
 * @param {object} options
 * @param {Array} options.articles
 * @param {string} options.geminiKey
 * @param {boolean} options.allowBrowserAI
 * @param {(provider:string) => void} options.onProvider
 */
export async function generateDailySummary({
  articles = [],
  geminiKey = "",
  allowBrowserAI = true,
  onProvider = null
} = {}) {
  const now = Date.now();
  const { eligible, excluded, totalRecent } = getSummaryCandidates(articles, now);
  const fallback = buildExtractiveSummary(eligible, excluded, now);
  const prompt = buildGeminiPrompt(eligible);

  // 1. Gemini
  if (geminiKey && eligible.length) {
    onProvider?.("Gemini");
    try {
      const payload = await callGemini(prompt, geminiKey);
      const summary = normalizeAiSummary(payload, fallback);
      return {
        ...summary,
        provider: "Gemini 1.5 Flash",
        providerKey: "gemini",
        isAi: true,
        analyzedCount: eligible.length,
        excludedCount: excluded.length,
        totalRecent,
        sources: fallback.sources,
        excludedSources: fallback.excludedSources,
        articleIds: fallback.articleIds,
        generatedAt: new Date().toISOString()
      };
    } catch (error) {
      console.warn("[Tourmaline] Gemini indisponible, repli local :", error);
    }
  }

  // 2. IA locale du navigateur
  if (allowBrowserAI && eligible.length) {
    onProvider?.("IA locale");
    try {
      const payload = await callBrowserAI(prompt);
      const summary = normalizeAiSummary(payload, fallback);
      return {
        ...summary,
        provider: "IA locale (navigateur)",
        providerKey: "browser-ai",
        isAi: true,
        analyzedCount: eligible.length,
        excludedCount: excluded.length,
        totalRecent,
        sources: fallback.sources,
        excludedSources: fallback.excludedSources,
        articleIds: fallback.articleIds,
        generatedAt: new Date().toISOString()
      };
    } catch (error) {
      console.info("[Tourmaline] IA locale indisponible :", error.message);
    }
  }

  // 3. Synthèse extractive locale
  onProvider?.("Synthèse locale");
  return {
    ...fallback,
    totalRecent
  };
}

/**
 * Sérialise une synthèse en Markdown (export / partage).
 */
export function summaryToMarkdown(summary) {
  if (!summary) return "";
  const lines = [
    `# ${summary.headline || "Résumé du jour"}`,
    "",
    `> ${summary.intro || ""}`,
    "",
    ...(summary.sections || []).flatMap((section) => [
      `## ${section.title}`,
      "",
      section.body,
      ""
    ]),
    "## Points clés",
    "",
    ...(summary.keyPoints || []).map((point) => `- ${point}`),
    ""
  ];

  if (summary.watch) {
    lines.push("## À surveiller", "", summary.watch, "");
  }

  lines.push(
    "---",
    `Généré le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(new Date(summary.generatedAt || Date.now()))}.`,
    `Méthode : ${summary.provider || "Tourmaline"} · ${summary.analyzedCount || 0} articles analysés · ${summary.excludedCount || 0} article(s) extrême(s) écarté(s).`
  );

  return lines.join("\n");
}

export { buildExtractiveSummary };
