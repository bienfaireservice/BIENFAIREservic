import { firebaseConfig } from "./firebase-config.js";

const UI_CACHE_KEY = "bf_ui_user_cache";
const firebase = {
  ready: false,
  auth: null,
  db: null,
  onAuthStateChanged: null,
  signOut: null,
  doc: null,
  getDoc: null,
  setDoc: null,
  updateDoc: null
};

// used by admin tools
window.currentUserEmail = "";

document.documentElement.classList.remove("auth-ready");

function readUiCache() {
  try {
    const raw = localStorage.getItem(UI_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeUiCache(data) {
  try {
    localStorage.setItem(UI_CACHE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

function clearUiCache() {
  try {
    localStorage.removeItem(UI_CACHE_KEY);
  } catch {
    // ignore
  }
}

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
  btn.addEventListener("click", performSignOut);
  actions.appendChild(btn);
  return btn;
}

async function performSignOut() {
  clearUiCache();
  try {
    if (firebase.ready && firebase.signOut && firebase.auth) {
      await firebase.signOut(firebase.auth);
    }
  } catch {
    // ignore
  }
  window.location.href = "auth.html";
}

function renderHeaderForUser(view) {
  const avatar = ensureAvatar();
  const badge = ensureBadge();
  const logout = ensureLogout();
  const menu = ensureMenu();
  if (!badge || !logout || !avatar || !menu) return;

  const navLoginLinks = document.querySelectorAll('a[href="auth.html"], a[href="./auth.html"], a[data-i18n="nav_login"]');
  const menuName = document.querySelector("#userMenuName");
  const menuEmail = document.querySelector("#userMenuEmail");
  const adminBadge = document.querySelector("#adminBadge");
  const adminLink = document.querySelector("#adminLink");
  const loginLink = document.querySelector("#menuLoginLink");

  window.currentUserEmail = view.email || "";
  badge.textContent = `Bonjour, ${view.name}`;
  badge.href = "account.html";
  badge.style.display = "inline-flex";
  avatar.textContent = view.initial || "U";
  avatar.style.display = "inline-flex";
  logout.style.display = "inline-flex";
  if (menuName) menuName.textContent = view.name;
  if (menuEmail) menuEmail.textContent = view.email || "";
  if (adminBadge) adminBadge.style.display = view.isAdmin ? "inline-flex" : "none";
  if (adminLink) adminLink.style.display = view.isAdmin ? "inline-flex" : "none";
  if (loginLink) loginLink.style.display = "none";
  navLoginLinks.forEach(el => el.style.display = "none");
}

function renderHeaderLoggedOut() {
  const avatar = ensureAvatar();
  const badge = ensureBadge();
  const logout = ensureLogout();
  const menu = ensureMenu();
  if (!badge || !logout || !avatar || !menu) return;

  const navLoginLinks = document.querySelectorAll('a[href="auth.html"], a[href="./auth.html"], a[data-i18n="nav_login"]');
  const adminBadge = document.querySelector("#adminBadge");
  const adminLink = document.querySelector("#adminLink");
  const loginLink = document.querySelector("#menuLoginLink");
  const menuName = document.querySelector("#userMenuName");
  const menuEmail = document.querySelector("#userMenuEmail");

  window.currentUserEmail = "";
  badge.textContent = "Se connecter";
  badge.href = "auth.html";
  badge.style.display = "inline-flex";
  avatar.style.display = "none";
  logout.style.display = "none";
  if (adminBadge) adminBadge.style.display = "none";
  if (adminLink) adminLink.style.display = "none";
  if (loginLink) loginLink.style.display = "inline-flex";
  if (menuName) menuName.textContent = "";
  if (menuEmail) menuEmail.textContent = "";
  navLoginLinks.forEach(el => el.style.display = "inline-flex");
}

async function isAdminUser(user) {
  if (!user || !firebase.ready || !firebase.doc || !firebase.getDoc || !firebase.db) return false;
  try {
    const ref = firebase.doc(firebase.db, "admins", user.uid);
    const snap = await firebase.getDoc(ref);
    if (snap.exists()) return true;
  } catch {
    // ignore
  }
  return false;
}

function handleAuthState(user) {
  document.documentElement.classList.add("auth-ready");
  if (user) {
    const name = user.displayName || user.email || "Compte";
    const initial = (user.displayName || user.email || "U").trim().charAt(0).toUpperCase();
    const email = user.email || "";
    renderHeaderForUser({ name, email, initial, isAdmin: false });
    writeUiCache({ name, email, initial, isAdmin: false });

    // Do not block header rendering with network requests.
    if (firebase.ready && firebase.doc && firebase.setDoc && firebase.db) {
      firebase.setDoc(firebase.doc(firebase.db, "users", user.uid), {
        name: user.displayName || "Client",
        email,
        lastLoginAt: new Date().toISOString(),
        isOnline: true,
        lastSeenAt: new Date().toISOString()
      }, { merge: true }).catch(() => {
        // ignore
      });
    }

    isAdminUser(user).then((isAdmin) => {
      const adminBadge = document.querySelector("#adminBadge");
      const adminLink = document.querySelector("#adminLink");
      if (adminBadge) adminBadge.style.display = isAdmin ? "inline-flex" : "none";
      if (adminLink) adminLink.style.display = isAdmin ? "inline-flex" : "none";
      writeUiCache({ name, email, initial, isAdmin });
    }).catch(() => {
      // ignore
    });
  } else {
    renderHeaderLoggedOut();
    clearUiCache();
  }
}

async function initFirebase() {
  try {
    const [{ initializeApp, getApps, getApp }, { getAuth, onAuthStateChanged, signOut }, { getFirestore, doc, getDoc, setDoc, updateDoc }] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
    ]);

    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    firebase.auth = getAuth(app);
    firebase.db = getFirestore(app);
    firebase.onAuthStateChanged = onAuthStateChanged;
    firebase.signOut = signOut;
    firebase.doc = doc;
    firebase.getDoc = getDoc;
    firebase.setDoc = setDoc;
    firebase.updateDoc = updateDoc;
    firebase.ready = true;

    firebase.onAuthStateChanged(firebase.auth, handleAuthState);
  } catch {
    // Keep cached/local header if Firebase is unavailable.
    document.documentElement.classList.add("auth-ready");
  }
}

const cachedView = readUiCache();
if (cachedView?.email && cachedView?.name) {
  renderHeaderForUser({
    name: cachedView.name,
    email: cachedView.email,
    initial: cachedView.initial || "U",
    isAdmin: cachedView.isAdmin === true
  });
} else {
  renderHeaderLoggedOut();
}

initFirebase();

// Best-effort presence (set offline)
window.addEventListener("beforeunload", async () => {
  if (!firebase.ready || !firebase.auth || !firebase.doc || !firebase.updateDoc || !firebase.db) return;
  const u = firebase.auth.currentUser;
  if (!u) return;
  try {
    await firebase.updateDoc(firebase.doc(firebase.db, "users", u.uid), {
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
    logoutBtn.addEventListener("click", performSignOut);
  }
});
