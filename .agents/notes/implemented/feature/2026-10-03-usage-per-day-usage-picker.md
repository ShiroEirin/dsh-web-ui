# Agent Note: Per-day usage pickers in dsh-usage (usage tab and Token bank)

Status: implemented

## Problem

The usage ledger has been persistent since [the plugin's first release](../feature/2026-08-29-usage-statistics-plugin.md): every fold lands in `$DSH_HOME/dsh-usage/usage-ledger.json` under its local day, and retention keeps `retainDays` of them (180 by default). What the browser could reach, however, was only today (`usage.today`), the last 30 days aggregated (`usage.range`) and the whole ledger aggregated (`usage.all`). A user asking "what did I spend on Tuesday" got today's card, a 30-day bar chart, or a lifetime total, and the per-provider and per-model rows of a past day were unreachable — the section looked like a plugin without persistence, because nothing on screen showed a past day.

## Decision

The day becomes a first-class window, served on demand rather than pre-aggregated into the poll:

- **`usage.availableDays?: string[]`** (new, optional) rides the overview: every retained day that recorded usage, ascending, reaching past the 30-day trend cap to the whole retention window. It is the pickers' option list and costs a few bytes per day.
- **`GET /api/dsh-usage/day?date=YYYY-MM-DD`** (new, `packages/dsh-usage/src/host/routes.ts`) answers one day as `{ ok: true, day: UsageDayView }` — the same `{ date, totals, providers }` shape the overview already serves for today, so a picked day and the live today card are one document type. The route reuses the family trust fence (loopback, or a paired-device cookie), answers 400 for a `date` that is not a real local day, and resolves a pruned or never-recorded day to a zeroed day. `UsageService.day()` exposes the aggregation; `isLedgerDateKey` in `src/core/ledger.ts` is the one date-key validator, shared with the persisted-document reader.
- **The section keeps no day cache.** `useDayView` fetches a picked day, cancels a superseded selection, and reports a failed load as its own error line. Today never fetches: the overview already carries it live, so switching back is instant and keeps counting with the 10 s poll.
- **Two pickers, one hook.** The usage tab's card switches between today and a picked day (title, totals, provider rows, day-level spend label all follow the selection; the peak/off-peak line stays on today because it describes the pricing window now). The Token bank's picker adds a leading "all retained days" option, so the voucher mints from one day or from the whole window, and its observed-spend line — a cumulative watch from the first balance reading — is whole-window only.
- **A picked day wraps its provider rows.** A day row reads `tokens · calls · cost`, longer than today's single-provider lines, so the shared provider row wraps its value onto its own line in a narrow panel instead of running into the provider name. The rule is layout-only and applies to every provider row.
- **The option list carries its own surface and label.** A native `select` paints its popup list itself and does not inherit the control's background, so an option with no background falls back to the browser's light list while its text still inherits the section's light text color: light text on a light list, unreadable on a dark skin (reported after the first push). Both the day picker and the settings-row select therefore set `option { background-color: var(--dsw-alias-bg-multi-select, Canvas); color: var(--dsw-alias-label-primary, CanvasText) }` — one pair per theme half, read from tokens the platform and the skins already ship, so text and background can no longer drift apart. The closed control keeps the card's transparent `currentColor` chrome; only the list the browser paints needs the explicit pair.

## Alternatives considered

- **Serving every retained day inside the overview document**: one request, no new route. Lost: the overview is polled every 10 s while the section is open, and a full retention window is up to 730 days of per-provider and per-model rows — tens of times the payload for a day the user looks at rarely. The date list is cheap (strings); the per-day breakdown is not.
- **A free date picker (`input type=date`) over the whole retention window**: any day would be reachable, including days with no usage. Lost: the ledger only holds days that recorded usage, so most of that range is an empty card, and a native date input brings locale-dependent parsing and a second control per tab. The dropdown also cannot offer a day the host will answer with zeros, and it reads as "the days I can look at" rather than "a calendar".
- **Enlarging the 30-day trend window to cover retention**: the trend is a bar chart over a window, not a per-day browser; extending it would put a year of bars on screen and still not give that day's provider rows.
- **A client-side day cache over the store**: it would avoid refetching when a user flips between two days. Lost: the store is documented as the section-local overview snapshot plus fetch lifecycle, and the section component already survives tab switches, so a cache would add shared state for a saving a loopback request already makes cheap.
- **Deriving past days from the persisted ledger file in the browser**: impossible by construction — the file is host-side, and its contents are exactly what the ledger route already guards.

## Consequences

- The pickers list only days with recorded usage; a day without usage is never offered, and a day pruned by retention reads as an empty or zeroed card rather than as a different day.
- The day route is a third fenced endpoint: the daily facts are as personal as the overview, so `isUsageAllowed` gates it identically (a paired LAN device passes; every other unpaired request keeps its 403).
- An older host document without `availableDays` renders no picker at all, and an older browser half ignores the extra route; both directions stay compatible because the new field is optional and the new route is only reached from a picker that exists.
- A picked day is a snapshot of one fetch: the 10 s poll does not refresh it, which is correct for a closed day and covered by the today path for the open one.
- `tests/usage-service.spec.ts`, `tests/routes.spec.ts` and `tests/section-card.spec.tsx` pin the day aggregation, the query gate and fence, and the two pickers' switching behavior.
