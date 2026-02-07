import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

function qs(sel, parent = document) { return parent.querySelector(sel); }

function renderUser(user) {
  const profile = qs("#accountProfile");
  if (!profile) return;
  if (!user) {
    profile.innerHTML = "Aucun utilisateur connecte.";
    return;
  }
  const name = user.displayName || "Client";
  profile.innerHTML = `<strong>${name}</strong><div>${user.email}</div>`;
}

function bindLogout() {
  const btn = qs("#logoutBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "auth.html";
  });
}

onAuthStateChanged(auth, (user) => {
  renderUser(user);
  if (!user) {
    window.location.href = "auth.html";
  }
});

window.addEventListener("DOMContentLoaded", bindLogout);
