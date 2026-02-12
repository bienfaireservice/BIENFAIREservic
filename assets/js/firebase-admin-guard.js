import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Fallback admin list (still used if Firestore isn't configured)
const ADMIN_EMAILS = [
  "BIENFAIREservice@gmail.com"
];

async function isAdmin(user) {
  if (!user) return false;
  // Primary: Firestore check -> collection "admins", doc id = user.uid
  try {
    const ref = doc(db, "admins", user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return true;
  } catch {
    // Ignore and fallback
  }
  // Fallback: email allow-list
  const email = (user.email || "").toLowerCase();
  return ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../auth.html";
    return;
  }
  const allowed = await isAdmin(user);
  if (!allowed) {
    window.location.href = "../index.html";
  }
});
