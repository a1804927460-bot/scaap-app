# Agent platform status (2026-09-07)

## Implemented locally

- Both Agent entrypoints send routing intent separately from the fallback model
  label. Queued messages snapshot that intent; later selector changes do not
  modify queued tasks. Manual model selection sends no automatic strategy.
- `config/agent-routing.json` defines three model capability tiers and three
  preference policies. Complexity is a conservative text heuristic, not a
  trained router or a quality guarantee. Short continuation prompts also inspect
  recent user context. New configured models appear in the manual list; they
  are not automatically trusted as cheap or capable routing candidates.
- Gateway resolves only configured routes with keys. Existing same-model safe
  fallback semantics remain intact; ambiguous accepted requests are not replayed.
  No new cross-model outage fallback or distributed circuit breaker is claimed.
- Shared context budgeting preserves the trusted system instruction and complete
  recent turns/tool exchanges, leaves the stored transcript intact, and rejects
  an oversized current task rather than silently cutting its content. UTF-8-byte
  budgeting is a conservative estimate, not provider token usage for billing.
- Client-supplied historical system roles are demoted before inserting the host's
  trusted instruction. This is one boundary, not a complete injection defense.
- MiniSearch provides local document retrieval through the embedded MCP tools.
  Only explicit file remembering is supported, with separate approval even in
  full-access mode. Credential paths and detected secrets are rejected. Documents
  are account-separated, persisted atomically, replaceable and removable.
  Retrieval returns at most four 1000-character excerpts with document names.
  Users can ask to remember, search, list or forget files in either Agent.
- This initial local store is limited to 128 text snapshots / 8 MiB. Reads inherit
  the host's 1 MiB input and 60,000-character text limits. It is not a vector DB,
  does not watch files, does not parse every binary format, and is not suitable
  for hundreds of thousands of documents. No full-disk scan or embedding upload.

## Remaining work

- Real SSE: upstream documentation explicitly supports `stream:true`; the current
  client/provider path still uses `stream:false`. Implement incremental parsing,
  cancellation, final usage, continuation handling and both renderer views before
  enabling it. Never present buffered typewriter animation as streaming.
- Dynamic UI: use validated component schemas and allowlisted renderers, not
  arbitrary model-generated HTML or JavaScript inside the privileged app.
  Existing artifact output and sandbox execution remain available.
- Planning: existing bounded tool loop remains; a visible editable task plan and
  durable step lifecycle are not implemented. Show concise actions/outcomes,
  not private chain-of-thought.
- Billing/observability: actual usage settlement, estimate ranges, trace IDs,
  redacted tool events and retention/deletion controls still need integration.
  Standard logs remain useful. Do not upload raw transcripts to an observability
  vendor by default. Agent billing is still not enabled.
- Verify moderation across input, output, retrieval and tools. System-prompt
  secrecy is not an authorization mechanism. Keep tenant binding outside the model.
- Desktop live-provider tests, restored-history UI regression, packaged smoke
  tests and deployment are outstanding. No cloud DB migration was required for
  this local-memory phase.

## Component assessment and sources

- MCP official SDK: in-memory transport already integrated, no public listener.
- MiniSearch 7.2.0: documented tokenizer hook supports `Intl.Segmenter` for local
  multilingual retrieval. https://github.com/lucaong/minisearch
- AI Reiter Chat API: verified 2026-09-07, streaming and tool-calling fields.
  https://docs.aireiter.com/zh/api-reference/text/openai-chat-completions-api/endpoint.md
- AI Reiter prices: https://aireiter.com/market ; see the separate price audit.
- LiteLLM routing: https://docs.litellm.ai/docs/routing ; not added as a second
  production gateway because existing auth, media jobs and credit transactions
  must retain one authority. Its routing patterns can inform later health policies.
- Qdrant partitioning: https://qdrant.tech/documentation/guides/multiple-partitions/
  Cloud vector retrieval deferred because the user chose local authorized files.
- Langfuse/LangSmith/Helicone are not installed or receiving user data.
  The attempted Langfuse data-masking URL returned 404; no claims rely on it.

Run `npm run test:agent-core`, `node scripts/test-gateway-providers.mjs` and the
existing Playwright preset/queue tests for this phase.
