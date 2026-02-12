(() => {
  const PROJECT_ID = "bienfaireservic";
  const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const CHAT_KEY = "bf_support_chat_id_v2";
  const EMAIL_CHAT_MAP_PREFIX = "bf_support_chat_id_email_v1_";
  const FIRST_USER_KEY = "bf_first_user_sent_v2";
  const RATED_KEY = "bf_chat_rated_v1";
  const POLL_MS = 2000;
  const PRESENCE_MS = 25000;
  const SPAM_WINDOW_MS = 20000;
  const SPAM_MAX_MSG = 5;
  const AI_PAUSE_KEY_PREFIX = "bf_ai_paused_v1_";
  const AI_CONTEXT_CACHE_KEY = "bf_ai_site_context_v1";
  const AI_CONTEXT_TTL_MS = 10000;
  const AI_CONTEXT_MAX_CHARS = 18000;
  const FIREBASE_CONFIG_URL = "/assets/js/firebase-config.js";
  const HANDOFF_COOLDOWN_MS = 12000;
  let realtimeSdkPromise = null;

  function hashString(value) {
    let h = 5381;
    const s = String(value || "");
    for (let i = 0; i < s.length; i += 1) {
      h = ((h << 5) + h) + s.charCodeAt(i);
    }
    return Math.abs(h >>> 0).toString(36);
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function getChatId() {
    const user = getUserMeta();
    const email = normalizeEmail(user.email);

    if (email) {
      const emailKey = `${EMAIL_CHAT_MAP_PREFIX}${email}`;
      let byEmailId = localStorage.getItem(emailKey);
      if (!byEmailId) {
        byEmailId = `chat_user_${hashString(email)}`;
        localStorage.setItem(emailKey, byEmailId);
      }
      localStorage.setItem(CHAT_KEY, byEmailId);
      return byEmailId;
    }

    let id = localStorage.getItem(CHAT_KEY);
    if (!id) {
      id = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(CHAT_KEY, id);
    }
    return id;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function getUserMeta() {
    let name = "Client";
    let email = "";
    try {
      const cached = JSON.parse(localStorage.getItem("bf_ui_user_cache") || "{}");
      if (cached?.name) name = String(cached.name);
      if (cached?.email) email = String(cached.email);
    } catch {
      // ignore
    }
    if ((!name || name === "Client") && email) name = email.split("@")[0] || "Client";
    return { name, email };
  }

  function getAiPauseKey(chatId) {
    return `${AI_PAUSE_KEY_PREFIX}${chatId}`;
  }

  function isAiPaused(chatId) {
    return localStorage.getItem(getAiPauseKey(chatId)) === "1";
  }

  function setAiPaused(chatId, paused) {
    localStorage.setItem(getAiPauseKey(chatId), paused ? "1" : "0");
  }

  function detectLanguage(text) {
    const t = String(text || "").toLowerCase();
    const enHints = ["hello", "price", "delivery", "order", "thanks", "help", "please"];
    const frHints = ["bonjour", "prix", "livraison", "commande", "merci", "aide", "svp"];
    const en = enHints.filter(k => t.includes(k)).length;
    const fr = frHints.filter(k => t.includes(k)).length;
    return en > fr ? "en" : "fr";
  }

  async function patchChat(chatId, fields) {
    const keys = Object.keys(fields || {});
    if (!keys.length) return;
    const mask = keys.map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
    const payload = {};
    keys.forEach((k) => {
      payload[k] = { stringValue: String(fields[k] ?? "") };
    });
    await fetch(`${FIRESTORE_BASE}/chats/${chatId}?${mask}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: payload })
    });
  }

  async function chatDocExists(chatId) {
    try {
      const res = await fetch(`${FIRESTORE_BASE}/chats/${chatId}`);
      if (res.ok) return true;
      if (res.status === 404) return false;
      return true;
    } catch {
      return true;
    }
  }

  async function ensureChatDoc(chatId) {
    const user = getUserMeta();
    const now = nowIso();
    const exists = await chatDocExists(chatId);
    try {
      if (!exists) {
        await fetch(`${FIRESTORE_BASE}/chats?documentId=${chatId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: {
              createdAt: { stringValue: now },
              status: { stringValue: "open" },
              userName: { stringValue: user.name || "Client" },
              userEmail: { stringValue: user.email || "" },
              userOnline: { stringValue: "true" },
              lastSeenAt: { stringValue: now },
              lastMessageAt: { stringValue: now },
              lastMessageSender: { stringValue: "system" },
              lastMessageText: { stringValue: "Session ouverte" }
            }
          })
        });
      }
    } catch {
      // ignore
    }
    try {
      await patchChat(chatId, {
        userName: user.name || "Client",
        userEmail: user.email || "",
        userOnline: "true",
        lastSeenAt: now
      });
    } catch {
      // ignore
    }
  }

  async function addMessage(chatId, sender, text, extra = {}) {
    const user = getUserMeta();
    const now = nowIso();
    const msgFields = {
      sender: { stringValue: sender },
      text: { stringValue: text },
      createdAt: { stringValue: now }
    };
    if (sender === "user") {
      msgFields.senderName = { stringValue: user.name || "Client" };
      msgFields.senderEmail = { stringValue: user.email || "" };
    }
    if (extra.attachmentName) msgFields.attachmentName = { stringValue: extra.attachmentName };
    if (extra.attachmentDataUrl) msgFields.attachmentDataUrl = { stringValue: extra.attachmentDataUrl };
    if (extra.type) msgFields.type = { stringValue: extra.type };

    await fetch(`${FIRESTORE_BASE}/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: msgFields })
    });
    await patchChat(chatId, {
      lastMessageAt: now,
      lastMessageSender: sender,
      lastMessageText: text,
      status: "human",
      ...(sender === "user" ? {
        userName: user.name || "Client",
        userEmail: user.email || "",
        userDisplay: user.email ? `${user.name || "Client"} (${user.email})` : (user.name || "Client")
      } : {})
    });
  }

  async function fetchMessages(chatId) {
    const res = await fetch(`${FIRESTORE_BASE}/chats/${chatId}:runQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "messages" }],
          orderBy: [{ field: { fieldPath: "createdAt" }, direction: "ASCENDING" }],
          limit: 80
        }
      })
    });
    if (!res.ok) return [];
    const rows = await res.json();
    const out = [];
    for (const row of rows) {
      const doc = row?.document;
      if (!doc) continue;
      const f = doc.fields || {};
      out.push({
        id: (doc.name || "").split("/").pop(),
        sender: f.sender?.stringValue || "user",
        text: f.text?.stringValue || "",
        createdAt: f.createdAt?.stringValue || "",
        attachmentName: f.attachmentName?.stringValue || "",
        attachmentDataUrl: f.attachmentDataUrl?.stringValue || "",
        type: f.type?.stringValue || ""
      });
    }
    return out.filter(m => m.text);
  }

  async function getRealtimeSdk() {
    if (realtimeSdkPromise) return realtimeSdkPromise;
    realtimeSdkPromise = Promise.all([
      import(FIREBASE_CONFIG_URL),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
    ]).then(([cfg, appMod, fsMod]) => {
      const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(cfg.firebaseConfig);
      const db = fsMod.getFirestore(app);
      return {
        db,
        collection: fsMod.collection,
        onSnapshot: fsMod.onSnapshot,
        getDocs: fsMod.getDocs
      };
    });
    return realtimeSdkPromise;
  }

  async function subscribeMessagesRealtime(chatId, onMessages, onError) {
    const sdk = await getRealtimeSdk();
    const ref = sdk.collection(sdk.db, "chats", chatId, "messages");
    return sdk.onSnapshot(
      ref,
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
        onMessages(rows);
      },
      onError
    );
  }

  function isAiEnabled() {
    return window.AI_CHAT_ENABLED === true && typeof window.AI_CHAT_ENDPOINT === "string" && window.AI_CHAT_ENDPOINT.trim();
  }

  function getAiEndpoints() {
    const list = [];
    const primary = String(window.AI_CHAT_ENDPOINT || "").trim();
    const fallbacks = Array.isArray(window.AI_CHAT_ENDPOINT_FALLBACKS) ? window.AI_CHAT_ENDPOINT_FALLBACKS : [];
    if (primary) list.push(primary);
    fallbacks.forEach((endpoint) => {
      const value = String(endpoint || "").trim();
      if (value && !list.includes(value)) list.push(value);
    });
    return list;
  }

  function toAiHistory(messages) {
    return messages
      .filter((m) => m && typeof m.text === "string" && m.text.trim())
      .slice(-12)
      .map((m) => ({
        role: m.sender === "user" ? "user" : "assistant",
        content: m.text
      }));
  }

  function parseFsFieldValue(field) {
    if (!field || typeof field !== "object") return "";
    if (typeof field.stringValue === "string") return field.stringValue;
    if (typeof field.integerValue === "string") return field.integerValue;
    if (typeof field.doubleValue === "number") return String(field.doubleValue);
    if (typeof field.booleanValue === "boolean") return field.booleanValue ? "true" : "false";
    return "";
  }

  function parseFsStringField(fields, key) {
    return String(parseFsFieldValue(fields?.[key]) || "");
  }

  function normalizeStatus(v) {
    const s = String(v || "in").toLowerCase();
    if (["out", "rupture", "unavailable", "0"].includes(s)) return "out";
    return "in";
  }

  function compressText(text, max = 1600) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  }

  function stripHtmlToText(html) {
    try {
      const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
      return compressText(doc.body?.textContent || "", 2200);
    } catch {
      return "";
    }
  }

  async function fetchProductsContext() {
    // 1) Firestore SDK (temps reel, plus fiable que REST)
    try {
      const sdk = await getRealtimeSdk();
      const snap = await sdk.getDocs(sdk.collection(sdk.db, "products"));
      const rows = snap.docs.map((d) => {
        const p = d.data() || {};
        const name = String(p.name || "").trim();
        if (!name) return null;
        const price = String(p.price ?? "n/a");
        const qty = String(p.qty ?? "n/a");
        const category = String(p.category || "n/a");
        const status = normalizeStatus(p.status) === "out" ? "rupture" : "disponible";
        const desc = compressText(String(p.description || ""), 180);
        return `${name} | prix:${price} FCFA | stock:${qty} | categorie:${category} | statut:${status} | desc:${desc || "n/a"}`;
      }).filter(Boolean);
      if (rows.length) return rows.join("\n");
    } catch {
      // fallback REST
    }

    // 2) Firestore REST
    try {
      const res = await fetch(`${FIRESTORE_BASE}/products`);
      if (!res.ok) return "";
      const data = await res.json();
      const docs = Array.isArray(data?.documents) ? data.documents : [];
      const lines = docs.map((d) => {
        const f = d.fields || {};
        const name = parseFsStringField(f, "name");
        const price = parseFsStringField(f, "price");
        const qty = parseFsStringField(f, "qty");
        const category = parseFsStringField(f, "category");
        const status = normalizeStatus(parseFsStringField(f, "status")) === "out" ? "rupture" : "disponible";
        const desc = compressText(parseFsStringField(f, "description"), 220);
        if (!name) return "";
        return `${name} | prix:${price || "n/a"} FCFA | stock:${qty || "n/a"} | categorie:${category || "n/a"} | statut:${status} | desc:${desc || "n/a"}`;
      }).filter(Boolean);
      if (lines.length) return lines.join("\n");
    } catch {
      // ignore
    }

    // 3) Fallback catalogue local si Firestore indisponible
    try {
      const res = await fetch("/assets/data/products.json", { cache: "no-store" });
      if (!res.ok) return "";
      const products = await res.json();
      if (!Array.isArray(products)) return "";
      const lines = products.map((p) => {
        const name = String(p?.name || "").trim();
        if (!name) return "";
        const price = String(p?.price ?? "n/a");
        const qty = String(p?.qty ?? p?.stock ?? "n/a");
        const category = String(p?.category || "n/a");
        const status = normalizeStatus(p?.status) === "out" ? "rupture" : "disponible";
        const desc = compressText(String(p?.description || ""), 220);
        return `${name} | prix:${price} FCFA | stock:${qty} | categorie:${category} | statut:${status} | desc:${desc || "n/a"}`;
      }).filter(Boolean);
      return lines.join("\n");
    } catch {
      return "";
    }
  }

  async function fetchProductsLiveList() {
    try {
      const sdk = await getRealtimeSdk();
      const snap = await sdk.getDocs(sdk.collection(sdk.db, "products"));
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    } catch {
      return [];
    }
  }

  async function fetchPagesContext() {
    const pages = [
      "/index.html",
      "/shop.html",
      "/contact.html",
      "/about.html",
      "/terms.html",
      "/privacy.html"
    ];
    const chunks = [];
    for (const page of pages) {
      try {
        const res = await fetch(page, { cache: "no-store" });
        if (!res.ok) continue;
        const html = await res.text();
        const text = stripHtmlToText(html);
        if (!text) continue;
        chunks.push(`[PAGE ${page}] ${text}`);
      } catch {
        // ignore one page
      }
    }
    return chunks.join("\n");
  }

  function getBaseBusinessContext() {
    return [
      "BIEN FAIRE Shop",
      "Activite: materiel pro, imprimantes, accessoires, consommables.",
      "Zone: Abidjan et environs.",
      "Service: 24/7.",
      "Paiement: Mobile Money, WhatsApp, carte optionnelle.",
      "Objectif IA: aider, orienter, expliquer, saluer naturellement."
    ].join("\n");
  }

  async function buildSiteContext() {
    try {
      const cachedRaw = localStorage.getItem(AI_CONTEXT_CACHE_KEY);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (cached?.value && Number.isFinite(cached?.updatedAt) && (Date.now() - cached.updatedAt) < AI_CONTEXT_TTL_MS) {
          return String(cached.value).slice(0, AI_CONTEXT_MAX_CHARS);
        }
      }
    } catch {
      // ignore cache read
    }

    const [productsCtx, pagesCtx] = await Promise.all([
      fetchProductsContext(),
      fetchPagesContext()
    ]);
    const merged = [
      getBaseBusinessContext(),
      `[PRODUITS]\n${productsCtx || "Aucune donnee produits disponible."}`,
      `[PAGES]\n${pagesCtx || "Aucune donnee pages disponible."}`
    ].join("\n\n").slice(0, AI_CONTEXT_MAX_CHARS);

    try {
      localStorage.setItem(AI_CONTEXT_CACHE_KEY, JSON.stringify({
        value: merged,
        updatedAt: Date.now()
      }));
    } catch {
      // ignore cache write
    }
    return merged;
  }

  function isAvailabilityQuestion(text) {
    const t = String(text || "").toLowerCase();
    return (
      t.includes("disponible") ||
      t.includes("disponibles") ||
      t.includes("stock") ||
      t.includes("article") ||
      t.includes("articles") ||
      t.includes("produit") ||
      t.includes("produits")
    );
  }

  async function buildAvailabilityAnswer() {
    const products = await fetchProductsLiveList();
    if (!products.length) return "";
    const availableProducts = products
      .filter((p) => normalizeStatus(p.status) !== "out")
      .sort((a, b) => {
        const ca = String(a.category || "").toLowerCase();
        const cb = String(b.category || "").toLowerCase();
        if (ca !== cb) return ca.localeCompare(cb);
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
    if (!availableProducts.length) {
      return "Je ne vois aucun article disponible pour le moment. Voulez-vous que je vous transfere a un conseiller ?";
    }
    const byCategory = new Map();
    for (const p of availableProducts) {
      const cat = String(p.category || "Autres").trim() || "Autres";
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(p);
    }
    const sections = [];
    for (const [cat, items] of byCategory.entries()) {
      const lines = items.slice(0, 10).map((p) => {
        const qty = Number(p.qty || 0);
        const qtyTxt = Number.isFinite(qty) && qty > 0 ? `${qty}` : "n/a";
        return `- ${String(p.name || "Article")} | prix: ${String(p.price ?? "n/a")} FCFA | stock: ${qtyTxt}`;
      });
      sections.push(`${cat}:\n${lines.join("\n")}`);
    }
    const outCount = products.filter((p) => normalizeStatus(p.status) === "out").length;
    return `Articles disponibles actuellement (classes par categorie):\n${sections.join("\n\n")}\n\nArticles en rupture: ${outCount}\nSouhaitez-vous une recommandation selon votre budget ?`;
  }

  async function requestAiReply(chatId, userText) {
    if (!isAiEnabled()) return { reply: "", error: "AI_DISABLED" };
    try {
      const historyRows = await fetchMessages(chatId);
      const siteContext = await buildSiteContext();
      const endpoints = getAiEndpoints();
      let lastNetworkError = "";
      for (const endpoint of endpoints) {
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: userText,
              history: toAiHistory(historyRows),
              context: siteContext,
              model: window.AI_CHAT_MODEL || "",
              system: window.AI_SYSTEM_PROMPT || ""
            })
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => "");
            console.error("AI endpoint error:", endpoint, res.status, errText);
            return { reply: "", error: `AI_HTTP_${res.status}`, detail: errText };
          }
          const data = await res.json();
          const reply = String(data?.reply || "").trim();
          if (!reply) return { reply: "", error: "AI_EMPTY_REPLY" };
          return { reply, error: "", detail: "" };
        } catch (err) {
          lastNetworkError = String(err?.message || err || "network error");
          console.error("AI request failed on endpoint:", endpoint, err);
        }
      }
      return { reply: "", error: "AI_NETWORK", detail: lastNetworkError || "All endpoints failed" };
    } catch (err) {
      console.error("AI request failed:", err);
      return { reply: "", error: "AI_NETWORK", detail: String(err?.message || err || "") };
    }
  }

  async function buildHandoffSummary(chatId) {
    try {
      const rows = await fetchMessages(chatId);
      const lines = rows
        .filter((m) => m && m.text)
        .slice(-12)
        .map((m) => {
          const who = m.sender === "user" ? "CLIENT" : (m.sender === "ai" ? "IA" : "AUTRE");
          return `[${who}] ${String(m.text).replace(/\s+/g, " ").trim()}`;
        });
      return lines.join(" | ").slice(0, 1400);
    } catch {
      return "";
    }
  }

  function isResumeOrder(text) {
    const t = String(text || "").toLowerCase();
    return (
      t.includes("reprendre ia") ||
      t.includes("reactiver ia") ||
      t.includes("réactiver ia") ||
      t.includes("retour ia") ||
      t.includes("retour assistant")
    );
  }

  function buildWidget(mountEl = null) {
    if (document.getElementById("supportChatWidget")) return null;
    const root = document.createElement("div");
    root.id = "supportChatWidget";
    root.style.position = "fixed";
    root.style.right = "18px";
    root.style.bottom = "18px";
    root.style.zIndex = "9999";
    root.innerHTML = `
      <div id="supportChatToggle" class="chat-toggle">Assistant</div>
      <div id="supportChatPanel" class="chat-panel">
        <div class="chat-header">
          <strong>Support</strong>
          <button id="supportChatClose" class="chat-close" type="button">x</button>
        </div>
        <div id="supportChatBody" class="chat-body"></div>
        <div class="chat-actions">
          <button id="supportHumanBtn" class="btn small" type="button">Parler a un humain</button>
        </div>
        <div id="supportSuggestions" class="chat-actions"></div>
        <div class="chat-input">
          <input id="supportChatInput" class="input" placeholder="Ecrivez votre message..." />
          <button id="supportChatSend" class="btn small" type="button">Envoyer</button>
        </div>
        <button id="supportJumpDown" class="chat-jump-down" type="button" title="Aller en bas" hidden>&darr;</button>
        <div class="chat-actions">
          <input id="supportChatFile" class="input" type="file" />
        </div>
        <div id="supportRatingBox" class="chat-actions" style="display:none;">
          <div class="muted">Notez le support (1-5)</div>
          <div class="filters">
            <select id="supportRatingValue" class="input" style="max-width:120px;">
              <option value="5">5</option>
              <option value="4">4</option>
              <option value="3">3</option>
              <option value="2">2</option>
              <option value="1">1</option>
            </select>
            <input id="supportRatingComment" class="input" placeholder="Commentaire (optionnel)" />
            <button id="supportRatingSend" class="btn small" type="button">Envoyer note</button>
          </div>
        </div>
      </div>
    `;
    (mountEl || document.body).appendChild(root);
    return root;
  }

  function init() {
    if (location.pathname.includes("/admin/")) return;
    const isChatPage = /\/chat(?:\.html)?\/?$/i.test(location.pathname);
    const chatMount = isChatPage ? document.getElementById("chatPageMount") : null;
    const root = buildWidget(chatMount);
    if (!root) return;

    const chatId = getChatId();
    const body = root.querySelector("#supportChatBody");
    const toggle = root.querySelector("#supportChatToggle");
    const panel = root.querySelector("#supportChatPanel");
    const close = root.querySelector("#supportChatClose");
    const input = root.querySelector("#supportChatInput");
    const send = root.querySelector("#supportChatSend");
    const human = root.querySelector("#supportHumanBtn");
    const suggestionsBox = root.querySelector("#supportSuggestions");
    const file = root.querySelector("#supportChatFile");
    const jumpDown = root.querySelector("#supportJumpDown");
    const ratingBox = root.querySelector("#supportRatingBox");
    const ratingValue = root.querySelector("#supportRatingValue");
    const ratingComment = root.querySelector("#supportRatingComment");
    const ratingSend = root.querySelector("#supportRatingSend");
    const rendered = new Set();
    const sentTimes = [];
    let stopRealtime = null;
    let pollTimer = null;
    let aiErrorShown = false;
    let userMessageCount = 0;
    let handoffPending = false;
    let lastHandoffAt = 0;

    const SUGGESTIONS_WELCOME = [
      "Quels articles sont disponibles ?",
      "Quels sont vos prix ?",
      "Quels delais de livraison ?",
      "Quels modes de paiement ?"
    ];
    const SUGGESTIONS_AFTER = [
      "Peux-tu recommander un produit ?",
      "Donne-moi un devis rapide",
      "Comparer deux produits",
      "Parler a un humain"
    ];

    function jumpToUserComposer() {
      const target = input?.closest(".chat-input") || input;
      if (!target) return;
      try {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch {
        target.scrollIntoView();
      }
      setTimeout(() => {
        try {
          input?.focus({ preventScroll: true });
        } catch {
          input?.focus();
        }
      }, 220);
    }

    function scrollUserMessagesToBottom() {
      if (!body) return;
      body.scrollTop = body.scrollHeight;
      updateJumpDownVisibility();
    }

    function updateJumpDownVisibility() {
      if (!jumpDown || !body) return;
      const nearBottom = (body.scrollHeight - body.scrollTop - body.clientHeight) < 30;
      jumpDown.hidden = nearBottom;
    }

    if (isChatPage) {
      root.classList.add("chat-page-mode");
      root.style.position = "static";
      root.style.right = "auto";
      root.style.bottom = "auto";
      root.style.width = "100%";
      root.style.maxWidth = "1200px";
      root.style.margin = "0 auto";
      if (toggle) toggle.style.display = "none";
      panel.classList.add("open");
      setTimeout(jumpToUserComposer, 140);
    }

    function renderSuggestions() {
      if (!suggestionsBox) return;
      const source = userMessageCount >= 2 ? SUGGESTIONS_AFTER : SUGGESTIONS_WELCOME;
      suggestionsBox.innerHTML = source.map((q) => `
        <button class="btn small" type="button" data-suggest="${q.replace(/"/g, "&quot;")}">${q}</button>
      `).join("");
      suggestionsBox.querySelectorAll("[data-suggest]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const text = btn.getAttribute("data-suggest") || "";
          if (!text) return;
          if (text.toLowerCase().includes("parler a un humain")) {
            handoffToHuman();
            return;
          }
          sendMessage(text);
        });
      });
    }

    function classifySender(sender) {
      const value = String(sender || "").trim().toLowerCase();
      if (!value) return { role: "bot", label: "Support: " };
      if (value === "user") return { role: "user", label: "" };
      if (value === "admin_note") return null;
      if (value === "admin" || value === "support") return { role: "bot", label: "Assistant(e): " };
      if (value === "ai" || value === "assistant" || value === "bot" || value === "system") {
        return { role: "bot", label: "IA: " };
      }
      return { role: "bot", label: "Support: " };
    }

    function addLine(sender, text, dataUrl = "", filename = "") {
      const senderMeta = classifySender(sender);
      if (!senderMeta) return;
      const div = document.createElement("div");
      div.className = `chat-msg ${senderMeta.role}`;
      if (senderMeta.role === "bot" && senderMeta.label) {
        const prefix = document.createElement("span");
        const labelLower = senderMeta.label.toLowerCase();
        prefix.className = `chat-msg-prefix ${labelLower.includes("ia") ? "chat-msg-prefix-ai" : "chat-msg-prefix-admin"}`;
        prefix.textContent = senderMeta.label;
        const content = document.createElement("span");
        content.textContent = text || "";
        div.appendChild(prefix);
        div.appendChild(content);
      } else {
        div.textContent = text || "";
      }
      if (dataUrl) {
        const link = document.createElement("a");
        link.href = dataUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = `Piece jointe: ${filename || "ouvrir"}`;
        link.style.display = "block";
        link.style.marginTop = "6px";
        div.appendChild(link);
      }
      body.appendChild(div);
      updateJumpDownVisibility();
    }

    function processMessages(messages) {
      let added = false;
      messages.forEach((m) => {
        const key = m.id || `${m.sender}|${m.createdAt}|${m.text}|${m.attachmentName || ""}`;
        if (rendered.has(key)) return;
        rendered.add(key);
        if (m.type === "rating_request") {
          const rated = localStorage.getItem(`${RATED_KEY}_${chatId}`) === "1";
          if (ratingBox) ratingBox.style.display = rated ? "none" : "block";
        }
        if (!classifySender(m.sender)) return;
        addLine(m.sender, m.text, m.attachmentDataUrl, m.attachmentName);
        added = true;
      });
      if (added) {
        scrollUserMessagesToBottom();
      } else {
        updateJumpDownVisibility();
      }
    }

    async function sendAiReplyNow(lastUserText) {
      if (!isAiEnabled()) return;
      const aiResult = await requestAiReply(chatId, lastUserText);
      if (!aiResult.reply) {
        if (isAvailabilityQuestion(lastUserText)) {
          const fallback = await buildAvailabilityAnswer();
          if (fallback) {
            aiErrorShown = false;
            await addMessage(chatId, "ai", fallback, { type: "ai_catalog_fallback" });
            return;
          }
        }
        if (!aiErrorShown) {
          aiErrorShown = true;
          let hint = "";
          if (aiResult.error === "AI_HTTP_401") hint = " (cle OpenAI invalide ou revoquee)";
          if (aiResult.error === "AI_HTTP_429") hint = " (quota/limite atteinte)";
          if (aiResult.error === "AI_NETWORK") {
            hint = " (endpoint IA inaccessible: verifiez URL/HTTPS/localhost)";
          }
          addLine("admin", `Assistant IA indisponible${hint}.`);
        }
        return;
      }
      aiErrorShown = false;
      await addMessage(chatId, "ai", aiResult.reply, { type: "ai_auto" });
    }

    async function handoffToHuman() {
      const nowGate = Date.now();
      if (handoffPending) return;
      if (nowGate - lastHandoffAt < HANDOFF_COOLDOWN_MS) return;
      if (isAiPaused(chatId)) {
        addLine("admin", "Transfert deja effectue. Un conseiller humain prendra le relais.");
        return;
      }
      handoffPending = true;
      lastHandoffAt = nowGate;
      if (human) human.disabled = true;
      const text = "Je souhaite parler a un humain.";
      const now = Date.now();
      while (sentTimes.length && now - sentTimes[0] > SPAM_WINDOW_MS) sentTimes.shift();
      if (sentTimes.length >= SPAM_MAX_MSG) {
        addLine("admin", "Trop de messages. Reessayez dans quelques secondes.");
        handoffPending = false;
        if (human) human.disabled = false;
        return;
      }
      sentTimes.push(now);
      input.value = "";
      try {
        await ensureChatDoc(chatId);
        const recent = await fetchMessages(chatId);
        const lastUserHumanReq = [...recent].reverse().find((m) => {
          const sender = String(m?.sender || "").toLowerCase();
          const type = String(m?.type || "").toLowerCase();
          const txt = String(m?.text || "").trim().toLowerCase();
          return sender === "user" && (type === "human_request" || txt === text.toLowerCase());
        });
        const reqAt = lastUserHumanReq?.createdAt ? new Date(lastUserHumanReq.createdAt).getTime() : 0;
        if (reqAt && (Date.now() - reqAt) < 5 * 60 * 1000) {
          setAiPaused(chatId, true);
          await patchChat(chatId, { status: "human", aiPaused: "true" }).catch(() => {});
          addLine("admin", "Votre demande est deja transmise a un conseiller humain.");
          return;
        }
        await addMessage(chatId, "user", text, { type: "human_request" });
        const summary = await buildHandoffSummary(chatId);
        setAiPaused(chatId, true);
        await patchChat(chatId, {
          status: "human",
          aiPaused: "true",
          handoffRequestedAt: nowIso(),
          handoffSummary: summary
        });
        await addMessage(chatId, "ai", "Je transfere la conversation a un conseiller humain. L'assistant IA est en pause.");
      } catch {
        addLine("admin", "Erreur reseau. Reessayez.");
      } finally {
        setTimeout(() => {
          handoffPending = false;
          if (human) human.disabled = false;
        }, 800);
      }
    }

    async function refreshMessages() {
      try {
        const messages = await fetchMessages(chatId);
        processMessages(messages);
      } catch {
        // ignore
      }
    }

    async function startRealtimeMessages() {
      try {
        stopRealtime = await subscribeMessagesRealtime(
          chatId,
          (messages) => {
            processMessages(messages);
          },
          () => {
            if (!pollTimer) pollTimer = setInterval(refreshMessages, POLL_MS);
          }
        );
      } catch {
        if (!pollTimer) pollTimer = setInterval(refreshMessages, POLL_MS);
      }
    }

    async function sendMessage(text, extra = {}) {
      const value = (text || "").trim();
      if (!value) return;
      const now = Date.now();
      while (sentTimes.length && now - sentTimes[0] > SPAM_WINDOW_MS) sentTimes.shift();
      if (sentTimes.length >= SPAM_MAX_MSG) {
        addLine("admin", "Trop de messages. Reessayez dans quelques secondes.");
        return;
      }
      sentTimes.push(now);
      input.value = "";
      userMessageCount += 1;
      renderSuggestions();
      try {
        await ensureChatDoc(chatId);
        await addMessage(chatId, "user", value, extra);
        if (localStorage.getItem(`${FIRST_USER_KEY}_${chatId}`) !== "1") {
          localStorage.setItem(`${FIRST_USER_KEY}_${chatId}`, "1");
          await patchChat(chatId, { firstUserMessageAt: nowIso() });
        }
        await patchChat(chatId, { language: detectLanguage(value) });
        if (isAiPaused(chatId)) {
          if (isResumeOrder(value)) {
            setAiPaused(chatId, false);
            await patchChat(chatId, { aiPaused: "false", status: "open" });
            await addMessage(chatId, "ai", "Assistant IA reactive. Je reprends la conversation.");
            await sendAiReplyNow(value);
          }
          return;
        }
        await sendAiReplyNow(value);
      } catch {
        addLine("admin", "Erreur reseau. Reessayez.");
      }
    }

    async function sendRating() {
      const value = Number(ratingValue?.value || 5);
      const comment = (ratingComment?.value || "").trim();
      try {
        await addMessage(chatId, "user", `Note support: ${value}/5${comment ? ` - ${comment}` : ""}`, { type: "rating" });
        await patchChat(chatId, {
          rating: String(value),
          ratingComment: comment,
          ratedAt: nowIso()
        });
        localStorage.setItem(`${RATED_KEY}_${chatId}`, "1");
        if (ratingBox) ratingBox.style.display = "none";
      } catch {
        addLine("admin", "Impossible d'envoyer la note.");
      }
    }

    async function sendAttachment() {
      const f = file?.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        const label = input.value.trim() || "Fichier joint";
        sendMessage(label, {
          attachmentName: f.name,
          attachmentDataUrl: dataUrl
        });
        file.value = "";
      };
      reader.readAsDataURL(f);
    }

    async function updatePresence(isOnline) {
      try {
        await patchChat(chatId, {
          userOnline: isOnline ? "true" : "false",
          lastSeenAt: nowIso()
        });
      } catch {
        // ignore
      }
    }

    toggle.addEventListener("click", () => {
      if (!isChatPage) {
        window.location.href = "chat.html";
        return;
      }
      panel.classList.toggle("open");
      if (panel.classList.contains("open")) setTimeout(jumpToUserComposer, 120);
      updateJumpDownVisibility();
    });
    close.addEventListener("click", () => panel.classList.remove("open"));
    send.addEventListener("click", () => sendMessage(input.value));
    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter") send.click();
    });
    human.addEventListener("click", handoffToHuman);
    file.addEventListener("change", sendAttachment);
    body.addEventListener("scroll", updateJumpDownVisibility);
    jumpDown?.addEventListener("click", () => {
      scrollUserMessagesToBottom();
      setTimeout(jumpToUserComposer, 80);
    });
    ratingSend?.addEventListener("click", sendRating);

    ensureChatDoc(chatId).then(() => {
      addLine("admin", "Bonjour, ecrivez votre message.");
      renderSuggestions();
      if (isAiPaused(chatId)) {
        addLine("admin", "Assistant IA en pause. Un conseiller humain prendra le relais.");
      }
      refreshMessages();
      startRealtimeMessages();
      if (isChatPage) setTimeout(jumpToUserComposer, 120);
      updateJumpDownVisibility();
      updatePresence(true);
      setInterval(() => updatePresence(true), PRESENCE_MS);
    });
    window.addEventListener("beforeunload", () => {
      if (stopRealtime) stopRealtime();
      if (pollTimer) clearInterval(pollTimer);
      updatePresence(false);
    });
  }

  window.addEventListener("DOMContentLoaded", init);
})();
