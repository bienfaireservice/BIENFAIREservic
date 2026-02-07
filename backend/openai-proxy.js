const http = require("node:http");

const PORT = process.env.PORT || 8787;
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
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

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    });
    return res.end();
  }

  if (req.method !== "POST" || req.url !== "/chat") {
    return sendJson(res, 404, { error: "Not found" });
  }

  if (!API_KEY) {
    return sendJson(res, 500, { error: "Missing OPENAI_API_KEY" });
  }

  let body = "";
  req.on("data", chunk => body += chunk);
  req.on("end", async () => {
    try {
      const payload = JSON.parse(body || "{}");
      const message = String(payload.message || "").trim();
      if (!message) return sendJson(res, 400, { error: "Missing message" });

      const context = String(payload.context || "").trim();
      const system = context
        ? `Tu es un assistant pour BIEN FAIRE Shop. Reponds en francais, clairement et brièvement. Catalogue JSON: ${context}`
        : "Tu es un assistant pour BIEN FAIRE Shop. Reponds en francais, clairement et brièvement.";

      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: payload.model || MODEL,
          input: [
            { role: "system", content: system },
            { role: "user", content: message }
          ],
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
  console.log(`AI proxy listening on :${PORT}`);
});
