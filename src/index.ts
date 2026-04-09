/**
 * SBB Brand Library API
 *
 * A semantic brand knowledge base powered by:
 * - Cloudflare D1: Structured brand data (colors, typography, rules, values)
 * - Cloudflare Vectorize: Semantic search over brand guidelines
 * - Workers AI: Embedding generation for queries
 *
 * Part of the .brand ecosystem — Daniel Kunz & Nicolas Paupe (Brigade Studio)
 */

export interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  DB: D1Database;
  BRAND_NAME: string;
  BRAND_VERSION: string;
}

interface SearchResult {
  id: string;
  score: number;
  section_id?: string;
  chunk_text?: string;
  chunk_type?: string;
  metadata?: Record<string, string>;
}

// ─── CORS Headers ───────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ── API Overview ──────────────────────────────────────────────
      if (path === '/' || path === '/api') {
        return jsonResponse({
          name: `${env.BRAND_NAME} Brand Library API`,
          version: env.BRAND_VERSION,
          description: 'Semantic brand knowledge base for the .brand ecosystem',
          endpoints: {
            'GET /api/search?q=...': 'Semantic search across all brand guidelines',
            'GET /api/colors': 'All brand colors with specs',
            'GET /api/colors/:category': 'Colors by category (corporate, rolling-stock, architecture, clock)',
            'GET /api/typography': 'Typography system and font rules',
            'GET /api/values': 'Brand values (DE/FR)',
            'GET /api/sections': 'All brand guideline sections',
            'GET /api/sections/:id': 'Specific section with all rules',
            'GET /api/rules?type=...': 'Brand rules filtered by type (principle, usage, restriction, exception, technical)',
            'GET /api/assets': 'Available downloadable brand assets',
            'POST /api/search': 'Advanced semantic search (JSON body: { query, top_k, filter })',
            'POST /api/embed': 'Generate embedding for text (for .brand agents)',
            'POST /api/ingest': 'Ingest new brand content chunks',
          },
          brand: {
            name: env.BRAND_NAME,
            primary_color: '#eb0000',
            font: 'SBB Font / SBBWeb',
            languages: ['de', 'fr', 'it', 'en'],
          },
        });
      }

      // ── Semantic Search (GET) ─────────────────────────────────────
      if (path === '/api/search' && request.method === 'GET') {
        const query = url.searchParams.get('q');
        if (!query) {
          return jsonResponse({ error: 'Missing query parameter ?q=' }, 400);
        }
        const topK = parseInt(url.searchParams.get('top_k') || '5');
        return await semanticSearch(env, query, topK);
      }

      // ── Semantic Search (POST) ────────────────────────────────────
      if (path === '/api/search' && request.method === 'POST') {
        const body = await request.json() as { query: string; top_k?: number; filter?: Record<string, string> };
        if (!body.query) {
          return jsonResponse({ error: 'Missing query in request body' }, 400);
        }
        return await semanticSearch(env, body.query, body.top_k || 5, body.filter);
      }

      // ── Colors ────────────────────────────────────────────────────
      if (path === '/api/colors') {
        const category = url.searchParams.get('category');
        const sql = category
          ? 'SELECT * FROM brand_colors WHERE category = ? ORDER BY sort_order'
          : 'SELECT * FROM brand_colors ORDER BY sort_order';
        const params = category ? [category] : [];
        const result = await env.DB.prepare(sql).bind(...params).all();
        return jsonResponse({ colors: result.results, count: result.results.length });
      }

      if (path.startsWith('/api/colors/')) {
        const category = path.split('/api/colors/')[1];
        const result = await env.DB.prepare(
          'SELECT * FROM brand_colors WHERE category = ? ORDER BY sort_order'
        ).bind(category).all();
        return jsonResponse({ category, colors: result.results, count: result.results.length });
      }

      // ── Typography ────────────────────────────────────────────────
      if (path === '/api/typography') {
        const result = await env.DB.prepare(
          'SELECT * FROM brand_typography ORDER BY sort_order'
        ).all();
        return jsonResponse({ typography: result.results });
      }

      // ── Brand Values ──────────────────────────────────────────────
      if (path === '/api/values') {
        const result = await env.DB.prepare(
          'SELECT * FROM brand_values ORDER BY sort_order'
        ).all();
        return jsonResponse({ values: result.results });
      }

      // ── Sections ──────────────────────────────────────────────────
      if (path === '/api/sections') {
        const result = await env.DB.prepare(
          'SELECT id, title, title_fr, category, url, content, content_fr FROM brand_sections ORDER BY sort_order'
        ).all();
        return jsonResponse({ sections: result.results });
      }

      if (path.startsWith('/api/sections/') && !path.endsWith('/rules')) {
        const sectionId = path.split('/api/sections/')[1];
        const section = await env.DB.prepare(
          'SELECT * FROM brand_sections WHERE id = ?'
        ).bind(sectionId).first();
        if (!section) {
          return jsonResponse({ error: 'Section not found' }, 404);
        }
        const rules = await env.DB.prepare(
          'SELECT * FROM brand_rules WHERE section_id = ? ORDER BY sort_order'
        ).bind(sectionId).all();
        return jsonResponse({ section, rules: rules.results });
      }

      // ── Rules ─────────────────────────────────────────────────────
      if (path === '/api/rules') {
        const ruleType = url.searchParams.get('type');
        const sectionId = url.searchParams.get('section');
        let sql = 'SELECT r.*, s.title as section_title FROM brand_rules r JOIN brand_sections s ON r.section_id = s.id WHERE 1=1';
        const params: string[] = [];
        if (ruleType) {
          sql += ' AND r.rule_type = ?';
          params.push(ruleType);
        }
        if (sectionId) {
          sql += ' AND r.section_id = ?';
          params.push(sectionId);
        }
        sql += ' ORDER BY r.sort_order';
        const result = await env.DB.prepare(sql).bind(...params).all();
        return jsonResponse({ rules: result.results, count: result.results.length });
      }

      // ── Assets ────────────────────────────────────────────────────
      if (path === '/api/assets') {
        const result = await env.DB.prepare(
          'SELECT * FROM brand_assets ORDER BY sort_order'
        ).all();
        return jsonResponse({ assets: result.results });
      }

      // ── Embed (for .brand agents) ────────────────────────────────
      if (path === '/api/embed' && request.method === 'POST') {
        const body = await request.json() as { text: string | string[] };
        if (!body.text) {
          return jsonResponse({ error: 'Missing text in request body' }, 400);
        }
        const texts = Array.isArray(body.text) ? body.text : [body.text];
        const embeddings = await generateEmbeddings(env, texts);
        return jsonResponse({
          model: '@cf/baai/bge-base-en-v1.5',
          dimensions: 768,
          embeddings: embeddings.map((v, i) => ({
            text: texts[i].substring(0, 100) + (texts[i].length > 100 ? '...' : ''),
            vector_length: v.length,
          })),
        });
      }

      // ── Ingest new chunks ─────────────────────────────────────────
      if (path === '/api/ingest' && request.method === 'POST') {
        const body = await request.json() as {
          chunks: Array<{
            id: string;
            section_id: string;
            text: string;
            type?: string;
            metadata?: Record<string, string>;
          }>;
        };
        if (!body.chunks || !Array.isArray(body.chunks)) {
          return jsonResponse({ error: 'Missing chunks array in request body' }, 400);
        }
        return await ingestChunks(env, body.chunks);
      }

      // ── Bootstrap: Generate embeddings for all existing chunks ────
      if (path === '/api/bootstrap' && request.method === 'POST') {
        return await bootstrapEmbeddings(env);
      }

      // ── 404 ───────────────────────────────────────────────────────
      return jsonResponse({ error: 'Not found', path }, 404);

    } catch (err: any) {
      console.error('Error:', err);
      return jsonResponse({ error: err.message || 'Internal server error' }, 500);
    }
  },
};

// ─── Core Functions ─────────────────────────────────────────────────────────

async function generateEmbeddings(env: Env, texts: string[]): Promise<number[][]> {
  const response = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
    text: texts,
  }) as { data: number[][] };
  return response.data;
}

async function semanticSearch(
  env: Env,
  query: string,
  topK: number = 5,
  filter?: Record<string, string>
): Promise<Response> {
  // Generate embedding for the query
  const [queryVector] = await generateEmbeddings(env, [query]);

  // Search Vectorize
  const vectorResults = await env.VECTORIZE.query(queryVector, {
    topK,
    returnMetadata: 'all',
  });

  // Enrich with D1 data
  const results: SearchResult[] = [];
  for (const match of vectorResults.matches) {
    const chunk = await env.DB.prepare(
      'SELECT c.*, s.title, s.title_fr, s.url FROM brand_chunks c LEFT JOIN brand_sections s ON c.section_id = s.id WHERE c.id = ?'
    ).bind(match.id).first();

    results.push({
      id: match.id,
      score: match.score,
      section_id: (chunk as any)?.section_id || undefined,
      chunk_text: (chunk as any)?.chunk_text || (match.metadata as any)?.text || undefined,
      chunk_type: (chunk as any)?.chunk_type || undefined,
      metadata: {
        section_title: (chunk as any)?.title || '',
        section_title_fr: (chunk as any)?.title_fr || '',
        url: (chunk as any)?.url || '',
        ...(typeof (chunk as any)?.metadata === 'string'
          ? JSON.parse((chunk as any).metadata)
          : {}),
      },
    });
  }

  return jsonResponse({
    query,
    results,
    count: results.length,
    model: '@cf/baai/bge-base-en-v1.5',
  });
}

async function ingestChunks(
  env: Env,
  chunks: Array<{
    id: string;
    section_id: string;
    text: string;
    type?: string;
    metadata?: Record<string, string>;
  }>
): Promise<Response> {
  // Generate embeddings for all chunks
  const texts = chunks.map((c) => c.text);
  const embeddings = await generateEmbeddings(env, texts);

  // Insert into D1
  const stmt = env.DB.prepare(
    'INSERT OR REPLACE INTO brand_chunks (id, section_id, chunk_text, chunk_type, metadata) VALUES (?, ?, ?, ?, ?)'
  );
  const batch = chunks.map((c) =>
    stmt.bind(c.id, c.section_id, c.text, c.type || 'content', JSON.stringify(c.metadata || {}))
  );
  await env.DB.batch(batch);

  // Insert into Vectorize
  const vectors: VectorizeVector[] = chunks.map((c, i) => ({
    id: c.id,
    values: embeddings[i],
    metadata: {
      section_id: c.section_id,
      chunk_type: c.type || 'content',
      text: c.text.substring(0, 500),
    },
  }));
  const inserted = await env.VECTORIZE.upsert(vectors);

  return jsonResponse({
    ingested: chunks.length,
    vectorize_result: inserted,
  });
}

async function bootstrapEmbeddings(env: Env): Promise<Response> {
  // Read all chunks from D1
  const result = await env.DB.prepare(
    'SELECT id, section_id, chunk_text, chunk_type, metadata FROM brand_chunks'
  ).all();

  const chunks = result.results as Array<{
    id: string;
    section_id: string;
    chunk_text: string;
    chunk_type: string;
    metadata: string;
  }>;

  if (chunks.length === 0) {
    return jsonResponse({ error: 'No chunks found in D1' }, 404);
  }

  // Generate embeddings in batches of 10
  const batchSize = 10;
  let totalInserted = 0;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map((c) => c.chunk_text);
    const embeddings = await generateEmbeddings(env, texts);

    const vectors: VectorizeVector[] = batch.map((c, j) => ({
      id: c.id,
      values: embeddings[j],
      metadata: {
        section_id: c.section_id,
        chunk_type: c.chunk_type,
        text: c.chunk_text.substring(0, 500),
      },
    }));

    await env.VECTORIZE.upsert(vectors);
    totalInserted += vectors.length;
  }

  return jsonResponse({
    bootstrapped: totalInserted,
    total_chunks: chunks.length,
    message: 'All brand chunks embedded and indexed in Vectorize',
  });
}
