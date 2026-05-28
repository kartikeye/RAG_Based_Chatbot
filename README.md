# RAG Chatbot

A retrieval-augmented generation chatbot that answers strictly from user-uploaded documents (PDF, .txt, .docx). For questions outside the uploaded corpus, the bot responds *"This is out of my expertise to answer."*

## Stack

| Layer | Tech | Why |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript | Fast HMR dev loop; small bundle; modern tooling |
| Backend | Node.js + Express + TypeScript | Lightweight HTTP server with mature middleware ecosystem |
| LLM | AWS Bedrock — Claude 3.5 Haiku | Fast, cheap, more than capable for grounded Q&A |
| Embeddings | AWS Bedrock — Amazon Titan Text Embeddings V2 | 1024-dim; same Bedrock account so one integration |
| Vector store | Postgres + pgvector | ACID + relational joins + vector search in one DB |
| Local infra | Docker Compose | One command to bring up the DB |

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
- AWS account with Bedrock access (Claude 3.5 Haiku + Titan Text Embeddings V2 enabled in your region)

## Environment setup

```bash
cd backend
cp .env.example .env
# Edit .env — fill in AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
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
| 4 | Chat: embed question → vector search → Claude 3.5 Haiku → answer | Done |
| 5 | Frontend: React SPA with auth, upload, and chat screens | Done |

**Known limitations (next polish pass):**
- No response streaming — answers arrive all at once
- No conversation history — each message is independent
- JWT stored in localStorage (XSS-vulnerable; production would use httpOnly cookie + refresh token)
- No file-upload progress indicator
- No end-to-end or component tests

See `docs/` for milestone teaching notes and `RAG_Based_Chatbot_docs.md` for consolidated interview prep.
