
# Feature 7 – Knowledge Graph of Energy Events (React-only)

This is a single React + Vite project where **everything** happens inside the
component:

- Graph structure and metrics
- Embeddings with `text-embedding-3-small`
- GPT-4o-mini calls via the Responses API
- RAG search on the client

There is **no separate backend**. The React component talks directly to
`https://api.openai.com` from the browser.

> IMPORTANT: This means your `VITE_OPENAI_API_KEY` is exposed to users.
> Use this pattern only for local demos / hackathons, not production.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from the example and set your key:

```bash
cp .env.example .env
# edit .env and put your real OpenAI API key
```

3. Start dev server:

```bash
npm run dev
```

Open http://localhost:5173.

## Using the UI

1. In the **Ingest data** card, keep the default JSON or paste your own:

- `Papers JSON`: array of `{ id, title, summary, published }`
- `Grid events JSON`: array of event objects
- `Policies JSON`: array of policy objects

2. Click **Ingest / Rebuild Graph**:

- The component:
  - calls OpenAI embeddings for each item,
  - builds a knowledge graph in memory,
  - links locations and simple paper–event relations,
  - computes degree centrality and risk scores.

3. Use the rest of the UI:

- **Interactive graph** – click nodes to inspect them.
- **Node inspector** – calls GPT-4o-mini to summarise node + neighbours.
- **Timeline** – built from node timestamps.
- **RAG over the graph** – runs embedding search + GPT-4o-mini with the
  retrieved nodes as context.

You can drop this `App.jsx` into your existing EnergyVerse front-end and
wire it to your layout.
