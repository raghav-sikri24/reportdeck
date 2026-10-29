import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { recommendCharts } from '../src/ai/recommend';
import type { DataProfile } from '../src/ai/profile';
import { createChartAdvisor, type ChartAdvisorOptions } from '../src/server/advisor';

const src = (p: string) => fileURLToPath(new URL(`../src/${p}`, import.meta.url));

/**
 * Serves POST /api/chart-advisor during development. With GEMINI_API_KEY,
 * OPENAI_API_KEY or ANTHROPIC_API_KEY in playground/.env.local it calls that
 * provider; otherwise a demo provider answers with the built-in rules through
 * the same validation and privacy pipeline.
 */
function chartAdvisor(env: Record<string, string>): Plugin {
  const provider: ChartAdvisorOptions['provider'] = env.GEMINI_API_KEY
    ? 'gemini'
    : env.OPENAI_API_KEY
      ? 'openai'
      : env.ANTHROPIC_API_KEY
        ? 'anthropic'
        : {
            name: 'demo',
            model: 'built-in rules',
            async generate({ prompt }) {
              await new Promise((r) => setTimeout(r, 700)); // feel like a network call
              const profile = JSON.parse(prompt.slice(prompt.indexOf('{'), prompt.lastIndexOf('}') + 1)) as DataProfile;
              const question = /User request: (".*")/.exec(prompt)?.[1];
              return { suggestions: recommendCharts(profile, { question: question ? (JSON.parse(question) as string) : '', max: 4 }) };
            },
          };
  const apiKey = env.GEMINI_API_KEY || env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || undefined;
  const handler = createChartAdvisor({ provider, apiKey, model: env.AI_MODEL || undefined, onError: (e) => console.warn('[chart-advisor]', e) });
  return {
    name: 'chart-advisor',
    configureServer(server) {
      console.warn(`[chart-advisor] provider: ${typeof provider === 'string' ? provider : 'demo (no API key set)'}`);
      server.middlewares.use('/api/chart-advisor', (req: IncomingMessage, res: ServerResponse) => {
        void (async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const request = new Request('http://localhost/api/chart-advisor', {
            method: req.method,
            headers: { 'content-type': String(req.headers['content-type'] ?? 'application/json') },
            body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
          });
          const response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        })();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '');
  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [react(), chartAdvisor(env)],
    resolve: {
      alias: [
        { find: /^reportdeck\/styles\.css$/, replacement: src('styles.css') },
        { find: /^reportdeck\/(core|export)$/, replacement: src('$1/index.ts') },
        { find: /^reportdeck$/, replacement: src('index.ts') },
      ],
    },
    server: { port: 5199, strictPort: true },
  };
});
