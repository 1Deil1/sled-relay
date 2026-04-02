// relay-server.js
// Runs on Railway (or any Node.js host)
// Relays messages between the Unity game client and the phone controller client.

const WebSocket = require("ws");
const http = require("http");

const PORT = process.env.PORT || 3000;

// Simple HTTP server for health checks and CORS preflight
const httpServer = http.createServer((req, res) => {
  // CORS headers for fetch /ping from phone controller
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/ping") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("pong");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Sled Relay Server running.");
});

const wss = new WebSocket.Server({ noServer: true });

// Explicit upgrade handling — required for some cloud platforms (Railway, Render, etc.)
httpServer.on("upgrade", (request, socket, head) => {
  console.log("WebSocket upgrade request from:", request.headers.origin || "unknown origin");
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

// We expect exactly two clients: one Unity game (role: "game") and one phone (role: "phone")
let gameClient = null;
let phoneClient = null;

wss.on("connection", (ws) => {
  console.log("New client connected. Total:", wss.clients.size);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // First message must be a handshake: { "type": "register", "role": "game" | "phone" }
    if (!ws.role) {
      if (msg.type === "register" && (msg.role === "game" || msg.role === "phone")) {
        ws.role = msg.role;
        if (msg.role === "game")  { gameClient  = ws; console.log("Unity game registered."); }
        if (msg.role === "phone") { phoneClient = ws; console.log("Phone controller registered."); }

        // Notify both sides about connection status
        broadcastStatus();
      }
      return;
    }

    // Phone → Game: tilt data { pitch, roll }
    if (ws.role === "phone" && gameClient && gameClient.readyState === WebSocket.OPEN) {
      gameClient.send(raw.toString());
    }

    // Game → Phone: optional feedback (e.g. speed, score) — forward if needed
    if (ws.role === "game" && phoneClient && phoneClient.readyState === WebSocket.OPEN) {
      phoneClient.send(raw.toString());
    }
  });

  ws.on("close", () => {
    if (ws.role === "game")  { gameClient  = null; console.log("Unity game disconnected."); }
    if (ws.role === "phone") { phoneClient = null; console.log("Phone disconnected."); }
    broadcastStatus();
  });

  ws.on("error", (err) => console.error("WS error:", err.message));
});

function broadcastStatus() {
  const status = JSON.stringify({
    type: "status",
    gameConnected:  gameClient  !== null && gameClient.readyState  === WebSocket.OPEN,
    phoneConnected: phoneClient !== null && phoneClient.readyState === WebSocket.OPEN,
  });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(status);
  });
}

httpServer.listen(PORT, () => console.log(`Relay server listening on port ${PORT}`));
