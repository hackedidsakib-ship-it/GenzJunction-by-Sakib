const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { URL } = require("url");

const ROOT_DIR = path.join(__dirname, "..");
const PANEL_PASSWORD = "Sakib@7890";
const SESSION_MAXAGE = 86400000;
const IGNORE_DIRS = new Set(["node_modules", ".git", ".cache", ".local"]);

// In-memory sessions
const sessions = {};
function createSession() {
  const id = crypto.randomBytes(24).toString("hex");
  sessions[id] = { created: Date.now() };
  return id;
}
function getSession(cookieHeader) {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/panelSid=([a-f0-9]+)/);
  if (!m) return null;
  const s = sessions[m[1]];
  if (!s) return null;
  if (Date.now() - s.created > SESSION_MAXAGE) { delete sessions[m[1]]; return null; }
  return { id: m[1], data: s };
}
function isAuth(req) { return !!getSession(req.headers.cookie); }

// Helpers
function readBody(req) {
  return new Promise((res, rej) => {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => res(body));
    req.on("error", rej);
  });
}
function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(body);
}
function serveFile(res, filePath, contentType) {
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch (e) {
    res.writeHead(404); res.end("Not found");
  }
}
function getContentType(ext) {
  return { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".json": "application/json" }[ext] || "text/plain";
}

// File tree builder
function buildTree(dir, rel = "") {
  const items = [];
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return items; }
  for (const e of entries) {
    if (IGNORE_DIRS.has(e)) continue;
    const full = path.join(dir, e);
    const r = rel ? `${rel}/${e}` : e;
    try {
      const stat = fs.statSync(full);
      if (stat.isDirectory()) items.push({ name: e, path: r, type: "dir", children: buildTree(full, r) });
      else items.push({ name: e, path: r, type: "file", size: stat.size });
    } catch {}
  }
  return items.sort((a, b) => {
    if (a.type === "dir" && b.type !== "dir") return -1;
    if (a.type !== "dir" && b.type === "dir") return 1;
    return a.name.localeCompare(b.name);
  });
}

// SSE clients
const sseClients = [];

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = u.pathname;
  const method = req.method;

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  // ── STATIC IMAGES ──────────────────────────────────────────────────────────
  if (pathname.startsWith("/images/")) {
    const imgPath = path.join(ROOT_DIR, "dashboard", pathname);
    return serveFile(res, imgPath, getContentType(path.extname(imgPath)));
  }

  // ── MAIN PAGE ──────────────────────────────────────────────────────────────
  if (pathname === "/" || pathname === "/index.html") {
    return serveFile(res, path.join(__dirname, "panel.html"), "text/html");
  }

  // ── AUTH ───────────────────────────────────────────────────────────────────
  if (pathname === "/auth/login" && method === "POST") {
    const body = await readBody(req);
    let data;
    try { data = JSON.parse(body); } catch { return json(res, { success: false, message: "Bad request" }, 400); }
    if (data.password === PANEL_PASSWORD) {
      const sid = createSession();
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Set-Cookie": `panelSid=${sid}; Path=/; HttpOnly; Max-Age=86400; SameSite=Lax`
      });
      return res.end(JSON.stringify({ success: true }));
    }
    return json(res, { success: false, message: "Invalid password" }, 401);
  }

  if (pathname === "/auth/logout" && method === "POST") {
    const s = getSession(req.headers.cookie);
    if (s) delete sessions[s.id];
    res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": "panelSid=; Path=/; Max-Age=0" });
    return res.end(JSON.stringify({ success: true }));
  }

  if (pathname === "/auth/status") {
    return json(res, { authenticated: isAuth(req) });
  }

  // ── SSE LOGS ───────────────────────────────────────────────────────────────
  if (pathname === "/api/sse/logs") {
    if (!isAuth(req)) return json(res, { error: "Unauthorized" }, 401);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    // Send existing logs
    const logs = global.panelState.getLogs();
    res.write(`event: bulk\ndata: ${JSON.stringify(logs)}\n\n`);
    // Send current status
    res.write(`event: status\ndata: ${JSON.stringify(global.panelState.getBotStatus())}\n\n`);

    // Register SSE client
    const idx = global.panelState.getSseClients ? global.panelState.getSseClients().push(res) - 1 : sseClients.push(res) - 1;
    const clients = global.panelState.getSseClients ? global.panelState.getSseClients() : sseClients;

    // Heartbeat
    const hb = setInterval(() => { try { res.write(": heartbeat\n\n"); } catch { clearInterval(hb); } }, 25000);
    req.on("close", () => {
      clearInterval(hb);
      const i = clients.indexOf(res);
      if (i !== -1) clients.splice(i, 1);
    });
    return;
  }

  // ── PROTECTED API ──────────────────────────────────────────────────────────
  if (!isAuth(req)) {
    if (pathname.startsWith("/api/")) return json(res, { error: "Unauthorized" }, 401);
  }

  // ─── BOT CONTROL ──────────────────────────────────────────────────────────
  if (pathname === "/api/bot/status") {
    const p = global.panelState;
    return json(res, { status: p.getBotStatus(), uptime: process.uptime(), pid: p.getBotProcess()?.pid || null });
  }
  if (pathname === "/api/bot/restart" && method === "POST") {
    global.panelState.restartBot();
    return json(res, { success: true, message: "Bot restarting..." });
  }
  if (pathname === "/api/bot/stop" && method === "POST") {
    global.panelState.stopBot();
    return json(res, { success: true, message: "Bot stopped." });
  }
  if (pathname === "/api/bot/start" && method === "POST") {
    global.panelState.startBot();
    return json(res, { success: true, message: "Bot starting..." });
  }

  // ─── LOGS ──────────────────────────────────────────────────────────────────
  if (pathname === "/api/logs") {
    return json(res, { logs: global.panelState.getLogs() });
  }

  // ─── COOKIE ────────────────────────────────────────────────────────────────
  if (pathname === "/api/cookie") {
    const accountFile = path.join(ROOT_DIR, "account.txt");
    let content = "";
    try { content = fs.readFileSync(accountFile, "utf8").trim(); } catch {}
    return json(res, { cookie: content, connected: content.length > 10 });
  }
  if (pathname === "/api/cookie/connect" && method === "POST") {
    const body = await readBody(req);
    let data;
    try { data = JSON.parse(body); } catch { return json(res, { success: false, message: "Bad request" }, 400); }
    if (!data.cookie || data.cookie.trim().length < 10)
      return json(res, { success: false, message: "Invalid cookie." }, 400);
    try {
      fs.writeFileSync(path.join(ROOT_DIR, "account.txt"), data.cookie.trim());
      setTimeout(() => global.panelState.restartBot(), 500);
      return json(res, { success: true, message: "Cookie saved. Bot restarting..." });
    } catch (e) { return json(res, { success: false, message: e.message }, 500); }
  }
  if (pathname === "/api/cookie/delete" && method === "POST") {
    try {
      fs.writeFileSync(path.join(ROOT_DIR, "account.txt"), "");
      global.panelState.stopBot();
      return json(res, { success: true, message: "Cookie deleted. Bot stopped." });
    } catch (e) { return json(res, { success: false, message: e.message }, 500); }
  }

  // ─── FILE MANAGER ──────────────────────────────────────────────────────────
  if (pathname === "/api/files/tree") {
    return json(res, { tree: buildTree(ROOT_DIR) });
  }
  if (pathname === "/api/files/read") {
    const fp = u.searchParams.get("filePath");
    if (!fp) return json(res, { error: "No path" }, 400);
    const abs = path.join(ROOT_DIR, fp);
    if (!abs.startsWith(ROOT_DIR)) return json(res, { error: "Access denied" }, 403);
    try { return json(res, { content: fs.readFileSync(abs, "utf8") }); }
    catch (e) { return json(res, { error: e.message }, 500); }
  }
  if (pathname === "/api/files/save" && method === "POST") {
    const body = await readBody(req);
    let data;
    try { data = JSON.parse(body); } catch { return json(res, { error: "Bad JSON" }, 400); }
    const abs = path.join(ROOT_DIR, data.filePath || "");
    if (!abs.startsWith(ROOT_DIR)) return json(res, { error: "Access denied" }, 403);
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, data.content || "");
      return json(res, { success: true });
    } catch (e) { return json(res, { error: e.message }, 500); }
  }
  if (pathname === "/api/files/create" && method === "POST") {
    const body = await readBody(req);
    let data;
    try { data = JSON.parse(body); } catch { return json(res, { error: "Bad JSON" }, 400); }
    const abs = path.join(ROOT_DIR, data.filePath || "");
    if (!abs.startsWith(ROOT_DIR)) return json(res, { error: "Access denied" }, 403);
    try {
      if (data.isDir) { fs.mkdirSync(abs, { recursive: true }); }
      else {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        if (fs.existsSync(abs)) return json(res, { error: "File already exists" }, 400);
        fs.writeFileSync(abs, "");
      }
      return json(res, { success: true });
    } catch (e) { return json(res, { error: e.message }, 500); }
  }
  if (pathname === "/api/files/delete" && method === "POST") {
    const body = await readBody(req);
    let data;
    try { data = JSON.parse(body); } catch { return json(res, { error: "Bad JSON" }, 400); }
    const abs = path.join(ROOT_DIR, data.filePath || "");
    if (!abs.startsWith(ROOT_DIR)) return json(res, { error: "Access denied" }, 403);
    try { fs.rmSync(abs, { recursive: true, force: true }); return json(res, { success: true }); }
    catch (e) { return json(res, { error: e.message }, 500); }
  }

  // ─── CONFIG ────────────────────────────────────────────────────────────────
  if (pathname === "/api/config") {
    try { return json(res, { content: fs.readFileSync(path.join(ROOT_DIR, "config.json"), "utf8") }); }
    catch (e) { return json(res, { error: e.message }, 500); }
  }
  if (pathname === "/api/config/save" && method === "POST") {
    const body = await readBody(req);
    let data;
    try { data = JSON.parse(body); } catch { return json(res, { error: "Bad JSON" }, 400); }
    try {
      JSON.parse(data.content);
      fs.writeFileSync(path.join(ROOT_DIR, "config.json"), data.content);
      return json(res, { success: true, message: "Config saved. Restart bot to apply." });
    } catch (e) { return json(res, { error: "Invalid JSON: " + e.message }, 400); }
  }

  // ─── COMMANDS ──────────────────────────────────────────────────────────────
  if (pathname === "/api/commands") {
    try {
      const cmdDir = path.join(ROOT_DIR, "scripts", "cmds");
      const files = fs.existsSync(cmdDir) ? fs.readdirSync(cmdDir).filter(f => f.endsWith(".js")) : [];
      let banned = [];
      try { banned = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "configCommands.json"), "utf8")).commandBanned || []; } catch {}
      return json(res, { commands: files.map(f => ({ name: f.replace(".js", ""), file: f, enabled: !banned.includes(f.replace(".js", "")) })) });
    } catch (e) { return json(res, { error: e.message }, 500); }
  }
  if (pathname === "/api/commands/toggle" && method === "POST") {
    const body = await readBody(req);
    let data;
    try { data = JSON.parse(body); } catch { return json(res, { error: "Bad JSON" }, 400); }
    try {
      const cfgPath = path.join(ROOT_DIR, "configCommands.json");
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      cfg.commandBanned = cfg.commandBanned || [];
      if (data.enabled) cfg.commandBanned = cfg.commandBanned.filter(c => c !== data.name);
      else if (!cfg.commandBanned.includes(data.name)) cfg.commandBanned.push(data.name);
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
      return json(res, { success: true });
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  // ─── STATS ─────────────────────────────────────────────────────────────────
  if (pathname === "/api/stats") {
    const total = os.totalmem(), free = os.freemem(), used = total - free;
    const cmdDir = path.join(ROOT_DIR, "scripts", "cmds");
    const evtDir = path.join(ROOT_DIR, "scripts", "events");
    const totalCommands = fs.existsSync(cmdDir) ? fs.readdirSync(cmdDir).filter(f => f.endsWith(".js")).length : 0;
    const totalEvents = fs.existsSync(evtDir) ? fs.readdirSync(evtDir).filter(f => f.endsWith(".js")).length : 0;
    return json(res, {
      botStatus: global.panelState.getBotStatus(),
      uptime: process.uptime(),
      memory: { total, used, free, percent: Math.round((used / total) * 100) },
      cpu: { load: os.loadavg()[0].toFixed(2), cores: os.cpus().length },
      totalCommands, totalEvents,
      nodeVersion: process.version,
      platform: os.platform()
    });
  }

  // 404
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

module.exports = server;
