import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  getDoc,
  doc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  onSnapshot,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
let lastFilteredOrders = [];

function qs(sel, parent = document) { return parent.querySelector(sel); }

function toCsv(rows) {
  const escape = (v) => `"${String(v ?? "").replace(/"/g, "\"\"")}"`;
  return rows.map(r => r.map(escape).join(",")).join("\n");
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

async function loadProducts() {
  const snap = await getDocs(collection(db, "products"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function logAdmin(action, details = {}) {
  const adminEmail = (window?.currentUserEmail || "");
  try {
    await addDoc(collection(db, "admin_logs"), {
      action,
      details,
      adminEmail,
      createdAt: serverTimestamp()
    });
  } catch {
    // ignore
  }
}

async function renderProducts() {
  const list = qs("#adminProductList");
  if (!list) return;
  const products = await loadProducts();
  const query = (qs("#productSearch")?.value || "").toLowerCase();
  const status = qs("#productStatusFilter")?.value || "all";
  const filtered = products.filter(p => {
    const matchesQuery = (p.name || "").toLowerCase().includes(query);
    const matchesStatus = status === "all" || p.status === status;
    return matchesQuery && matchesStatus;
  });
  list.innerHTML = filtered.map(p => `
    <div class="product-row">
      <div>
        <strong>${p.name || ""}</strong>
        <div class="muted">${p.category || ""} - ${p.status || "in"}</div>
      </div>
      <div>
        <button class="btn small" data-edit="${p.id}">Edit</button>
        <button class="btn small" data-delete="${p.id}">Del</button>
      </div>
    </div>
  `).join("");

  document.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await deleteDoc(doc(db, "products", btn.dataset.delete));
      await logAdmin("product_delete", { id: btn.dataset.delete });
      renderProducts();
    });
  });

  document.querySelectorAll("[data-edit]").forEach(btn => {
    const p = products.find(x => x.id === btn.dataset.edit);
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
}

async function uploadImage() {
  const file = qs("#pImageFile")?.files?.[0];
  if (!file) return;
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
}

async function saveProduct() {
  const id = qs("#saveProduct").dataset.edit;
  const product = {
    name: qs("#pName").value.trim(),
    price: Number(qs("#pPrice").value || 0),
    qty: Number(qs("#pStock").value || 0),
    category: qs("#pCategory").value.trim(),
    image: qs("#pImage").value.trim(),
    status: qs("#pStatus").value,
    description: qs("#pDesc").value.trim(),
    updatedAt: serverTimestamp()
  };
  if (id) {
    await updateDoc(doc(db, "products", id), product);
    await logAdmin("product_update", { id, name: product.name });
  } else {
    product.createdAt = serverTimestamp();
    await addDoc(collection(db, "products"), product);
    await logAdmin("product_create", { name: product.name });
  }
  qs("#saveProduct").dataset.edit = "";
  qs("#pName").value = "";
  qs("#pPrice").value = "";
  qs("#pStock").value = "";
  qs("#pCategory").value = "";
  qs("#pImage").value = "";
  qs("#pStatus").value = "in";
  qs("#pDesc").value = "";
  renderProducts();
}

function bindProductForm() {
  const saveBtn = qs("#saveProduct");
  const resetBtn = qs("#resetProduct");
  const uploadBtn = qs("#uploadImageBtn");
  if (saveBtn) saveBtn.addEventListener("click", saveProduct);
  if (uploadBtn) uploadBtn.addEventListener("click", uploadImage);
  if (resetBtn) resetBtn.addEventListener("click", () => {
    qs("#saveProduct").dataset.edit = "";
    qs("#pName").value = "";
    qs("#pPrice").value = "";
    qs("#pStock").value = "";
    qs("#pCategory").value = "";
    qs("#pImage").value = "";
    const preview = qs("#pImagePreview");
    if (preview) preview.style.display = "none";
    qs("#pStatus").value = "in";
    qs("#pDesc").value = "";
  });
}

async function renderOrders() {
  const box = qs("#adminOrders");
  if (!box) return;
  const snap = await getDocs(collection(db, "orders"));
  const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const query = (qs("#orderSearch")?.value || "").toLowerCase();
  const status = qs("#orderStatusFilter")?.value || "all";
  const filtered = orders.filter(o => {
    const matchesQuery = (o.id || "").toLowerCase().includes(query) ||
      (o.customer?.name || "").toLowerCase().includes(query) ||
      (o.customer?.email || "").toLowerCase().includes(query);
    const matchesStatus = status === "all" || (o.status || "new") === status;
    return matchesQuery && matchesStatus;
  });
  lastFilteredOrders = filtered;
  box.innerHTML = filtered.length ? filtered.map(o => {
    const phone = (o.customer?.phone || "").replace(/\\D/g, "");
    const status = o.status || "new";
    const messages = {
      new: `Bonjour ${o.customer?.name || ""}, votre commande ${o.id} a bien ete recue. Merci.`,
      processing: `Bonjour ${o.customer?.name || ""}, votre commande ${o.id} est en cours de traitement.`,
      delivered: `Bonjour ${o.customer?.name || ""}, votre commande ${o.id} a ete livree. Merci.`,
      cancelled: `Bonjour ${o.customer?.name || ""}, votre commande ${o.id} a ete annulee. Contactez-nous si besoin.`
    };
    const waMsg = messages[status] || messages.processing;
    const wa = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(waMsg)}` : "";
    return `
    <div class="card">
      <div><strong>${o.id}</strong></div>
      <div>${(o.items || []).length} article(s) - ${o.total || 0} FCFA</div>
      <div class="muted">${o.customer?.name || ""} - ${o.payment || ""}</div>
      <div style="margin-top:8px;">
        <select class="input" data-order-status="${o.id}">
          <option value="new" ${((o.status || "new") === "new") ? "selected" : ""}>Nouveau</option>
          <option value="processing" ${o.status === "processing" ? "selected" : ""}>En cours</option>
          <option value="delivered" ${o.status === "delivered" ? "selected" : ""}>Livre</option>
          <option value="cancelled" ${o.status === "cancelled" ? "selected" : ""}>Annule</option>
        </select>
      </div>
      ${wa ? `<a class="btn small" href="${wa}" target="_blank" style="margin-top:8px;">WhatsApp client</a>` : ""}
    </div>
  `;
  }).join("") : "Aucune commande.";

  document.querySelectorAll("[data-order-status]").forEach(sel => {
    sel.addEventListener("change", async () => {
      const id = sel.getAttribute("data-order-status");
      await updateDoc(doc(db, "orders", id), { status: sel.value });
      await logAdmin("order_status", { id, status: sel.value });
    });
  });
}

async function renderUsers() {
  const box = qs("#adminUsers");
  if (!box) return;
  const snap = await getDocs(collection(db, "users"));
  const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const query = (qs("#userSearch")?.value || "").toLowerCase();
  const status = qs("#userStatusFilter")?.value || "all";
  const filtered = users.filter(u => {
    const matchesQuery = (u.name || "").toLowerCase().includes(query) || (u.email || "").toLowerCase().includes(query);
    const matchesStatus = status === "all" || (status === "banned" ? !!u.banned : !u.banned);
    return matchesQuery && matchesStatus;
  });
  box.innerHTML = filtered.length ? filtered.map(u => `
    <div class="card">
      <strong>${u.name || "Client"}</strong>
      <div>${u.email || ""}</div>
      <div class="muted">Statut: ${u.banned ? "Banni" : "Actif"}</div>
      <div class="muted">En ligne: ${u.isOnline ? "Oui" : "Non"}</div>
      <div class="muted">Derniere connexion: ${u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "-"}</div>
      <div class="muted">Derniere activite: ${u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : "-"}</div>
      <div class="muted">Par: ${u.bannedBy || "-"}</div>
      <div class="muted">Le: ${u.bannedAt ? new Date(u.bannedAt).toLocaleString() : "-"}</div>
      <div style="margin-top:8px;">
        <button class="btn small" data-ban="${u.id}" data-state="${u.banned ? "unban" : "ban"}">
          ${u.banned ? "Debannir" : "Bannir"}
        </button>
        <button class="btn small" data-orders-email="${u.email || ""}">Voir commandes</button>
      </div>
    </div>
  `).join("") : "Aucun utilisateur.";

  document.querySelectorAll("[data-ban]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-ban");
      const next = btn.getAttribute("data-state") === "ban";
      const adminEmail = (window?.currentUserEmail || "");
      await updateDoc(doc(db, "users", id), {
        banned: next,
        bannedBy: adminEmail,
        bannedAt: next ? new Date().toISOString() : null
      });
      await logAdmin("user_ban", { id, banned: next });
      renderUsers();
    });
  });

  // Per-user orders
  const ordersBox = qs("#userOrders");
  document.querySelectorAll("[data-orders-email]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const email = btn.getAttribute("data-orders-email");
      if (!ordersBox) return;
      ordersBox.innerHTML = "Chargement...";
      const snap = await getDocs(collection(db, "orders"));
      const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const filteredOrders = orders.filter(o => (o.customer?.email || "") === email);
      ordersBox.innerHTML = filteredOrders.length ? filteredOrders.map(o => `
        <div class="card">
          <div><strong>${o.id}</strong></div>
          <div>${(o.items || []).length} article(s) - ${o.total || 0} FCFA</div>
          <div class="muted">${o.payment || ""} - ${o.status || "new"}</div>
        </div>
      `).join("") : "Aucune commande pour cet utilisateur.";
    });
  });

  // Recent active users
  const recentBox = qs("#recentUsers");
  if (recentBox) {
    const recent = [...users]
      .filter(u => u.lastSeenAt || u.lastLoginAt)
      .sort((a, b) => {
        const ta = new Date(a.lastSeenAt || a.lastLoginAt || 0).getTime();
        const tb = new Date(b.lastSeenAt || b.lastLoginAt || 0).getTime();
        return tb - ta;
      })
      .slice(0, 5);
    recentBox.innerHTML = recent.length ? recent.map(u => `
      <div class="card">
        <strong>${u.name || "Client"}</strong>
        <div>${u.email || ""}</div>
        <div class="muted">Derniere activite: ${u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : "-"}</div>
      </div>
    `).join("") : "Aucun utilisateur recent.";
  }
}

async function renderAdminLogs() {
  const box = qs("#adminLogs");
  if (!box) return;
  const snap = await getDocs(collection(db, "admin_logs"));
  const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const sorted = logs.sort((a, b) => {
    const ta = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0;
    const tb = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0;
    return tb - ta;
  }).slice(0, 20);
  box.innerHTML = sorted.length ? sorted.map(l => `
    <div class="card">
      <strong>${l.action}</strong>
      <div class="muted">${l.adminEmail || ""}</div>
      <div class="muted">${l.createdAt?.seconds ? new Date(l.createdAt.seconds * 1000).toLocaleString() : ""}</div>
    </div>
  `).join("") : "Aucun log.";
}

async function renderChats() {
  const list = qs("#chatSessions");
  const messagesBox = qs("#chatMessages");
  const input = qs("#adminChatInput");
  const sendBtn = qs("#adminChatSend");
  if (!list || !messagesBox) return;
  const seenMap = getChatSeenMap();
  const snap = await getDocs(collection(db, "chats"));
  const chats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  list.innerHTML = chats.length ? chats.map(c => `
    <div class="card">
      <strong>${c.id}</strong>
      <div class="muted">Statut: ${c.status || "bot"}</div>
      ${isNewChatMessage(c, seenMap) ? `<span class="pill alert">Nouveau message</span>` : ""}
      <button class="btn small" data-chat="${c.id}">Voir messages</button>
    </div>
  `).join("") : "Aucun chat.";

  document.querySelectorAll("[data-chat]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const chatId = btn.getAttribute("data-chat");
      window.currentChatId = chatId;
      messagesBox.innerHTML = "Chargement...";
      const msgSnap = await getDocs(collection(db, "chats", chatId, "messages"));
      const msgs = msgSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
      messagesBox.innerHTML = msgs.length ? msgs.map(m => `
        <div class="card">
          <strong>${m.sender || "user"} ${m.sender === "ai" ? "<span class='pill alert'>IA</span>" : ""}</strong>
          <div>${m.text || ""}</div>
          <div class="muted">${m.createdAt || ""}</div>
        </div>
      `).join("") : "Aucun message.";
      markChatSeen(chatId);
      renderChats();
    });
  });

  if (sendBtn && input) {
    sendBtn.onclick = async () => {
      const chatId = window.currentChatId;
      const text = input.value.trim();
      if (!chatId || !text) return;
      await addDoc(collection(db, "chats", chatId, "messages"), {
        text,
        sender: "admin",
        createdAt: new Date().toISOString()
      });
      await updateDoc(doc(db, "chats", chatId), {
        lastMessageAt: new Date().toISOString(),
        lastMessageSender: "admin",
        lastMessageText: text
      });
      input.value = "";
      renderChats();
    };
  }
}

async function renderFaq() {
  const list = qs("#faqList");
  const filter = qs("#faqCategoryFilter");
  if (!list) return;
  const snap = await getDocs(collection(db, "faq"));
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  if (filter) {
    const cats = [...new Set(items.map(i => (i.category || "").trim()).filter(Boolean))].sort();
    const current = filter.value || "all";
    filter.innerHTML = [`<option value="all">Toutes les categories</option>`, ...cats.map(c => `<option value="${c}">${c}</option>`)].join("");
    filter.value = cats.includes(current) ? current : "all";
  }

  const activeCat = filter?.value || "all";
  const visible = activeCat === "all" ? items : items.filter(i => (i.category || "") === activeCat);

  list.innerHTML = visible.length ? visible.map(f => `
    <div class="card">
      <strong>${f.question || ""}</strong>
      <div class="muted">${f.answer || ""}</div>
      <div class="muted">Categorie: ${f.category || "-"}</div>
      <div class="muted">Score: ${f.score || 0}</div>
      <div style="margin-top:8px;">
        <button class="btn small" data-faq-edit="${f.id}">Editer</button>
        <button class="btn small" data-faq-up="${f.id}">+1 Score</button>
        <button class="btn small" data-faq-del="${f.id}">Supprimer</button>
      </div>
    </div>
  `).join("") : "Aucune FAQ.";

  document.querySelectorAll("[data-faq-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await deleteDoc(doc(db, "faq", btn.getAttribute("data-faq-del")));
      renderFaq();
    });
  });

  document.querySelectorAll("[data-faq-up]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-faq-up");
      const current = items.find(i => i.id === id)?.score || 0;
      await updateDoc(doc(db, "faq", id), { score: current + 1 });
      renderFaq();
    });
  });

  document.querySelectorAll("[data-faq-edit]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-faq-edit");
      const item = items.find(i => i.id === id);
      if (!item) return;
      qs("#faqQuestion").value = item.question || "";
      qs("#faqAnswer").value = item.answer || "";
      qs("#faqCategory").value = item.category || "";
      qs("#faqScore").value = item.score || 0;
      qs("#faqSave").dataset.edit = id;
    });
  });
}

function bindFaqForm() {
  const q = qs("#faqQuestion");
  const a = qs("#faqAnswer");
  const c = qs("#faqCategory");
  const s = qs("#faqScore");
  const save = qs("#faqSave");
  const filter = qs("#faqCategoryFilter");
  if (!save) return;
  save.addEventListener("click", async () => {
    if (!q.value.trim() || !a.value.trim()) return;
    const payload = {
      question: q.value.trim(),
      answer: a.value.trim(),
      category: c?.value.trim() || "",
      score: Number(s?.value || 0),
      updatedAt: serverTimestamp()
    };
    const editId = save.dataset.edit;
    if (editId) {
      await updateDoc(doc(db, "faq", editId), payload);
      save.dataset.edit = "";
    } else {
      payload.createdAt = serverTimestamp();
      await addDoc(collection(db, "faq"), payload);
    }
    q.value = "";
    a.value = "";
    if (c) c.value = "";
    if (s) s.value = 0;
    renderFaq();
  });
  filter?.addEventListener("change", renderFaq);
}

async function renderStats() {
  const statOrders = qs("#statOrders");
  const statSales = qs("#statSales");
  const statUsers = qs("#statUsers");
  const statBasket = qs("#statBasket");
  const statProducts = qs("#statProducts");
  const statOut = qs("#statOut");
  if (!statOrders && !statSales && !statUsers && !statBasket && !statProducts && !statOut) return;

  const [ordersSnap, productsSnap, usersSnap] = await Promise.all([
    getDocs(collection(db, "orders")),
    getDocs(collection(db, "products")),
    getDocs(collection(db, "users"))
  ]);

  const orders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const products = productsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const sales = orders.reduce((sum, o) => sum + (o.total || 0), 0);
  const avg = orders.length ? Math.round(sales / orders.length) : 0;
  const out = products.filter(p => p.status === "out").length;

  if (statOrders) statOrders.textContent = orders.length;
  if (statSales) statSales.textContent = `${sales} FCFA`;
  if (statUsers) statUsers.textContent = users.length;
  if (statBasket) statBasket.textContent = `${avg} FCFA`;
  if (statProducts) statProducts.textContent = products.length;
  if (statOut) statOut.textContent = out;

  const salesByDay = qs("#salesByDay");
  const salesChartCanvas = qs("#salesChartCanvas");
  if (salesByDay) {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push(key);
    }
    const totals = Object.fromEntries(days.map(d => [d, 0]));
    orders.forEach(o => {
      const key = (o.createdAt || "").slice(0, 10);
      if (totals[key] != null) totals[key] += (o.total || 0);
    });
    salesByDay.innerHTML = days.map(d => `
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
            data: days.map(d => totals[d]),
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
  }
}

window.addEventListener("DOMContentLoaded", () => {
  bindProductForm();
  renderProducts();
  renderOrders();
  renderUsers();
  renderStats();
  renderAdminLogs();
  renderChats();
  renderFaq();
  bindFaqForm();
  renderChatbotSettings();
  bindChatbotSettings();
  bindChatNotifications();

  qs("#productSearch")?.addEventListener("input", renderProducts);
  qs("#productStatusFilter")?.addEventListener("change", renderProducts);
  qs("#orderSearch")?.addEventListener("input", renderOrders);
  qs("#orderStatusFilter")?.addEventListener("change", renderOrders);
  qs("#exportOrdersBtn")?.addEventListener("click", async () => {
    const orders = lastFilteredOrders.length ? lastFilteredOrders : (await getDocs(collection(db, "orders"))).docs.map(d => ({ id: d.id, ...d.data() }));
    const rows = [
      ["id", "total", "payment", "status", "customer_name", "customer_email", "customer_phone", "createdAt"],
      ...orders.map(o => [
        o.id,
        o.total || 0,
        o.payment || "",
        o.status || "",
        o.customer?.name || "",
        o.customer?.email || "",
        o.customer?.phone || "",
        o.createdAt || ""
      ])
    ];
    const csv = toCsv(rows);
    downloadCsv("orders.csv", csv);
  });
  qs("#userSearch")?.addEventListener("input", renderUsers);
  qs("#userStatusFilter")?.addEventListener("change", renderUsers);
  qs("#exportUsersBtn")?.addEventListener("click", async () => {
    const snap = await getDocs(collection(db, "users"));
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const rows = [
      ["id", "name", "email", "phone", "banned", "lastLoginAt", "lastSeenAt", "bannedBy", "bannedAt"],
      ...users.map(u => [
        u.id,
        u.name || "",
        u.email || "",
        u.phone || "",
        u.banned ? "true" : "false",
        u.lastLoginAt || "",
        u.lastSeenAt || "",
        u.bannedBy || "",
        u.bannedAt || ""
      ])
    ];
    const csv = toCsv(rows);
    downloadCsv("users.csv", csv);
  });
});

async function renderChatbotSettings() {
  const checkbox = qs("#aiEnabled");
  const status = qs("#aiStatus");
  if (!checkbox || !status) return;
  try {
    const snap = await getDoc(doc(db, "settings", "chatbot"));
    const data = snap.exists() ? snap.data() : {};
    checkbox.checked = !!data.aiEnabled;
    status.textContent = `Etat: ${checkbox.checked ? "active" : "desactive"}`;
  } catch {
    status.textContent = "Etat: erreur";
  }
}

function bindChatbotSettings() {
  const checkbox = qs("#aiEnabled");
  const save = qs("#aiSave");
  const status = qs("#aiStatus");
  if (!checkbox || !save || !status) return;
  save.addEventListener("click", async () => {
    try {
      await setDoc(doc(db, "settings", "chatbot"), {
        aiEnabled: checkbox.checked,
        updatedAt: serverTimestamp()
      }, { merge: true });
      status.textContent = `Etat: ${checkbox.checked ? "active" : "desactive"}`;
      await logAdmin("chatbot_ai_toggle", { aiEnabled: checkbox.checked });
    } catch {
      status.textContent = "Etat: erreur";
    }
  });
}

function getChatSeenMap() {
  try {
    return JSON.parse(localStorage.getItem("bf_chat_seen") || "{}");
  } catch {
    return {};
  }
}

function markChatSeen(chatId) {
  const seen = getChatSeenMap();
  seen[chatId] = new Date().toISOString();
  localStorage.setItem("bf_chat_seen", JSON.stringify(seen));
}

function isNewChatMessage(chat, seenMap) {
  if (!chat?.lastMessageAt || chat.lastMessageSender !== "user") return false;
  const seenAt = seenMap?.[chat.id];
  if (!seenAt) return true;
  return new Date(chat.lastMessageAt).getTime() > new Date(seenAt).getTime();
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => {
      osc.stop();
      ctx.close();
    }, 200);
  } catch {
    // ignore (autoplay restrictions)
  }
}

function bindChatNotifications() {
  const badge = qs("#chatBadge");
  const list = qs("#chatSessions");
  if (!list) return;
  const notifiedHuman = new Set();
  const notifiedMessage = {};

  onSnapshot(collection(db, "chats"), (snap) => {
    const chats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const humanCount = chats.filter(c => c.status === "human").length;
    if (badge) {
      badge.textContent = humanCount ? `${humanCount} humain` : "Nouveau";
      badge.style.display = humanCount ? "inline-flex" : "none";
      badge.classList.toggle("success", humanCount > 0);
    }

    snap.docChanges().forEach(change => {
      const c = { id: change.doc.id, ...change.doc.data() };
      if (c.status === "human" && !notifiedHuman.has(c.id)) {
        notifiedHuman.add(c.id);
        playNotificationSound();
      }
      if (c.lastMessageSender === "user" && c.lastMessageAt) {
        const last = notifiedMessage[c.id];
        if (last !== c.lastMessageAt) {
          notifiedMessage[c.id] = c.lastMessageAt;
          playNotificationSound();
        }
      }
    });
  });
}
