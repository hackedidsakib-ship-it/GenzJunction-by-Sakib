const { spawn } = require("child_process");
const controlPanel = require("./controlPanel/server.js");

let botProcess = null;
let botStatus = "stopped";
let logBuffer = [];
const MAX_LOG_LINES = 500;
const sseClients = [];

global.panelState = {
  getBotProcess: () => botProcess,
  getBotStatus: () => botStatus,
  getLogs: () => logBuffer,
  getSseClients: () => sseClients,
  restartBot,
  stopBot,
  startBot
};

function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try { sseClients[i].write(msg); } catch (e) { sseClients.splice(i, 1); }
  }
}

function addLog(line, type = "info") {
  const entry = { time: new Date().toISOString(), msg: String(line).trim(), type };
  if (!entry.msg) return;
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
  broadcastSSE("log", entry);
}

function startBot() {
  if (botProcess) return;
  botStatus = "starting";
  broadcastSSE("status", botStatus);
  addLog("Starting bot process...", "info");

  botProcess = spawn("node", ["Goat.js"], {
    cwd: __dirname,
    shell: true,
    env: { ...process.env }
  });

  if (botProcess.stdout) {
    botProcess.stdout.on("data", (d) => {
      String(d).split("\n").filter(l => l.trim()).forEach(l => addLog(l, "info"));
    });
  }
  if (botProcess.stderr) {
    botProcess.stderr.on("data", (d) => {
      String(d).split("\n").filter(l => l.trim()).forEach(l => addLog(l, "error"));
    });
  }

  botProcess.on("spawn", () => {
    botStatus = "running";
    broadcastSSE("status", botStatus);
    addLog("Bot process started.", "success");
  });

  botProcess.on("close", (code) => {
    addLog(`Bot exited (code ${code}).`, code === 0 ? "info" : "error");
    botProcess = null;
    if (code === 2) {
      botStatus = "restarting";
      broadcastSSE("status", botStatus);
      addLog("Auto-restarting bot...", "info");
      setTimeout(startBot, 2000);
    } else {
      botStatus = "stopped";
      broadcastSSE("status", botStatus);
    }
  });

  botProcess.on("error", (err) => {
    addLog(`Bot error: ${err.message}`, "error");
    botProcess = null;
    botStatus = "error";
    broadcastSSE("status", botStatus);
  });
}

function stopBot() {
  if (botProcess) {
    botProcess.removeAllListeners("close");
    botProcess.kill("SIGTERM");
    botProcess = null;
    botStatus = "stopped";
    addLog("Bot stopped by admin.", "warn");
    broadcastSSE("status", botStatus);
  }
}

function restartBot() {
  addLog("Restarting bot...", "warn");
  stopBot();
  setTimeout(startBot, 1500);
}

startBot();

const PORT = process.env.PORT || 5000;
controlPanel.listen(PORT, () => {
  console.log(`GenZ Junction Control Panel: http://localhost:${PORT}`);
});
