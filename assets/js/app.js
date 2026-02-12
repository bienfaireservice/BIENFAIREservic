// Core UI + shop logic (Firestore products + local cart)
document.documentElement.classList.add("js");

const PROJECT_ID = "bienfaireservic";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const store = {
  cartKey: "bf_cart",
  orderKey: "bf_orders",
  userKey: "bf_user"
};
const runtimeCache = {
  productsPromise: null,
  productsFetchedAt: 0,
  firebaseSdkPromise: null,
  chatbotSettingsPromise: null
};
const PRODUCTS_CACHE_TTL_MS = 60000;

function qs(sel, parent = document) { return parent.querySelector(sel); }
function qsa(sel, parent = document) { return [...parent.querySelectorAll(sel)]; }

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!(window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1")) return;
  const isAdminPage = /\/admin\//.test(location.pathname);
  const swUrl = isAdminPage ? "../sw.js" : "sw.js";
  navigator.serviceWorker.register(swUrl).catch(() => {
    // ignore registration errors
  });
}

function getProductsCached() {
  const expired = (Date.now() - runtimeCache.productsFetchedAt) > PRODUCTS_CACHE_TTL_MS;
  if (!runtimeCache.productsPromise || expired) {
    runtimeCache.productsPromise = loadProducts();
    runtimeCache.productsFetchedAt = Date.now();
  }
  return runtimeCache.productsPromise;
}

function getChatbotSettingsCached() {
  if (!runtimeCache.chatbotSettingsPromise) {
    runtimeCache.chatbotSettingsPromise = loadChatbotSettings();
  }
  return runtimeCache.chatbotSettingsPromise;
}

function bindThemeToggle() {
  const toggle = qs("#themeToggle");
  if (!toggle) return;
  toggle.addEventListener("click", () => {
    const html = document.documentElement;
    const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", next);
    localStorage.setItem("bf_theme", next);
  });
  const saved = localStorage.getItem("bf_theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
}

function bindNavToggle() {
  const btn = qs("#navToggle");
  const nav = qs("#nav");
  let backdrop = qs("#navBackdrop");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "navBackdrop";
    backdrop.className = "nav-backdrop";
    document.body.appendChild(backdrop);
  }
  if (!btn || !nav) return;
  const close = () => {
    nav.classList.remove("show");
    backdrop.classList.remove("show");
  };
  const open = () => {
    nav.classList.add("show");
    backdrop.classList.add("show");
  };
  btn.addEventListener("click", () => {
    if (nav.classList.contains("show")) close(); else open();
  });
  backdrop.addEventListener("click", close);
  nav.addEventListener("click", (e) => {
    if (e.target.tagName === "A") close();
  });
}

function bindReveal() {
  const els = qsa(".reveal");
  if (!els.length) return;
  els.forEach(el => el.classList.add("show"));
}

function getCart() {
  try { return JSON.parse(localStorage.getItem(store.cartKey)) || []; } catch { return []; }
}
function saveCart(cart) { localStorage.setItem(store.cartKey, JSON.stringify(cart)); }

function updateCartCount() {
  const cart = getCart();
  const count = cart.reduce((sum, item) => sum + item.qty, 0);
  const el = qs("#cartCount");
  if (el) el.textContent = count;
}

function formatMoney(n) {
  return `${new Intl.NumberFormat("fr-FR").format(n)} FCFA`;
}

function mapFirestoreDoc(doc) {
  const f = doc.fields || {};
  const get = (k, def = "") => (f[k]?.stringValue ?? def);
  const num = (k, def = 0) => (f[k]?.integerValue ? Number(f[k].integerValue) : (f[k]?.doubleValue ? Number(f[k].doubleValue) : def));
  return {
    id: doc.name.split("/").pop(),
    name: get("name"),
    description: get("description"),
    price: num("price"),
    qty: num("qty"),
    category: get("category"),
    status: get("status", "in"),
    image: get("image")
  };
}

function mapSdkProductDoc(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    name: String(data.name || ""),
    description: String(data.description || ""),
    price: Number(data.price || 0),
    qty: Number(data.qty || 0),
    category: String(data.category || ""),
    status: String(data.status || "in"),
    image: String(data.image || "")
  };
}

async function getFirebaseProductsSdk() {
  if (!runtimeCache.firebaseSdkPromise) {
    runtimeCache.firebaseSdkPromise = Promise.all([
      import("./firebase-config.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
    ]).then(([cfg, appMod, fsMod]) => {
      const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(cfg.firebaseConfig);
      const db = fsMod.getFirestore(app);
      return { db, fsMod };
    });
  }
  const { db, fsMod } = await runtimeCache.firebaseSdkPromise;
  const snap = await fsMod.getDocs(fsMod.collection(db, "products"));
  return snap.docs.map(mapSdkProductDoc);
}

async function loadProducts() {
  try {
    const res = await fetch(`${FIRESTORE_BASE}/products`);
    if (res.ok) {
      const data = await res.json();
      if (data.documents) return data.documents.map(mapFirestoreDoc);
    }
  } catch {
    // fallback below
  }
  // Fallback robuste: SDK Firestore (evite certaines erreurs REST/429)
  try {
    const sdkProducts = await getFirebaseProductsSdk();
    if (sdkProducts.length) return sdkProducts;
  } catch {
    // fallback below
  }
  try {
    const res = await fetch("assets/data/products.json");
    if (res.ok) return res.json();
  } catch {
    // ignore
  }
  return [];
}

async function loadChatbotSettings() {
  const localEnabled = window.AI_CHAT_ENABLED === true;
  try {
    const res = await fetch(`${FIRESTORE_BASE}/settings/chatbot`);
    if (!res.ok) return { aiEnabled: localEnabled };
    const data = await res.json();
    const f = data.fields || {};
    return { aiEnabled: localEnabled || f.aiEnabled?.booleanValue === true };
  } catch {
    return { aiEnabled: localEnabled };
  }
}

function addToCart(product, qty = 1) {
  const cart = getCart();
  const existing = cart.find(i => i.id === product.id);
  if (existing) existing.qty += qty; else cart.push({ ...product, qty });
  saveCart(cart);
  updateCartCount();
}

function renderFeatured(products) {
  const box = qs("#featured");
  if (!box) return;
  box.innerHTML = products.slice(0, 3).map(p => `
    <div class="product">
      <div class="thumb">
        ${p.image ? `<img src="${p.image}" alt="${p.name}" />` : ""}
      </div>
      <div>
        <h3>${p.name}</h3>
        <div class="muted">${p.category || ""}</div>
      </div>
      <div class="meta">
        <strong>${formatMoney(p.price)}</strong>
        <button class="btn small" data-id="${p.id}">Ajouter</button>
      </div>
    </div>
  `).join("");
  qsa("#featured .btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const product = products.find(p => p.id === btn.dataset.id);
      if (product) addToCart(product);
    });
  });
}

async function renderShop() {
  const grid = qs("#productGrid");
  if (!grid) return;
  grid.innerHTML = `<div class="card">Chargement des produits...</div>`;
  let products = await getProductsCached();
  const categories = ["all", ...new Set(products.map(p => p.category).filter(Boolean))];
  const catSelect = qs("#categoryFilter");
  if (catSelect) {
    catSelect.innerHTML = categories.map(c => `<option value="${c}">${c}</option>`).join("");
  }

  function draw() {
    const query = (qs("#searchInput")?.value || "").toLowerCase();
    const cat = qs("#categoryFilter")?.value || "all";
    const stock = qs("#stockFilter")?.value || "all";
    const filtered = products.filter(p => {
      const matchesQuery = (p.name || "").toLowerCase().includes(query);
      const matchesCat = cat === "all" || p.category === cat;
      const matchesStock = stock === "all" || (stock === "in" ? p.status === "in" : p.status === "out");
      return matchesQuery && matchesCat && matchesStock;
    });
    grid.innerHTML = filtered.map(p => `
      <div class="product">
        <div class="thumb">
          ${p.image ? `<img src="${p.image}" alt="${p.name}" />` : ""}
        </div>
        <div>
          <h3>${p.name}</h3>
          <div class="muted">${p.category || ""}</div>
          <div class="muted">${p.status === "in" ? "En stock" : "Rupture"}</div>
        </div>
        <div class="meta">
          <strong>${formatMoney(p.price)}</strong>
          <div>
            <a class="btn small" href="product.html?id=${p.id}">Voir</a>
            <button class="btn small" data-id="${p.id}">Ajouter</button>
          </div>
        </div>
      </div>
    `).join("");
    qsa("#productGrid .btn.small[data-id]").forEach(btn => {
      btn.addEventListener("click", () => {
        const product = products.find(p => p.id === btn.dataset.id);
        if (product) addToCart(product);
      });
    });
  }

  ["#searchInput", "#categoryFilter", "#stockFilter"].forEach(id => {
    qs(id)?.addEventListener("input", draw);
  });
  draw();
}

async function renderProduct() {
  const box = qs("#productDetail");
  if (!box) return;
  box.innerHTML = `<div class="card">Chargement du produit...</div>`;
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const products = await getProductsCached();
  const product = products.find(p => p.id === id) || products[0];
  if (!product) return;
  box.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="thumb" style="height:220px;">
          ${product.image ? `<img src="${product.image}" alt="${product.name}" />` : ""}
        </div>
      </div>
      <div class="card">
        <h1>${product.name}</h1>
        <p class="muted">${product.description || ""}</p>
        <div class="summary-row"><span>Categorie</span><strong>${product.category || ""}</strong></div>
        <div class="summary-row"><span>Statut</span><strong>${product.status === "in" ? "En stock" : "Rupture"}</strong></div>
        <div class="summary-row"><span>Prix</span><strong>${formatMoney(product.price)}</strong></div>
        <button class="btn primary" id="addToCart">Ajouter au panier</button>
      </div>
    </div>
  `;
  qs("#addToCart")?.addEventListener("click", () => addToCart(product));
}

function renderCart() {
  const box = qs("#cartItems");
  if (!box) return;
  const cart = getCart();
  if (!cart.length) {
    box.innerHTML = `<div class="card">Panier vide.</div>`;
  } else {
    box.innerHTML = cart.map(item => `
      <div class="cart-item">
        <div class="thumb">
          ${item.image ? `<img src="${item.image}" alt="${item.name}" />` : ""}
        </div>
        <div>
          <strong>${item.name}</strong>
          <div class="muted">${formatMoney(item.price)}</div>
          <div class="muted">Quantite: <input class="input" data-id="${item.id}" type="number" min="1" value="${item.qty}" style="width:90px; display:inline-block;" /></div>
        </div>
        <button class="btn small" data-remove="${item.id}">Supprimer</button>
      </div>
    `).join("");
  }
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  qs("#subtotal") && (qs("#subtotal").textContent = formatMoney(subtotal));
  qs("#total") && (qs("#total").textContent = formatMoney(subtotal));

  qsa("[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.remove;
      const next = cart.filter(i => i.id !== id);
      saveCart(next);
      renderCart();
      updateCartCount();
    });
  });

  qsa("input[data-id]").forEach(input => {
    input.addEventListener("change", () => {
      const id = input.dataset.id;
      const next = cart.map(i => i.id === id ? { ...i, qty: Math.max(1, Number(input.value)) } : i);
      saveCart(next);
      renderCart();
      updateCartCount();
    });
  });

  const placeOrder = qs("#placeOrder");
  if (placeOrder) {
    placeOrder.addEventListener("click", async () => {
      const name = qs("#customerName")?.value || "";
      const phone = qs("#customerPhone")?.value || "";
      const email = qs("#customerEmail")?.value || "";
      const address = qs("#customerAddress")?.value || "";
      const payment = qsa("input[name=payment]").find(r => r.checked)?.value || "whatsapp";
      // Block banned users if they are logged in (email match)
      try {
        const userEmail = (window?.currentUserEmail || "").toLowerCase();
        if (userEmail) {
          const res = await fetch(`${FIRESTORE_BASE}/users`);
          if (res.ok) {
            const data = await res.json();
            const banned = (data.documents || []).some(doc => {
              const f = doc.fields || {};
              const email = (f.email?.stringValue || "").toLowerCase();
              const isBanned = f.banned?.booleanValue === true;
              return email === userEmail && isBanned;
            });
            if (banned) {
              alert("Votre compte est suspendu. Commande impossible.");
              return;
            }
          }
        }
      } catch {
        // ignore
      }

      const order = {
        items: cart,
        total: subtotal,
        payment,
        customer: { name, phone, email, address },
        status: "new",
        createdAt: new Date().toISOString()
      };
      try {
        await fetch(`${FIRESTORE_BASE}/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: {
              total: { integerValue: String(order.total) },
              payment: { stringValue: order.payment },
              status: { stringValue: order.status },
              customer: {
                mapValue: {
                  fields: {
                    name: { stringValue: order.customer.name },
                    phone: { stringValue: order.customer.phone },
                    email: { stringValue: order.customer.email },
                    address: { stringValue: order.customer.address }
                  }
                }
              },
              items: {
                arrayValue: {
                  values: order.items.map(i => ({
                    mapValue: {
                      fields: {
                        id: { stringValue: i.id },
                        name: { stringValue: i.name },
                        price: { integerValue: String(i.price) },
                        qty: { integerValue: String(i.qty) }
                      }
                    }
                  }))
                }
              },
              createdAt: { stringValue: order.createdAt }
            }
          })
        });
        await sendOrderEmail(order);
      } catch {
        const orders = JSON.parse(localStorage.getItem(store.orderKey) || "[]");
        orders.unshift(order);
        localStorage.setItem(store.orderKey, JSON.stringify(orders));
      }
      saveCart([]);
      renderCart();
      updateCartCount();
      alert("Commande enregistree. Un conseiller vous recontacte.");
      updateWhatsapp();
    });
  }

  updateWhatsapp();
}

function updateWhatsapp() {
  const btn = qs("#whatsappOrder");
  if (!btn) return;
  const cart = getCart();
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const lines = cart.map(i => `- ${i.name} x${i.qty}`);
  const text = `Bonjour, je souhaite commander:%0A${lines.join("%0A")}%0ATotal: ${total} FCFA`;
  btn.href = `https://wa.me/2250142824932?text=${text}`;
}

async function sendOrderEmail(order) {
  const cfg = window.EMAIL_CONFIG;
  if (!cfg || !cfg.serviceId || cfg.serviceId.startsWith("YOUR_")) return;
  try {
    await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: cfg.serviceId,
        template_id: cfg.templateId,
        user_id: cfg.publicKey,
        template_params: {
          to_email: cfg.toEmail,
          customer_name: order.customer?.name || "",
          customer_phone: order.customer?.phone || "",
          customer_email: order.customer?.email || "",
          total: order.total,
          payment: order.payment,
          items: order.items.map(i => `${i.name} x${i.qty}`).join(", ")
        }
      })
    });
  } catch {
    // ignore
  }
}

async function init() {
  registerServiceWorker();
  bindThemeToggle();
  bindNavToggle();
  bindReveal();
  updateCartCount();
  renderCart();
  const featured = qs("#featured");
  if (featured) {
    featured.innerHTML = `
      <div class="card">Chargement...</div>
      <div class="card">Chargement...</div>
      <div class="card">Chargement...</div>
    `;
  }

  getProductsCached()
    .then((products) => {
      window.__productsCache = products;
      renderFeatured(products);
      return Promise.all([renderShop(), renderProduct()]);
    })
    .catch(() => {
      // ignore rendering errors to keep UI running
    });
}

window.addEventListener("DOMContentLoaded", init);

// --- Simple Chat Assistant (bot + live handoff) ---
function initChatWidget() {
  if (document.getElementById("chatWidget")) return;
  const widget = document.createElement("div");
  widget.id = "chatWidget";
  widget.innerHTML = `
    <div class="chat-toggle">Assistant</div>
    <div class="chat-panel">
      <div class="chat-header">
        <strong>Assistant</strong>
        <button class="chat-close">×</button>
      </div>
      <div class="chat-body" id="chatBody"></div>
      <div class="chat-actions">
        <button class="btn small" id="chatHuman">Parler a un humain</button>
      </div>
      <div class="chat-input">
        <input class="input" id="chatInput" placeholder="Ecrivez votre message..." />
        <button class="btn small" id="chatSend">Envoyer</button>
      </div>
    </div>
  `;
  document.body.appendChild(widget);

  const toggle = widget.querySelector(".chat-toggle");
  const panel = widget.querySelector(".chat-panel");
  const close = widget.querySelector(".chat-close");
  const body = widget.querySelector("#chatBody");
  const input = widget.querySelector("#chatInput");
  const sendBtn = widget.querySelector("#chatSend");
  const humanBtn = widget.querySelector("#chatHuman");

  const chatId = getChatId();
  ensureChatDoc(chatId);
  const memory = [];
  window.__chatMemory = memory;
  const seenAdminMessages = new Set();

  function addMsg(text, who = "bot") {
    const div = document.createElement("div");
    div.className = `chat-msg ${who}`;
    div.textContent = text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    memory.push({ sender: who, text });
    if (memory.length > 30) memory.shift();
  }

  async function botReply(text) {
    const lower = text.toLowerCase();
    // Firestore FAQ (admin editable)
    try {
      const res = await fetch(`${FIRESTORE_BASE}/faq`);
      if (res.ok) {
        const data = await res.json();
        const docs = data.documents || [];
        const matches = [];
        for (const doc of docs) {
          const f = doc.fields || {};
          const q = (f.question?.stringValue || "").toLowerCase();
          const a = f.answer?.stringValue || "";
          const cat = (f.category?.stringValue || "").toLowerCase();
          const score = f.score?.integerValue ? Number(f.score.integerValue) : (f.score?.doubleValue ? Number(f.score.doubleValue) : 0);
          const questionMatch = q && q.split(",").some(k => lower.includes(k.trim()));
          if (!questionMatch) continue;
          const catKeywords = cat ? cat.split(",").map(k => k.trim()).filter(Boolean) : [];
          const categoryMatch = catKeywords.length ? catKeywords.some(k => lower.includes(k)) : false;
          matches.push({ answer: a, score, categoryMatch });
        }
        if (matches.length) {
          matches.sort((x, y) => {
            if (x.categoryMatch !== y.categoryMatch) return x.categoryMatch ? -1 : 1;
            return y.score - x.score;
          });
          return { text: matches[0].answer, sender: "bot" };
        }
      }
    } catch {
      // ignore
    }
    const aiReply = await tryAiReply(text, window.__productsCache || [], chatId);
    if (aiReply) return { text: aiReply, sender: "ai" };
    // Category bots (route by keywords)
    const botCategories = [
      {
        name: "Paiement",
        keywords: ["paiement", "payer", "mobile money", "mtn", "orange", "moov", "carte", "paypal", "stripe"],
        replies: [
          "Paiement: Mobile Money (Orange/MTN/Moov) et WhatsApp. Carte dispo en option.",
          "Paiement: dites le mode (Orange, MTN, Moov) et on valide la commande."
        ]
      },
      {
        name: "Livraison",
        keywords: ["livraison", "livrer", "adresse", "delai", "délai", "expedition", "expédition"],
        replies: [
          "Livraison: Abidjan et environs. Donnez votre adresse pour le delai.",
          "Livraison: dites la zone et la date souhaitee, on confirme."
        ]
      },
      {
        name: "Stock",
        keywords: ["stock", "disponible", "rupture", "quantite", "quantité"],
        replies: [
          "Stock: donnez le nom du produit, je verifie.",
          "Stock: indiquez le modele et la quantite."
        ]
      },
      {
        name: "Devis",
        keywords: ["devis", "proforma", "facture", "facturation", "proforma"],
        replies: [
          "Devis: listez les produits + quantites, je prepare.",
          "Devis: envoyez les references et votre email."
        ]
      },
      {
        name: "SAV",
        keywords: ["garantie", "sav", "retour", "reparation", "réparation"],
        replies: [
          "SAV: indiquez le produit et le probleme, on vous aide.",
          "Garantie/SAV: envoyez la reference et la date d'achat."
        ]
      }
    ];
    const matchedBot = botCategories.find(b => b.keywords.some(k => lower.includes(k)));
    if (matchedBot) {
      const reply = matchedBot.replies[Math.floor(Math.random() * matchedBot.replies.length)];
      return { text: `${matchedBot.name}: ${reply}`, sender: "bot" };
    }
    // Fallback rules
    const rules = [
      { k: ["prix", "tarif", "cost", "price"], r: "Les prix sont visibles dans la boutique. Donnez le produit pour un devis rapide." },
      { k: ["livraison", "delivery", "livrer"], r: "Livraison possible a Abidjan et environs. Donnez votre adresse." },
      { k: ["paiement", "payer", "mobile money", "mtn", "orange", "moov"], r: "Paiements: WhatsApp, Mobile Money (Orange/MTN/Moov), carte (optionnel)." },
      { k: ["stock", "disponible", "rupture"], r: "Je peux verifier le stock. Quel produit ?" },
      { k: ["garantie", "sav", "retour"], r: "Garantie et SAV disponibles. Dites-moi le produit concerne." },
      { k: ["facture", "devis", "proforma"], r: "Je peux preparer un devis. Merci d'indiquer les produits et quantites." },
      { k: ["contact", "conseiller", "humain"], r: "Je transmets a un conseiller. Cliquez sur 'Parler a un humain'." },
      { k: ["heure", "ouvert", "horaires"], r: "Nous sommes disponibles 24/7 pour les commandes." },
      { k: ["reduction", "promo", "promotion"], r: "Promotions possibles selon volume. Donnez vos quantites." }
    ];
    for (const rule of rules) {
      if (rule.k.some(k => lower.includes(k))) return { text: rule.r, sender: "bot" };
    }
    return { text: "Je peux aider pour prix, stock, livraison, paiement, devis. Dites-moi votre besoin.", sender: "bot" };
  }

  async function sendMessage(text, who = "user") {
    if (!text) return;
    addMsg(text, who);
    await saveMessage(chatId, text, who);
    if (who === "user") {
      const reply = await botReply(text);
      addMsg(reply.text, reply.sender);
      await saveMessage(chatId, reply.text, reply.sender);
    }
  }

  async function syncAdminReplies() {
    try {
      const rows = await fetchChatHistory(chatId, 40);
      rows
        .filter((m) => m.sender === "admin")
        .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))
        .forEach((m) => {
          const key = `${m.id || ""}|${m.sender}|${m.createdAt || ""}|${m.text || ""}`;
          if (seenAdminMessages.has(key)) return;
          seenAdminMessages.add(key);
          addMsg(`Conseiller: ${m.text}`, "bot");
        });
    } catch {
      // ignore
    }
  }

  toggle.addEventListener("click", () => panel.classList.toggle("open"));
  close.addEventListener("click", () => panel.classList.remove("open"));
  sendBtn.addEventListener("click", () => {
    const text = input.value.trim();
    input.value = "";
    sendMessage(text, "user");
  });
  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendBtn.click();
  });
  humanBtn.addEventListener("click", async () => {
    await ensureChatDoc(chatId);
    await saveMessage(chatId, "Je souhaite parler a un humain.", "user");
    await updateChatStatus(chatId, "human", "Je souhaite parler a un humain.");
    addMsg("Un conseiller va vous repondre.", "bot");
  });

  // Greeting
  addMsg("Bonjour! Comment puis-je vous aider?", "bot");
  syncAdminReplies();
  setInterval(syncAdminReplies, 4000);
}

function buildProductContext(products) {
  if (!products?.length) return "";
  const top = products.slice(0, 30).map(p => ({
    name: p.name,
    price: p.price,
    category: p.category,
    status: p.status
  }));
  return JSON.stringify(top);
}

async function fetchChatHistory(chatId, limit = 12) {
  if (!chatId) return [];
  try {
    const res = await fetch(`${FIRESTORE_BASE}/chats/${chatId}:runQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "messages" }],
          orderBy: [{ field: { fieldPath: "createdAt" }, direction: "ASCENDING" }],
          limit
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
      const text = f.text?.stringValue || "";
      const sender = f.sender?.stringValue || "user";
      const createdAt = f.createdAt?.stringValue || "";
      const id = (doc.name || "").split("/").pop();
      if (!text) continue;
      out.push({ id, sender, text, createdAt });
    }
    return out;
  } catch {
    return [];
  }
}

function buildHistoryPayload(messages = []) {
  return messages
    .filter(m => m && m.text)
    .map(m => ({
      role: m.sender === "user" ? "user" : "assistant",
      content: String(m.text)
    }));
}

async function tryAiReply(text, products = [], chatId = "") {
  const settings = window.__chatbotSettings || { aiEnabled: false };
  if (!settings.aiEnabled) return "";
  const disabledUntil = Number(localStorage.getItem("bf_ai_disabled_until") || 0);
  if (disabledUntil && Date.now() < disabledUntil) return "";
  const endpoint = (window.AI_CHAT_ENDPOINT || "").trim();
  if (!endpoint) return "";
  const firestoreHistory = await fetchChatHistory(chatId, 12);
  const localHistory = Array.isArray(window.__chatMemory) ? window.__chatMemory : [];
  const history = buildHistoryPayload(firestoreHistory.length ? firestoreHistory : localHistory).slice(-12);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        locale: "fr",
        model: window.AI_CHAT_MODEL || "",
        context: buildProductContext(products),
        history,
        system: window.AI_SYSTEM_PROMPT || ""
      })
    });
    if (!res.ok) {
      localStorage.setItem("bf_ai_disabled_until", String(Date.now() + 10 * 60 * 1000));
      return "";
    }
    const data = await res.json();
    return data?.reply || "";
  } catch {
    localStorage.setItem("bf_ai_disabled_until", String(Date.now() + 10 * 60 * 1000));
    return "";
  }
}

function getChatId() {
  const key = "bf_chat_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

function getChatUserMeta() {
  let name = "Client";
  let email = "";
  try {
    const cached = JSON.parse(localStorage.getItem("bf_ui_user_cache") || "{}");
    if (cached?.name) name = String(cached.name);
    if (cached?.email) email = String(cached.email);
  } catch {
    // ignore
  }
  if (!email && window?.currentUserEmail) {
    email = String(window.currentUserEmail);
  }
  if ((!name || name === "Client") && email) {
    name = email.split("@")[0] || "Client";
  }
  return { name, email };
}

async function ensureChatDoc(chatId) {
  try {
    const user = getChatUserMeta();
    await fetch(`${FIRESTORE_BASE}/chats?documentId=${chatId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          status: { stringValue: "bot" },
          createdAt: { stringValue: new Date().toISOString() },
          userName: { stringValue: user.name || "Client" },
          userEmail: { stringValue: user.email || "" }
        }
      })
    });
    await fetch(`${FIRESTORE_BASE}/chats/${chatId}?updateMask.fieldPaths=userName&updateMask.fieldPaths=userEmail`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          userName: { stringValue: user.name || "Client" },
          userEmail: { stringValue: user.email || "" }
        }
      })
    });
  } catch {
    // ignore
  }
}

async function saveMessage(chatId, text, sender) {
  try {
    const user = getChatUserMeta();
    const msgFields = {
      text: { stringValue: text },
      sender: { stringValue: sender },
      createdAt: { stringValue: new Date().toISOString() }
    };
    if (sender === "user") {
      msgFields.senderName = { stringValue: user.name || "Client" };
      msgFields.senderEmail = { stringValue: user.email || "" };
    }
    await fetch(`${FIRESTORE_BASE}/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: msgFields
      })
    });
    const userMask = sender === "user" ? "&updateMask.fieldPaths=userName&updateMask.fieldPaths=userEmail" : "";
    await fetch(`${FIRESTORE_BASE}/chats/${chatId}?updateMask.fieldPaths=lastMessageAt&updateMask.fieldPaths=lastMessageSender&updateMask.fieldPaths=lastMessageText${userMask}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          lastMessageAt: { stringValue: new Date().toISOString() },
          lastMessageSender: { stringValue: sender },
          lastMessageText: { stringValue: text },
          ...(sender === "user" ? {
            userName: { stringValue: user.name || "Client" },
            userEmail: { stringValue: user.email || "" }
          } : {})
        }
      })
    });
  } catch {
    // ignore
  }
}

async function updateChatStatus(chatId, status, note = "") {
  try {
    const now = new Date().toISOString();
    const mask = `updateMask.fieldPaths=status&updateMask.fieldPaths=lastMessageAt&updateMask.fieldPaths=lastMessageSender&updateMask.fieldPaths=lastMessageText${status === "human" ? "&updateMask.fieldPaths=humanRequestedAt" : ""}`;
    await fetch(`${FIRESTORE_BASE}/chats/${chatId}?${mask}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          status: { stringValue: status },
          lastMessageAt: { stringValue: now },
          lastMessageSender: { stringValue: "user" },
          lastMessageText: { stringValue: note || "Demande de conseiller humain" },
          ...(status === "human" ? { humanRequestedAt: { stringValue: now } } : {})
        }
      })
    });
  } catch {
    // ignore
  }
}
