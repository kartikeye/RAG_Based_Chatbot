# Milestone 5 — The React + Vite + TypeScript frontend

## What we built

A complete React + Vite + TypeScript single-page app with five screens: Login, Signup, Documents (upload + list with status), Chat (with source citations), and a shared Layout with top nav. Auth state is managed via React Context with JWT persistence in localStorage. The dev server proxies `/auth`, `/documents`, `/chat` to the Express backend on port 3000 — so the same API code works locally and in production behind a single origin.

## How to run it

From the repo root (recommended — starts everything with one command):

```bash
npm run install:all   # first time only
npm run dev           # http://localhost:5173 (frontend) + http://localhost:3000 (backend)
```

Open http://localhost:5173, sign up, upload a PDF, ask a question. That's the full product.

To run the frontend in isolation:

```bash
cd C:\Kartikeye\Practise\RAG_Chatbot\RAG_Based_Chatbot\frontend
npm install --legacy-peer-deps
npm run dev          # http://localhost:5173
```

For production:

```bash
npm run build        # tsc + vite build → dist/
npm run preview      # serve the dist/ build locally to verify
```

The `dist/` folder is a static bundle you can host anywhere — S3 + CloudFront, Vercel, Netlify, or behind the same Express server using `app.use(express.static('frontend/dist'))`.

## Interview talking points

### "Why Vite over Create React App?"

CRA (Create React App) was deprecated by the React team in 2023. The replacement default is Vite — and the reasons matter for interviews. Vite uses **esbuild** for the dev server, which means cold starts in under a second on most projects (CRA could take 30+ seconds). It uses **native ESM in the browser during dev**, so only the modules you actually import are compiled, on demand — versus CRA's "compile the entire bundle, then serve it" approach. For production it switches to **Rollup**, which produces smaller, more aggressively tree-shaken bundles. The net effect is dramatically faster feedback loops in dev plus smaller bundles in prod. The framework wars are settled here: every modern React project uses Vite, Next.js, or Remix.

### "Why React Context for auth instead of Redux or Zustand?"

Three reasons. **Auth is read-heavy, write-rare** — the nav, every protected page, and the API client all read auth state, but only login/signup/logout mutate it. Context is built for that. **No additional dependency** — Redux Toolkit or Zustand are great tools but adding them just for auth is overkill. **It composes well** — wrapping the app in `<AuthProvider>` is one line, and `useAuth()` works anywhere underneath. For more complex global state (chat history, notifications, undoable actions), Zustand or Redux start paying off; for auth alone, Context is the right call.

### "Why localStorage for the JWT? What are the trade-offs?"

localStorage is the simplest path — synchronous read/write API, persists across tabs and refreshes, available since IE 8. The trade-off is **XSS vulnerability**: any malicious script that runs in your origin can read every key in localStorage. If you have a stored-XSS bug, your tokens are compromised. The production-grade alternative is to put the access token in JavaScript memory only and rely on a long-lived **refresh token in an httpOnly cookie** (cookies marked httpOnly cannot be read by JS, so XSS can't exfiltrate them). On every API call the access token is added from memory; when it expires (15 minutes), a silent refresh hits a `/auth/refresh` endpoint that uses the httpOnly cookie. We documented this as a known limitation; that's the right interview answer.

### "Controlled components — what does that mean?"

A controlled component is one whose value is owned by React state, not by the DOM. Every input has `value={state}` and `onChange={(e) => setState(e.target.value)}`. The DOM mirrors React; React is the source of truth. The alternative is uncontrolled, where React just hands the input to the DOM and reads it later via a ref. Controlled is the default for any form input that needs validation, formatting, or coordination with other state — which is essentially every real-world form. The tiny cost (boilerplate) buys you total observability and control.

### "How does the dev server proxy work?"

Vite's dev server has a `server.proxy` config that forwards specific paths to another origin. We configured `/auth`, `/documents`, `/chat`, `/health` to forward to `http://localhost:3000` (the Express backend). The frontend code calls `fetch('/documents')` — same-origin, no CORS issue. In production we'd serve the built `dist/` folder behind the same Express server (or a reverse proxy like Nginx) so the relative paths still work. This is the standard "single-origin SPA" pattern; it avoids CORS preflight overhead and credential headaches.

### "Why are protected routes implemented with `<Navigate>` instead of `useEffect + navigate()`?"

`<Navigate>` is **declarative**: during the first render, if `!isAuthenticated`, React returns a redirect element and the router handles it before painting. The user never sees a flash of the protected page. The imperative alternative — render the protected page, then in a useEffect call `navigate('/login')` — paints one frame of the protected content before redirecting. That's both bad UX and a security smell (any sensitive data the page tried to load is briefly visible in DevTools). Declarative routing always wins here.

### "Why hand-mirror types instead of sharing or generating them?"

For five endpoints, hand-mirroring is the lowest-friction option — no monorepo plumbing, no codegen step. It does mean changes to the backend route shape require manual updates in `frontend/src/api/types.ts`. The scaling answers are: (1) extract a `shared/` package in a monorepo with both `backend` and `frontend` consuming it; (2) generate types from an OpenAPI spec via `openapi-typescript` so the spec is the contract; (3) use tRPC for end-to-end type safety with no manual mirroring. Each has overhead. For our scope, hand-mirroring is right; in a 30-endpoint product, generation pays off fast.

### "Why use `useMemo` on the AuthContext value?"

The value passed into `<AuthContext.Provider value={...}>` is read by every consumer via `useAuth()`. If we passed an inline object literal each render, every consumer would re-render whenever the AuthProvider itself rendered (because object identity changes). `useMemo` keeps the value stable across renders as long as its dependencies (`user`, `token`, `login`, etc.) don't change. The `useCallback` on `login`/`signup`/`logout` keeps the function references stable for the same reason. This is the standard pattern for any non-trivial Context value.

### "What's not in this version?"

Five things worth knowing about so you can articulate them as "next steps" in interviews. **No response streaming** — Claude responses arrive all at once instead of token-by-token; for perceived latency, streaming is a real win. **No file-upload progress bar** — `fetch` doesn't expose upload progress events; an XMLHttpRequest wrapper or the new `fetch` upload streams (limited browser support as of 2026) would add it. **No conversation history** — each chat message is independent; the backend doesn't see prior turns. For multi-turn coherent chat you'd need to either pass recent message history into the prompt or summarize it. **No optimistic UI** — uploads block until the server responds; you could render a "processing" entry immediately and reconcile later. **No e2e or component tests** — Playwright + Vitest would round out the stack.

## The complete product, end to end

You now have a working multi-tenant RAG chatbot built from scratch. Counting backend + frontend, that's roughly:

```
backend/  TypeScript Express server, 15 source files
frontend/ TypeScript React + Vite SPA, 12 source files
db/       Postgres schema with vector index
docs/     Five milestone teaching documents
```

Every line was written for a reason you can defend, and every architectural choice has an explicit trade-off captured in the milestone docs. That's the bar for a portfolio project that opens interview doors.
