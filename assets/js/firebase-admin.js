import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  doc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

let lastFilteredOrders = [];
let allUsers = [];
let unsubscribeUsers = null;

function qs(sel, parent = document) {
  return parent.querySelector(sel);
}

function toCsv(rows) {
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return rows.map((r) => r.map(escape).join(",")).join("\n");
}

function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "string") {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date ? d.getTime() : 0;
  }
  if (typeof value.seconds === "number") {
    return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000);
  }
  return 0;
}

function formatDate(value) {
  const ms = toMillis(value);
  return ms ? new Date(ms).toLocaleString() : "-";
}

function toDayKey(value) {
  const ms = toMillis(value);
  return ms ? new Date(ms).toISOString().slice(0, 10) : "";
}

function setListMessage(container, text, isError = false) {
  if (!container) return;
  container.innerHTML = `<div class="${isError ? "error" : "muted"}">${text}</div>`;
}

async function loadProducts() {
  const snap = await getDocs(collection(db, "products"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function logAdmin(action, details = {}) {
  try {
    await addDoc(collection(db, "admin_logs"), {
      action,
      details,
      adminEmail: window.currentUserEmail || "",
      createdAt: serverTimestamp()
    });
  } catch {
    // non bloquant
  }
}

async function renderProducts() {
  const list = qs("#adminProductList");
  if (!list) return;

  try {
    const products = await loadProducts();
    const query = (qs("#productSearch")?.value || "").toLowerCase();
    const status = qs("#productStatusFilter")?.value || "all";

    const filtered = products.filter((p) => {
      const matchesQuery = (p.name || "").toLowerCase().includes(query);
      const matchesStatus = status === "all" || (p.status || "in") === status;
      return matchesQuery && matchesStatus;
    });

    if (!filtered.length) {
      setListMessage(list, "Aucun produit.");
      return;
    }

    list.innerHTML = filtered.map((p) => `
      <div class="product-row">
        <div>
          <strong>${p.name || ""}</strong>
          <div class="muted">${p.category || "-"} - ${p.status || "in"}</div>
        </div>
        <div>
          <button class="btn small" data-edit="${p.id}">Edit</button>
          <button class="btn small" data-delete="${p.id}">Del</button>
        </div>
      </div>
    `).join("");

    document.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await deleteDoc(doc(db, "products", btn.dataset.delete));
          await logAdmin("product_delete", { id: btn.dataset.delete });
          await renderProducts();
        } catch {
          alert("Suppression impossible (droits Firebase ou connexion).");
        }
      });
    });

    document.querySelectorAll("[data-edit]").forEach((btn) => {
      const p = products.find((x) => x.id === btn.dataset.edit);
      if (!p) return;
      btn.addEventListener("click", () => {
        qs("#pName").value = p.name || "";
        qs("#pPrice").value = p.price || 0;
        qs("#pStock").value = p.qty || 0;
        qs("#pCategory").value = p.category || "";
        qs("#pImage").value = p.image || "";
        qs("#pStatus").value = p.status || "in";
        qs("#pDesc").value = p.description || "";

        const preview = qs("#pImagePreview");
        if (preview) {
          if (p.image) {
            preview.src = p.image;
            preview.style.display = "block";
          } else {
            preview.style.display = "none";
          }
        }

        qs("#saveProduct").dataset.edit = p.id;
      });
    });
  } catch {
    setListMessage(list, "Erreur chargement produits (verifiez droits admin Firestore).", true);
  }
}

async function uploadImage() {
  const file = qs("#pImageFile")?.files?.[0];
  if (!file) return;

  try {
    const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "")}`;
    const fileRef = ref(storage, `products/${safeName}`);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);

    qs("#pImage").value = url;
    const preview = qs("#pImagePreview");
    if (preview) {
      preview.src = url;
      preview.style.display = "block";
    }
  } catch {
    alert("Upload image impossible (storage rules ou connexion).");
  }
}

async function saveProduct() {
  const saveBtn = qs("#saveProduct");
  if (!saveBtn) return;

  const id = saveBtn.dataset.edit;
  const product = {
    name: qs("#pName")?.value.trim() || "",
    price: Number(qs("#pPrice")?.value || 0),
    qty: Number(qs("#pStock")?.value || 0),
    category: qs("#pCategory")?.value.trim() || "",
    image: qs("#pImage")?.value.trim() || "",
    status: qs("#pStatus")?.value || "in",
    description: qs("#pDesc")?.value.trim() || "",
    updatedAt: serverTimestamp()
  };

  if (!product.name) {
    alert("Le nom du produit est obligatoire.");
    return;
  }

  try {
    if (id) {
      await updateDoc(doc(db, "products", id), product);
      await logAdmin("product_update", { id, name: product.name });
    } else {
      product.createdAt = serverTimestamp();
      await addDoc(collection(db, "products"), product);
      await logAdmin("product_create", { name: product.name });
    }

    saveBtn.dataset.edit = "";
    qs("#pName").value = "";
    qs("#pPrice").value = "";
    qs("#pStock").value = "";
    qs("#pCategory").value = "";
    qs("#pImage").value = "";
    qs("#pStatus").value = "in";
    qs("#pDesc").value = "";
    const preview = qs("#pImagePreview");
    if (preview) preview.style.display = "none";

    await renderProducts();
  } catch {
    alert("Enregistrement impossible (droits Firebase ou connexion).");
  }
}

function bindProductForm() {
  const saveBtn = qs("#saveProduct");
  const resetBtn = qs("#resetProduct");
  const uploadBtn = qs("#uploadImageBtn");

  if (saveBtn) saveBtn.addEventListener("click", saveProduct);
  if (uploadBtn) uploadBtn.addEventListener("click", uploadImage);
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      qs("#saveProduct").dataset.edit = "";
      qs("#pName").value = "";
      qs("#pPrice").value = "";
      qs("#pStock").value = "";
      qs("#pCategory").value = "";
      qs("#pImage").value = "";
      qs("#pStatus").value = "in";
      qs("#pDesc").value = "";
      const preview = qs("#pImagePreview");
      if (preview) preview.style.display = "none";
    });
  }
}

async function renderOrders() {
  const box = qs("#adminOrders");
  if (!box) return;

  try {
    const snap = await getDocs(collection(db, "orders"));
    const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const query = (qs("#orderSearch")?.value || "").toLowerCase();
    const statusFilter = qs("#orderStatusFilter")?.value || "all";

    const filtered = orders.filter((o) => {
      const matchesQuery =
        (o.id || "").toLowerCase().includes(query) ||
        (o.customer?.name || "").toLowerCase().includes(query) ||
        (o.customer?.email || "").toLowerCase().includes(query);
      const matchesStatus = statusFilter === "all" || (o.status || "new") === statusFilter;
      return matchesQuery && matchesStatus;
    });

    filtered.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    lastFilteredOrders = filtered;

    if (!filtered.length) {
      setListMessage(box, "Aucune commande.");
      return;
    }

    box.innerHTML = filtered.map((o) => {
      const phone = (o.customer?.phone || "").replace(/\D/g, "");
      const orderStatus = o.status || "new";
      const messages = {
        new: `Bonjour ${o.customer?.name || ""}, votre commande ${o.id} a bien ete recue. Merci.`,
        processing: `Bonjour ${o.customer?.name || ""}, votre commande ${o.id} est en cours de traitement.`,
        delivered: `Bonjour ${o.customer?.name || ""}, votre commande ${o.id} a ete livree. Merci.`,
        cancelled: `Bonjour ${o.customer?.name || ""}, votre commande ${o.id} a ete annulee. Contactez-nous si besoin.`
      };
      const waMsg = messages[orderStatus] || messages.processing;
      const wa = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(waMsg)}` : "";

      return `
        <div class="card">
          <div><strong>${o.id}</strong></div>
          <div>${(o.items || []).length} article(s) - ${o.total || 0} FCFA</div>
          <div class="muted">${o.customer?.name || ""} - ${o.payment || ""}</div>
          <div class="muted">${formatDate(o.createdAt)}</div>
          <div style="margin-top:8px;">
            <select class="input" data-order-status="${o.id}">
              <option value="new" ${(orderStatus === "new") ? "selected" : ""}>Nouveau</option>
              <option value="processing" ${(orderStatus === "processing") ? "selected" : ""}>En cours</option>
              <option value="delivered" ${(orderStatus === "delivered") ? "selected" : ""}>Livre</option>
              <option value="cancelled" ${(orderStatus === "cancelled") ? "selected" : ""}>Annule</option>
            </select>
          </div>
          ${wa ? `<a class="btn small" href="${wa}" target="_blank" rel="noopener" style="margin-top:8px;">WhatsApp client</a>` : ""}
        </div>
      `;
    }).join("");

    document.querySelectorAll("[data-order-status]").forEach((sel) => {
      sel.addEventListener("change", async () => {
        const id = sel.getAttribute("data-order-status");
        try {
          await updateDoc(doc(db, "orders", id), { status: sel.value });
          await logAdmin("order_status", { id, status: sel.value });
        } catch {
          alert("Mise a jour statut impossible.");
        }
      });
    });
  } catch {
    setListMessage(box, "Erreur chargement commandes (droits admin requis).", true);
  }
}

function renderUsers() {
  const box = qs("#adminUsers");
  if (!box) return;

  try {
    const query = (qs("#userSearch")?.value || "").toLowerCase();
    const status = qs("#userStatusFilter")?.value || "all";

    const filtered = allUsers.filter((u) => {
      const matchesQuery = (u.name || "").toLowerCase().includes(query) || (u.email || "").toLowerCase().includes(query);
      const matchesStatus = status === "all" || (status === "banned" ? !!u.banned : !u.banned);
      return matchesQuery && matchesStatus;
    });

    filtered.sort((a, b) => toMillis(b.lastSeenAt || b.lastLoginAt) - toMillis(a.lastSeenAt || a.lastLoginAt));

    if (!filtered.length) {
      setListMessage(box, "Aucun utilisateur.");
    } else {
      box.innerHTML = filtered.map((u) => `
        <div class="card">
          <strong>${u.name || "Client"}</strong>
          <div>${u.email || ""}</div>
          <div class="muted">Statut: ${u.banned ? "Banni" : "Actif"}</div>
          <div class="muted">En ligne: ${u.isOnline ? "Oui" : "Non"}</div>
          <div class="muted">Derniere connexion: ${formatDate(u.lastLoginAt)}</div>
          <div class="muted">Derniere activite: ${formatDate(u.lastSeenAt)}</div>
          <div class="muted">Par: ${u.bannedBy || "-"}</div>
          <div class="muted">Le: ${formatDate(u.bannedAt)}</div>
          <div style="margin-top:8px;">
            <button class="btn small" data-ban="${u.id}" data-state="${u.banned ? "unban" : "ban"}">
              ${u.banned ? "Debannir" : "Bannir"}
            </button>
            <button class="btn small" data-orders-email="${u.email || ""}">Voir commandes</button>
          </div>
        </div>
      `).join("");
    }

    document.querySelectorAll("[data-ban]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-ban");
        const next = btn.getAttribute("data-state") === "ban";
        try {
          await updateDoc(doc(db, "users", id), {
            banned: next,
            bannedBy: window.currentUserEmail || "",
            bannedAt: next ? new Date().toISOString() : null
          });
          await logAdmin("user_ban", { id, banned: next });
        } catch {
          alert("Action bannir/debannir impossible.");
        }
      });
    });

    const ordersBox = qs("#userOrders");
    document.querySelectorAll("[data-orders-email]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const email = (btn.getAttribute("data-orders-email") || "").toLowerCase();
        if (!ordersBox || !email) return;

        ordersBox.innerHTML = "Chargement...";
        try {
          const orderSnap = await getDocs(collection(db, "orders"));
          const orders = orderSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          const filteredOrders = orders.filter((o) => (o.customer?.email || "").toLowerCase() === email);

          ordersBox.innerHTML = filteredOrders.length ? filteredOrders.map((o) => `
            <div class="card">
              <div><strong>${o.id}</strong></div>
              <div>${(o.items || []).length} article(s) - ${o.total || 0} FCFA</div>
              <div class="muted">${o.payment || ""} - ${o.status || "new"}</div>
              <div class="muted">${formatDate(o.createdAt)}</div>
            </div>
          `).join("") : "Aucune commande pour cet utilisateur.";
        } catch {
          ordersBox.innerHTML = "Erreur chargement commandes utilisateur.";
        }
      });
    });

    const recentBox = qs("#recentUsers");
    if (recentBox) {
      const recent = allUsers
        .filter((u) => toMillis(u.lastSeenAt || u.lastLoginAt) > 0)
        .sort((a, b) => toMillis(b.lastSeenAt || b.lastLoginAt) - toMillis(a.lastSeenAt || a.lastLoginAt))
        .slice(0, 5);

      recentBox.innerHTML = recent.length ? recent.map((u) => `
        <div class="card">
          <strong>${u.name || "Client"}</strong>
          <div>${u.email || ""}</div>
          <div class="muted">Derniere activite: ${formatDate(u.lastSeenAt || u.lastLoginAt)}</div>
        </div>
      `).join("") : "Aucun utilisateur recent.";
    }
  } catch {
    setListMessage(box, "Erreur chargement utilisateurs (droits admin requis).", true);
  }
}

function startUsersRealtime() {
  const box = qs("#adminUsers");
  if (!box) return;
  if (unsubscribeUsers) return;

  unsubscribeUsers = onSnapshot(
    collection(db, "users"),
    (snap) => {
      allUsers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderUsers();
    },
    () => {
      setListMessage(box, "Erreur temps reel utilisateurs (droits admin requis).", true);
    }
  );
}

window.addEventListener("beforeunload", () => {
  if (unsubscribeUsers) {
    unsubscribeUsers();
    unsubscribeUsers = null;
  }
});

async function renderAdminLogs() {
  const box = qs("#adminLogs");
  if (!box) return;

  try {
    const snap = await getDocs(collection(db, "admin_logs"));
    const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    logs.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    const recent = logs.slice(0, 20);

    if (!recent.length) {
      setListMessage(box, "Aucun log.");
      return;
    }

    box.innerHTML = recent.map((l) => `
      <div class="card">
        <strong>${l.action || "action"}</strong>
        <div class="muted">${l.adminEmail || ""}</div>
        <div class="muted">${formatDate(l.createdAt)}</div>
      </div>
    `).join("");
  } catch {
    setListMessage(box, "Erreur chargement historique admin.", true);
  }
}

async function renderStats() {
  const statOrders = qs("#statOrders");
  const statSales = qs("#statSales");
  const statUsers = qs("#statUsers");
  const statBasket = qs("#statBasket");
  const statProducts = qs("#statProducts");
  const statOut = qs("#statOut");

  if (!statOrders && !statSales && !statUsers && !statBasket && !statProducts && !statOut) return;

  try {
    const [ordersSnap, productsSnap, usersSnap] = await Promise.all([
      getDocs(collection(db, "orders")),
      getDocs(collection(db, "products")),
      getDocs(collection(db, "users"))
    ]);

    const orders = ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const products = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const sales = orders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const avg = orders.length ? Math.round(sales / orders.length) : 0;
    const out = products.filter((p) => (p.status || "in") === "out").length;

    if (statOrders) statOrders.textContent = String(orders.length);
    if (statSales) statSales.textContent = `${sales} FCFA`;
    if (statUsers) statUsers.textContent = String(users.length);
    if (statBasket) statBasket.textContent = `${avg} FCFA`;
    if (statProducts) statProducts.textContent = String(products.length);
    if (statOut) statOut.textContent = String(out);

    const salesByDay = qs("#salesByDay");
    const salesChartCanvas = qs("#salesChartCanvas");
    if (!salesByDay) return;

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }

    const totals = Object.fromEntries(days.map((d) => [d, 0]));
    orders.forEach((o) => {
      const key = toDayKey(o.createdAt);
      if (key && Object.prototype.hasOwnProperty.call(totals, key)) {
        totals[key] += (Number(o.total) || 0);
      }
    });

    salesByDay.innerHTML = days.map((d) => `
      <div class="card">
        <strong>${d}</strong>
        <div>${totals[d]} FCFA</div>
      </div>
    `).join("");

    if (salesChartCanvas && window.Chart) {
      const ctx = salesChartCanvas.getContext("2d");
      if (window.__salesChart) window.__salesChart.destroy();
      window.__salesChart = new Chart(ctx, {
        type: "bar",
        data: {
          labels: days,
          datasets: [{
            label: "Ventes (FCFA)",
            data: days.map((d) => totals[d]),
            backgroundColor: "rgba(27,107,75,0.7)"
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false } },
            y: { grid: { color: "rgba(0,0,0,0.1)" } }
          }
        }
      });
    }
  } catch {
    if (statOrders) statOrders.textContent = "Erreur";
    if (statSales) statSales.textContent = "Erreur";
    if (statUsers) statUsers.textContent = "Erreur";
    if (statBasket) statBasket.textContent = "Erreur";
    if (statProducts) statProducts.textContent = "Erreur";
    if (statOut) statOut.textContent = "Erreur";
  }
}

function bindOrderExport() {
  const exportBtn = qs("#exportOrdersBtn");
  if (!exportBtn) return;

  exportBtn.addEventListener("click", async () => {
    try {
      const orders = lastFilteredOrders.length
        ? lastFilteredOrders
        : (await getDocs(collection(db, "orders"))).docs.map((d) => ({ id: d.id, ...d.data() }));

      const rows = [
        ["id", "total", "payment", "status", "customer_name", "customer_email", "customer_phone", "createdAt"],
        ...orders.map((o) => [
          o.id,
          Number(o.total) || 0,
          o.payment || "",
          o.status || "",
          o.customer?.name || "",
          o.customer?.email || "",
          o.customer?.phone || "",
          formatDate(o.createdAt)
        ])
      ];
      downloadCsv("orders.csv", toCsv(rows));
    } catch {
      alert("Export commandes impossible.");
    }
  });
}

function bindUserExport() {
  const exportBtn = qs("#exportUsersBtn");
  if (!exportBtn) return;

  exportBtn.addEventListener("click", async () => {
    try {
      const snap = await getDocs(collection(db, "users"));
      const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const rows = [
        ["id", "name", "email", "phone", "banned", "lastLoginAt", "lastSeenAt", "bannedBy", "bannedAt"],
        ...users.map((u) => [
          u.id,
          u.name || "",
          u.email || "",
          u.phone || "",
          u.banned ? "true" : "false",
          formatDate(u.lastLoginAt),
          formatDate(u.lastSeenAt),
          u.bannedBy || "",
          formatDate(u.bannedAt)
        ])
      ];
      downloadCsv("users.csv", toCsv(rows));
    } catch {
      alert("Export utilisateurs impossible.");
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  const hasProducts = !!qs("#adminProductList");
  const hasOrders = !!qs("#adminOrders");
  const hasUsers = !!qs("#adminUsers");
  const hasStats = !!qs("#statOrders") || !!qs("#statBasket") || !!qs("#salesByDay");
  const hasLogs = !!qs("#adminLogs");

  if (hasProducts) {
    bindProductForm();
    renderProducts();
    qs("#productSearch")?.addEventListener("input", renderProducts);
    qs("#productStatusFilter")?.addEventListener("change", renderProducts);
  }

  if (hasOrders) {
    renderOrders();
    qs("#orderSearch")?.addEventListener("input", renderOrders);
    qs("#orderStatusFilter")?.addEventListener("change", renderOrders);
    bindOrderExport();
  }

  if (hasUsers) {
    startUsersRealtime();
    qs("#userSearch")?.addEventListener("input", () => renderUsers());
    qs("#userStatusFilter")?.addEventListener("change", () => renderUsers());
    bindUserExport();
  }

  if (hasStats) renderStats();
  if (hasLogs) renderAdminLogs();
});
