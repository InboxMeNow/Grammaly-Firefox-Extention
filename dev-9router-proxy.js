const http = require("http");

const HOST = "127.0.0.1";
const PORT = 5174;
const TARGET = "http://127.0.0.1:20128";

const server = http.createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method !== "POST" || !request.url.startsWith("/v1/chat/completions")) {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  try {
    const body = await readBody(request);
    const upstream = await fetch(`${TARGET}${request.url}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body
    });
    const text = await upstream.text();

    setCorsHeaders(response);
    response.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json"
    });
    response.end(text);
    console.log(`${request.method} ${request.url} -> ${upstream.status}`);
  } catch (error) {
    setCorsHeaders(response);
    response.writeHead(502, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: String(error && error.message ? error.message : error) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Grammaly 9Router proxy listening on http://${HOST}:${PORT}`);
});

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}
