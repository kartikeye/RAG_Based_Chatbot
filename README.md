# RAG Chatbot

A retrieval-augmented generation chatbot that answers strictly from user-uploaded documents (PDF, .txt, .docx). For questions outside the uploaded corpus, the bot responds *"This is out of my expertise to answer."*

## Stack

| Layer | Tech | Why |
|---|---|---|
| Frontend | React + Vite | Fast HMR dev loop; small bundle; modern tooling |
| Backend | Node.js + Express | Lightweight HTTP server with mature middleware ecosystem |
| LLM | AWS Bedrock — Claude Haiku | Fast, cheap, more than capable for grounded Q&A |
| Embeddings | AWS Bedrock — Amazon Titan Text Embeddings V2 | 1024-dim; same Bedrock account so one integration |
| Vector store | Postgres + pgvector | ACID + relational joins + vector search in one DB |
| Local infra | Docker Compose | One command to bring up the DB |

## Folder structure

```
RAG_Based_Chatbot/
├── backend/      # Express API: auth, document upload, ingestion pipeline, chat endpoint
├── frontend/     # React + Vite SPA: login, upload screen, chat UI
├── db/           # SQL schema, migrations, seed scripts
├── docs/         # Architecture notes, learning material
├── docker-compose.yml
├── .gitignore
└── README.md
```

## Status

Currently at **Milestone 1**: infrastructure foundations (folder layout + Docker Postgres + pgvector + schema). See `docs/milestone-1.md` for the teaching notes accompanying this milestone.
