// AI chat configuration
// Local dev: uses localhost proxy.
// Production: set localStorage "bf_ai_endpoint" to your deployed proxy URL.
(() => {
  const host = String(window.location.hostname || "").toLowerCase();
  const localHosts = ["localhost", "127.0.0.1"];
  const localEndpoint = "http://localhost:8787/chat";
  const prodDefaultEndpoint = "https://bienfaireservic.onrender.com/chat";
  const params = new URLSearchParams(window.location.search);
  const queryEndpoint = String(
    params.get("ai_endpoint") ||
    params.get("ai") ||
    ""
  ).trim();
  const shouldSaveQueryEndpoint = queryEndpoint && (
    params.get("save_ai") === "1" ||
    params.get("saveAi") === "1"
  );
  const savedEndpoint = String(localStorage.getItem("bf_ai_endpoint") || "").trim();

  function normalizeEndpoint(raw) {
    const value = String(raw || "").trim();
    if (!value) return "";
    try {
      const url = new URL(value, window.location.origin);
      const epHost = String(url.hostname || "").toLowerCase();
      const isEndpointLocal = localHosts.includes(epHost);
      const isPageLocal = localHosts.includes(host);
      if (!isPageLocal && isEndpointLocal) return "";
      if (window.location.protocol === "https:" && url.protocol === "http:" && !isEndpointLocal) {
        url.protocol = "https:";
      }
      return url.href;
    } catch {
      return "";
    }
  }

  const normalizedQueryEndpoint = normalizeEndpoint(queryEndpoint);
  const normalizedSavedEndpoint = normalizeEndpoint(savedEndpoint);
  const endpoint = normalizedQueryEndpoint || normalizedSavedEndpoint || (localHosts.includes(host) ? localEndpoint : prodDefaultEndpoint);
  const fallbacks = [prodDefaultEndpoint].filter((item) => item && item !== endpoint);

  if (shouldSaveQueryEndpoint) {
    try {
      if (normalizedQueryEndpoint) {
        localStorage.setItem("bf_ai_endpoint", normalizedQueryEndpoint);
      }
    } catch {
      // ignore storage errors
    }
  }

  window.AI_CHAT_ENDPOINT = endpoint;
  window.AI_CHAT_ENDPOINT_FALLBACKS = fallbacks;
  window.AI_CHAT_MODEL = ""; // optional, if your proxy accepts it
  window.AI_CHAT_ENABLED = Boolean(endpoint);
})();
window.AI_SYSTEM_PROMPT = [
  "Tu es l'assistant officiel de BIEN FAIRE Shop.",
  "Reponds en francais de facon naturelle et conversationnelle, comme un assistant moderne.",
  "Tu reponds aussi aux salutations (bonjour, salut, merci, etc.).",
  "Objectif: aider a l'achat, proposer un devis, guider vers la boutique.",
  "Infos: livraison Abidjan et environs, service 24/7, paiement Mobile Money/WhatsApp, carte en option.",
  "Si une info manque, pose une question simple et utile.",
  "Utilise le contexte produits/pages fourni pour repondre de facon precise.",
  "Ne fabrique pas les prix, stocks ou promesses non confirmes."
].join(" ");
