# Evidence Quality Upgrade

This is a one-time, resumable intelligence refresh. It does not create, enable,
or modify a scheduler.

## Commands

```bash
npm run intelligence:run-once -- preflight
npm run intelligence:run-once -- run --live
npm run intelligence:run-once -- resume --live
npm run intelligence:run-once -- status
```

`preflight` is read-only with respect to providers. `run` and `resume` require
the explicit `--live` flag before any paid call can start.

## Spend contract

The provider ledger fails closed at $25. Each call reserves its full declared
ceiling before execution. Unknown provider usage continues to consume that full
ceiling. The fixed lane allocations are:

- $5 social discovery
- $4 audience and comment research
- $7 video analysis
- $3 Instagram image and carousel analysis
- $2 analysis retries
- $2 current-metric rechecks
- $2 reserve, unavailable to ordinary calls

The refresh uses deterministic local vectors, so corpus and query embeddings do
not add an unallocated provider-spend category.

## Evidence and release gates

The run emits separate public and operator corpora. Public evidence must be
`public_reviewed`, and public vector coverage must be complete. Audience themes
below the privacy bucket of five remain operator-only. Owned-outcome questions
must disclose `not_connected` until a valid aggregate export is supplied.

The generated `public/` directory is allowlisted. Source files, corpora, vector
artifacts, scripts, tests, manifests, local paths, credentials, and provisional
operator evidence are not static release content.

Promotion is permitted only after the final manifest reports every source,
spend, official-source, vector, visibility, mixed-media, owned-data, and release
privacy gate as passed.
