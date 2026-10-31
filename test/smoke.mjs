/**
 * Headless smoke test for the session-clock client bundle.
 *
 * Runs the real lib/client.js against a fake module loader, a fake Cordis
 * context and a minimal row shim, then exercises the label format, the paint
 * rules, and the slot registration.
 *
 * Usage: node test/smoke.mjs
 */
import fs from "node:fs";
import os from "node:os";
import vm from "node:vm";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
/** React comes from a DSH installation, not from this package. */
const profileModules = process.env.DSH_PROFILE_MODULES ?? path.join(os.homedir(), ".dsh", "profiles", "node_modules");
if (!fs.existsSync(path.join(profileModules, "react", "package.json"))) {
	console.error(`no react in ${profileModules}; set DSH_PROFILE_MODULES to a directory holding react`);
	process.exit(2);
}
const profileRequire = createRequire(path.join(profileModules, "index.js"));

let failures = 0;
function check(label, condition, detail) {
	if (condition) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${detail}`}`);
}

//#region fakes
let definition;
globalThis.window = {
	__ModuleLoader__: {
		load(value) {
			definition = value;
		}
	}
};

const react = profileRequire("react");
const requireShim = (specifier) => {
	if (specifier === "react") return react;
	if (specifier === "react/jsx-runtime") return profileRequire("react/jsx-runtime");
	throw new Error(`unexpected require: ${specifier}`);
};
//#endregion

//#region load
const code = fs.readFileSync(path.join(root, "lib/client.js"), "utf8");
vm.runInThisContext(code, { filename: "lib/client.js" });
check("bundle registers a factory", definition !== undefined);
check("bundle id", definition.id === "dsh-plugin-session-clock", definition.id);
const plugin = definition.factory(requireShim);
check("exports apply", typeof plugin.apply === "function");
check("inject covers the services used", ["slots", "locale"].every((name) => plugin.inject.includes(name)), JSON.stringify(plugin.inject));
//#endregion

//#region fake context
const dictionaries = new Map();
const registeredSlots = [];
const effects = [];
const ctx = {
	effect(callback, label) {
		const dispose = callback();
		effects.push({ label, dispose });
		return dispose;
	},
	locale: {
		register(namespace, value) {
			dictionaries.set(namespace, value);
			return () => dictionaries.delete(namespace);
		},
		bind(namespace) {
			const table = dictionaries.get(namespace);
			return (key) => table?.zh?.[key] ?? key;
		}
	},
	slots: {
		inject(name, callback) {
			return callback();
		},
		register(options, component) {
			registeredSlots.push({ options, component });
			return () => {};
		}
	}
};

plugin.apply(ctx);
check("registers a locale dictionary", dictionaries.has("session-clock"));
const zhKeys = Object.keys(dictionaries.get("session-clock").zh).sort().join("|");
const enKeys = Object.keys(dictionaries.get("session-clock").en).sort().join("|");
check("zh and en key sets match", zhKeys === enKeys);
check("registers exactly one slot", registeredSlots.length === 1, String(registeredSlots.length));
const seat = registeredSlots[0];
check("the seat lives in the frame overlay", seat.options.name === "shell.overlay", seat.options.name);
check("the seat id", seat.options.id === "session-clock", String(seat.options.id));
check("the seat carries the locale seat", seat.options.locale === "session-clock", String(seat.options.locale));
check("one effect: the dictionary disposer", effects.length === 1, JSON.stringify(effects.map((effect) => effect.label)));
//#endregion

//#region label format
const t = ctx.locale.bind("session-clock");
const at = (y, m, d, h, mi) => new Date(y, m - 1, d, h, mi, 0, 0).getTime();
const now = at(2026, 10, 29, 21, 12);

check("today shows the clock", plugin.clockLabel(at(2026, 10, 29, 9, 5), now, t) === "09:05", plugin.clockLabel(at(2026, 10, 29, 9, 5), now, t));
check("yesterday keeps the clock behind the word", plugin.clockLabel(at(2026, 10, 28, 18, 40), now, t) === "昨天18:40", plugin.clockLabel(at(2026, 10, 28, 18, 40), now, t));
check("earlier this year shows month and day", plugin.clockLabel(at(2026, 10, 27, 23, 59), now, t) === "10/27", plugin.clockLabel(at(2026, 10, 27, 23, 59), now, t));
check("a day earlier across a month boundary", plugin.clockLabel(at(2026, 9, 30, 8, 0), now, t) === "09/30", plugin.clockLabel(at(2026, 9, 30, 8, 0), now, t));
check("an earlier year shows a two-digit year", plugin.clockLabel(at(2025, 12, 31, 23, 0), now, t) === "25/12/31", plugin.clockLabel(at(2025, 12, 31, 23, 0), now, t));
check("a future stamp reads as a clock, not a date", plugin.clockLabel(at(2026, 10, 29, 22, 0), now, t) === "22:00");
check("an unusable stamp yields no label", plugin.clockLabel(undefined, now, t) === null && plugin.clockLabel(Number.NaN, now, t) === null);
//#endregion

//#region paint
/** A minimal Session row: leading span, title span, time span. */
function fakeRow(id, text, extra = {}) {
	const span = {
		tagName: "SPAN",
		childElementCount: 0,
		firstChild: { nodeType: 3, nodeValue: text },
		attributes: new Map(),
		get textContent() {
			return this.firstChild.nodeValue;
		},
		set textContent(value) {
			this.firstChild.nodeValue = String(value);
		},
		getAttribute(name) {
			return this.attributes.has(name) ? this.attributes.get(name) : null;
		},
		setAttribute(name, value) {
			this.attributes.set(name, String(value));
		},
		removeAttribute(name) {
			this.attributes.delete(name);
		}
	};
	const row = {
		children: [{ tagName: "SPAN" }, { tagName: "SPAN" }, span],
		attrs: new Map([["data-row-key", `session:${id}`]]),
		getAttribute(name) {
			return this.attrs.has(name) ? this.attrs.get(name) : null;
		},
		querySelector(selector) {
			return selector.includes("data-dsh-clock") && span.getAttribute("data-dsh-clock") !== null ? span : null;
		}
	};
	return { row, span, ...extra };
}

const map = new Map([
	["relative", at(2026, 10, 29, 18, 12)],
	["stale", at(2026, 10, 28, 7, 30)],
	["status", at(2026, 10, 29, 8, 0)],
	["unknown", at(2026, 10, 29, 8, 0)],
	["gone", at(2026, 10, 29, 8, 0)]
]);

const relative = fakeRow("relative", "3小时");
plugin.paintRow(relative.row, map, now, t);
check("a shipped relative label is replaced", relative.span.textContent === "18:12", relative.span.textContent);
check("the row keeps React's text node", typeof relative.span.firstChild.nodeValue === "string" && relative.span.firstChild.nodeValue === "18:12");
check("the painted span is marked with its text", relative.span.getAttribute("data-dsh-clock") === "18:12");

const stale = fakeRow("stale", "23小时");
plugin.paintRow(stale.row, map, now, t);
check("yesterday keeps its word", stale.span.textContent === "昨天07:30", stale.span.textContent);

// The English UI ships now / 5min / 3h / 1d / 2mo / 2y; those must be recognised too.
for (const [label, expected] of [["5min", "18:12"], ["now", "18:12"], ["3h", "18:12"], ["1d", "18:12"], ["2mo", "18:12"], ["2y", "18:12"]]) {
	const row = fakeRow("relative", label);
	plugin.paintRow(row.row, map, now, t);
	check(`the English label "${label}" is replaced`, row.span.textContent === expected, row.span.textContent);
}

// Anything that is not a shipped relative label stays put.
for (const label of ["3", "h", "in 3 days", "18:12"]) {
	const row = fakeRow("relative", label);
	plugin.paintRow(row.row, map, now, t);
	check(`"${label}" is not mistaken for a relative label`, row.span.textContent === label, row.span.textContent);
}

const tEn = (key) => dictionaries.get("session-clock").en[key] ?? key;
check("the English word for yesterday", plugin.clockLabel(at(2026, 10, 28, 18, 40), now, tEn) === "Yesterday 18:40", plugin.clockLabel(at(2026, 10, 28, 18, 40), now, tEn));

// React rewrote the label while the row rerendered: the old text is gone, the mark stays.
const rerendered = fakeRow("relative", "18:12");
rerendered.span.setAttribute("data-dsh-clock", "18:12");
plugin.paintRow(rerendered.row, new Map([["relative", at(2026, 10, 29, 19, 45)]]), now, t);
check("a changed Session time repaints an already painted row", rerendered.span.textContent === "19:45", rerendered.span.textContent);

// The same cell carries a transient status label; that text must survive.
const status = fakeRow("status", "进行中");
plugin.paintRow(status.row, map, now, t);
check("a status label in the time cell is left alone", status.span.textContent === "进行中", status.span.textContent);
check("an untouched status cell is not marked", status.span.getAttribute("data-dsh-clock") === null);

// An unknown Session and a blank row never paint.
const unknown = fakeRow("missing", "2天");
plugin.paintRow(unknown.row, map, now, t);
check("an unknown Session is left alone", unknown.span.textContent === "2天", unknown.span.textContent);
const blank = { children: [{ tagName: "SPAN" }, { tagName: "SPAN" }], getAttribute: () => "session:gone", querySelector: () => null };
plugin.paintRow(blank, map, now, t);
check("a blank row without a time cell is skipped", true);
//#endregion

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
