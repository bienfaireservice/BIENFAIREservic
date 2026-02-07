import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// used by admin tools
window.currentUserEmail = "";

document.documentElement.classList.remove("auth-ready");

function ensureBadge() {
  let badge = document.querySelector("#userBadge");
  if (badge) return badge;
  const actions = document.querySelector(".header-actions");
  if (!actions) return null;
  badge = document.createElement("a");
  badge.id = "userBadge";
  badge.className = "btn ghost";
  badge.href = "account.html";
  actions.insertBefore(badge, actions.firstChild);
  return badge;
}

function ensureAvatar() {
  let avatar = document.querySelector("#userAvatar");
  if (avatar) return avatar;
  const actions = document.querySelector(".header-actions");
  if (!actions) return null;
  avatar = document.createElement("div");
  avatar.id = "userAvatar";
  avatar.className = "user-avatar";
  actions.insertBefore(avatar, actions.firstChild);
  return avatar;
}

function ensureMenu() {
  let menu = document.querySelector("#userMenu");
  if (menu) return menu;
  const actions = document.querySelector(".header-actions");
  if (!actions) return null;
  menu = document.createElement("div");
  menu.id = "userMenu";
  menu.className = "user-menu";
  menu.innerHTML = `
    <div class="user-menu-header">
      <div id="userMenuName" class="user-menu-name"></div>
      <div id="userMenuEmail" class="user-menu-email"></div>
      <span id="adminBadge" class="admin-badge" style="display:none;">ADMIN</span>
    </div>
    <div class="user-menu-links">
      <a href="account.html">Mon compte</a>
      <a id="adminLink" href="admin/index.html" style="display:none;">Admin</a>
      <a id="menuLoginLink" href="auth.html">Connexion</a>
      <button id="menuLogoutBtn" type="button">Se deconnecter</button>
    </div>
  `;
  actions.appendChild(menu);
  return menu;
}

function toggleMenu(show) {
  const menu = ensureMenu();
  if (!menu) return;
  menu.style.display = show ? "block" : "none";
}

function ensureLogout() {
  let btn = document.querySelector("#headerLogout");
  if (btn) return btn;
  const actions = document.querySelector(".header-actions");
  if (!actions) return null;
  btn = document.createElement("button");
  btn.id = "headerLogout";
  btn.className = "btn ghost";
  btn.textContent = "Se deconnecter";
  btn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "auth.html";
  });
  actions.appendChild(btn);
  return btn;
}

async function isAdminUser(user) {
  if (!user) return false;
  try {
    const ref = doc(db, "admins", user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return true;
  } catch {
    // ignore
  }
  return false;
}

onAuthStateChanged(auth, async (user) => {
  document.documentElement.classList.add("auth-ready");
  const avatar = ensureAvatar();
  const badge = ensureBadge();
  const logout = ensureLogout();
  const menu = ensureMenu();
  if (!badge || !logout || !avatar || !menu) return;
  const navLoginLinks = document.querySelectorAll('a[href="auth.html"], a[href="./auth.html"], a[data-i18n="nav_login"]');
  if (user) {
    // Presence + last login
    try {
      await setDoc(doc(db, "users", user.uid), {
        name: user.displayName || "Client",
        email: user.email || "",
        lastLoginAt: new Date().toISOString(),
        isOnline: true,
        lastSeenAt: new Date().toISOString()
      }, { merge: true });
    } catch {
      // ignore
    }
    const name = user.displayName || user.email || "Compte";
    const initial = (user.displayName || user.email || "U").trim().charAt(0).toUpperCase();
    badge.textContent = `Bonjour, ${name}`;
    badge.style.display = "inline-flex";
    avatar.textContent = initial;
    avatar.style.display = "inline-flex";
    logout.style.display = "inline-flex";
    const isAdmin = await isAdminUser(user);
    const badgeEl = document.querySelector("#adminBadge");
    if (badgeEl) badgeEl.style.display = isAdmin ? "inline-flex" : "none";
    const adminLink = document.querySelector("#adminLink");
    if (adminLink) adminLink.style.display = isAdmin ? "inline-flex" : "none";
    const loginLink = document.querySelector("#menuLoginLink");
    if (loginLink) loginLink.style.display = "none";
    navLoginLinks.forEach(el => el.style.display = "none");
    const menuName = document.querySelector("#userMenuName");
    const menuEmail = document.querySelector("#userMenuEmail");
    if (menuName) menuName.textContent = name;
    if (menuEmail) menuEmail.textContent = user.email || "";
  } else {
    badge.textContent = "Se connecter";
    badge.href = "auth.html";
    avatar.style.display = "none";
    logout.style.display = "none";
    const badgeEl = document.querySelector("#adminBadge");
    if (badgeEl) badgeEl.style.display = "none";
    const loginLink = document.querySelector("#menuLoginLink");
    if (loginLink) loginLink.style.display = "inline-flex";
    navLoginLinks.forEach(el => el.style.display = "inline-flex");
  }
});

// Best-effort presence (set offline)
window.addEventListener("beforeunload", async () => {
  const u = auth.currentUser;
  if (!u) return;
  try {
    await updateDoc(doc(db, "users", u.uid), {
      isOnline: false,
      lastSeenAt: new Date().toISOString()
    });
  } catch {
    // ignore
  }
});

window.addEventListener("click", (e) => {
  const menu = document.querySelector("#userMenu");
  const avatar = document.querySelector("#userAvatar");
  if (!menu || !avatar) return;
  if (avatar.contains(e.target)) {
    toggleMenu(menu.style.display !== "block");
    return;
  }
  if (!menu.contains(e.target)) toggleMenu(false);
});

window.addEventListener("DOMContentLoaded", () => {
  const logoutBtn = document.querySelector("#menuLogoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await signOut(auth);
      window.location.href = "auth.html";
    });
  }
});
    window.currentUserEmail = user.email || "";
