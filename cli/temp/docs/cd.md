# Continuous Delivery Pipeline

## Pull Requests

Every pull request runs formatting checks, static analysis, unit tests, and integration tests.

A pull request cannot be merged while a required check is failing.

## Build Artifacts

The pipeline produces immutable container images identified by the Git commit SHA.

Using immutable tags prevents a deployment from silently changing the binary associated with an existing release.

## Deployment

Production deployments use a rolling strategy. New instances are started before old instances are removed.

Health checks must pass before traffic is routed to a new instance.

## Rollback

If a release causes elevated error rates or degraded performance, the deployment can be rolled back to the previous known-good image.

Database migrations must be backward compatible when rollback of application code is required.

## Environment Variables

Production credentials are injected by the deployment platform. Secrets must not be stored in source control or embedded in container images.

