# GridWise: LLM-Assisted Campus Energy Optimizer
BUP CSE Fest 2026 Hackathon, Online Preliminary. TypeScript monorepo:

| Folder | Stack | Role |
|---|---|---|
| `backend/` | NestJS 10 + HiGHS (WebAssembly) | **The judged API**: `GET /health`, `POST /optimize-energy` |
| `frontend/` | Next.js 15 (App Router) | Operator dashboard for demos and manual testing (not required by the judge) |

## Architecture
```
operator_notes ─► LLM interpreter ─► deterministic guardrails ─► LP optimizer (HiGHS) ─► replay validator ─► JSON
                  llm.service.ts      guardrails.ts               optimizer.service.ts     replay.ts
```
- **LLM role**: every operator note is interpreted by the LLM (one call for all notes, temperature 0, JSON mode). It returns the directive type, time *ranges* (start inclusive, end exclusive), and the value with its unit or kind (`reduction_fraction` or `remaining_fraction`, `kwh` or `percent_of_capacity`). Results are cached per note set.
- **Guardrails** (`guardrails.ts`): only the six allowed types are accepted, with exactly one entry per note in `note_index` order. Ranges are expanded to unique, sorted hours 0–23 in code, including midnight wrap. Conversions happen in code: an 80% reduction becomes factor 0.2, and a percentage of capacity becomes kWh. Factor must be in [0,1]; reserve must be finite, ≥0, and ≤ capacity; the grid cap must be finite and ≥0. Invalid output becomes a safe `no_op` rather than an invented rule.
- **Optimizer** (`optimizer.service.ts`): a linear program solved with HiGHS. Per-hour variables are grid, solar used, charge, discharge, and battery energy. Constraints cover energy balance, battery transitions, capacity and minimum energy, rate limits, effective solar, all directives, and end-of-day neutrality. The objective is to minimize Σ grid × tariff. Directive constraints carry large-penalty slack variables so the service never fails on an unexpected scenario.
- **Replay** (`replay.ts`): re-checks the final plan hour by hour. Totals are recomputed from `hourly_plan`.
- **Safe failure**: if the LLM provider fails after one retry, a rule-based backup parser (`fallback.ts`) produces the same raw format and passes through the same guardrails.
- **Errors**: malformed or structurally invalid requests return 400, an inconsistent battery returns 422, and anything else returns a controlled 500. No stack traces or secrets are exposed.

## Model / provider
Any OpenAI-compatible chat-completions API. Default: Groq `llama-3.3-70b-versatile`.

| Env variable (backend) | Meaning |
|---|---|
| `LLM_BASE_URL` | e.g. `https://api.groq.com/openai/v1` |
| `LLM_API_KEY` | provider key (secret, never commit) |
| `LLM_MODEL` | model id |
| `LLM_TIMEOUT_MS` | per-call timeout, default 12000 |
| `PORT` | default 8000 |

Frontend: `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`).

## Local quickstart (Node 20+)
```bash
git clone <REPO_URL> && cd <REPO_DIR>/backend
cp .env.example .env        # then put your key in .env, or export the variables
npm ci && npm run build
export $(grep -v '^#' .env | xargs) && npm start
```
Test:
```bash
curl http://localhost:8000/health                  # {"status":"ok"}
node -e "console.log(JSON.stringify(require('./test/public_samples.json').cases[0].input))" > /tmp/s1.json
curl -X POST http://localhost:8000/optimize-energy -H "Content-Type: application/json" -d @/tmp/s1.json
npm run test:samples -- http://localhost:8000      # expected: 10 x PASS, "ALL PASS"
```
Dashboard (optional):
```bash
cd ../frontend && npm ci && npm run dev             # http://localhost:3000
```

## Docker fallback
```bash
docker pull <REGISTRY>/<IMAGE>:<TAG>
docker run -p 8000:8000 -e LLM_BASE_URL=https://api.groq.com/openai/v1 \
  -e LLM_MODEL=llama-3.3-70b-versatile -e LLM_API_KEY=<your key> <REGISTRY>/<IMAGE>:<TAG>
```
To build it yourself: `docker build -t gridwise-api ./backend`. To run both services: `docker compose up --build` (reads `backend/.env`). No secrets are baked into the images.

## Dependencies & credits
NestJS, HiGHS (`highs` npm, WebAssembly build of the HiGHS solver), Next.js, React, and the Groq-hosted Llama 3.3 model. AI coding assistants were used during development.

## Known limitations
- The battery model has no efficiency losses (as specified), so simultaneous charge and discharge are netted into one action per hour.
- If a scenario were infeasible, directive constraints are relaxed with a large penalty and `plan_summary` contains a warning.
- The backup parser, used only when the LLM is down, covers common phrasings but is less robust than the LLM.
