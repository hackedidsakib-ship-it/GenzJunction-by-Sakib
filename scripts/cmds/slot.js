module.exports.config = {
  name: "slot",
  version: "2.0",
  author: "MOHAMMAD AKASH",
  role: 0,
  category: "economy",
  shortDescription: "Slot Machine Game"
};

module.exports.onStart = async function ({ api, event, args, usersData }) {
  const { senderID, threadID, messageID } = event;

  const bet = parseInt(args[0]);
  if (!bet || bet <= 0)
    return api.sendMessage("Enter valid bet amount.", threadID, messageID);

  const userData = await usersData.get(senderID);
  let balance = userData?.data?.money ?? 100;

  if (balance < bet)
    return api.sendMessage("❌ Not enough balance!", threadID, messageID);

  const symbols = ["🍎", "🍌", "🍒", "⭐", "7️⃣"];
  const win = Math.random() * 100 < 60;

  let slot1, slot2, slot3;
  const winAmount = bet;

  if (win) {
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
    slot1 = slot2 = slot3 = symbol;
    balance += winAmount;
  } else {
    do {
      slot1 = symbols[Math.floor(Math.random() * symbols.length)];
      slot2 = symbols[Math.floor(Math.random() * symbols.length)];
      slot3 = symbols[Math.floor(Math.random() * symbols.length)];
    } while (slot1 === slot2 && slot2 === slot3);
    balance -= bet;
  }

  await usersData.set(senderID, { data: { ...userData.data, money: balance } });

  const resultText = win
    ? `🎰 SLOT GAME 🎰\n──────────────\n\n🎲 Result →\n${slot1} | ${slot2} | ${slot3}\n\n🏆 Jackpot Winner!\n💵 Earned +${winAmount}$\n\n💰 Balance → ${balance}$`
    : `🎰 SLOT GAME 🎰\n──────────────\n\n🎲 Result →\n${slot1} | ${slot2} | ${slot3}\n\n💸 You Lose!\n💵 Lost -${bet}$\n\n💰 Balance → ${balance}$`;

  api.sendMessage(resultText, threadID, messageID);
};
