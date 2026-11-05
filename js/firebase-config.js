/* ==========================================================================
   TOURMALINE — FIREBASE CONFIGURATION
   ==========================================================================
   Console Firebase > Paramètres du projet > Général > Vos applications > Web.
   Collez ici les identifiants de votre projet.
   ========================================================================== */

// 🔑 EMPLACEMENT DES IDENTIFIANTS FIREBASE
// Remplacez chaque valeur ci-dessous par celle fournie par la console Firebase.
// Ces clés sont publiques par nature (elles identifient le projet côté client) :
// la sécurité réelle est assurée par Firebase Auth + les règles Firestore.
export const firebaseConfig = {
  apiKey: "AIzaSy...",                                        // <-- Coller votre apiKey ici
  authDomain: "tourmaline-xxx.firebaseapp.com",                // <-- Votre domaine Auth
  projectId: "tourmaline-xxx",                                 // <-- Votre projectId
  storageBucket: "tourmaline-xxx.appspot.com",                 // <-- Votre storageBucket
  messagingSenderId: "123456789",                              // <-- Votre messagingSenderId
  appId: "1:123456789:web:abcdef..."                           // <-- Votre appId Web
};

/* ==========================================================================
   FIN DE LA ZONE À PERSONNALISER
   ========================================================================== */

const PLACEHOLDER_MARKERS = ["AIzaSy...", "tourmaline-xxx", "123456789", "abcdef..."];

/**
 * Vrai uniquement si les valeurs d'exemple ont été remplacées.
 * L'application reste 100 % fonctionnelle en mode invité quand Firebase
 * n'est pas configuré : les données sont alors conservées en localStorage.
 */
export const isFirebaseConfigured = (() => {
  const values = Object.values(firebaseConfig).filter(Boolean);
  if (values.length < 6) return false;
  return !PLACEHOLDER_MARKERS.some((marker) =>
    values.some((value) => String(value).includes(marker))
  );
})();

let firebasePromise = null;

/**
 * Charge Firebase à la demande depuis le CDN officiel.
 * Le chargement dynamique évite de casser l'application si le CDN est
 * momentanément indisponible ou si le projet n'est pas encore configuré.
 *
 * @returns {Promise<null | {
 *   app: object,
 *   auth: object,
 *   db: object,
 *   authApi: object,
 *   firestoreApi: object
 * }>}
 */
export async function getFirebase() {
  if (!isFirebaseConfigured) return null;

  if (!firebasePromise) {
    firebasePromise = (async () => {
      const [appApi, authApi, firestoreApi] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js"),
        import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js")
      ]);

      const app = appApi.initializeApp(firebaseConfig);
      const auth = authApi.getAuth(app);
      const db = firestoreApi.getFirestore(app);

      // Persistance de session locale : l'utilisateur reste connecté après
      // la fermeture de l'onglet (utile pour une PWA installée).
      try {
        await authApi.setPersistence(auth, authApi.browserLocalPersistence);
      } catch (error) {
        console.warn("[Tourmaline] Persistance Firebase indisponible :", error);
      }

      return { app, auth, db, authApi, firestoreApi };
    })().catch((error) => {
      firebasePromise = null;
      console.error("[Tourmaline] Initialisation Firebase impossible :", error);
      throw error;
    });
  }

  return firebasePromise;
}
