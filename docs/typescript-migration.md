# TypeScript migration

The backend was converted from JavaScript to TypeScript after Milestones 1–3 were already working. This document captures what changed, why, and the interview-grade rationale.

## What changed structurally

Every `.js` file under `backend/src` became a `.ts` file. A `tsconfig.json` was added with strict mode on, NodeNext module resolution, and `dist/` as the output directory. Two new type-only files were added: `src/types/express.d.ts` augments Express's `Request` interface to declare `req.userId?: string`, and `src/types/pdf-parse.d.ts` is an ambient declaration for the untyped `pdf-parse` library. The dev script switched from `nodemon` to `tsx watch`, which runs TypeScript directly without an explicit compile step. A new `build` script runs `tsc` to emit compiled JS into `dist/` for production deploys; `start` runs `node dist/server.js`.

## Why TypeScript at all

Three interview-relevant reasons.

The first is **compile-time safety**. The JavaScript backend would happily let me reference `req.userI` (typo) or pass a number where a string is expected — the failure surfaces only at runtime, often deep inside a route handler. TypeScript flags these before the file is even saved. For a server that hits AWS Bedrock with structured request bodies, the type-safety on the request/response shapes alone catches a meaningful class of bugs.

The second is **self-documenting interfaces**. The shape of a Bedrock Titan response (an `embedding: number[]` and a token count), a Postgres query result (a typed `rows` array), a route handler (a `Request` augmented with `userId`) — all of those become explicit, hover-documented, and refactor-safe. If we add a column to the `users` table, the query result type changes and every caller flags up where they need to update.

The third is **interview signal**. Saying "I built this in TypeScript with strict mode" tells an interviewer you understand why type safety matters in a backend service, not just in research code. It's the default for new Node services at most modern teams.

## The .js extension in imports — the most common TypeScript-with-ESM gotcha

The most confusing thing about TypeScript + ESM in Node is that **imports in your source `.ts` files must use the `.js` extension**, even though the source file is `.ts`. So this is correct:

```ts
import { env } from '../config/env.js';
```

…even though the file on disk is `env.ts`. The reason is that TypeScript does **not rewrite import specifiers** when it compiles — what you write is what the compiled `.js` runtime sees. Since Node's ESM resolver requires explicit `.js` extensions, your source files have to write the names the runtime will look for. TypeScript still resolves `env.js` back to `env.ts` at compile time, so type checking works.

This trips up every developer the first time. Memorize the rule: **write the runtime path, not the source path.**

## Strict mode — what it actually does

`"strict": true` in `tsconfig.json` is a meta-flag that turns on roughly a dozen individual strictness flags. The most important ones:

`strictNullChecks` makes `null` and `undefined` first-class types. A variable typed `string` is now genuinely guaranteed not to be null. To pass a possibly-null value you have to write `string | null` and the compiler forces you to handle the null case before using it.

`noImplicitAny` forbids variables and parameters whose type can't be inferred. Every function parameter must be either annotated or have a type inferable from the call site. This is the single most valuable strictness flag — it prevents the entire class of "I forgot to type this and now my pipeline is silently passing `any` around" bugs.

`strictFunctionTypes` enforces variance correctly on function parameters. Mostly invisible until you start composing higher-order functions, then it saves you.

The combined effect: strict mode catches problems early, makes the type system *trustworthy*, and provides much better autocomplete. Anything less than strict in 2026 is a code smell.

## Augmenting `Request` for `req.userId`

The auth middleware attaches the authenticated user's id to the request object. In JavaScript that just worked. In TypeScript, `req.userId = payload.sub` would be a type error because `Request` doesn't know about `userId`. The fix is **module augmentation** in `src/types/express.d.ts`:

```ts
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}
export {};
```

The `declare global` block reaches into the Express types and adds a property. The trailing `export {}` is what makes TypeScript treat this file as a module — otherwise the `declare global` would not be honored. Every Express handler now sees `req.userId` as a typed `string | undefined`.

A subtle but interview-worthy detail: we typed it as `userId?: string` (optional) rather than `userId: string`. The optional version is correct because *not every* request has been through `requireAuth` — public routes like `/health` and `/auth/signup` don't run that middleware and so don't set the property. Making it required would be a lie. In route handlers downstream of `requireAuth`, we narrow with a guard (`if (!req.userId) throw new Error(...)`) or, more idiomatically, the middleware shape itself guarantees presence and the cast is implicit.

## Untyped dependency: the ambient declaration pattern

`pdf-parse` ships no types and has no `@types/pdf-parse` on DefinitelyTyped. Three options:

Option 1 is `// @ts-expect-error` per call site. This kills type safety wherever the library is used and is the worst long-term option.

Option 2 is a local **ambient declaration** in `src/types/pdf-parse.d.ts` that describes just the surface area we use. That's what we did. The declaration is small, self-contained, and lives with our code so it can't go stale relative to our usage.

Option 3 is contributing types to DefinitelyTyped or a community fork. Right thing to do for a popular library, overkill for an internal project.

The ambient pattern generalizes. Any time you have an untyped dependency, write the smallest declaration that satisfies your usage and put it under `src/types/`. The TypeScript compiler auto-includes all `.d.ts` files in your project.

## The `jsonwebtoken` `expiresIn` quirk

The `jsonwebtoken` v9 types tightened — `SignOptions.expiresIn` is now `number | StringValue` where `StringValue` is a template-literal type from the `ms` package (`"7d" | "15m" | "30s" | ...`). Our env loader returns a plain `string`, so passing it directly is a type error.

We resolved it with a cast: `expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn']`. The cast tells TypeScript "trust me — this string follows the ms format" and ships the runtime check off to `jsonwebtoken` itself, which throws if the format is wrong. This is the standard pattern when an env-var-shaped value flows into a strictly-typed third-party API.

Interview takeaway: **casts are not a failure of the type system; they are an acknowledged escape hatch that should be rare, narrow, and commented.** Ours is one line, scoped to a single property, with a comment explaining why.

## Dev workflow

`npm run dev` runs `tsx watch src/server.ts`. tsx is an esbuild-powered TypeScript runner that's roughly 10x faster than `ts-node`. The `watch` flag restarts on every file change. No separate build step in dev — your TypeScript runs straight away.

`npm run build` runs `tsc` to compile the whole project into `dist/`. This is the production artifact: pure Node-compatible ESM JavaScript with sourcemaps and declaration files (`.d.ts`).

`npm start` runs `node dist/server.js` — the compiled output. In a Docker container or production server, the flow is `npm install --production` (skips devDependencies), `npm run build`, then `npm start`.

## What's next

Milestone 4 (the chat endpoint) and Milestone 5 (the React UI) will be built in TypeScript from day one. The patterns established here — strict mode, `.js` import extensions, ambient declarations for untyped deps, judicious casts at type-system boundaries — apply throughout.
