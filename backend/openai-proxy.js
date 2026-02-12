const http = require("node:http");

const PORT = process.env.PORT || 8787;
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  });
  res.end(JSON.stringify(data));
}

function extractText(data) {
  if (!data) return "";
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
  const outputs = Array.isArray(data.output) ? data.output : [];
  for (const item of outputs) {
    const content = item?.content || [];
    for (const part of content) {
      if (part?.type === "output_text" && part?.text) return part.text;
      if (part?.type === "text" && part?.text) return part.text;
    }
  }
  return "";
}

function extractGroqText(data) {
  const text = data?.choices?.[0]?.message?.content;
  return typeof text === "string" ? text : "";
}

function pickProvider() {
  if (GROQ_API_KEY) return "groq";
  if (API_KEY) return "openai";
  return "none";
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    });
    return res.end();
  }

  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, 200, { ok: true, provider: pickProvider() });
  }

  if (req.method !== "POST" || req.url !== "/chat") {
    return sendJson(res, 404, { error: "Not found" });
  }

  const provider = pickProvider();
  if (provider === "none") {
    return sendJson(res, 500, { error: "Missing GROQ_API_KEY (or OPENAI_API_KEY)" });
  }

  let body = "";
  req.on("data", chunk => body += chunk);
  req.on("end", async () => {
    try {
      const payload = JSON.parse(body || "{}");
      const message = String(payload.message || "").trim();
      if (!message) return sendJson(res, 400, { error: "Missing message" });

      const context = String(payload.context || "").trim();
      const customSystem = String(payload.system || "").trim();
      const baseSystem = "Tu es un assistant pour BIEN FAIRE Shop. Reponds en francais, clairement et brievement.";
      const system = context
        ? `${customSystem || baseSystem} Catalogue JSON: ${context}`
        : (customSystem || baseSystem);
      const history = Array.isArray(payload.history) ? payload.history : [];
      const safeHistory = history
        .filter(item => item && typeof item.content === "string" && item.content.trim())
        .map(item => ({
          role: item.role === "user" ? "user" : "assistant",
          content: item.content
        }));

      const messages = [
        { role: "system", content: system },
        ...safeHistory,
        { role: "user", content: message }
      ];

      if (provider === "groq") {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${GROQ_API_KEY}`
          },
          body: JSON.stringify({
            model: payload.model || GROQ_MODEL,
            messages,
            temperature: 0.5,
            max_tokens: 250
          })
        });
        const data = await response.json();
        const reply = extractGroqText(data).trim();
        if (!response.ok) {
          return sendJson(res, response.status, { error: data?.error?.message || "Groq error" });
        }
        return sendJson(res, 200, { reply });
      }

      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: payload.model || MODEL,
          input: messages,
          max_output_tokens: 250
        })
      });
      const data = await response.json();
      const reply = extractText(data) || "";
      if (!response.ok) {
        return sendJson(res, response.status, { error: data?.error?.message || "OpenAI error" });
      }
      return sendJson(res, 200, { reply });
    } catch {
      return sendJson(res, 500, { error: "Server error" });
    }
  });
});

server.listen(PORT, () => {
  const provider = pickProvider();
  console.log(`AI proxy listening on :${PORT} (${provider})`);
});
