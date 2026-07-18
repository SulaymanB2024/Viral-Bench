# Provider efficiency contracts

The `*_v1` acquisition records are additive operational evidence. They do not
modify normalized posts, viral-library records, or generated corpora.

`ProviderSpendEventV1` separates three monetary claims: a provider-reported
actual charge, a usage-pricing estimate, and the conservative reservation.
Until a charge is settled, the full reservation remains cumulatively consumed.
Unknown billing is therefore a stop condition, not a zero-dollar result.

Apify starts remain non-retryable. A successful terminal run is reread after
the settlement window; the exact returned build, dataset totals, truncation,
and duplicate-adjusted yield must be retained before a compatible run is
consolidated. Configuration audits report only presence and identifiers, never
credential values.

`TwelveLabsBatchAnalysisV1` uses only ready, reusable asset IDs. Batch analysis
uses `pegasus1.5`, deterministic `custom_id` values, at most 1,000 requests and
2,000 content hours per batch, and a 24-hour execution lifetime. Results may
be read for 30 days. Expired, canceled, or failed items are retained with their
lineage and only those items may enter a child retry batch. The adapter does not
infer a batch-price discount. Its estimate explicitly contains Pegasus video
minutes and output-token caps. Marengo embedding/indexing is intentionally not
part of this operation and must wait until metadata filtering completes.
