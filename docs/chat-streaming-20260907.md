# Chat Delivery Latency

## Finding

The connected chat routes use an OpenAI-compatible endpoint. Previously the
upstream request explicitly disabled streaming, the gateway buffered JSON,
Electron awaited the complete reply, and both Agent views only showed a timer.
The catalog already has a 60-second account-scoped cache and attachment parsing
already runs concurrently; neither was replaced speculatively.

A synthetic direct upstream request on 2026-09-07 returned SSE headers and its
first (role-only) packet at 3698 ms, and completed at 5276 ms. This confirms
transport support, not a guaranteed first-text or completion latency.

## Change

- Explicit `eventsource-parser` dependency, incremental UTF-8 decoding and SSE
  framing, following the transport pattern used by Vercel AI SDK.
- Opt-in SSE via Accept on /v1/chat, flush headers, no-transform/no-buffering
  headers, heartbeats, backpressure and disconnect cancellation. Legacy JSON
  clients continue to work; JSON-only upstreams do not trigger a second POST.
- Stream text from the currently connected OpenAI-compatible chat routes.
  Native Gemini, Anthropic and Responses adapters retain existing JSON behavior.
- A done event carries the authoritative text and normalized usage. Missing
  terminal events, invalid JSON, excessive output and stream errors are not
  treated as successful completions and are never blindly replayed.
- Existing exact-overlap continuation and complete file/tool validation remain.
  Continuation is buffered until validated. Tool arguments and model reasoning
  are not emitted as text; internal artifact bodies are withheld from previews.
- Both Agents share one request-scoped renderer subscription. Electron batches
  previews at most once per 32 ms, rendering uses inert text, thinking timers
  do not overwrite it, tool progress remains visible, and listeners are cleaned
  up. A switched account or detached message never receives stale previews.
- Gateway timing logs separate preparation, fair-queue wait, first text and
  completion. Desktop logs separate preparation/catalog/first preview/total.
  Logs contain no prompts, file contents, access tokens or credentials.

## Verification

- `npm test`: existing desktop and gateway suites passed.
- `npm run test:chat-stream`: split UTF-8, usage, continuation, legacy JSON,
  failure safety, cancellation, private tool bodies and real HTTP early-delivery
  tests passed.
- `scripts/test-chat-stream-ui.cjs`: both shared renderer paths, request
  isolation, cleanup, inert text and light/dark 480/1280px screenshots passed.
- Live smoke mode: `MESSS_LIVE_CHAT_AUDIT=1 MESSS_LIVE_CHAT_STREAM=1` with
  `scripts/probe-live-chat-routes.mjs`. Uses a temporary test account and removes
  it afterward. Does not use an existing customer's conversations or files.

## Boundaries

Streaming reduces time before readable output; it cannot guarantee faster
upstream generation. Cold-route rejection delays described in
`chat-route-resilience-20260907.md` still apply. No speculative duplicate paid
submissions, image/video route changes, concurrency-limit changes, database
migrations or billing changes are part of this patch. Formal Agent billing
is still separate work. Desktop streaming requires an updated client.

## References

- https://github.com/rexxars/eventsource-parser
- https://github.com/vercel/ai/blob/main/packages/provider-utils/src/parse-json-event-stream.ts
- https://github.com/vercel/ai/blob/main/packages/ai/src/ui-message-stream/pipe-ui-message-stream-to-response.ts
