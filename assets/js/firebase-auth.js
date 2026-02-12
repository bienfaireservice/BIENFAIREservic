import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function qs(sel, parent = document) { return parent.querySelector(sel); }

function setStatus(el, msg, ok = true) {
  if (!el) return;
  el.textContent = msg;
  el.style.color = ok ? "var(--primary)" : "#b91c1c";
}

async function upsertUserDoc(user) {
  if (!user) return;
  const fallbackName = user.displayName || user.email || "Client";
  await setDoc(doc(db, "users", user.uid), {
    name: fallbackName,
    email: user.email || "",
    banned: false,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString()
  }, { merge: true });
}

async function signup() {
  const name = qs("#signupName")?.value?.trim() || "";
  const email = qs("#signupEmail")?.value?.trim() || "";
  const pass = qs("#signupPassword")?.value || "";
  const status = qs("#authStatus");
  if (!name || !email || !pass) return setStatus(status, "Veuillez remplir tous les champs.", false);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, "users", cred.user.uid), {
      name,
      email,
      banned: false,
      createdAt: new Date().toISOString()
    });
    setStatus(status, "Compte cree. Redirection...", true);
    window.location.href = "account.html";
  } catch (err) {
    setStatus(status, err.message || "Erreur d'inscription.", false);
  }
}

async function login() {
  const email = qs("#loginEmail")?.value?.trim() || "";
  const pass = qs("#loginPassword")?.value || "";
  const status = qs("#authStatus");
  if (!email || !pass) return setStatus(status, "Email et mot de passe requis.", false);
  try {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    const userDoc = await getDoc(doc(db, "users", cred.user.uid));
    if (userDoc.exists() && userDoc.data()?.banned) {
      setStatus(status, "Compte suspendu. Contactez l'administrateur.", false);
      await signOut(auth);
      return;
    }
    setStatus(status, "Connexion reussie. Redirection...", true);
    window.location.href = "account.html";
  } catch (err) {
    setStatus(status, err.message || "Erreur de connexion.", false);
  }
}

async function loginWithGoogle() {
  const status = qs("#authStatus");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  try {
    const cred = await signInWithPopup(auth, provider);
    const userDoc = await getDoc(doc(db, "users", cred.user.uid));
    if (userDoc.exists() && userDoc.data()?.banned) {
      setStatus(status, "Compte suspendu. Contactez l'administrateur.", false);
      await signOut(auth);
      return;
    }
    await upsertUserDoc(cred.user);
    setStatus(status, "Connexion Google reussie. Redirection...", true);
    window.location.href = "account.html";
  } catch (err) {
    const code = err?.code || "";
    if (code === "auth/popup-blocked") {
      setStatus(status, "Popup Google bloquee. Autorisez les popups puis reessayez.", false);
      return;
    }
    setStatus(status, err.message || "Connexion Google impossible.", false);
  }
}

async function resetPassword() {
  const email = qs("#loginEmail")?.value?.trim() || "";
  const status = qs("#authStatus");
  if (!email) return setStatus(status, "Entrez votre email pour reinitialiser.", false);
  try {
    await sendPasswordResetEmail(auth, email);
    setStatus(status, "Email de reinitialisation envoye.", true);
  } catch (err) {
    setStatus(status, err.message || "Erreur lors de la reinitialisation.", false);
  }
}

function bindAuth() {
  const signupBtn = qs("#signupBtn");
  const loginBtn = qs("#loginBtn");
  const googleLoginBtn = qs("#googleLoginBtn");
  const resetBtn = qs("#resetBtn");
  signupBtn?.addEventListener("click", signup);
  loginBtn?.addEventListener("click", login);
  googleLoginBtn?.addEventListener("click", loginWithGoogle);
  resetBtn?.addEventListener("click", resetPassword);
}

onAuthStateChanged(auth, (user) => {
  const status = qs("#authStatus");
  if (user && status) {
    status.textContent = `Connecte: ${user.email}`;
  }
  if (user) {
    // block banned accounts
    getDoc(doc(db, "users", user.uid)).then(snap => {
      if (snap.exists() && snap.data()?.banned) {
        signOut(auth);
        window.location.href = "auth.html";
      }
    });
  }
  if (user) {
    // If already logged in, skip auth page
    if (window.location.pathname.endsWith("auth.html")) {
      window.location.href = "account.html";
    }
  }
});

window.addEventListener("DOMContentLoaded", bindAuth);
