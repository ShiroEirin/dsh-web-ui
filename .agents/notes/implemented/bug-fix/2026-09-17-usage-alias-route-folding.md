# Agent Note: Usage balance card folds adapter-family alias routes

Status: implemented

## Problem

The dsh-usage balance card rendered the official DeepSeek account twice: `deepseek` (lowercase) and `DeepSeek`, each showing the identical CNY balance, while the user had configured only the official provider.

The host enumerates every route the LLM runtime knows — `llm.listProviders()` plus `llm.listConfigurableProviders()` — and the second source is the pi-ai catalog directory, which ships a dormant `deepseek` entry alongside the live `deepseek-official` route the `llm-deepseek` adapter registers. The DeepSeek adapter deliberately serves both ids (the live route is what sessions carry), and credential resolution falls back to the family's `apiKeyEnv` (`llm-deepseek`'s `DEEPSEEK_API_KEY`) for any DeepSeek-family route, so the unconfigured catalog entry resolved the same key and passed the client's configured-only credential filter, which [renders configured providers only](../simplification/2026-09-09-usage-render-configured-providers-only.md). Each poll cycle also probed `https://api.deepseek.com/user/balance` twice for one account.

## Decision

Alias folding lives host-side in `foldAliasRoutes()` (`packages/dsh-usage/src/core/provider-routes.ts`) and is applied where the service enumerates routes (`UsageService.listProviderRoutes()`): a route the LLM runtime serves nothing on (catalog-only, `live: false`) is dropped when another route of the same adapter family is live. `ProviderRoute` carries the `live` flag it needs, set by the enumeration itself rather than inferred from display names or route order.

The rule is family-scoped and deliberately conservative:

- Live routes are never folded, so two configured profiles that share an adapter family (for example `zai` and `zai-coding` on api.z.ai) remain two accounts.
- A family with no live route keeps its catalog entry, so a deployment whose catalog alias is the only route of its family renders exactly as before.
- Routes outside the adapter directory pass through untouched.

**Folding is not the only way two accounts can collide (issue #1688).** A route id can also be reused by a provider that merely speaks the same API: `deepseek` is the official catalog entry AND a common id for an OpenAI-compatible reseller (Alibaba Bailian, ...) whose profile points `baseURL` at another host. Family folding does not merge those (both are real accounts), but the DeepSeek adapter's balance endpoint is a fixed official origin, so probing it for the reseller reported the official account's money under the reseller's row. The balance half of an adapter may now declare `origin` (`DEEPSEEK_API_ORIGIN` for DeepSeek), and `balanceAppliesToRoute()` refuses that endpoint for a route whose configured `baseURL` resolves to a different origin; such a route renders `balanceSupported: false` (the UI's existing unsupported state) and issues no request. A route that pins no `baseURL` - the catalog alias resolving the family's own credential - still applies, and adapters whose endpoint follows the profile host declare no origin and are unaffected.

A session running on a folded id keeps its strip-ready view: `currentView()` already falls back to any snapshot of the same adapter family, and `routeDisplayName()` falls back to the adapter's display name. The surviving row is the live one, whose display name is the runtime's human name (`DeepSeek`) rather than the catalog entry's raw lowercase id.

## Alternatives considered

- **Fold in the browser section** (the layer [the configured-providers filter](../simplification/2026-09-09-usage-render-configured-providers-only.md) chose): the wire document carries no adapter-family identity, so the balance card, the plans tab, and the sidebar panel would each need the rule, and the duplicate host-side probe would survive. Family identity exists only in the host, next to the adapter table.
- **Keep the catalog id instead of the live route**: sessions and agent default-model records reference the live route, its display name is the human one, and the catalog entry is the dormant one. Keeping the catalog id would render a lowercase id and lose the name the runtime reports.
- **Dedupe by display name or by identical balance value**: both are coincidences, not identities — two real accounts can share a name or a balance, and a wrongly folded row would hide a provider the user configured.
- **Render the alias row with an "alias of ..." label**: keeps a row for a route the user never configured and whose balance is not separately actionable, with no way to tell it apart from an unconfigured catalog entry that happens to resolve a credential.
- **Filter catalog entries out of the enumeration entirely**: would drop dormant entries that are legitimate routes once `llm-deepseek` is absent, and would remove the directory data the settings surface reads.

## Consequences

- One row and one probe per account: the duplicate `api.deepseek.com/user/balance` request per poll cycle is gone, and the account shows once under the runtime's display name.
- The dropped id's persisted snapshot is removed by the existing unseen-route cleanup on the next cycle. Token totals, the trend chart, and the observed-spend watch were already family-merged, so no figure moves.
- The wire document no longer carries the folded catalog entry; the client's `credential !== 'none'` filter still hides the remaining dormant entries, and an older client keeps rendering whatever a newer host sends.
- A host without the `llm-deepseek` adapter, where `deepseek` is the only route of its family, is unaffected.
- A reseller profile sharing the `deepseek` route id no longer shows the official account's balance: it shows the unsupported state instead of a wrong number. The trade-off is deliberate - the adapter cannot know a reseller's balance endpoint, and a wrong figure is worse than an absent one.

## Testing

- `packages/dsh-usage/tests/provider-routes.spec.ts`: the pure rule — a catalog alias shadowed by a live route folds away, two live routes of one family both survive, catalog-only families survive, folding stays family-scoped, and adapter-less routes pass through.
- `packages/dsh-usage/tests/usage-service.spec.ts`: the end-to-end shape from the reported environment (live `deepseek-official` plus catalog `deepseek`) yields exactly one provider row with the live route's name, and exactly one balance probe.
- `pnpm --filter @linxin666/dsh-usage test` and `typecheck`: 11 files, 136 tests, both commands exit 0.
- `packages/dsh-usage/tests/adapters.spec.ts` and `tests/usage-service.spec.ts` (#1688): a reseller `deepseek` profile keeps its own account (no probe issued, row reports unsupported) while an explicit official origin still probes, plus the pure origin rule including the unparsable-base-URL fallback.
