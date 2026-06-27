const fs = require("fs");
const path = require("path");

const LEAVE_QUEUE_FILE = path.join(__dirname, "../../controlPanel/leaveQueue.json");

module.exports = {
  config: {
    name: "leaveGroupQueue",
    eventType: ["log"],
    version: "1.0",
    author: "GenZ Junction",
    description: "Processes leave group requests queued via the control panel"
  },
  async onEvent({ api, event, threadsData }) {
    try {
      if (!fs.existsSync(LEAVE_QUEUE_FILE)) return;
      const queue = JSON.parse(fs.readFileSync(LEAVE_QUEUE_FILE, "utf8"));
      if (!queue.length) return;

      const currentThreadID = event.threadID;
      const idx = queue.findIndex(q => q.threadID === currentThreadID);
      if (idx === -1) return;

      const leaveReq = queue[idx];
      queue.splice(idx, 1);
      fs.writeFileSync(LEAVE_QUEUE_FILE, JSON.stringify(queue, null, 2));

      await api.sendMessage(
        "Admin has requested to leave this group. Goodbye!",
        currentThreadID
      );

      await new Promise(r => setTimeout(r, 2000));
      await api.removeUserFromGroup(api.getCurrentUserID(), currentThreadID);
    } catch (e) {
      // Silently fail - not all events support leave
    }
  }
};
