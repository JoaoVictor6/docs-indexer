# Caching Strategy

## Purpose

Caching reduces latency and database load by storing frequently accessed information closer to the application.

The cache is useful for relatively stable resources such as configuration metadata, product catalogs, and public documentation.

## Cache Invalidation

Cached data must have a clearly defined expiration policy.

When a resource changes, the application can invalidate its corresponding cache entry immediately or wait for the configured time-to-live.

## Time To Live

Short TTL values provide fresher data but increase backend traffic. Long TTL values improve cache efficiency but increase the probability of serving stale information.

## Cache Keys

Cache keys should include all parameters that influence the result.

For example, a localized product page should not use the same cache key for English and Portuguese responses.

## Failure Behavior

The application should continue operating when the cache is unavailable.

Cache failures should normally degrade performance rather than make the primary database inaccessible.

