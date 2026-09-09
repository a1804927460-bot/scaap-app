# MESSS credit purchases

One-time USD products, tax included, converted from the requested CNY amounts at the existing 7.3 CNY/USD reference rate:

| Pack | Credits | USD | Creem production product |
| --- | ---: | ---: | --- |
| START | 1,000 | 9.59 | prod_3VjqStP9C0MJlgFUeUCD0e |
| CREATE | 3,000 | 28.77 | prod_2NmqpcWAQlKTo1SwuAZCec |
| STUDIO | 10,000 | 95.89 | prod_2s5Vo8SWmin5VxAcz0UO0v |

The gateway owns the catalog and creates an immutable, authenticated database payment intent before requesting hosted checkout. Product/price/credits supplied by clients are never trusted. Completion requires a raw-body HMAC-SHA256 Creem signature, a paid production one-time order, matching product/currency/amount, and the locally stored intent. The SQL transaction locks the intent and account and records a unique provider order and ledger entry. Repeated notifications do not grant twice. The public return page never grants credits.

Gateway routes: authenticated `GET /v1/payments/packs`, authenticated `POST /v1/payments/checkout`, public signed `POST /v1/payments/creem/webhook`, and informational `GET /payments/return`. Checkout IDs and secrets are not exposed as general-purpose redirects. The desktop main process only opens HTTPS Creem hosts.

Apply only `202609080002_credit_payments.sql` to the existing database, with its service-role-only function permissions. Do not replay historical migrations. Environment: `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET`, `CREEM_PRODUCT_START`, `CREEM_PRODUCT_CREATE`, `CREEM_PRODUCT_STUDIO`, `CREEM_PAYMENT_ENV=prod`, and `CREEM_PAYMENTS_ENABLED=true` only after live merchant activation. Default and rollout state are disabled. `PAYMENT_PUBLIC_URL` can override the canonical gateway return-page origin.

Subscribe the webhook to `checkout.completed`, `refund.created`, and `dispute.created`. Refund/dispute events are stored idempotently in the RLS-protected `credit_payment_reviews` table for manual reconciliation. Automatic credit clawback and debt recovery are not implemented; operators must reconcile these records before marking them resolved. Never process refunds merely from a customer screenshot or redirect.

On 2026-09-08, Creem's production API created a checkout successfully, but its hosted page returned **Live Payments Not Enabled / This store is not currently accepting payments**. Keep purchases disabled until the merchant platform enables live collection. The user reports their payout account has been added; this does not yet establish live checkout availability.

Validation: signature tampering, wrong mode, unpaid status, currency/product/amount mismatches, metadata mismatch, external redirect injection, disabled checkout, and webhook persistence failures are covered by gateway tests. A rollback-only database preflight verified one credit grant after duplicate events, one ledger entry, amount rejection, and restricted client permissions. Local browser tests verified the three prices, purchase action, closing, and 420/1100px layouts. No real payment has been charged during setup.
