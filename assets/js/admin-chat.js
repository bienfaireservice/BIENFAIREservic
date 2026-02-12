import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  getDocs,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);

function qs(sel, parent = document) { return parent.querySelector(sel); }
function qsa(sel, parent = document) { return [...parent.querySelectorAll(sel)]; }
function nowIso() { return new Date().toISOString(); }
function safe(v) { return String(v ?? ""); }

const QUICK_REPLIES_FR = [
  "Bonjour, je prends votre demande.",
  "Merci, je verifie et je reviens vers vous.",
  "Pouvez-vous envoyer votre numero de commande ?",
  "Livraison possible aujourd'hui selon votre zone.",
  "Merci, votre dossier SAV est en cours."
];
const QUICK_REPLIES_EN = [
  "Hello, I'm handling your request.",
  "Thanks, I am checking and will get back to you.",
  "Can you share your order number?",
  "Delivery is possible today depending on your area.",
  "Thanks, your support ticket is in progress."
];

let currentChatId = "";
let allChats = [];
let chatsById = {};
let currentMessages = [];
let unsubscribeMessages = null;
const identityBackfillTried = new Set();

const SEEN_KEY = "bf_admin_chat_seen_v3";
const WEBHOOK_KEY = "bf_chat_webhook_url_v1";
const AUTO_CLOSE_KEY = "bf_chat_auto_close_hours_v1";
const notifiedMap = {};
const baseTitle = document.title;

function parseAdmins(raw) {
  try {
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function getSeenMap() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}"); } catch { return {}; }
}

function setSeen(chatId, at) {
  const seen = getSeenMap();
  seen[chatId] = at || nowIso();
  localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
}

function isUnread(chat, seenMap) {
  if (!chat?.lastMessageAt) return false;
  if ((chat.lastMessageSender || "") !== "user") return false;
  const seenAt = seenMap[chat.id];
  if (!seenAt) return true;
  return new Date(chat.lastMessageAt).getTime() > new Date(seenAt).getTime();
}

function formatDate(v) {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? safe(v) : d.toLocaleString();
}

function asBool(v) {
  if (typeof v === "boolean") return v;
  const s = safe(v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function customerLabel(chat) {
  const name = (chat?.userName || "").trim();
  const email = (chat?.userEmail || "").trim();
  if (name && email) return { title: name, sub: email };
  if (name) return { title: name, sub: chat?.id || "" };
  if (email) return { title: email, sub: chat?.id || "" };
  return { title: "Client", sub: chat?.id || "" };
}

function isLegacyAnonymousChat(chat) {
  const id = safe(chat?.id);
  const email = safe(chat?.userEmail).trim();
  const name = safe(chat?.userName).trim().toLowerCase();
  const isLegacyId = /^chat_\d+_[a-z0-9]+$/i.test(id);
  const anonymous = !email && (!name || name === "client" || name === "client inconnu");
  return isLegacyId && anonymous;
}

function hasModernSessions(chats = []) {
  return chats.some((c) => {
    const id = safe(c?.id);
    const email = safe(c?.userEmail).trim();
    return id.startsWith("chat_user_") || !!email;
  });
}

async function backfillChatIdentity(chat) {
  if (!chat?.id) return;
  if ((safe(chat.userName).trim()) || (safe(chat.userEmail).trim())) return;
  if (identityBackfillTried.has(chat.id)) return;
  identityBackfillTried.add(chat.id);
  try {
    const messagesSnap = await getDocs(collection(db, "chats", chat.id, "messages"));
    const msgs = messagesSnap.docs.map((d) => d.data() || {});
    const userMsg = msgs.find((m) => safe(m.sender).toLowerCase() === "user" && (safe(m.senderName).trim() || safe(m.senderEmail).trim()));
    if (!userMsg) return;
    const patch = {};
    const senderName = safe(userMsg.senderName).trim();
    const senderEmail = safe(userMsg.senderEmail).trim();
    if (senderName) patch.userName = senderName;
    if (senderEmail) patch.userEmail = senderEmail;
    if (!Object.keys(patch).length) return;
    await updateDoc(doc(db, "chats", chat.id), patch).catch(() => {});
  } catch {
    // ignore
  }
}

function getWebhookUrl() { return (localStorage.getItem(WEBHOOK_KEY) || "").trim(); }
function getAutoCloseHours() {
  const n = Number(localStorage.getItem(AUTO_CLOSE_KEY) || "24");
  return Number.isFinite(n) && n > 0 ? n : 24;
}

function setUnreadTitle(count) {
  document.title = count > 0 ? `(${count}) Nouveau message - ${baseTitle}` : baseTitle;
}

function getSlaMinutes(chat) {
  if (!chat?.lastMessageAt || chat?.lastMessageSender !== "user") return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(chat.lastMessageAt).getTime()) / 60000));
}

function badgePriority(chat) {
  const p = (chat?.priority || "normal").toLowerCase();
  if (p === "urgent") return `<span class="pill alert">URGENT</span>`;
  if (p === "high") return `<span class="pill">HIGH</span>`;
  return "";
}

function getQuickReplies(chat) {
  return (chat?.language || "fr").toLowerCase().startsWith("en") ? QUICK_REPLIES_EN : QUICK_REPLIES_FR;
}

function renderQuickReplies(chat) {
  const box = qs("#quickReplies");
  if (!box) return;
  const replies = getQuickReplies(chat);
  box.innerHTML = replies.map(r => `<button class="btn small" data-qr="${r.replace(/"/g, "&quot;")}">${r}</button>`).join("");
  qsa("[data-qr]", box).forEach((b) => {
    b.addEventListener("click", () => {
      const input = qs("#adminChatInput");
      if (input) input.value = b.getAttribute("data-qr") || "";
    });
  });
}

function renderChatMeta(chat) {
  const panel = qs("#chatMeta");
  if (!panel) return;
  if (!chat) {
    panel.innerHTML = "Selectionnez une session.";
    return;
  }
  const assigned = chat.assignedTo || "Non assigne";
  const online = chat.userOnline === "true" ? "En ligne" : "Hors ligne";
  const lastSeen = chat.lastSeenAt ? formatDate(chat.lastSeenAt) : "-";
  const activeAdmins = parseAdmins(chat.activeAdmins);
  const rating = chat.rating ? `${chat.rating}/5` : "-";
  panel.innerHTML = `
    <div class="card">
      <div><strong>Client:</strong> ${chat.userName || "-"}</div>
      <div class="muted">${chat.userEmail || "-"}</div>
      <div><strong>Langue:</strong> ${(chat.language || "fr").toUpperCase()}</div>
      <div><strong>Etat:</strong> ${online}</div>
      <div><strong>Derniere activite:</strong> ${lastSeen}</div>
      <div><strong>Assigne a:</strong> ${assigned}</div>
      <div><strong>Admins actifs:</strong> ${activeAdmins.join(", ") || "-"}</div>
      <div><strong>Priorite:</strong> ${(chat.priority || "normal").toUpperCase()}</div>
      <div><strong>Satisfaction:</strong> ${rating}</div>
    </div>
  `;
}

async function renderCustomerHistory(chat) {
  const box = qs("#customerHistory");
  if (!box) return;
  if (!chat?.userEmail) {
    box.innerHTML = "Aucun historique client.";
    return;
  }
  box.innerHTML = "Chargement historique...";
  try {
    const snap = await getDocs(collection(db, "orders"));
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(o => safe(o.customer?.email).toLowerCase() === safe(chat.userEmail).toLowerCase())
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    box.innerHTML = orders.length ? orders.slice(0, 8).map(o => `
      <div class="card">
        <strong>${o.id}</strong>
        <div>${(o.items || []).length} article(s) - ${o.total || 0} FCFA</div>
        <div class="muted">${o.status || "new"} - ${formatDate(o.createdAt)}</div>
      </div>
    `).join("") : "Aucune commande pour ce client.";
  } catch {
    box.innerHTML = "Erreur chargement historique.";
  }
}

function filterMessagesView() {
  const q = (qs("#chatSearchInput")?.value || "").toLowerCase();
  const onlyNotes = qs("#chatOnlyNotes")?.checked === true;
  let filtered = currentMessages;
  if (q) {
    filtered = filtered.filter(m => `${m.text || ""} ${m.senderName || ""} ${m.sender || ""}`.toLowerCase().includes(q));
  }
  if (onlyNotes) {
    filtered = filtered.filter(m => m.sender === "admin_note");
  }
  renderMessages(filtered);
}

function jumpToAdminComposer() {
  const input = qs("#adminChatInput");
  if (!input) return;
  const target = input.closest(".filters") || input;
  try {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch {
    target.scrollIntoView();
  }
  setTimeout(() => {
    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }
  }, 220);
}

function scrollAdminMessagesToBottom() {
  const box = qs("#chatMessages");
  if (!box) return;
  box.scrollTop = box.scrollHeight;
  updateAdminJumpVisibility();
}

function updateAdminJumpVisibility() {
  const box = qs("#chatMessages");
  const btn = qs("#chatJumpBottomBtn");
  if (!box || !btn) return;
  const nearBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 30;
  const hasOverflow = box.scrollHeight > box.clientHeight + 8;
  btn.style.display = hasOverflow && !nearBottom ? "inline-flex" : "none";
}

function renderMessages(messages) {
  const box = qs("#chatMessages");
  if (!box) return;
  const visibleMessages = messages.filter((m) => {
    const sender = safe(m.sender).trim().toLowerCase();
    const type = safe(m.type).toLowerCase();
    const text = safe(m.text).trim().toLowerCase();
    if (sender === "system") return false;
    if (type === "read_receipt") return false;
    if (text === "vu") return false;
    return true;
  });
  if (!visibleMessages.length) {
    box.innerHTML = "Aucun message.";
    return;
  }
  const meta = chatsById[currentChatId] || {};
  box.innerHTML = visibleMessages.map((m) => {
    const who = m.sender === "user"
      ? (m.senderName || meta.userName || meta.userEmail || "Client")
      : (m.sender === "admin_note" ? "Note interne" : (m.sender || "admin"));
    const noteBadge = m.sender === "admin_note" ? `<span class="pill">Interne</span>` : "";
    const special = m.type === "rating" ? `<span class="pill success">Note client</span>` : "";
    return `
      <div class="card">
        <strong>${who} ${noteBadge} ${special}</strong>
        <div>${m.text || ""}</div>
        ${m.attachmentDataUrl ? `<a href="${m.attachmentDataUrl}" target="_blank" rel="noopener noreferrer">Piece jointe: ${m.attachmentName || "ouvrir"}</a>` : ""}
        <div class="muted">${formatDate(m.createdAt)}</div>
      </div>
    `;
  }).join("");
  updateAdminJumpVisibility();
}

async function addMessage(chatId, sender, text, extra = {}) {
  const now = nowIso();
  const payload = {
    sender,
    text,
    createdAt: now,
    ...(extra.senderName ? { senderName: extra.senderName } : {}),
    ...(extra.attachmentName ? { attachmentName: extra.attachmentName } : {}),
    ...(extra.attachmentDataUrl ? { attachmentDataUrl: extra.attachmentDataUrl } : {}),
    ...(extra.type ? { type: extra.type } : {})
  };
  await addDoc(collection(db, "chats", chatId, "messages"), payload);
  const patch = {
    status: sender === "admin_note" ? (chatsById[chatId]?.status || "human") : "human",
    lastMessageAt: now,
    lastMessageSender: sender === "admin_note" ? "admin" : sender,
    lastMessageText: text
  };
  const chat = chatsById[chatId] || {};
  if (sender === "admin" && chat.firstUserMessageAt && !chat.firstAdminReplyAt) {
    const sec = Math.max(0, Math.floor((new Date(now).getTime() - new Date(chat.firstUserMessageAt).getTime()) / 1000));
    patch.firstAdminReplyAt = now;
    patch.firstResponseSec = String(sec);
  }
  await updateDoc(doc(db, "chats", chatId), patch);
}

async function assignCurrentChat() {
  if (!currentChatId) return;
  const adminEmail = window.currentUserEmail || "admin";
  await updateDoc(doc(db, "chats", currentChatId), { assignedTo: adminEmail });
}

async function transferCurrentChat() {
  if (!currentChatId) return;
  const target = (qs("#chatTransferTo")?.value || "").trim().toLowerCase();
  if (!target) {
    alert("Entrez l'email admin de destination.");
    return;
  }
  const current = safe(window.currentUserEmail).trim().toLowerCase() || "admin";
  const active = parseAdmins(chatsById[currentChatId]?.activeAdmins).filter((a) => safe(a).toLowerCase() !== current);
  if (!active.some((a) => safe(a).toLowerCase() === target)) active.push(target);
  await updateDoc(doc(db, "chats", currentChatId), {
    assignedTo: target,
    activeAdmins: JSON.stringify(active),
    transferredAt: nowIso(),
    transferredBy: current
  });
  await addDoc(collection(db, "chats", currentChatId, "messages"), {
    sender: "admin_note",
    type: "transfer",
    text: `Chat transfere a ${target}`,
    senderName: current,
    createdAt: nowIso()
  }).catch(() => {});
  const input = qs("#chatTransferTo");
  if (input) input.value = "";
  alert(`Chat transfere a ${target}.`);
}

async function closeCurrentChat() {
  if (!currentChatId) return;
  const now = nowIso();
  await updateDoc(doc(db, "chats", currentChatId), { status: "closed", closedAt: now });
  await addDoc(collection(db, "chats", currentChatId, "messages"), {
    sender: "admin",
    type: "rating_request",
    text: "Merci pour cet echange. Merci de noter notre support (1-5).",
    createdAt: now
  });
}

async function setPriorityCurrentChat(priority) {
  if (!currentChatId) return;
  await updateDoc(doc(db, "chats", currentChatId), { priority: priority || "normal" });
}

function toCsv(rows) {
  const esc = (v) => `"${safe(v).replace(/"/g, "\"\"")}"`;
  return rows.map(r => r.map(esc).join(",")).join("\n");
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

function exportCurrentChatCsv() {
  if (!currentChatId || !currentMessages.length) return;
  const rows = [
    ["chatId", "sender", "senderName", "text", "createdAt", "attachmentName", "type"],
    ...currentMessages.map(m => [currentChatId, m.sender || "", m.senderName || "", m.text || "", m.createdAt || "", m.attachmentName || "", m.type || ""])
  ];
  downloadCsv(`chat-${currentChatId}.csv`, toCsv(rows));
}

function exportCurrentChatPdf() {
  if (!currentChatId || !currentMessages.length) return;
  const win = window.open("", "_blank");
  if (!win) return;
  const lines = currentMessages.map((m) => {
    const who = m.sender === "user" ? (m.senderName || "Client") : (m.sender || "admin");
    const date = formatDate(m.createdAt);
    return `<div style="margin-bottom:10px;"><strong>${who}</strong> <span style="color:#666;">${date}</span><div>${safe(m.text).replace(/</g, "&lt;")}</div></div>`;
  }).join("");
  win.document.write(`
    <html>
      <head><title>Chat ${currentChatId}</title></head>
      <body style="font-family:Arial, sans-serif; padding:20px;">
        <h2>Conversation ${currentChatId}</h2>
        ${lines}
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 900;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => { osc.stop(); ctx.close(); }, 180);
  } catch {
    // ignore
  }
}

function notifyNewMessage(chat) {
  const label = customerLabel(chat);
  const body = `${label.title}: ${chat.lastMessageText || "Nouveau message"}`;
  if ("Notification" in window && Notification.permission === "granted") {
    try { new Notification("Nouveau message client", { body }); } catch { /* ignore */ }
  }
  playNotificationSound();
  const endpoint = getWebhookUrl();
  if (endpoint) {
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "new_user_message",
        chatId: chat.id,
        userName: chat.userName || "",
        userEmail: chat.userEmail || "",
        text: chat.lastMessageText || "",
        at: chat.lastMessageAt || nowIso()
      })
    }).catch(() => {});
  }
}

function renderSessions(chats) {
  const list = qs("#chatSessions");
  const badge = qs("#chatBadge");
  if (!list) return;
  chatsById = Object.fromEntries(chats.map(c => [c.id, c]));
  const seenMap = getSeenMap();
  const unreadCount = chats.filter(c => isUnread(c, seenMap)).length;
  setUnreadTitle(unreadCount);
  if (badge) {
    badge.style.display = unreadCount ? "inline-flex" : "none";
    badge.textContent = unreadCount ? `${unreadCount} nouveau` : "Nouveau";
  }
  const statusFilter = (qs("#chatStatusFilter")?.value || "all").toLowerCase();
  const modernExists = hasModernSessions(chats);
  const visibleChats = chats.filter((c) => {
    if (asBool(c.adminHidden)) return false;
    if (modernExists && isLegacyAnonymousChat(c)) return false;
    if (statusFilter === "all") return true;
    if (statusFilter === "urgent") return (c.priority || "").toLowerCase() === "urgent";
    return (c.status || "open").toLowerCase() === statusFilter;
  });
  list.innerHTML = visibleChats.length ? visibleChats.map((c) => {
    const label = customerLabel(c);
    const selected = currentChatId === c.id ? " style=\"border:2px solid var(--primary);\"" : "";
    const unread = isUnread(c, seenMap);
    const sla = getSlaMinutes(c);
    const slaBadge = sla >= 10 ? `<span class="pill alert">SLA ${sla}m</span>` : (sla > 0 ? `<span class="pill">SLA ${sla}m</span>` : "");
    const online = c.userOnline === "true" ? "En ligne" : "Hors ligne";
    return `
      <div class="card"${selected}>
        <strong>${label.title}</strong>
        <div class="muted">${label.sub}</div>
        <div class="muted">Statut: ${c.status || "open"} - ${online}</div>
        ${badgePriority(c)}
        ${unread ? `<span class="pill alert">Nouveau message</span>` : ""}
        ${slaBadge}
        <div class="muted">${c.lastMessageText || ""}</div>
        <div class="muted">${formatDate(c.lastMessageAt)}</div>
        <button class="btn small" data-chat-open="${c.id}">Ouvrir</button>
      </div>
    `;
  }).join("") : "Aucun chat.";
  qsa("[data-chat-open]").forEach((btn) => {
    btn.addEventListener("click", () => openChat(btn.getAttribute("data-chat-open") || ""));
  });
}

function renderKpis(chats) {
  const adminEmail = safe(window.currentUserEmail).toLowerCase();
  const openCount = chats.filter(c => (c.status || "open") !== "closed").length;
  const assignedCount = chats.filter(c => safe(c.assignedTo).toLowerCase() === adminEmail).length;
  const urgentCount = chats.filter(c => safe(c.priority).toLowerCase() === "urgent").length;
  const today = new Date().toISOString().slice(0, 10);
  const volumeToday = chats.filter(c => safe(c.lastMessageAt).startsWith(today)).length;
  const resolvedToday = chats.filter(c => safe(c.status).toLowerCase() === "closed" && safe(c.closedAt).startsWith(today)).length;
  const firstResponses = chats.map(c => Number(c.firstResponseSec || 0)).filter(v => Number.isFinite(v) && v > 0);
  const firstAvgMin = firstResponses.length ? Math.round((firstResponses.reduce((a, b) => a + b, 0) / firstResponses.length) / 60) : 0;
  if (qs("#kpiOpenChats")) qs("#kpiOpenChats").textContent = String(openCount);
  if (qs("#kpiAssignedToMe")) qs("#kpiAssignedToMe").textContent = String(assignedCount);
  if (qs("#kpiUrgentChats")) qs("#kpiUrgentChats").textContent = String(urgentCount);
  if (qs("#kpiFirstReplyAvg")) qs("#kpiFirstReplyAvg").textContent = `${firstAvgMin}m`;
  if (qs("#kpiVolumeToday")) qs("#kpiVolumeToday").textContent = String(volumeToday);
  if (qs("#kpiResolvedToday")) qs("#kpiResolvedToday").textContent = String(resolvedToday);
}

async function refreshActiveAdmins(chatId) {
  const chat = chatsById[chatId] || {};
  const current = window.currentUserEmail || "admin";
  const active = parseAdmins(chat.activeAdmins);
  if (!active.includes(current)) active.push(current);
  await updateDoc(doc(db, "chats", chatId), { activeAdmins: JSON.stringify(active) }).catch(() => {});
}

function openChat(chatId) {
  if (!chatId) return;
  const isNewSelection = currentChatId !== chatId;
  currentChatId = chatId;
  const meta = chatsById[chatId] || {};
  setSeen(chatId, meta.lastMessageAt || nowIso());
  renderSessions(allChats);
  renderChatMeta(meta);
  renderCustomerHistory(meta);
  renderQuickReplies(meta);
  refreshActiveAdmins(chatId);
  if (unsubscribeMessages) {
    unsubscribeMessages();
    unsubscribeMessages = null;
  }
  const ref = collection(db, "chats", chatId, "messages");
  unsubscribeMessages = onSnapshot(
    ref,
    async (snap) => {
      currentMessages = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter((m) => {
          const sender = safe(m.sender).trim().toLowerCase();
          const type = safe(m.type).toLowerCase();
          const text = safe(m.text).trim().toLowerCase();
          if (sender === "system") return false;
          if (type === "read_receipt") return false;
          if (text === "vu") return false;
          return true;
        })
        .sort((a, b) => safe(a.createdAt).localeCompare(safe(b.createdAt)));

      // Backfill client identity on chat doc if missing.
      try {
        const metaNow = chatsById[chatId] || {};
        const hasName = safe(metaNow.userName).trim().length > 0;
        const hasEmail = safe(metaNow.userEmail).trim().length > 0;
        if (!hasName || !hasEmail) {
          const firstUserMsg = currentMessages.find((m) => safe(m.sender).toLowerCase() === "user");
          const senderName = safe(firstUserMsg?.senderName).trim();
          const senderEmail = safe(firstUserMsg?.senderEmail).trim();
          const patch = {};
          if (!hasName && senderName) patch.userName = senderName;
          if (!hasEmail && senderEmail) patch.userEmail = senderEmail;
          if (Object.keys(patch).length) {
            await updateDoc(doc(db, "chats", chatId), patch).catch(() => {});
          }
        }
      } catch {
        // ignore backfill errors
      }

      filterMessagesView();
      if (isNewSelection) {
        setTimeout(jumpToAdminComposer, 120);
      }
    },
    (err) => {
      console.error("admin chat messages snapshot error:", err);
      const box = qs("#chatMessages");
      if (box) box.innerHTML = "Erreur lecture messages (permissions/rules).";
    }
  );
}

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function sendAdminMessage(sender = "admin") {
  const input = qs("#adminChatInput");
  const file = qs("#adminChatFile");
  if (!input) return;
  const text = input.value.trim();
  if (!currentChatId || !text) return;
  let attachmentName = "";
  let attachmentDataUrl = "";
  if (file?.files?.[0]) {
    attachmentName = file.files[0].name;
    attachmentDataUrl = await readFileAsDataUrl(file.files[0]);
    file.value = "";
  }
  try {
    await addMessage(currentChatId, sender, text, {
      senderName: window.currentUserEmail || "admin",
      attachmentName,
      attachmentDataUrl
    });
  } catch (err) {
    console.error("sendAdminMessage failed:", err);
    alert("Envoi impossible (verifiez connexion/regles Firestore).");
    return;
  }
  input.value = "";
}

async function clearAllChatHistory() {
  const ok = window.confirm("Supprimer tout l'historique des chats ? Cette action est definitive.");
  if (!ok) return;
  const btn = qs("#clearChatHistoryBtn");
  if (btn) btn.disabled = true;
  let hardDeleted = 0;
  let archived = 0;
  try {
    const chatsSnap = await getDocs(collection(db, "chats"));
    for (const chatDoc of chatsSnap.docs) {
      const chatId = chatDoc.id;
      let hardDeleteOk = true;
      try {
        const messagesSnap = await getDocs(collection(db, "chats", chatId, "messages"));
        for (const msgDoc of messagesSnap.docs) {
          await deleteDoc(doc(db, "chats", chatId, "messages", msgDoc.id));
        }
        await deleteDoc(doc(db, "chats", chatId));
        hardDeleted += 1;
      } catch {
        hardDeleteOk = false;
      }
      if (!hardDeleteOk) {
        await updateDoc(doc(db, "chats", chatId), {
          adminHidden: "true",
          status: "closed",
          closedAt: nowIso(),
          lastMessageText: "Archive admin"
        }).catch(() => {});
        archived += 1;
      }
    }
    currentChatId = "";
    allChats = [];
    chatsById = {};
    currentMessages = [];
    if (unsubscribeMessages) {
      unsubscribeMessages();
      unsubscribeMessages = null;
    }
    if (qs("#chatSessions")) qs("#chatSessions").innerHTML = "Aucun chat.";
    if (qs("#chatMessages")) qs("#chatMessages").innerHTML = "Historique supprime.";
    renderChatMeta(null);
    alert(`Historique traite. Supprimes: ${hardDeleted}. Archives: ${archived}.`);
  } catch (err) {
    console.error("clearAllChatHistory failed:", err);
    alert("Suppression echouee. Verifiez les permissions admin Firestore.");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function cleanupSystemMessages() {
  const ok = window.confirm("Supprimer tous les anciens messages system/vu de Firestore ?");
  if (!ok) return;
  const btn = qs("#cleanupSystemMessagesBtn");
  if (btn) btn.disabled = true;
  let deleted = 0;
  try {
    const chatsSnap = await getDocs(collection(db, "chats"));
    for (const chatDoc of chatsSnap.docs) {
      const chatId = chatDoc.id;
      const messagesSnap = await getDocs(collection(db, "chats", chatId, "messages"));
      for (const msgDoc of messagesSnap.docs) {
        const data = msgDoc.data() || {};
        const sender = safe(data.sender).toLowerCase();
        const type = safe(data.type).toLowerCase();
        const text = safe(data.text).trim().toLowerCase();
        const shouldDelete =
          sender === "system" ||
          type === "read_receipt" ||
          text === "vu";
        if (!shouldDelete) continue;
        await deleteDoc(doc(db, "chats", chatId, "messages", msgDoc.id));
        deleted += 1;
      }
    }
    if (currentChatId) openChat(currentChatId);
    alert(`Nettoyage termine. ${deleted} message(s) supprime(s).`);
  } catch (err) {
    console.error("cleanupSystemMessages failed:", err);
    alert("Nettoyage refuse. Verifiez les regles Firestore (delete messages pour admin).");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function applyAutoClose() {
  const hoursInput = Number(qs("#autoCloseHours")?.value || getAutoCloseHours());
  const hours = Number.isFinite(hoursInput) && hoursInput > 0 ? hoursInput : 24;
  localStorage.setItem(AUTO_CLOSE_KEY, String(hours));
  const cutoff = Date.now() - (hours * 3600 * 1000);
  const toClose = allChats.filter((c) => {
    const status = safe(c.status).toLowerCase() || "open";
    if (status === "closed") return false;
    if (!c.lastMessageAt) return false;
    return new Date(c.lastMessageAt).getTime() < cutoff;
  });
  for (const c of toClose) {
    await updateDoc(doc(db, "chats", c.id), { status: "closed", closedAt: nowIso() }).catch(() => {});
  }
}

function loadAutomationSettings() {
  if (qs("#webhookEndpoint")) qs("#webhookEndpoint").value = getWebhookUrl();
  if (qs("#autoCloseHours")) qs("#autoCloseHours").value = String(getAutoCloseHours());
}

function bind() {
  qs("#adminChatSend")?.addEventListener("click", () => sendAdminMessage("admin"));
  qs("#adminChatSendNote")?.addEventListener("click", () => sendAdminMessage("admin_note"));
  qs("#adminChatInput")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      sendAdminMessage("admin_note");
      return;
    }
    if (e.key === "Enter") sendAdminMessage("admin");
  });
  qs("#refreshChatBtn")?.addEventListener("click", () => {
    renderSessions(allChats);
    if (currentChatId) openChat(currentChatId);
  });
  qs("#chatJumpBottomBtn")?.addEventListener("click", () => {
    scrollAdminMessagesToBottom();
    setTimeout(jumpToAdminComposer, 80);
  });
  qs("#clearChatHistoryBtn")?.addEventListener("click", clearAllChatHistory);
  qs("#cleanupSystemMessagesBtn")?.addEventListener("click", cleanupSystemMessages);
  qs("#chatAssignBtn")?.addEventListener("click", assignCurrentChat);
  qs("#chatTransferBtn")?.addEventListener("click", transferCurrentChat);
  qs("#chatCloseBtn")?.addEventListener("click", closeCurrentChat);
  qs("#chatPriority")?.addEventListener("change", (e) => setPriorityCurrentChat(e.target.value));
  qs("#chatStatusFilter")?.addEventListener("change", () => renderSessions(allChats));
  qs("#chatSearchInput")?.addEventListener("input", filterMessagesView);
  qs("#chatOnlyNotes")?.addEventListener("change", filterMessagesView);
  qs("#chatMessages")?.addEventListener("scroll", updateAdminJumpVisibility);
  qs("#chatExportCsvBtn")?.addEventListener("click", exportCurrentChatCsv);
  qs("#chatExportPdfBtn")?.addEventListener("click", exportCurrentChatPdf);
  qs("#saveWebhookBtn")?.addEventListener("click", () => {
    const endpoint = (qs("#webhookEndpoint")?.value || "").trim();
    localStorage.setItem(WEBHOOK_KEY, endpoint);
  });
  qs("#applyAutoCloseBtn")?.addEventListener("click", applyAutoClose);
}

function start() {
  const ref = collection(db, "chats");
  onSnapshot(
    ref,
    (snap) => {
      const chats = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => safe(b.lastMessageAt).localeCompare(safe(a.lastMessageAt)));
      allChats = chats;
      chatsById = Object.fromEntries(chats.map(c => [c.id, c]));
      chats.forEach((c) => { backfillChatIdentity(c); });
      const seenMap = getSeenMap();
      chats.forEach((c) => {
        if (!isUnread(c, seenMap)) return;
        if (notifiedMap[c.id] === c.lastMessageAt) return;
        notifiedMap[c.id] = c.lastMessageAt;
        notifyNewMessage(c);
      });
      renderSessions(chats);
      renderKpis(chats);
      // Do not auto-open chats on snapshot updates.
      // Admin opens a chat only via explicit "Ouvrir" click.
      if (currentChatId && !chatsById[currentChatId]) {
        currentChatId = "";
        currentMessages = [];
        if (unsubscribeMessages) {
          unsubscribeMessages();
          unsubscribeMessages = null;
        }
        const box = qs("#chatMessages");
        if (box) box.innerHTML = "Selectionnez une session.";
        renderChatMeta(null);
      }
    },
    (err) => {
      console.error("admin chats snapshot error:", err);
      const list = qs("#chatSessions");
      if (list) list.innerHTML = "Erreur lecture chats (permissions/rules).";
    }
  );
  setInterval(() => { applyAutoClose().catch(() => {}); }, 60000);
}

window.addEventListener("DOMContentLoaded", () => {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
  loadAutomationSettings();
  renderQuickReplies(null);
  renderChatMeta(null);
  updateAdminJumpVisibility();
  bind();
  start();
  window.addEventListener("beforeunload", () => {
    if (!currentChatId) return;
    const chat = chatsById[currentChatId] || {};
    const current = window.currentUserEmail || "admin";
    const active = parseAdmins(chat.activeAdmins).filter(a => a !== current);
    updateDoc(doc(db, "chats", currentChatId), { activeAdmins: JSON.stringify(active) }).catch(() => {});
  });
});
