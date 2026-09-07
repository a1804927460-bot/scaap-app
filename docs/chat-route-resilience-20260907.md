# Chat Route Reliability

## Observed failures

- Production returned provider-task-recovery-pending and provider-rate-limited for chat requests.
- Direct synthetic upstream checks: Flash 429 after 22253 ms, Pro 429 after 23473 ms, both reporting "All available accounts exhausted"; Sol succeeded after 3516 ms.
- This evidence concerns chat pool capacity, not the image mixing percentage.

## Implementation

- Use Cockatiel 3.2.1 for circuit state, half-open probes and bounded retries. Node 20 remains supported.
- Health is scoped by route, endpoint, model and credential fingerprint. It stores no user prompt or response.
- Depleted pools cool down; automatic modes prefer recently successful responsive compatible candidates. Existing stronger-model-only fallback rules and manual model identity are preserved.
- At most one extra retry for explicit transient pre-accept rejections, with Retry-After, jitter and a bounded wait budget. Accepted/ambiguous requests and policy blocks are never replayed.
- Chat errors no longer promise durable media recovery or held image/video credits.
- Structured attempt logs capture model, route, duration, status and normalized usage, without prompts or credentials.
- Image/video routing weights, media submission recovery, customer pricing and generation concurrency limits are unchanged.

## Evidence and limits

- Full npm test and gateway regression suite passed, including image/video route contracts.
- Real adapter calls after the change: first fast request 27973 ms (Flash rejected; Pro recovered), then balanced 3893 ms and ultimate 3545 ms. These are synthetic measurements, not a latency guarantee.
- Cold requests may still wait for the upstream to explicitly reject a submission. Do not hedge paid submissions blindly to hide that wait.
- Circuit health is per gateway process. A restart clears health; separate replicas do not share state. Independent provider capacity is still necessary to survive a complete upstream outage.
- The implementation does not add SSE or formal Agent billing. Estimate labels are separately simplified without changing the estimate calculation.

## References

- https://github.com/Portkey-AI/gateway : configurable fallback, retries and load balancing.
- https://github.com/connor4312/cockatiel : circuit breakers, half-open probes, retry policies and backoff.
- https://www.npmjs.com/package/cockatiel/v/3.2.1
