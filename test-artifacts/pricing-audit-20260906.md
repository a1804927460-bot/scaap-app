# Pricing audit, 2026-09-06

Public AI Reiter prices were fetched directly on this date. API documentation
describes accepted parameters; the product pricing tables supply USD costs.

| Active channel | 1K | 2K | 4K |
| --- | ---: | ---: | ---: |
| nano_banana_pro_max | 0.165 | 0.165 | 0.330 |
| nano_banana_v2_max | 0.077 | 0.1155 | 0.154 |
| gpt_image_2_official, low | 0.022 | 0.029 | 0.036 |
| gpt_image_2_official, medium | 0.092 | 0.100 | 0.170 |
| gpt_image_2_official, high | 0.330 | 0.350 | 0.620 |

Sources:
- https://aireiter.com/image/nano-banana-pro
- https://aireiter.com/image/nano-banana-v2
- https://aireiter.com/image/gpt-image-2
- https://docs.aireiter.com/en/api-reference/images/nano-banana-v2/generation
- https://docs.aireiter.com/en/api-reference/images/gpt-image-2-official/generation

MiniMax H3's pricing table at https://aireiter.com/video/minimax-h3 lists
USD 0.1125/second for 768P and USD 0.1825/second for 2K. Input video duration
is also billed. The first five reference images are free; additional images
cost USD 0.055 each. The same page's FAQ contains different, inconsistent
figures. The explicit pricing table was used; live account billing still
needs verification.

The implemented formula is ceil((upstream CNY + allocated operations CNY)
* 1.10 / 0.75 * 1000 / 70). This means a 25% gross margin after the 10%
buffer, not a 25% markup. FX is fixed at 7.3 CNY/USD.

Operations allocations (CNY 0.013/image and 0.250/video) are estimates,
not verified infrastructure invoices. Seedance rates have not been
independently reverified in this continuation. Do not claim unconditional
profit protection from these assumptions or from mock regression tests.

The new database migration has not been applied to production. Existing
usage reporting now returns recorded charges/reservations before computing
any hypothetical current quote; it must not reprice historical debits.
