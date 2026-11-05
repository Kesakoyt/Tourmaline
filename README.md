# Tourmaline — L'actualité en clair

Tourmaline est une PWA de lecture d'actualité au design **Windows 11 Fluent Light**. Elle rassemble des flux RSS et des API d'information, classe chaque source sur un spectre politique en cinq positions, met en avant les signaux urgents des dernières 24 heures et génère un **résumé quotidien neutre, sans les sources extrêmes**.

![Statut](https://img.shields.io/badge/PWA-installable-008080) ![Statut](https://img.shields.io/badge/design-Fluent%20Light-005fb8)

## Fonctionnalités

- **Accueil** : fil agrégé, filtres par catégorie, pays, ligne éditoriale et tri, équilibre des sources en temps réel.
- **Urgent** : détection des signaux forts des dernières 24 h (conflits, catastrophes, bilans humains, développements majeurs).
- **Résumé** : synthèse IA quotidienne. Les sources classées **extrême gauche (-2)** et **extrême droite (+2)** sont exclues avant tout appel au modèle.
- **Enquêtes** : sélection des sources d'investigation et des formats longs.
- **Moi** : compte Firebase, synchronisation, préférences, clés API, flux RSS personnalisés, favoris, installation PWA.
- **Lecteur plein écran** : lecture confortable, impression, export **PDF** et **Markdown**.
- **Recherche globale** : `Ctrl+K` ou `/`, navigation clavier dans les résultats.
- **Hors ligne** : cache local du fil + service worker (interface et icônes en cache-first, actualités en network-first).

## Spectre éditorial

| Valeur | Libellé affiché |
| --- | --- |
| `-2` | Extrême gauche |
| `-1` | Centre gauche |
| `0` | Centre |
| `1` | Centre droit |
| `2` | Extrême droite |

Chaque carte d'article porte un badge de ligne éditoriale. Le spectre est une indication de positionnement éditorial, pas un label de qualité. Les extrêmes restent visibles dans le fil (si vous les activez) mais sont **toujours exclus du Résumé IA**.

## Structure du projet

```text
Tourmaline/
├── index.html
├── manifest.json
├── sw.js
├── firestore.rules
├── .nojekyll
├── assets/
│   ├── icons/            # icônes PWA
│   └── news/             # visuels des articles de démonstration
├── css/
│   └── styles.css
└── js/
    ├── app.js            # contrôleur principal
    ├── news-service.js   # ingestion RSS / NewsAPI / GNews
    ├── ai-summarizer.js  # Gemini, IA navigateur, synthèse locale
    ├── firebase-config.js
    └── firebase-service.js
```

## Démarrage local

Les modules ES nécessitent un serveur HTTP (l'ouverture directe en `file://` ne fonctionne pas).

```bash
# Python
python -m http.server 8080

# ou Node.js
npx serve .
```

Ouvrez ensuite <http://localhost:8080>.

L'application démarre **sans configuration** en mode invité : les préférences, sources et favoris sont stockés dans le `localStorage`. Si aucun flux n'est accessible, des articles de démonstration clairement identifiés sont affichés.

Cinq sources françaises sont actives par défaut : **Le Monde**, **Le Figaro**, **France 24**, **L'Express** et **Mediapart**. Franceinfo, BBC World, The Guardian, ProPublica, Al Jazeera et Révolution permanente restent configurées mais désactivées : activez-les depuis **Moi → Flux RSS & médias**.

### Ingestion des flux

Les flux RSS passent d'abord par **rss2json**, puis basculent automatiquement sur des proxys CORS publics (`proxy.corsfix.com`, `api.allorigins.win`, `api.codetabs.com`) si le service est saturé ou refuse la requête. Le chargement est progressif : les premiers articles s'affichent dès qu'une source répond, avec une limite globale de 15 secondes. NewsAPI et GNews complètent le fil lorsqu'une clé est renseignée.

## Configuration des clés API

Deux méthodes, au choix.

### 1. Dans l'interface (recommandé)

Ouvrez **Moi → Clés API** et renseignez :

| Clé | Usage |
| --- | --- |
| `Gemini API` | Synthèse quotidienne rédigée par Gemini |
| `NewsAPI` | Titres internationaux complémentaires |
| `GNews` | Flux d'appoint |
| `RSS2JSON` | Optionnel, pour relever les limites du proxy public |

Les clés sont conservées **uniquement dans le navigateur** (`localStorage`) et ne sont **jamais synchronisées vers Firestore**.

### 2. Dans le code (usage privé uniquement)

- `js/ai-summarizer.js` : constantes `DEFAULT_GEMINI_KEY`, `DEFAULT_NEWSAPI_KEY`, `DEFAULT_GNEWS_KEY`.
- `js/firebase-config.js` : identifiants du projet Firebase.

> ⚠️ **Toute clé placée dans le code est visible par les visiteurs.** N'utilisez cette méthode que pour une démonstration privée. Pour un site public, préférez la saisie locale ou un proxy serveur.

### Synthèse IA

Ordre de repli automatique :

1. **Gemini** — `gemini-1.5-flash`, puis `gemini-2.0-flash` et `gemini-2.5-flash` si le modèle demandé est retiré.
2. **IA locale du navigateur** — `LanguageModel` / Chrome Prompt API, quand elle est disponible.
3. **Synthèse extractive locale** — toujours disponible, même hors ligne.

Le résumé du jour est mis en cache dans le `localStorage` et, si un compte est connecté, publié dans `daily_summaries/{AAAA-MM-JJ}` pour être partagé en lecture.

## Configuration Firebase

1. Créez un projet sur <https://console.firebase.google.com>.
2. Ajoutez une application **Web** et copiez les identifiants dans `js/firebase-config.js`.
3. Activez **Authentication → Sign-in method → E-mail/Mot de passe**.
4. Créez la base **Firestore** (mode production).
5. Déployez les règles fournies :

```bash
# Avec la CLI Firebase, depuis la racine du projet
firebase deploy --only firestore:rules
```

Ou copiez le contenu de `firestore.rules` dans **Firestore → Règles** puis publiez.

6. Dans **Authentication → Settings → Authorized domains**, ajoutez votre domaine de production, par exemple `votre-compte.github.io`.

Structure Firestore utilisée :

```text
users/{uid}
  preferences, displayName, updatedAt
users/{uid}/rss_sources/{sourceId}
users/{uid}/saved_articles/{articleId}
daily_summaries/{AAAA-MM-JJ}   # lecture publique, écriture authentifiée
```

Si Firebase n'est pas configuré, l'application reste entièrement fonctionnelle en mode invité avec stockage local.

## Déploiement sur GitHub Pages

1. Créez un dépôt GitHub et poussez le contenu du dossier :

   ```bash
   git init
   git add .
   git commit -m "Tourmaline PWA"
   git branch -M main
   git remote add origin https://github.com/VOTRE_COMPTE/tourmaline.git
   git push -u origin main
   ```

2. Dans le dépôt : **Settings → Pages**.
3. Source : **Deploy from a branch**, branche `main`, dossier `/ (root)`.
4. Attendez la publication sur `https://VOTRE_COMPTE.github.io/tourmaline/`.

Le fichier `.nojekyll` est déjà présent : il évite que GitHub Pages ignore certains fichiers. Tous les chemins de l'application sont relatifs, ce qui permet un déploiement dans un sous-dossier (`/tourmaline/`) comme à la racine d'un domaine.

### Après le déploiement

- Ajoutez le domaine GitHub Pages dans les **domaines autorisés Firebase**.
- Vérifiez que le service worker s'enregistre : DevTools → **Application → Service Workers**. Il nécessite HTTPS (fourni par GitHub Pages).
- Pour mettre à jour l'application, modifiez `VERSION` dans `sw.js` afin de renouveler le cache.
- L'installation PWA est proposée depuis le bouton **Installer** ou le menu du navigateur (Chrome/Edge). Sur iOS : **Partager → Sur l'écran d'accueil**.

## Limites connues

- **Clés côté client** : visibles dans le navigateur et le réseau. Pour une mise en production à fort trafic, utilisez un backend/proxy (Cloud Functions, Worker) et des restrictions de clé par domaine.
- **NewsAPI** : l'offre gratuite limite souvent les appels depuis un domaine de production. GNews et les flux RSS restent les sources principales.
- **rss2json** : le proxy public peut renvoyer `HTTP 429` en cas d'appels simultanés. Tourmaline limite la concurrence (4 requêtes) et bascule sur des proxys de secours (`corsfix`, `allorigins`, `codetabs`), mais certains flux peuvent rester partiellement indisponibles. Franceinfo renvoie notamment `403` via proxy ; activez-la si votre réseau le permet.
- **Classement éditorial** : attribution indicative par source, stockée dans `js/news-service.js`. Elle peut être ajustée manuellement dans la liste des sources.
- **Synthèse IA** : peut comporter des imprécisions. Les sources originales restent la référence ; un avertissement est affiché dans l'application.
- **PDF** : l'export utilise `html2pdf.js` (CDN). Les images sont retirées du document exporté pour éviter les erreurs CORS ; utilisez l'impression pour une version enrichie.

## Accessibilité et design

- Palette Fluent Light (`#f3f3f3`, `#ffffff`, `#1a1a1a`, `#616161`, teal `#008080`, bleu `#005fb8`).
- Effets de verre dépoli (`backdrop-filter: blur(20px)`), bordures `#e5e5e5`, ombres douces, rayons 8–12 px, police Segoe UI.
- Navigation latérale sur desktop, barre inférieure fixe sur mobile.
- Lien d'évitement, labels ARIA, navigation clavier, styles d'impression dédiés.
- Toutes les icônes proviennent d'**Icons8 Fluent** : `https://img.icons8.com/fluency/200/[nom].png`.

## Crédits

- Icônes : [Icons8](https://icons8.com).
- Visuels de démonstration : Unsplash (fichiers locaux dans `assets/news/`).
- Application et contenus de démonstration : Tourmaline.

Tourmaline n'héberge aucun article : chaque carte renvoie au média d'origine.
