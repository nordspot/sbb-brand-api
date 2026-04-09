# SBB Brand Library API — Deployment Guide

## Architecture

```
┌─────────────────────────────────────────────────┐
│              sbb-brand-api Worker                │
│                                                  │
│  /api/search   → Vectorize (semantic)            │
│  /api/colors   → D1 (structured)                 │
│  /api/values   → D1 (structured)                 │
│  /api/embed    → Workers AI (embeddings)         │
│  /api/ingest   → D1 + Vectorize (write)          │
│  /api/bootstrap → Embed all D1 chunks            │
└──────┬──────────────┬──────────────┬─────────────┘
       │              │              │
  ┌────▼────┐   ┌─────▼─────┐  ┌────▼────┐
  │   D1    │   │ Vectorize │  │Workers  │
  │sbb-brand│   │sbb-brand  │  │  AI     │
  │-library │   │-index     │  │bge-base │
  └─────────┘   └───────────┘  └─────────┘
```

## Prerequisites

- Node.js 18+
- Cloudflare account with Workers paid plan (for Vectorize + AI)
- `wrangler` CLI authenticated (`npx wrangler login`)

## Step 1: Create the Vectorize index

```bash
npx wrangler vectorize create sbb-brand-index --dimensions=768 --metric=cosine
```

## Step 2: Install and deploy

```bash
cd sbb-brand-api
npm install
npx wrangler deploy
```

## Step 3: Bootstrap embeddings

After deployment, generate vector embeddings for all brand chunks stored in D1:

```bash
curl -X POST https://sbb-brand-api.<YOUR_SUBDOMAIN>.workers.dev/api/bootstrap
```

This uses Workers AI (@cf/baai/bge-base-en-v1.5) to embed all 17 brand knowledge chunks.

## Step 4: Test semantic search

```bash
# What color is the SBB logo?
curl "https://sbb-brand-api.<YOUR_SUBDOMAIN>.workers.dev/api/search?q=logo%20color%20red"

# How should typography be used?
curl "https://sbb-brand-api.<YOUR_SUBDOMAIN>.workers.dev/api/search?q=font%20weight%20titles"

# What are the brand values?
curl "https://sbb-brand-api.<YOUR_SUBDOMAIN>.workers.dev/api/search?q=brand%20values%20sustainability"
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api` | GET | API overview and schema |
| `/api/search?q=...` | GET | Semantic search |
| `/api/search` | POST | Advanced search with filters |
| `/api/colors` | GET | All brand colors |
| `/api/colors/:category` | GET | Colors by category |
| `/api/typography` | GET | Font system |
| `/api/values` | GET | Brand values (DE/FR) |
| `/api/sections` | GET | All guideline sections |
| `/api/sections/:id` | GET | Section detail + rules |
| `/api/rules?type=...` | GET | Rules by type |
| `/api/assets` | GET | Downloadable assets |
| `/api/embed` | POST | Generate embeddings |
| `/api/ingest` | POST | Add new brand chunks |
| `/api/bootstrap` | POST | Embed all D1 chunks |

## D1 Database

Already created: `sbb-brand-library` (ID: dd470b9e-d176-4695-aec0-09cc24caf2d6)

Tables:
- `brand_sections` — 13 guideline sections (logo, colors, typography, etc.)
- `brand_colors` — 14 color specs with hex, RGB, CMYK, Pantone, RAL
- `brand_rules` — 23 rules (principles, usage, restrictions, exceptions, technical)
- `brand_typography` — 10 font entries with weights and usage contexts
- `brand_values` — 5 brand values (DE + FR translations)
- `brand_assets` — 11 downloadable resources
- `brand_chunks` — 17 semantic text chunks for vectorization

## For .brand Agents

A .brand agent can use this API to:
1. Query brand rules semantically: `POST /api/search { "query": "can I modify the logo?" }`
2. Get exact color specs: `GET /api/colors/corporate`
3. Check typography rules: `GET /api/typography`
4. Generate embeddings for its own content: `POST /api/embed { "text": "..." }`
