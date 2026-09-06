# Agent channel pricing verification

Verified on 2026-09-07. These are AI Reiter channel rates, not the adjacent
official retail rates, and not Messs credits. This audit does not enable billing.

## Sources

- https://aireiter.com/market (LLM tab after client hydration)
- https://aireiter.com/chat/gemini-3-8-flash (model details)
- https://aireiter.com/chat?model=chat-gemini-3.1-pro (Rate dialog)
- https://aireiter.com/chat/gpt-5-6-sol (model details)
- https://aireiter.com/llm-api/gpt-5.6 (channel price table)
- https://docs.aireiter.com/zh/api-reference/text/openai-chat-completions-api/endpoint.md

## Base Rates

All USD figures below are per million tokens.

| Preset | Model | Input | Output | Cache read | Cache write |
| --- | --- | ---: | ---: | ---: | ---: |
| Fast | gemini-3.8-flash | 0.225 | 1.125 | 0.0225 | Not listed |
| Balanced | gemini-3.1-pro | 0.60 | 3.60 | 0.06 | Not listed |
| Ultimate | gpt-5.6-sol | 1.20 | 6.00 | 0.12 | 1.50 |

Flash details expose 22.5 / 112.5 / 2.25 upstream credits per million tokens.
Do not use the rounded USD 1.13 output label as the precise output rate.
The Gemini 3.1 Pro dialog lists approximately 60 / 360 / 6 upstream credits.
The GPT guide prose says "half" while its numeric prices indicate 30% of
official rates; use the channel table, not that prose, for the base-rate audit.

## Messs Conversion

Current product conversion is 1000 Messs credits = CNY 70 and USD/CNY = 7.3.
The latter is the existing configured conversion, not a newly verified FX quote.
User policy for Agent is upstream cost multiplied by 1.20, without the media
profit multiplier. Existing image/video pricing must remain unchanged.

Before rounding, base input/output Messs credits per million tokens are:

| Model | Input | Output |
| --- | ---: | ---: |
| gemini-3.8-flash | 28.157142857 | 140.785714286 |
| gemini-3.1-pro | 75.085714286 | 450.514285714 |
| gpt-5.6-sol | 150.171428571 | 750.857142857 |

These are token unit prices, not a fixed per-task estimate. An estimate needs
the actual context and an explicit output budget; actual settlement needs usage.

## Outstanding Billing Requirements

- The Rate dialog warns that long context has tiered prices. Its linked GPT
  guide does not state thresholds or multipliers. Do not silently apply base
  rates to all context sizes; obtain the tier schedule before enabling that path.
- The chat page mentions a minimum of one upstream credit per request. Confirm
  whether this is also an API minimum, rather than assuming it applies to the API.
- Database balances and ledgers are integers; the current calculation helper
  returns hundredths. An authoritative settlement rounding policy is required.
- Reserve and settle in the database, bind idempotency to user and request,
  charge all continuation/tool-follow-up requests, and persist the rate snapshot.
- Missing usage must not become zero cost. Cache-write normalization and pricing
  must be verified before accepting usage containing cache creation.
- AI Reiter rates must not be applied to another provider's fallback route.
- Main chat and canvas Agent need the same estimate and settled-usage metadata,
  including detached windows and restored messages.

Paid chat remains disabled until the end-to-end reservation, settlement and UI
integration are implemented and verified. No database migration or deployment
was performed as part of this pricing-source audit.
