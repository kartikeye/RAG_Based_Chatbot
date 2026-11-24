# RAG Chatbot

A retrieval-augmented generation chatbot that answers strictly from user-uploaded documents (PDF, .txt, .docx). For questions outside the uploaded corpus, the bot responds *"This is out of my expertise to answer."*

## Stack

| Layer | Tech | Why |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript | Fast HMR dev loop; small bundle; modern tooling |
| Backend | Node.js + Express + TypeScript | Lightweight HTTP server with mature middleware ecosystem |
| LLM / Embeddings | Ollama (default) or AWS Bedrock | Pluggable via `LLM_PROVIDER` — see below |
| Vector store | Postgres + pgvector | ACID + relational joins + vector search in one DB |
| Local infra | Docker Compose | One command to bring up the DB |

### LLM provider: Ollama (default) or Bedrock

Embeddings and generation go through `backend/src/services/aiProvider.ts`, which switches between two interchangeable backends based on `LLM_PROVIDER` in `.env`:

- **`ollama`** (default) — runs fully locally via [Ollama](https://ollama.com), no AWS account or billing needed. Uses `mxbai-embed-large` (1024-dim embeddings) and `llama3.1` (generation).
- **`bedrock`** — AWS Bedrock, Amazon Titan Text Embeddings V2 + Claude Haiku. Fully implemented in `backend/src/services/bedrock.ts`, untouched and ready to use again any time you have Bedrock access — just set `LLM_PROVIDER=bedrock` and fill in the `AWS_*` vars.

Both produce 1024-dim vectors, so switching providers never requires a database migration.

## Quick start — one command

```bash
# First time only: install all dependencies
npm run install:all

# Start everything (DB + backend + frontend)
npm run dev
```

This starts:
- PostgreSQL (Docker) on port 5432
- Express backend on http://localhost:3000
- React/Vite frontend on http://localhost:5173

Open http://localhost:5173, sign up, upload a PDF, ask a question.

```bash
# Stop the database container
npm run stop
```

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- Node.js >= 20
- [Ollama](https://ollama.com/download) installed and running (default LLM provider — no AWS account needed), with the two models pulled:
  ```bash
  ollama pull mxbai-embed-large
  ollama pull llama3.1
  ```
- Optional: an AWS account with Bedrock access (Claude Haiku + Titan Text Embeddings V2 enabled in your region), only if you want `LLM_PROVIDER=bedrock` instead

## Environment setup

```bash
cd backend
cp .env.example .env
# Defaults to LLM_PROVIDER=ollama — works with no further edits once Ollama
# is running with the models above pulled. To use Bedrock instead, set
# LLM_PROVIDER=bedrock and fill in AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION.
```

## Folder structure

```
RAG_Based_Chatbot/
├── backend/      # Express API: auth, document upload, ingestion pipeline, chat endpoint
├── frontend/     # React + Vite SPA: login, upload screen, chat UI
├── db/           # SQL schema applied automatically on first Docker start
├── docs/         # Architecture notes, milestone teaching docs, interview prep
├── package.json  # Root — one-command dev startup via concurrently
├── docker-compose.yml
└── README.md
```

## Status

All five milestones complete. The product is end-to-end functional:

| Milestone | What | Status |
|---|---|---|
| 1 | Infrastructure: Docker Postgres + pgvector schema | Done |
| 2 | Backend: Express + JWT auth + bcrypt | Done |
| 3 | Ingestion: upload → extract → chunk → embed → store | Done |
| 4 | Chat: embed question → vector search → generate (Ollama/Bedrock) → answer | Done |
| 5 | Frontend: React SPA with auth, upload, and chat screens | Done |

**Known limitations (next polish pass):**
- No response streaming — answers arrive all at once
- No conversation history — each message is independent
- JWT stored in localStorage (XSS-vulnerable; production would use httpOnly cookie + refresh token)
- No file-upload progress indicator
- No end-to-end or component tests
- Upload size capped at 10MB per file (`MAX_FILE_BYTES` in `backend/src/routes/documents.ts`); oversized files get a clean `413`, not an error

See `docs/` for milestone teaching notes and `RAG_Based_Chatbot_docs.md` for consolidated interview prep.
