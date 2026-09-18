# GridWise: LLM-Assisted Campus Energy Optimizer

**BUP CSE Fest 2026 Hackathon — Online Preliminary**

GridWise is an LLM-assisted campus energy optimization service that converts natural-language operator instructions into structured energy directives and applies those directives to a deterministic 24-hour linear optimization model.

The project combines:

- LLM-based operator-note interpretation
- Deterministic validation and guardrails
- Linear Programming optimization using HiGHS
- Solar and battery constraint handling
- Hour-by-hour replay validation
- A public HTTP API
- An optional Next.js operator dashboard

---

## 1. Project Overview

Campus energy operators may provide instructions such as:

- reduce solar usage during specific hours
- maintain a minimum battery reserve
- prevent battery charging during a time window
- prevent battery discharging during a time window
- limit grid usage during selected hours
- ignore irrelevant operational notes

GridWise interprets these natural-language instructions and converts them into structured directives that can be safely applied to the energy optimization model.

### Core Pipeline

```text
Operator Notes
      |
      v
+---------------------+
| LLM Interpreter     |
| llm.service.ts      |
+----------+----------+
           |
           v
+---------------------+
| Deterministic       |
| Guardrails          |
| guardrails.ts       |
+----------+----------+
           |
           v
+---------------------+
| LP Optimizer        |
| HiGHS / WASM        |
| optimizer.service.ts|
+----------+----------+
           |
           v
+---------------------+
| Replay Validator    |
| replay.ts           |
+----------+----------+
           |
           v
      JSON Response
```

The LLM is part of the optimization path. It is not used only to generate a final summary.

---

# 2. Repository Structure

This repository is a TypeScript monorepo.

| Folder      | Technology                      | Purpose                     |
| ----------- | ------------------------------- | --------------------------- |
| `backend/`  | NestJS 10, TypeScript, HiGHS    | Judged HTTP API             |
| `frontend/` | Next.js 15, React, Tailwind CSS | Optional operator dashboard |

The **backend is the service evaluated by the competition judge**.

Required API endpoints:

```text
GET  /health
POST /optimize-energy
```

The frontend is provided for demonstration and manual testing and is not required by the judge.

---

# 3. Live API

The deployed backend is hosted on Render.

### Base URL

```text
https://bup-fest-2026.onrender.com
```

### Health Endpoint

```text
GET https://bup-fest-2026.onrender.com/health
```

Expected response:

```json
{
  "status": "ok"
}
```

### Optimization Endpoint

```text
POST https://bup-fest-2026.onrender.com/optimize-energy
```

The endpoint accepts a 24-hour energy scenario and returns:

- directive interpretations
- optimized hourly energy plan
- total grid energy
- total cost
- peak grid usage
- plan summary

---

# 4. API

## `GET /health`

Health/readiness endpoint.

### Request

```http
GET /health
```

### Response

```json
{
  "status": "ok"
}
```

---

## `POST /optimize-energy`

Main optimization endpoint.

The request contains:

- `scenario_id`
- `operator_notes`
- 24 hourly energy records
- battery configuration

The service processes every operator note and produces one structured interpretation per note.

### Processing Flow

```text
POST /optimize-energy
        |
        v
Request validation
        |
        v
LLM interpretation
        |
        v
Deterministic guardrails
        |
        v
Directive constraints
        |
        v
HiGHS LP optimization
        |
        v
Replay validation
        |
        v
Final JSON response
```

---

# 5. LLM Interpretation

GridWise uses an OpenAI-compatible chat-completions API.

### Default Provider

```text
Groq
```

### Default Model

```text
llama-3.3-70b-versatile
```

The LLM interprets the natural-language `operator_notes` and produces structured information that is subsequently validated by deterministic code.

The LLM is instructed to:

- identify the applicable supported directive
- identify relevant time ranges
- identify numeric values
- preserve units
- avoid inventing energy demand
- avoid inventing solar generation
- avoid inventing battery limits
- avoid unsupported directives

The structured result then passes through the deterministic guardrail layer before reaching the optimizer.

### LLM Configuration

| Environment Variable | Description                    |
| -------------------- | ------------------------------ |
| `LLM_BASE_URL`       | OpenAI-compatible API base URL |
| `LLM_API_KEY`        | Provider API key               |
| `LLM_MODEL`          | Model identifier               |
| `LLM_TIMEOUT_MS`     | LLM request timeout            |
| `PORT`               | Backend HTTP port              |

Example:

```text
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=llama-3.3-70b-versatile
LLM_TIMEOUT_MS=12000
PORT=8000
```

**Never commit `LLM_API_KEY` or any other secret to GitHub.**

---

# 6. Supported Directives

GridWise supports six directive types.

## 6.1 Solar Reduction

```json
{
  "directive_type": "solar_reduction",
  "structured_adjustment": {
    "hours": [13, 14],
    "factor": 0.2
  }
}
```

The factor represents the remaining usable fraction.

For example:

```text
80% reduction -> factor = 0.2
```

Effective solar is calculated as:

```text
effective_solar = original_solar * factor
```

---

## 6.2 Minimum Battery Reserve

```json
{
  "directive_type": "minimum_battery_reserve",
  "structured_adjustment": {
    "hours": [18, 19, 20],
    "minimum_energy_kwh": 30
  }
}
```

The battery energy after each specified hour must remain at or above the requested reserve, subject to the base battery minimum.

---

## 6.3 No Charge Window

```json
{
  "directive_type": "no_charge_window",
  "structured_adjustment": {
    "hours": [10, 11, 12]
  }
}
```

Charging is forced to zero during the specified hours.

---

## 6.4 No Discharge Window

```json
{
  "directive_type": "no_discharge_window",
  "structured_adjustment": {
    "hours": [18, 19, 20]
  }
}
```

Battery discharge is forced to zero during the specified hours.

---

## 6.5 Maximum Grid Window

```json
{
  "directive_type": "max_grid_window",
  "structured_adjustment": {
    "hours": [17, 18, 19],
    "max_grid_kwh": 25
  }
}
```

Grid usage is constrained to remain at or below the specified maximum.

---

## 6.6 No Operation

Irrelevant notes are represented as:

```json
{
  "directive_type": "no_op",
  "structured_adjustment": null
}
```

Invalid or unsupported LLM output is also safely converted to `no_op` by the guardrail layer instead of inventing an optimization rule.

---

# 7. Deterministic Guardrails

LLM output is never trusted directly.

The structured interpretation passes through deterministic validation in:

```text
backend/src/energy/guardrails.ts
```

The guardrail layer ensures that:

- only supported directive types are accepted
- there is exactly one interpretation per operator note
- `note_index` ordering is preserved
- hours are valid integers from `0` to `23`
- hours are unique
- hours are sorted
- time ranges are expanded correctly
- midnight-wrapping ranges are handled
- numerical values are finite
- solar reduction factors remain within `[0, 1]`
- battery reserve values are valid
- grid limits are valid
- unsupported or invalid LLM output becomes a safe `no_op`

For example:

```text
80% solar reduction
```

is converted in deterministic code to:

```text
factor = 0.2
```

Percentage-based battery reserves are converted to kWh using the scenario battery capacity.

---

# 8. Time Range Convention

Time ranges use:

```text
start inclusive
end exclusive
```

For example:

```text
1 PM - 3 PM
```

becomes:

```json
[13, 14]
```

Hours are:

- integers
- unique
- between `0` and `23`
- sorted ascending

Midnight-wrapping ranges are handled by the deterministic guardrail layer.

---

# 9. Optimization Model

The optimization engine is implemented in:

```text
backend/src/energy/optimizer.service.ts
```

GridWise uses **HiGHS**, compiled for WebAssembly, to solve a 24-hour Linear Programming problem.

The objective is:

```text
Minimize:

SUM(grid_kwh * tariff_bdt_per_kwh)
```

The optimizer determines the hourly:

- grid energy
- solar energy used
- battery charge
- battery discharge
- battery energy

---

# 10. Energy Balance

For each hour, the following energy balance is enforced:

```text
grid
+ solar_used
+ battery_discharge
=
demand
+ battery_charge
```

Solar generation that is not used is curtailed.

The model does not export unused solar to the grid.

---

# 11. Battery Constraints

The optimizer enforces battery state transitions.

### Charging

```text
E_after = E_before + charge
```

### Discharging

```text
E_after = E_before - discharge
```

### Idle

```text
E_after = E_before
```

The model also respects:

- minimum battery energy
- maximum battery capacity
- hourly charge rate
- hourly discharge rate
- directive-specific battery constraints
- final battery neutrality

The final battery energy after hour `23` must equal the initial battery energy.

---

# 12. Solar Constraints

Solar usage cannot exceed effective available solar:

```text
solar_used <= effective_solar
```

When a solar reduction directive is active:

```text
effective_solar =
original_solar * factor
```

Unused solar is curtailed and is not exported.

---

# 13. Directive Constraints in the Optimizer

Validated directives are converted into optimization constraints.

### No Charge

```text
charge[h] = 0
```

### No Discharge

```text
discharge[h] = 0
```

### Maximum Grid

```text
grid[h] <= max_grid_kwh
```

### Minimum Battery Reserve

```text
battery_energy_after[h] >= minimum_energy_kwh
```

### Solar Reduction

```text
solar_used[h] <= original_solar[h] * factor
```

Directive constraints use large-penalty slack variables so that unexpected infeasible scenarios can be handled without crashing the service.

If a directive has to be relaxed, the response includes a warning in `plan_summary`.

---

# 14. Replay Validation

After optimization, the resulting plan is independently checked hour by hour.

Implementation:

```text
backend/src/energy/replay.ts
```

The replay validator checks:

- battery state transitions
- battery capacity
- minimum battery energy
- charge limits
- discharge limits
- solar limits
- energy balance
- directive constraints
- final battery neutrality

Totals are recalculated from the returned `hourly_plan`.

This provides a second validation layer before the final API response is returned.

---

# 15. Fallback Parser

If the LLM provider fails after one retry, GridWise uses:

```text
backend/src/energy/fallback.ts
```

The fallback parser handles common supported operator-note phrasings and produces the same raw structured format expected by the guardrail layer.

The fallback result still passes through the same deterministic validation process.

```text
LLM failure
    |
    v
Fallback parser
    |
    v
Same guardrails
    |
    v
Same optimizer
```

The fallback parser is intentionally less general than the LLM and covers common supported phrasings.

---

# 16. Error Handling

The API uses controlled error responses.

### HTTP 400

Used for malformed or structurally invalid requests.

### HTTP 422

Used for inconsistent battery configuration or related semantic input problems.

### HTTP 500

Used for unexpected internal failures.

The service does not expose:

- stack traces
- provider API keys
- secrets
- internal credentials

---

# 17. Response Structure

A successful optimization response contains:

```text
scenario_id
directive_interpretation
hourly_plan
total_grid_kwh
total_cost_bdt
peak_grid_kwh
plan_summary
```

### Directive Interpretation

There is exactly one entry for each operator note in `note_index` order.

Each interpretation contains:

```text
note_index
applies
directive_type
structured_adjustment
explanation
```

### Hourly Plan

The response contains 24 hourly entries.

Each entry contains:

```text
hour
grid_kwh
solar_used_kwh
battery_action
battery_kwh
battery_energy_after_kwh
```

The hourly plan uses:

```text
0 ... 23
```

Each hour represents a whole-hour interval.

---

# 18. Local Development

## Requirements

- Node.js 20+
- npm
- Docker (optional)
- An OpenAI-compatible LLM provider key

## Backend Setup

Clone the repository:

```bash
git clone (https://github.com/mahib2121/BUP-Fest-2026)
cd /backend
```

Create the environment file:

```bash
cp .env.example .env
```

Add your provider configuration:

```text
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=<your-key>
LLM_MODEL=llama-3.3-70b-versatile
LLM_TIMEOUT_MS=12000
PORT=8000
```

Install dependencies:

```bash
npm ci
```

Build:

```bash
npm run build
```

Start:

```bash
npm start
```

The API will run on:

```text
http://localhost:8000
```

---

# 19. Local Health Check

Run:

```bash
curl http://localhost:8000/health
```

Expected:

```json
{
  "status": "ok"
}
```

---

# 20. Sample Testing

The repository contains public sample cases used for local validation.

Example:

```bash
node -e "console.log(JSON.stringify(require('./test/public_samples.json').cases[0].input))" > /tmp/s1.json
```

Then:

```bash
curl -X POST http://localhost:8000/optimize-energy   -H "Content-Type: application/json"   -d @/tmp/s1.json
```

The sample runner can be executed with:

```bash
npm run test:samples -- http://localhost:8000
```

Expected result:

```text
10 x PASS
ALL PASS
```

> The sample command assumes the public sample file is located at `backend/test/public_samples.json`.

---

# 21. Frontend Dashboard

The frontend is optional and intended for demonstrations and manual testing.

Technology:

```text
Next.js 15
React
Tailwind CSS
```

Run:

```bash
cd frontend
npm ci
npm run dev
```

The dashboard is available at:

```text
http://localhost:3000
```

Configure the backend URL with:

```text
NEXT_PUBLIC_API_URL=http://localhost:8000
```

The frontend is not required for the judged API service.

---

# 22. Docker Fallback

GridWise provides a Docker image as a deployment fallback.

## Docker Hub Image

```text
mahib6969/bup-fest-2026:1.0.0
```

## Exact Image Digest

```text
sha256:eae8b79589646af999544803a7c6d8fea5e971c00e2d56c33d40361442ff29e0
```

## Docker Hub Repository

https://hub.docker.com/repository/docker/mahib6969/bup-fest-2026/general

## Pull the Image

```bash
docker pull mahib6969/bup-fest-2026:1.0.0
```

## Run the Backend

### PowerShell

```powershell
docker run --rm -p 8000:8000 `
  -e LLM_BASE_URL=https://api.groq.com/openai/v1 `
  -e LLM_MODEL=llama-3.3-70b-versatile `
  -e LLM_API_KEY=<your-key> `
  mahib6969/bup-fest-2026:1.0.0
```

### Linux/macOS

```bash
docker run --rm -p 8000:8000   -e LLM_BASE_URL=https://api.groq.com/openai/v1   -e LLM_MODEL=llama-3.3-70b-versatile   -e LLM_API_KEY=<your-key>   mahib6969/bup-fest-2026:1.0.0
```

The container exposes port `8000`.

No secrets are baked into the Docker image.

---

# 23. Docker Health Check

With the container running:

```bash
curl http://localhost:8000/health
```

Expected:

```json
{
  "status": "ok"
}
```

---

# 24. Build Docker Image Locally

From the repository root:

```bash
docker build -t gridwise-api ./backend
```

Run:

```bash
docker run --rm -p 8000:8000   --env-file ./backend/.env   gridwise-api
```

Health check:

```bash
curl http://localhost:8000/health
```

---

# 25. Docker Compose

The repository also contains a Docker Compose configuration for running the backend and optional frontend together.

Run:

```bash
docker compose up --build
```

Backend:

```text
http://localhost:8000
```

Frontend:

```text
http://localhost:3000
```

The backend environment is loaded from:

```text
backend/.env
```

Do not commit this file when it contains secrets.

---

# 26. Environment Variables

## Backend

| Variable         | Required | Description                         |
| ---------------- | -------- | ----------------------------------- |
| `LLM_BASE_URL`   | Yes      | OpenAI-compatible provider endpoint |
| `LLM_API_KEY`    | Yes      | LLM provider API key                |
| `LLM_MODEL`      | Yes      | Model identifier                    |
| `LLM_TIMEOUT_MS` | No       | LLM timeout; default `12000`        |
| `PORT`           | No       | HTTP port; default `8000`           |

## Frontend

| Variable              | Description     |
| --------------------- | --------------- |
| `NEXT_PUBLIC_API_URL` | Backend API URL |

Example:

```text
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

# 27. Security

The project follows these deployment practices:

- API keys are provided through environment variables.
- Secrets are not baked into Docker images.
- Secrets are not committed to Git.
- Secrets are not returned in API responses.
- Stack traces are not exposed to API clients.
- Synthetic challenge data is used for testing.
- Provider credentials are kept outside the source repository.

Before publishing the repository, verify that no `.env` files, API keys, tokens, or credentials are included.

---

# 28. Technology Stack

## Backend

- TypeScript
- NestJS 10
- Node.js
- HiGHS
- WebAssembly
- Linear Programming

## LLM

- OpenAI-compatible Chat Completions API
- Groq
- Llama 3.3 70B Versatile

## Frontend

- Next.js 15
- React
- Tailwind CSS

## Deployment

- Render
- Docker
- Docker Hub

---

# 29. Dependencies & Credits

The project uses:

- NestJS
- HiGHS
- `highs` npm package
- WebAssembly-based HiGHS solver
- Next.js
- React
- Groq-hosted Llama 3.3 model

AI coding assistants were used during development.

---

# 30. Known Limitations

### Battery Efficiency

The battery model does not include charging/discharging efficiency losses, as specified by the problem model.

### Simultaneous Battery Actions

The model represents battery behavior using charge/discharge decisions and nets the resulting action for the returned hourly plan.

### Infeasible Scenarios

If a scenario becomes infeasible, directive constraints may be relaxed using large-penalty slack variables.

A warning is included in `plan_summary` when relaxation occurs.

### Fallback Parser

The rule-based fallback parser supports common operator-note phrasings but is less flexible than the LLM interpreter.

---

# 31. Project Architecture

```text
GridWise
|
+-- backend/
|   +-- src/
|   |   +-- energy/
|   |   |   +-- llm.service.ts
|   |   |   +-- guardrails.ts
|   |   |   +-- optimizer.service.ts
|   |   |   +-- replay.ts
|   |   |   +-- fallback.ts
|   |   |   +-- limits.ts
|   |   |   +-- request-validator.ts
|   |   |   +-- types.ts
|   |   +-- health.controller.ts
|   |   +-- app.module.ts
|   |   +-- main.ts
|   +-- test/
|   +-- Dockerfile
|   +-- package.json
|
+-- frontend/
|   +-- app/
|   +-- components/
|   +-- package.json
|
+-- docker-compose.yml
+-- README.md
```

---

# 32. End-to-End Execution

A typical request follows this sequence:

```text
1. Client sends POST /optimize-energy
                |
                v
2. Request structure is validated
                |
                v
3. Operator notes are sent to the LLM
                |
                v
4. LLM returns structured interpretations
                |
                v
5. Deterministic guardrails validate the result
                |
                v
6. Valid directives are converted into optimizer constraints
                |
                v
7. HiGHS solves the 24-hour LP
                |
                v
8. Replay validator checks the generated plan
                |
                v
9. Totals and peak grid usage are recomputed
                |
                v
10. Final JSON response is returned
```

---

# 33. Competition Deployment

### Live Service

```text
https://bup-fest-2026.onrender.com
```

### Required Endpoints

```text
GET  /health
POST /optimize-energy
```

### Docker Fallback

```text
mahib6969/bup-fest-2026:1.0.0
```

### Docker Digest

```text
sha256:eae8b79589646af999544803a7c6d8fea5e971c00e2d56c33d40361442ff29e0
```

The backend is the primary judged service. The frontend is optional.

---

---

# 34. Hackathon Information

**Event:** BUP CSE Fest 2026 Hackathon  
**Stage:** Online Preliminary  
**Project:** GridWise — LLM-Assisted Campus Energy Optimizer

GridWise is designed around a clear separation between:

```text
Natural-language interpretation
              +
Deterministic validation
              +
Mathematical optimization
              +
Independent replay validation
```

This architecture allows natural-language operator instructions to influence the optimization process while keeping the actual energy constraints and optimization behavior deterministic and verifiable.
