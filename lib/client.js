window.__ModuleLoader__.load({
	id: "dsh-plugin-session-clock",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");

		//#region contract
		/** Dictionary namespace owned by this plugin. */
		const NS = "session-clock";
		/** The row attribute the workspace browser already publishes per Session. */
		const ROW_SELECTOR = '[data-row-key^="session:"]';
		/** The shipped relative labels this plugin takes over: 刚刚 / 5分钟 / 3小时 / 1天 …, and the English now / 5min / 3h / 1d / 2mo / 2y. */
		const RELATIVE = /^(?:刚刚|now|\d+\s*(?:分钟|小时|个月|天|年|min|mo|h|d|y))$/u;
		/** A burst of mutations collapses into one repaint no sooner than this far apart. */
		const PAINT_INTERVAL_MS = 100;
		/** Marks a span this plugin painted, holding the exact text it wrote. */
		const PAINTED = "data-dsh-clock";
		//#endregion

		//#region locales
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"clock.yesterday": "昨天"
		};
		/** English dictionary, complete against the zh key set. */
		const en = {
			"clock.yesterday": "Yesterday "
		};
		//#endregion

		//#region format
		/** Two digits, the clock face and calendar components this format needs. */
		function pad2(value) {
			return String(value).padStart(2, "0");
		}

		/** Whether two instants fall on the same local calendar day. */
		function sameDay(left, right) {
			return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
		}

		/**
		 * The WeChat-style label for one Session's last update.
		 *
		 * today: `21:12`; yesterday: `昨天21:12`; this year: `10/29`; earlier
		 * years: `25/10/29`. A timestamp in the future is shown as today's clock,
		 * because a negative age reads as a clock skew, not a date.
		 *
		 * @param updatedAt - the Session's epoch milliseconds.
		 * @param now - the reference instant, in epoch milliseconds.
		 * @param t - the bound dictionary, for the yesterday word.
		 * @returns the label, or null when the input is not a usable timestamp.
		 */
		function clockLabel(updatedAt, now, t) {
			if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return null;
			const then = new Date(updatedAt);
			const current = new Date(now);
			const clock = `${pad2(then.getHours())}:${pad2(then.getMinutes())}`;
			if (updatedAt > now || sameDay(then, current)) return clock;
			const yesterday = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 1);
			if (sameDay(then, yesterday)) return `${t("clock.yesterday")}${clock}`;
			if (then.getFullYear() === current.getFullYear()) return `${pad2(then.getMonth() + 1)}/${pad2(then.getDate())}`;
			return `${pad2(then.getFullYear() % 100)}/${pad2(then.getMonth() + 1)}/${pad2(then.getDate())}`;
		}
		//#endregion

		//#region rows
		/**
		 * The text cell of one Session row.
		 *
		 * The row's children are, in order, the leading cell, the title, the time,
		 * an optional pin mark and the hover actions, so the time is the third span.
		 * A painted cell is addressed by its mark, which survives the row's rerenders.
		 *
		 * @param row - one `[data-row-key]` element.
		 * @returns the time span, or null for a row without one (a blank Session).
		 */
		function timeSpan(row) {
			const painted = row.querySelector(`[${PAINTED}]`);
			if (painted !== null) return painted;
			const candidate = row.children[2];
			if (candidate === undefined || candidate.tagName !== "SPAN" || candidate.childElementCount !== 0) return null;
			return candidate;
		}

		/**
		 * Replace one row's relative label with the absolute one.
		 *
		 * Only a shipped relative label or this plugin's own last write is touched:
		 * the same cell also carries transient status text ("进行中"), which must
		 * stay as the shipped row put it.
		 *
		 * @param row - one Session row element.
		 * @param updatedAtById - Session id to its last-update instant.
		 * @param now - the reference instant, in epoch milliseconds.
		 * @param t - the bound dictionary.
		 */
		function paintRow(row, updatedAtById, now, t) {
			const key = row.getAttribute("data-row-key");
			if (key === null) return;
			const updatedAt = updatedAtById.get(key.slice("session:".length));
			if (updatedAt === undefined) return;
			const span = timeSpan(row);
			if (span === null) return;
			const text = span.textContent ?? "";
			const painted = span.getAttribute(PAINTED);
			const shipped = RELATIVE.test(text);
			const ours = painted !== null && text === painted;
			if (!shipped && !ours) {
				span.removeAttribute(PAINTED);
				return;
			}
			const next = clockLabel(updatedAt, now, t);
			if (next === null) return;
			if (text !== next) {
				const node = span.firstChild;
				// Keep React's text node alive: replacing it would detach the node the
				// row still updates, and the next rerender would write into nothing.
				if (node !== null && node.nodeType === 3 && span.childElementCount === 0) node.nodeValue = next;
				else span.textContent = next;
			}
			span.setAttribute(PAINTED, next);
		}

		/** Every known Session's last-update instant, keyed by id. */
		function useUpdatedAtById(useSessions) {
			const list = typeof useSessions === "function" ? useSessions((state) => state) : null;
			return react.useMemo(() => {
				const map = new Map();
				const entries = list === null || list === undefined ? {} : list.byId ?? {};
				for (const [id, summary] of Object.entries(entries)) {
					if (typeof summary?.updatedAt === "number") map.set(id, summary.updatedAt);
				}
				return map;
			}, [list]);
		}

		/**
		 * The invisible seat that keeps the sidebar's time column absolute.
		 *
		 * The shipped workspace browser builds its own row labels, and no slot
		 * replaces that text, so this follows the published row keys and rewrites
		 * the label in place. It never inserts or hides rows, and an unrecognised
		 * row is left exactly as shipped.
		 *
		 * @param props - the slot's standard Session snapshot hook and locale seat.
		 * @returns null; this seat only paints.
		 */
		function SessionClock({ useSessions, t }) {
			const updatedAtById = useUpdatedAtById(useSessions);
			react.useEffect(() => {
				if (typeof document === "undefined") return;
				/* A streaming answer mutates text on every frame; collapse those bursts
				 * into at most one repaint per PAINT_INTERVAL_MS. The first repaint after
				 * a quiet period is immediate. */
				let timer = 0;
				let lastPaint = 0;
				const paint = () => {
					timer = 0;
					lastPaint = Date.now();
					const now = Date.now();
					for (const row of document.querySelectorAll(ROW_SELECTOR)) paintRow(row, updatedAtById, now, t);
				};
				const queue = () => {
					if (timer !== 0) return;
					const wait = Math.max(0, PAINT_INTERVAL_MS - (Date.now() - lastPaint));
					timer = window.setTimeout(paint, wait);
				};
				const observer = new MutationObserver(queue);
				observer.observe(document.body, { subtree: true, childList: true, characterData: true });
				const ticker = window.setInterval(queue, 30000);
				queue();
				return () => {
					observer.disconnect();
					window.clearInterval(ticker);
					if (timer !== 0) window.clearTimeout(timer);
				};
			}, [updatedAtById, t]);
			return null;
		}
		//#endregion

		//#region plugin
		/** Services required by this plugin. */
		const inject = [
			"slots",
			"locale"
		];
		/**
		 * Register the dictionary and the invisible paint seat.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "session-clock: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "session-clock",
				order: 60,
				locale: NS,
				inject: () => ({ t })
			}, SessionClock));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		// Exposed for the headless smoke test; the Loader only reads apply/inject.
		exports.clockLabel = clockLabel;
		exports.paintRow = paintRow;
		return module.exports;
	}
});
