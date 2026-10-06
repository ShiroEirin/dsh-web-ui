# Agent Note: Task board label management

Status: implemented

## Problem

A task's labels are the board's only cross-cutting classification: they drive the card badges, the header's multi-select filter and — through a label's execution hint — the prompt of every later run. They could only be edited from the card that carried them, so the label row was append-only. A typo, two labels that mean the same thing, or a label an afternoon experiment left behind stayed in the union of everything in use across the ledger, and the row grew until it stopped being a filter and became a wall: a board with twenty labels cannot be narrowed by clicking, and nothing in the product could remove one.

## Decision

Labels are managed by two ledger-wide transitions, exposed as the `rename-tag` and `delete-tag` protocol actions:

- **One transaction per edit.** The Host ledger applies the whole rewrite atomically — every matched card is rewritten in the same commit and the revision moves once — so a concurrent reader never sees half a rename. The pure transitions live in `src/core/use-cases/task-tag.ts` and are shared by the Host ledger and the transport-less client path.
- **Renaming onto a name already in use merges the labels.** A card carrying both keeps the target's own row, so the surviving label's execution hint stays the one that applies; a card carrying only the source keeps that row's hint under the new name. Merging never grows a list, so the eight-label cap cannot be violated by an edit.
- **Deleting covers archived cards.** The header's label row draws from the whole ledger (a label left on an archived card would come straight back), so the transition ignores the archive boundary.
- **The board's label row offers the way in.** A "Manage labels" action beside the filter chips opens the label manager: one row per label in use with the number of cards carrying it, an inline rename (which says when the typed name merges into an existing label before it is submitted), and a delete behind the shared confirm dialog, which names how many cards the label is removed from.
- **Only the wire gate is strict about names.** The protocol accepts a non-empty trimmed name within the tag cap and refuses anything else; trim/merge/deduplication belong to the use case, so the Host and a legacy in-memory board agree on the result.

## Constraints

- Host-authoritative like every other board mutation: the browser submits an action and only reflects what the ledger confirms. The transport-less path applies the same pure transitions for the legacy in-memory board.
- The label name stays the identity of a label. Two cards carrying the same name already share one label, which is why merging, not conflict resolution, is the meaning of renaming onto an existing name.
- No schema change: labels remain the optional `tags` field on a task row, and a card whose last label is removed drops the field exactly like clearing labels from the card editor.

## Testing

`tests/task-tag.spec.ts` covers the two transitions (rename everywhere, merge keeping the target's hint, the source hint surviving when only the source is carried, delete across archived cards, the last label clearing the field, refusals for an unknown, blank or over-long name, and trimmed input). `tests/tag-manager.spec.tsx` covers the dialog (usage counts, the rename it dispatches, the confirmation a delete passes through, the empty board). `tests/protocol.spec.ts` gates the wire shape and `tests/host-ledger.spec.ts` applies both actions through the real ledger, including the revision bump and the refusal. The flow was also exercised end to end against a running Host: a rename and a delete performed in the manager were read back from `$DSH_HOME/task-board/ledger-v2.json`.

## Alternatives considered

**Rewriting each card through the existing `update` action.** Rejected: renaming a label carried by fifty cards would be fifty round trips, each of them a separate revision, and a failure in the middle would leave the board half-renamed with no way to tell which half. One ledger transaction is atomic and reports one outcome.

**A separate labels registry (a document listing labels, with cards referencing ids).** Rejected: a label lives on the card today, the ledger already stores it there, and a registry would need a migration plus a reconciliation rule for cards that disagree with it. The union of the labels in use is a derived fact, not a second source of truth.

**Deleting by renaming to an empty name.** Rejected: it makes the empty string a valid target of the rename gate, and the two operations have different confirmations and different reversibility.

**Referring labels by index or generated id instead of name.** Rejected: renames would then need a rewrite of every referencing card anyway, and the name is what users type, read and filter by.

**Refusing a rename onto an existing label instead of merging.** Rejected: "these two labels are the same thing" is the common case (a typo fixed twice, an import that used a different spelling), and refusing it would force the user to delete one label first — losing the very hints a merge preserves.

## Consequences

- The board gains two wire actions. An older bundle talking to a newer Host (or the reverse) gets its action refused by the strict protocol gate instead of a partially applied edit.
- `updatedAt` moves only on the cards the edit actually touched, so a ledger-wide rename does not restamp the archive.
- The manager is the only place a label can leave the board; a future bulk-label editor should extend this dialog rather than grow a second surface.
