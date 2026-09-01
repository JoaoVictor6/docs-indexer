# Observability and Incident Response

## Metrics

Services expose metrics for request latency, throughput, error rates, database utilization, and queue depth.

Latency should be measured separately for successful and failed requests because an increase in errors can otherwise distort the average.

## Logs

Application logs use structured JSON. Each event should include a timestamp, severity, service name, and correlation identifier.

Sensitive credentials, authorization headers, and personal information must not appear in logs.

## Tracing

Distributed tracing connects operations performed across multiple services. A trace identifier should be propagated through HTTP requests and asynchronous jobs.

Tracing is especially useful when a request spends most of its time waiting on another service.

## Alerts

Alerts should represent actionable conditions rather than every unusual metric fluctuation.

An alert for elevated API error rates should include enough context for an engineer to identify the affected service and begin investigation.

## Incident Response

During an outage, responders should first establish the scope and customer impact. Changes made during an incident must be recorded so they can be reviewed afterward.

