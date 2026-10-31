# dsh-plugin-session-clock

Rewrites the relative times in the sidebar's session list (`刚刚`, `3小时`, `1天`, `2个月`) as WeChat-style absolute times.

## What you get

| When | Label |
|---|---|
| Today | `21:12` (24-hour, zero-padded) |
| Yesterday | `昨天21:12` |
| Earlier this year | `10/27` |
| Earlier years | `25/12/31` (two-digit year) |

A timestamp in the future (clock skew) reads as today's clock, `HH:MM`. In the English UI the yesterday word is `Yesterday `, and the shipped `now` / `5min` / `3h` / `1d` / `2mo` / `2y` labels are taken over as well.

Labels follow the system clock and time zone and refresh every 30 seconds, so a `21:12` becomes `10/29` after midnight.

## Why this is a DOM patch

The label is rendered directly by the kernel package `@deepseek-ai/dsh-client-ui-workspace` through `timeLabel()`, and the sidebar offers no slot that replaces that text: `sidebar.workspaces` is a single-value slot, so taking it over means reimplementing the whole session browser (search, grouping, drag, rename). This plugin therefore takes the smallest invasive path:

- registers an invisible `shell.overlay` seat (returns `null`) to read `updatedAt` from the standard `useSessions` snapshot
- follows the row keys the kernel already publishes — `[data-row-key="session:<id>"]` — and rewrites only the third column's text
- touches only two kinds of text: a shipped relative label, or this plugin's own previous write; transient status text such as "进行中" is never touched
- writes `nodeValue` on the existing text node, keeping the node React holds, so the next rerender does not write into a detached node
- coalesces mutation bursts into at most one repaint per 100 ms, so a streaming answer does not spin the observer every frame

**Cost and failure mode**: this is a DOM-level patch, not a slot-level extension. If the kernel renames `data-row-key` or reorders a row's children, the plugin silently stops working — the list falls back to relative times, with no error and no damage. After upgrading DSH, glance at the list to confirm the labels are still absolute.

## Install

### From the Plugins page (recommended)

1. Open **Plugins** in the left sidebar
2. Click **Add plugin**
3. Enter the Git URL `https://github.com/msongw-design/dsh-plugin-session-clock`, or the absolute path of a local clone
4. Enable it under **Installed**

### Into a profile

```bash
# inside the profile directory (~/.dsh/profiles/desktop)
pnpm add /path/to/dsh-plugin-session-clock
```

Then add the package name to `dsh.profile.bundles` and restart.

## Compatibility

Developed and used against **DSH 0.2.1-rc.3** (macOS desktop profile). The row structure was checked against that version's `SessionRow`: the third child is the time cell, and the row carries `data-row-key="session:<id>"`. Earlier versions were not checked one by one; per the failure mode above, a structural mismatch only falls back to relative times.

## Development

```
node test/smoke.mjs
```

A headless smoke test runs the real `lib/client.js` against a fake module loader, a fake Cordis context, and a synthetic session row. It covers all four `clockLabel` branches, Chinese and English relative labels plus the guard against false positives, protection of status text, repainting an already painted row, and the slot registration. React comes from `~/.dsh/profiles/node_modules` (override with `DSH_PROFILE_MODULES`).

## Known limits

- Session rows only; the hover card's "创建于 …" and its relative time are untouched
- Left sidebar session rows only; search-result metadata carries no time
- Date order is not localized: `MM/DD` stays month/day regardless of language
- Status text such as "进行中" is never taken over, and no row is inserted or hidden

## License

[MIT](LICENSE)
