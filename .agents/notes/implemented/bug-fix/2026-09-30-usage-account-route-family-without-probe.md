# Agent Note: The DeepSeek account route joins the family without being probed

Status: implemented

## Problem

A user signed in to a DeepSeek account (`llm-deepseek-account` registers the live route `deepseek-account`, authenticating with the account token rather than an API key) saw the Token Bank tab permanently empty while the Usage tab reported real token consumption on that very route. The header read "DeepSeek Account · deepseek-flash" — the route actually in use — above an empty note (issue #1772).

The cause was that the DEEPSEEK adapter listed only `deepseek` and `deepseek-official`, and `isDeepSeekProviderRoute()` derives from that list. Every accounting decision keyed on that predicate — fold-time spend stamping, the peak-period line, and the whale-yuan bank — therefore skipped the account route, and a zero-token family mints nothing by design. The host never filtered the ledger: `summarizeDays()` aggregates whatever the session reported, so the data was always present and only the client-side family test excluded it.

The naive fix — adding `deepseek-account` to the adapter's `ids` — is wrong, and in the worst possible direction. `ids` is not only a family list: `adapterFor()` drives the balance probe, the `DEEPSEEK_API_KEY` credential fallback in `resolveCredential()`, alias folding, and the renderable provider row. `/user/balance` reads an API-key account, so probing the account route either fails on the account token or, when the user also configured `DEEPSEEK_API_KEY`, prints **the API-key account's money under the account route's name** — precisely the mis-attribution #1688 was closed to prevent.

## Decision

A `ProviderAdapter` gains a `familyOnlyIds` list: route keys that belong to the family for accounting but are deliberately invisible to probing.

The DEEPSEEK adapter declares `familyOnlyIds: ['deepseek-account']`, and `isDeepSeekProviderRoute()` returns true for a listed id in addition to a probed one. `adapterFor()` is unchanged, so it still resolves `undefined` for the account route and the two decisions cannot widen together: every caller of `isDeepSeekProviderRoute()` is an accounting decision (pricing, the period line, the bank), while probing, credential fallback, and alias folding all read `adapterFor()`.

The account route therefore gets exactly what the issue asked for and nothing more: its calls are priced from the same V4 price book, its tokens mint whale yuan, and the peak-period line appears when it is the session's current route. It keeps a provider row carrying its runtime display name and no balance, and it never appears in the plans tab.

The split is a standing rule for the table, not a one-off: **a route that authenticates without an API key belongs to its provider's family and must never inherit that provider's API-key endpoints.** Any future non-key route follows `familyOnlyIds`.

## Alternatives considered

- **Adding the id to `ids` and accepting the probe.** Rejected: it silently grants the account route the official balance endpoint and the family's `apiKeyEnv` fallback. With `DEEPSEEK_API_KEY` configured it reports another account's balance under this route, which is the exact failure #1688 closed. Rejected for correctness, not for aesthetics.
- **Widening the family predicate only in the client** (the voucher and the period line). Rejected: the host stamps `cost` at fold time through the same predicate, so a client-only fix would mint the tokens but leave the spend estimate at zero — two cards disagreeing about the same route. Family identity belongs to the adapter table, which both halves already import.
- **Suppressing the account route everywhere it is not supported** (treat it as an unknown provider). Rejected: it is a real, in-use route on the same bill. The honest rendering is a named row with usage and no balance, which is what the family-only route produces.
- **Probing the account route with the account token** so it could report its own balance. Rejected: the plugin holds no DeepSeek account grant, and the harness does not expose the account route's balance contract. Guessing an endpoint would risk another account's figure — the same class of error as #1688 and #1724, in the wrong direction.
- **Merging the account route into the official row** so one DeepSeek account shows once. Rejected: the two routes are billed through different credentials and may be different accounts, and [alias folding](2026-09-17-usage-alias-route-folding.md) already encodes the rule that two live routes are two accounts.

## Consequences

- A user on the account route sees a populated Token Bank, a fold-time spend estimate, and the peak-period line. The empty state now means genuinely no family usage.
- The account route issues no probe and holds no balance figure; the balance tab keeps showing no configured provider for it, which is accurate rather than a gap.
- Because `adapterFor()` still returns `undefined`, alias folding is unaffected: a dormant catalog entry can never shadow or merge with the account route, and two live routes stay two rows.
- `familyOnlyIds` is optional and no other adapter declares it, so every other family keeps its current single-list behavior.
- A future non-key route for another provider needs one list entry; nothing else in the table changes.

## Testing

- `packages/dsh-usage/tests/adapters.spec.ts`: the account route is in the family but resolved by no adapter for probing; no family-only id collides with a probed id or another family-only id; the two key routes keep their probed behavior.
- `packages/dsh-usage/tests/usage-service.spec.ts`: end to end from the reported environment — a session spending on the live account route issues no request, its row carries no balance, and its calls are priced with a non-zero cost; with both channels live the overview keeps two rows, the key route still probes, and the account route stays unprobed.
- `packages/dsh-usage/tests/voucher.spec.ts`: the bank mints from the account route alongside the key routes and still ignores unrelated providers.
- The service tests are the guard against the rejected alternative: moving `deepseek-account` into `ids` fails them, so the mis-attribution path cannot be reintroduced by a future edit that "just adds the id".
- `pnpm --filter @linxin666/dsh-usage test`: 11 files, 151 tests. `pnpm typecheck` passes.
