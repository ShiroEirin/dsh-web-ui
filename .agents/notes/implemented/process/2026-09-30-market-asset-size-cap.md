# Agent Note: The market asset size cap blocks an oversized skin at deploy time

Status: implemented

## Problem

The 2026-09-30 skins intake round merged five pull requests into the dsh-skins
satellite and landed them here in the usual two steps: move the submodule pin to
the satellite's new main tip (`0fd62f6` -> `ec4ed25`), rebuild `market/dist`,
and push to dev. `market:check` and `test:scripts` were green and the local
build reported nothing wrong. The deploy lane then failed inside `wrangler
deploy`:

```
[ERROR] Asset too large.
  Cloudflare Workers supports assets with sizes of up to 25 MiB.
  We found a file .../market/dist/assets/skins/rainy-night.zip with a size of 31.5 MiB.
```

The store ships each skin as one zip asset, and Cloudflare Workers caps a single
asset at 25 MiB (26,214,400 bytes). `rainy-night.zip` is 33,027,261 bytes
because the skin carries a 32,494,969-byte background video. Nothing in the
repository stated that cap: [market-build](../../../../scripts/market-build)
enforces the installer's `MAX_FILES_PER_ASSET`, a file count, and has no
byte-size gate, so an oversized asset passes every local and CI check and only
fails after the pin is already on dev - where the failure blocks every later
market deploy on that branch, because the path filter watches the same pins.

## Decision

The landing was reverted rather than patched over. The revert moved the pin back
to `0fd62f6` and restored `market/dist`, the deploy lane went green again
(run 36717073370), and the contributor was asked on dsh-skins#16 to re-bake the
loop so the zip stays under 25 MiB. The re-bake arrived as dsh-skins#28 (the same
2026-09-29 master at CRF 24: 16,974,454 bytes, SSIM 0.9870 against 0.9917, its
README/README.zh/skin.json numbers carried along), the round re-landed the pin at
`493f81c7` and the lane went green on commit `122b3b46` (run 36718315143).
Nothing under `market/dist` exceeds 26,214,399 bytes.

## Alternatives considered

- **Restore the 16,549,139-byte bake the same pull request had produced before
  its final commit, and ship the round unchanged.** Rejected. It would override
  the contributor's deliberate choice of bake on content they own, and their
  measured provenance text describes the withdrawn bake, so the maintainer
  would also be rewriting their record.
- **Ship it and let the deploy fail until upstream shrinks the asset.**
  Rejected. A red market lane on dev blocks every other session's market work,
  and the completion criterion for a landing is a green lane.
- **Add a byte-size cap to market-build and let it skip an oversized skin.**
  Rejected for this round. Silently dropping a merged catalog item is a product
  decision, and the guard belongs in a change of its own with its own tests
  rather than in the middle of a landing repair.

## Consequences

- The round's seven merges reach the store in one commit after the re-bake, and
  a revert followed by a re-land is cheap here because the pin and `market/dist`
  are the only things the landing touches.
- A content landing is not complete until the deploy lane is green, so a skin
  carrying large media has to clear the lane's per-asset ceiling as part of the
  merge gate rather than after it. The size of the shipped zip, not the size of
  the source file, is what the ceiling applies to.
- `market-build` still has no byte-size gate; the next round should consider
  adding one so this class of failure surfaces before the pin moves.
- [Workshop deploys from dev pushes](2026-08-25-workshop-deploys-from-dev.md)
  owns the lane's triggers and gates; this note records the constraint the lane
  enforces from the platform side.
