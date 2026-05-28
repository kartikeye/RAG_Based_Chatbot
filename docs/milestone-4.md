# Milestone 4 — The chat endpoint

## What we built

The chat query path: embed user question via Titan → vector search in pgvector scoped to the user → relevance threshold filter → call Claude 3.5 Haiku with grounded prompt → return answer with source citations. The endpoint is `POST /chat`, requires auth, is rate-limited to 30 questions per user per hour, and short-circuits to "out of expertise" when no chunks are similar enough to be relevant.

## How to use it

```bash
# After uploading at least one document from Milestone 3:
curl -X POST http://localhost:3000/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question":"What does the contract say about termination?"}'

# Response shape:
# {
#   "answer": "According to [Source 1]...",
#   "grounded": true,
#   "sources": [
#     {"documentId":"...", "filename":"contract.pdf", "chunkIndex": 12, "distance": 0.31},
#     ...
#   ],
#   "usage": {"inputTokens": 850, "outputTokens": 120}
# }

# If the question has no relevant context in your corpus:
# {
#   "answer": "This is out of my expertise to answer.",
#   "grounded": false,
#   "sources": [],
#   "usage": {"inputTokens": 0, "outputTokens": 0}
# }
```

## Interview talking points

### "Walk me through what happens when a user asks a question."

The chat route receives the question, validates input length via zod (rejects bodies longer than 4000 chars before we touch a model), and confirms auth. Then the chat orchestrator runs four steps. **Step one**: embed the question via Bedrock Titan V2 — the same model that embedded every chunk during ingestion. This is non-negotiable; vectors from different models can't be meaningfully compared. **Step two**: run a top-5 vector search in pgvector, scoped to the authenticated user's chunks via `WHERE user_id = $1`. The search orders by `<=>` (cosine distance) so the ivfflat index is used. **Step three**: filter chunks where distance < 0.8 — our "actually relevant" threshold. If nothing passes the threshold, we short-circuit immediately and return "out of expertise" without calling Claude — saves money and removes the risk of hallucinated answers from weak context. **Step four**: if relevant chunks exist, we pass them to Claude 3.5 Haiku with a system prompt that forces grounded answers and a fallback refusal. The response includes the answer plus citation metadata (filename, chunk index, distance) for every source used.

### "What is cosine distance and why use it for retrieval?"

For unit-normalized embeddings — which Titan V2 produces because we set `normalize: true` — cosine distance is `1 - cos(angle)` where the angle is between the query vector and a chunk vector in 1024-dimensional space. Two vectors pointing in nearly the same direction have a small angle, so a small cosine distance, so they encode similar meaning. The pgvector range is 0 (identical direction) to 2 (opposite direction). For normalized embeddings, the same ordering would result from inner product or L2 distance, but cosine is the right *default* because it ignores magnitude — exactly the property we want for text embeddings, where vector length has no semantic content.

### "Why a threshold filter? Why not just send everything to Claude?"

Three reasons. **Cost**: a Claude 3.5 Haiku call is roughly two orders of magnitude more expensive than an embed call. If retrieval has nothing relevant, calling Claude burns money for no value. **Latency**: the LLM call is the slow step in the whole pipeline (~500–1500ms). Short-circuiting it makes "out of expertise" answers near-instant. **Quality**: if you stuff Claude full of weak context, the model can be tempted to reach — to anchor on the closest-but-still-irrelevant chunks and generate confident-sounding nonsense. Refusing pre-emptively with the threshold is the safer behavior. The 0.8 distance cutoff is calibrated for Titan V2 with normalize:true — strong matches typically sit at 0.2–0.5. Tuning the threshold against your specific corpus is a real practice; some systems keep it as a config knob.

### "How do you stop the LLM from hallucinating?"

Defense in depth, four layers. **Layer one**: the embedding-distance threshold above. Nothing relevant → no Claude call → no chance of hallucination. **Layer two**: the system prompt explicitly tells Claude to answer ONLY from the context block and to return the exact string "This is out of my expertise to answer." otherwise. This is what's known as a grounded prompt. **Layer three**: `temperature: 0` makes Claude's output deterministic — no creative sampling, no random reach. **Layer four**: the response includes source citations (`filename`, `chunkIndex`, `distance`) so the user can verify the answer was actually grounded in the documents they uploaded. None of these alone is perfect; together they make hallucination rare enough to ship.

### "Why scope retrieval by user_id at the SQL layer?"

Multi-tenancy. The `WHERE c.user_id = $2` clause is the boundary between user A's data and user B's data. Even if `requireAuth` were bypassed somehow, even if the JWT were forged, even if there were a bug in the route handler — the SQL itself filters to one user's chunks. A real leak would require a SQL injection that bypasses parameterized queries, *and* a JWT verification flaw. Both are independently very unlikely. This is the principle of **layered authorization**: put the access boundary as deep in the stack as possible, not just at the edge.

### "Why is ivfflat.probes set to 10?"

The ivfflat index groups vectors into clusters (the `lists` parameter — 100 in our schema). At query time, `probes` controls how many of those clusters get scanned for nearest neighbors. The default is 1, which is fast but loses recall when the right answer lives in a cluster other than the one whose centroid is closest to the query. Probes=10 scans 10 clusters, which raises recall to ~95% in practice for our data shape and adds a small amount of latency. It's a tunable knob. We set it via `SET LOCAL ivfflat.probes` inside a transaction so the setting doesn't leak across pool-borrowed connections.

### "Why is the embedding model the same on both sides of the pipeline?"

Embeddings from different models live in **different vector spaces**. The 1024 dimensions Titan produces are not the same 1024 dimensions OpenAI's `text-embedding-3-small` produces — the axes encode different latent features. Doing nearest-neighbor search across vectors from different models is meaningless. If we ever change the embedding model, we need to re-embed every existing chunk in the database. That's a real operational consideration — interviewers sometimes ask about migration strategies. The answer: dual-write (compute both old and new embeddings for new content while you backfill old content), then cut over reads, then drop the old column.

### "What's the cost per chat request?"

Order-of-magnitude: one Titan embed call (~$0.00002 for a typical question) plus one Claude 3.5 Haiku call (input + output tokens). At Haiku's roughly $0.25 per million input tokens and $1.25 per million output tokens, a typical chat request with 5 chunks of context (~3000 input tokens, ~200 output tokens) costs about **$0.001 per question** — a tenth of a cent. A user asking 100 questions costs 10 cents. The "out of expertise" short-circuit path is essentially free (one embed call, no Claude call).

### "How would you add response streaming?"

Bedrock supports `InvokeModelWithResponseStreamCommand` instead of `InvokeModelCommand`. The server would set `Transfer-Encoding: chunked` and pipe Claude's token-by-token output to the response stream. The frontend would render tokens as they arrive — much better perceived latency for long answers. Trade-offs: error handling is messier because you've already started a 200 response when a mid-stream failure happens; the rate limiter has to count by request rather than tokens; CDN/load-balancer config gets trickier (streaming + HTTP/2 + WebSockets). For Milestone 4 we kept it non-streaming for simplicity — that's a fair call to make in an interview, as long as you can articulate the trade-offs.

## What's next — Milestone 5

The React + Vite + TypeScript frontend: login + signup pages, a document upload screen with progress + status display, and a chat UI that renders sources alongside answers. Once that's done, you have a complete RAG product, fully built by you, end to end.
