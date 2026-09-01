# Payment Processing and Idempotency

## Creating a Payment

A payment request may be retried when the client experiences a network timeout.

Without protection against duplicate requests, a retry could result in the customer being charged more than once.

## Idempotency Keys

Clients must provide a unique idempotency key when creating a payment.

The server stores the result associated with the key. Repeating the same request with the same key returns the original result instead of creating another charge.

## Retry Policy

Clients should retry temporary network failures and HTTP 429 responses using exponential backoff.

Requests that fail because of invalid card information should not be retried automatically.

## Webhooks

Payment providers notify the platform asynchronously through webhooks.

Webhook handlers must also be idempotent because providers may deliver the same event multiple times.

## Reconciliation

A scheduled reconciliation job compares internal payment records with transactions reported by the external payment provider.

Discrepancies are placed into a review queue rather than being silently corrected.

