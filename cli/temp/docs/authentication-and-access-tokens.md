# Authentication and Access Tokens

## Overview

The Payments API uses bearer tokens to authenticate requests. Clients must obtain an access token before calling protected endpoints.

Authentication is separate from authorization. A valid token proves the identity of the caller, while permissions determine which resources the caller can access.

## Sending Credentials

Every authenticated request must include the token in the HTTP Authorization header.

```http
Authorization: Bearer eyJhbGciOi...
```

Do not place access tokens in query parameters or request bodies.

## Token Expiration

Access tokens are short-lived and expire after 60 minutes. Applications should refresh credentials before expiration instead of asking users to authenticate again.

Expired tokens result in an HTTP 401 response.

## Permissions

Tokens can contain scopes such as `payments:read`, `payments:write`, and `refunds:create`.

A caller with a valid token but insufficient scope receives HTTP 403.

## Security Recommendations

Applications should never log complete access tokens. Credentials must be stored using a secret manager or another protected storage mechanism.

