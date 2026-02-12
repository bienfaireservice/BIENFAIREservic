// AI chat configuration
// Local dev: uses localhost proxy.
// Production: set localStorage "bf_ai_endpoint" to your deployed proxy URL.
(() => {
  const host = String(window.location.hostname || "").toLowerCase();
  const localHosts = ["localhost", "127.0.0.1"];
  const localEndpoint = "http://localhost:8787/chat";
  const savedEndpoint = String(localStorage.getItem("bf_ai_endpoint") || "").trim();
  const endpoint = savedEndpoint || (localHosts.includes(host) ? localEndpoint : "");

  window.AI_CHAT_ENDPOINT = endpoint;
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
