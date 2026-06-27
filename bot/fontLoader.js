const path = require("path");
const fs = require("fs");

const FONT_DIR = path.join(__dirname, "../scripts/cmds/assets/font");

function getWeight(filename) {
	const lower = filename.toLowerCase();
	if (lower.includes("semibold") || lower.includes("semi-bold")) return "600";
	if (lower.includes("bold")) return "bold";
	if (lower.includes("black")) return "900";
	if (lower.includes("medium")) return "500";
	if (lower.includes("light")) return "300";
	if (lower.includes("thin")) return "100";
	return "normal";
}

function getStyle(filename) {
	return filename.toLowerCase().includes("italic") ? "italic" : "normal";
}

function getFamilyName(filename) {
	return filename
		.replace(/\.(ttf|otf)$/i, "")
		.replace(/[-_ ](regular|bold|light|thin|medium|semibold|semi-bold|black|italic|\d{3})/gi, "")
		.trim();
}

module.exports = function setupFonts() {
	try {
		const Canvas = require("canvas");

		if (!fs.existsSync(FONT_DIR)) {
			console.warn(`[fontLoader] Font directory not found: ${FONT_DIR}`);
			return;
		}

		const fontFiles = fs.readdirSync(FONT_DIR).filter(f => /\.(ttf|otf)$/i.test(f));

		if (fontFiles.length === 0) {
			console.warn("[fontLoader] No font files found");
			return;
		}

		const fallbackFamilies = [];

		for (const file of fontFiles) {
			const fontPath = path.join(FONT_DIR, file);
			const family = getFamilyName(file);
			const weight = getWeight(file);
			const style = getStyle(file);
			try {
				Canvas.registerFont(fontPath, { family, weight, style });
				if (!fallbackFamilies.includes(family)) fallbackFamilies.push(family);
			} catch (err) {
				console.warn(`[fontLoader] Failed to register "${file}": ${err.message}`);
			}
		}

		const originalRegisterFont = Canvas.registerFont.bind(Canvas);

		Canvas.registerFont = function(fontPath, descriptors) {
			originalRegisterFont(fontPath, descriptors);

			if (descriptors && descriptors.family) {
				const family = descriptors.family;
				for (const file of fontFiles) {
					const fp = path.join(FONT_DIR, file);
					const fn = getFamilyName(file);
					if (fn !== family) {
						try {
							originalRegisterFont(fp, {
								family,
								weight: descriptors.weight || getWeight(file),
								style: descriptors.style || "normal"
							});
						} catch {}
					}
				}
			}
		};

		const { CanvasRenderingContext2D } = Canvas;
		const descriptor = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "font");

		if (!descriptor || !descriptor.set) {
			console.warn("[fontLoader] Cannot patch CanvasRenderingContext2D.prototype.font");
			return;
		}

		const originalSet = descriptor.set;

		Object.defineProperty(CanvasRenderingContext2D.prototype, "font", {
			get: descriptor.get,
			set(value) {
				if (typeof value === "string") {
					const match = value.match(/^(.*?\d+(?:\.\d+)?px\s+)(.+)$/);
					if (match) {
						const sizePrefix = match[1];
						const existingFamilies = match[2];
						const extraFallbacks = fallbackFamilies
							.filter(f => !existingFamilies.includes(f))
							.map(f => `"${f}"`)
							.join(", ");
						if (extraFallbacks) {
							value = `${sizePrefix}${existingFamilies}, ${extraFallbacks}`;
						}
					}
				}
				originalSet.call(this, value);
			},
			configurable: true
		});

		console.log(`[fontLoader] ✅ ${fontFiles.length} font(s) registered. Families: ${fallbackFamilies.join(", ")}`);
	} catch (err) {
		console.warn(`[fontLoader] ⚠️ Setup failed: ${err.message}`);
	}
};
