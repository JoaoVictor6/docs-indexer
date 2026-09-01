# Database Transactions

## Transaction Model

The order service uses PostgreSQL transactions to guarantee that related changes are committed atomically.

Creating an order may involve inserting the order record, reserving inventory, and creating an initial payment record. These operations must succeed or fail together.

## Isolation

The default transaction isolation level is READ COMMITTED.

Long-running transactions should be avoided because they can hold locks and increase contention between concurrent requests.

## Deadlocks

Deadlocks may occur when two transactions acquire database locks in different orders.

The application should retry transient transaction failures with exponential backoff. A retry must create a new transaction rather than attempting to reuse a failed one.

## Connection Pooling

The service maintains a pool of PostgreSQL connections. Connections should be returned promptly after each operation.

A transaction must never remain open while waiting for an external HTTP request.

