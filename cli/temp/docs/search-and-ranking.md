# Search and Ranking

## Semantic Search

The documentation platform supports semantic search using vector embeddings. A query is converted into an embedding and compared against indexed document chunks.

Results are ordered by cosine similarity.

## Ranking

A higher similarity score indicates that the embedding of the query is closer to the embedding of the indexed chunk.

For example, a query about changing a password may retrieve a document describing credential rotation even if the phrase "change password" never appears in the document.

## Result Limits

The search endpoint returns ten results by default. Clients can provide a custom limit when they need more candidates.

Large result sets increase response size and may reduce the usefulness of the ranking.

## Filtering

Search can optionally be restricted to a project. Filtering by project is applied before the final result set is returned.

## Relevance Evaluation

Search quality should be evaluated using representative queries rather than exact keyword matches.

A good evaluation dataset contains related concepts, synonyms, unrelated topics, and ambiguous queries.

