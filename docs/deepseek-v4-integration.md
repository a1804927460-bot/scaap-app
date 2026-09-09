# DeepSeek V4 on AI Reiter — 2026-09-09

Both models were verified with the configured upstream account through GET /api/v1/models and a small real POST /api/v1/messages request. Both returned text, end_turn, and usage. Flash returned revision deepseek-v4-flash-ga-260731; Pro returned deepseek-v4-pro. The OpenAI Chat Completions endpoint rejected these models as protocol-incompatible.

| Model | USD input / million | USD output / million | USD cache read / million |
| --- | ---: | ---: | ---: |
| deepseek-v4-flash | 0.042 | 0.084 | 0.00084 |
| deepseek-v4-pro | 0.1305 | 0.261 | 0.001088 |

Source: https://aireiter.com/market (exact sku_pricing, 100 upstream credits = USD 1). Rounded labels on https://aireiter.com/chat/deepseek-v4-flash and https://aireiter.com/chat/deepseek-v4-pro are not used for calculation. CNY conversion uses the existing protective 7.3 rate. Pro cached rate is exactly CNY 0.0079424/million; integer arithmetic now supports nine decimal places to avoid rounding this cost down.

Main chat and canvas expose both models as manual choices, with existing preset defaults unchanged. Existing Messages JSON response support is used; token-by-token Messages streaming is not implemented. Cache creation is still rejected by billing without a verified separate rate. This change does not implement the broader media repricing project.
