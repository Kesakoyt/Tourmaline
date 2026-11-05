/* ==========================================================================
   Tourmaline — Firebase service
   Encapsule Auth + Firestore. Le reste de l'application n'a jamais besoin
   d'importer directement le SDK Firebase.
   ========================================================================== */

import { getFirebase, isFirebaseConfigured } from "./firebase-config.js";

let services = null;

async function ready() {
  if (!isFirebaseConfigured) return null;
  if (!services) services = await getFirebase();
  return services;
}

export function authErrorMessage(error) {
  const code = error?.code || "";
  const messages = {
    "auth/invalid-email": "Cette adresse e-mail n'est pas valide.",
    "auth/user-not-found": "Aucun compte ne correspond à cette adresse.",
    "auth/wrong-password": "Mot de passe incorrect.",
    "auth/invalid-credential": "E-mail ou mot de passe incorrect.",
    "auth/invalid-login-credentials": "E-mail ou mot de passe incorrect.",
    "auth/email-already-in-use": "Un compte existe déjà avec cette adresse.",
    "auth/weak-password": "Choisissez un mot de passe d'au moins 6 caractères.",
    "auth/too-many-requests": "Trop de tentatives. Réessayez dans quelques minutes.",
    "auth/network-request-failed": "Connexion au réseau impossible. Vérifiez votre connexion.",
    "auth/operation-not-allowed": "La connexion e-mail / mot de passe n'est pas activée dans Firebase.",
    "auth/requires-recent-login": "Reconnectez-vous avant de poursuivre cette action.",
    "permission-denied": "Accès Firestore refusé. Vérifiez que les règles de sécurité sont déployées.",
    "unavailable": "Firestore est momentanément indisponible."
  };
  return messages[code] || error?.message || "Une erreur inattendue est survenue.";
}

/** Écoute les changements de session Firebase. */
export async function startAuthListener(onChange) {
  try {
    const fb = await ready();
    if (!fb) {
      onChange(null);
      return () => {};
    }
    return fb.authApi.onAuthStateChanged(fb.auth, onChange);
  } catch (error) {
    console.error("[Tourmaline] Auth listener :", error);
    onChange(null);
    return () => {};
  }
}

export async function signInWithEmail(email, password) {
  const fb = await ready();
  if (!fb) throw new Error("Firebase n'est pas configuré.");
  const credential = await fb.authApi.signInWithEmailAndPassword(
    fb.auth,
    email.trim(),
    password
  );
  return credential.user;
}

export async function signUpWithEmail(name, email, password) {
  const fb = await ready();
  if (!fb) throw new Error("Firebase n'est pas configuré.");
  const credential = await fb.authApi.createUserWithEmailAndPassword(
    fb.auth,
    email.trim(),
    password
  );
  if (name.trim()) {
    await fb.authApi.updateProfile(credential.user, { displayName: name.trim() });
  }
  return credential.user;
}

export async function signOutUser() {
  const fb = await ready();
  if (!fb) return;
  await fb.authApi.signOut(fb.auth);
}

export async function sendPasswordReset(email) {
  const fb = await ready();
  if (!fb) throw new Error("Firebase n'est pas configuré.");
  await fb.authApi.sendPasswordResetEmail(fb.auth, email.trim());
}

export function getCurrentUser() {
  return services?.auth?.currentUser || null;
}

/* --------------------------------------------------------------------------
   Profil, préférences, sources, favoris
   -------------------------------------------------------------------------- */

function safeDocId(id) {
  return String(id).replace(/[\/#?[\]]/g, "_").slice(0, 900);
}

export async function loadUserCloudData(uid) {
  const fb = await ready();
  if (!fb) return { profile: null, sources: [], saved: [] };

  const {
    doc,
    getDoc,
    getDocs,
    collection
  } = fb.firestoreApi;

  const [profileSnap, sourcesSnap, savedSnap] = await Promise.all([
    getDoc(doc(fb.db, "users", uid)),
    getDocs(collection(fb.db, "users", uid, "rss_sources")),
    getDocs(collection(fb.db, "users", uid, "saved_articles"))
  ]);

  return {
    profile: profileSnap.exists() ? profileSnap.data() : null,
    sources: sourcesSnap.docs.map((item) => ({ id: item.id, ...item.data() })),
    saved: savedSnap.docs.map((item) => ({ id: item.id, ...item.data() }))
  };
}

export async function saveUserPreferences(uid, preferences, displayName = "") {
  const fb = await ready();
  if (!fb) return;
  const { doc, setDoc, serverTimestamp } = fb.firestoreApi;
  await setDoc(
    doc(fb.db, "users", uid),
    {
      preferences,
      displayName,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

export async function saveRssSource(uid, source) {
  const fb = await ready();
  if (!fb) return;
  const { doc, setDoc, serverTimestamp } = fb.firestoreApi;
  await setDoc(
    doc(fb.db, "users", uid, "rss_sources", safeDocId(source.id)),
    {
      ...source,
      id: source.id,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

export async function deleteRssSource(uid, sourceId) {
  const fb = await ready();
  if (!fb) return;
  const { doc, deleteDoc } = fb.firestoreApi;
  await deleteDoc(doc(fb.db, "users", uid, "rss_sources", safeDocId(sourceId)));
}

export async function saveArticleToCloud(uid, article) {
  const fb = await ready();
  if (!fb) return;
  const { doc, setDoc, serverTimestamp } = fb.firestoreApi;
  await setDoc(
    doc(fb.db, "users", uid, "saved_articles", safeDocId(article.id)),
    {
      ...article,
      id: article.id,
      savedAt: serverTimestamp()
    },
    { merge: true }
  );
}

export async function deleteArticleFromCloud(uid, articleId) {
  const fb = await ready();
  if (!fb) return;
  const { doc, deleteDoc } = fb.firestoreApi;
  await deleteDoc(doc(fb.db, "users", uid, "saved_articles", safeDocId(articleId)));
}

/* --------------------------------------------------------------------------
   Résumés quotidiens partagés
   Lecture publique, écriture réservée aux comptes connectés (cf. rules).
   -------------------------------------------------------------------------- */

export async function loadDailySummary(summaryId) {
  try {
    const fb = await ready();
    if (!fb) return null;
    const { doc, getDoc } = fb.firestoreApi;
    const snapshot = await getDoc(doc(fb.db, "daily_summaries", summaryId));
    return snapshot.exists() ? snapshot.data() : null;
  } catch (error) {
    console.warn("[Tourmaline] Résumé Firestore indisponible :", error);
    return null;
  }
}

export async function saveDailySummary(summaryId, summary) {
  try {
    const fb = await ready();
    if (!fb) return false;
    const user = fb.auth.currentUser;
    if (!user) return false;
    const { doc, setDoc, serverTimestamp } = fb.firestoreApi;
    await setDoc(
      doc(fb.db, "daily_summaries", summaryId),
      {
        ...summary,
        createdBy: user.uid,
        savedAt: serverTimestamp()
      },
      { merge: true }
    );
    return true;
  } catch (error) {
    console.warn("[Tourmaline] Enregistrement du résumé impossible :", error);
    return false;
  }
}
