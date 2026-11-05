/* ==========================================================================
   TOURMALINE — FIREBASE CONFIGURATION
   ==========================================================================
   Console Firebase > Paramètres du projet > Général > Vos applications > Web.
   Collez ici les identifiants de votre projet.
   ========================================================================== */

// 🔑 IDENTIFIANTS FIREBASE
// Projet : tourmaline-15bb0
// Ces clés sont publiques par nature (elles identifient le projet côté client) :
// la sécurité réelle est assurée par Firebase Auth + les règles Firestore.
export const firebaseConfig = {
  apiKey: "AIzaSyAFEiUfLeKpFe5qU2YgYSsmgWLtXN8sKLY",
  authDomain: "tourmaline-15bb0.firebaseapp.com",
  projectId: "tourmaline-15bb0",
  storageBucket: "tourmaline-15bb0.firebasestorage.app",
  messagingSenderId: "827890539094",
  appId: "1:827890539094:web:59cc0509d5adfd690139f7"
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
