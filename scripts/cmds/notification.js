const { getStreamsFromAttachment } = global.utils;

module.exports = {
	config: {
		name: "notification",
		aliases: ["notify", "noti"],
		version: "1.7",
		author: "NTKhang",
		countDown: 5,
		role: 2,
		description: {
			vi: "Gửi thông báo từ admin đến all box",
			en: "Send notification from admin to all box"
		},
		category: "owner",
		guide: {
			en: "{pn} <tin nhắn>"
		},
		envConfig: {
			delayPerGroup: 250
		}
	},

	langs: {
		vi: {
			missingMessage: "Vui lòng nhập tin nhắn bạn muốn gửi đến tất cả các nhóm",
			notification: "Thông báo từ admin bot đến tất cả nhóm chat (không phản hồi tin nhắn này)",
			sendingNotification: "Bắt đầu gửi thông báo từ admin bot đến %1 nhóm chat",
			sentNotification: "✅ Đã gửi thông báo đến %1 nhóm thành công",
			errorSendingNotification: "Có lỗi xảy ra khi gửi đến %1 nhóm:\n%2"
		},
		en: {
			missingMessage: "Please enter the message you want to send to all groups",
			notification: "Notification from admin bot to all chat groups (do not reply to this message)",
			sendingNotification: "Start sending notification from admin bot to %1 chat groups",
			sentNotification: "✅ Sent notification to %1 groups successfully",
			errorSendingNotification: "An error occurred while sending to %1 groups:\n%2"
		},
		tl: {
			missingMessage: "Mangyaring ilagay ang mensaheng gusto mong ipadala sa lahat ng grupo",
			notification: "Abiso mula sa admin bot sa lahat ng grupo (huwag sumagot sa mensaheng ito)",
			sendingNotification: "Nagsisimula nang magpadala ng abiso mula sa admin bot sa %1 grupo",
			sentNotification: "✅ Matagumpay na naipadala ang abiso sa %1 grupo",
			errorSendingNotification: "Nagkaroon ng error habang nagpapadala sa %1 grupo:\n%2"
		},
		hi: {
			missingMessage: "Kripya wo message dalein jo aap sabhi groups mein bhejna chahte hain",
			notification: "Admin bot ki taraf se sabhi groups ko notification (is message ka reply mat karein)",
			sendingNotification: "Admin bot se %1 groups mein notification bhejana shuru ho raha hai",
			sentNotification: "✅ %1 groups mein notification successfully bhej diya gaya",
			errorSendingNotification: "%1 groups mein bhejte waqt error aaya:\n%2"
		},
		ar: {
			missingMessage: "الرجاء إدخال الرسالة التي تريد إرسالها لجميع المجموعات",
			notification: "إشعار من مسؤول البوت لجميع المجموعات (لا ترد على هذه الرسالة)",
			sendingNotification: "بدء إرسال الإشعار من مسؤول البوت إلى %1 مجموعة",
			sentNotification: "✅ تم إرسال الإشعار بنجاح إلى %1 مجموعة",
			errorSendingNotification: "حدث خطأ أثناء الإرسال إلى %1 مجموعة:\n%2"
		},
		bn: {
			missingMessage: "অনুগ্রহ করে সব গ্রুপে পাঠাতে চান এমন message লিখুন",
			notification: "Admin bot থেকে সব গ্রুপে notification (এই message এ reply করবেন না)",
			sendingNotification: "Admin bot থেকে %1 টি গ্রুপে notification পাঠানো শুরু হচ্ছে",
			sentNotification: "✅ %1 টি গ্রুপে সফলভাবে notification পাঠানো হয়েছে",
			errorSendingNotification: "%1 টি গ্রুপে পাঠাতে error হয়েছে:\n%2"
		}
	},

	onStart: async function ({ message, api, event, args, commandName, envCommands, threadsData, getLang }) {
		const { delayPerGroup } = envCommands[commandName];
		if (!args[0])
			return message.reply(getLang("missingMessage"));
		const formSend = {
			body: `${getLang("notification")}\n────────────────\n${args.join(" ")}`,
			attachment: await getStreamsFromAttachment(
				[
					...event.attachments,
					...(event.messageReply?.attachments || [])
				].filter(item => ["photo", "png", "animated_image", "video", "audio"].includes(item.type))
			)
		};

		const allThreadID = (await threadsData.getAll()).filter(t => t.isGroup && t.members.find(m => m.userID == api.getCurrentUserID())?.inGroup);
		message.reply(getLang("sendingNotification", allThreadID.length));

		let sendSucces = 0;
		const sendError = [];
		const wattingSend = [];

		for (const thread of allThreadID) {
			const tid = thread.threadID;
			try {
				wattingSend.push({
					threadID: tid,
					pending: api.sendMessage(formSend, tid)
				});
				await new Promise(resolve => setTimeout(resolve, delayPerGroup));
			}
			catch (e) {
				sendError.push(tid);
			}
		}

		for (const sended of wattingSend) {
			try {
				await sended.pending;
				sendSucces++;
			}
			catch (e) {
				const { errorDescription } = e;
				if (!sendError.some(item => item.errorDescription == errorDescription))
					sendError.push({
						threadIDs: [sended.threadID],
						errorDescription
					});
				else
					sendError.find(item => item.errorDescription == errorDescription).threadIDs.push(sended.threadID);
			}
		}

		let msg = "";
		if (sendSucces > 0)
			msg += getLang("sentNotification", sendSucces) + "\n";
		if (sendError.length > 0)
			msg += getLang("errorSendingNotification", sendError.reduce((a, b) => a + b.threadIDs.length, 0), sendError.reduce((a, b) => a + `\n - ${b.errorDescription}\n  + ${b.threadIDs.join("\n  + ")}`, ""));
		message.reply(msg);
	}
};