import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
  }
  next();
});

const PORT = Number(process.env.PORT) || 3000;

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

app.get('/api/maps-config', (_req, res) => {
  const mapsApiKey =
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    '';
  res.json({ mapsApiKey });
});

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZipBuffer(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const compressed = zlib.deflateRawSync(entry.data);
    const crc = crc32(entry.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDir.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, endRecord]);
}

app.get('/api/export-zip', (_req, res) => {
  try {
    const rootDir = __dirname;
    const includeFiles = [
      '.env.example',
      '.gitignore',
      'README.md',
      'index.html',
      'metadata.json',
      'package.json',
      'render.yaml',
      'server.ts',
      'tsconfig.json',
      'vite.config.ts',
    ];
    const entries: Array<{ name: string; data: Buffer }> = [];

    for (const file of includeFiles) {
      const fullPath = path.join(rootDir, file);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        entries.push({ name: file, data: fs.readFileSync(fullPath) });
      }
    }

    const walkDir = (dirRel: string) => {
      const fullDir = path.join(rootDir, dirRel);
      if (!fs.existsSync(fullDir)) return;
      for (const item of fs.readdirSync(fullDir, { withFileTypes: true })) {
        const rel = path.posix.join(dirRel, item.name);
        if (rel === 'public/assets' || rel.startsWith('public/assets/')) {
          continue;
        }
        if (item.isDirectory()) {
          walkDir(rel);
        } else if (item.isFile()) {
          entries.push({ name: rel, data: fs.readFileSync(path.join(rootDir, rel)) });
        }
      }
    };

    walkDir('src');
    walkDir('public');
    walkDir('android-app');
    walkDir('.github');

    const zipBuf = buildZipBuffer(entries);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="spotlock-github.zip"'
    );
    res.setHeader('Content-Length', String(zipBuf.length));
    res.send(zipBuf);
  } catch (err: unknown) {
    res.status(500).json({
      error:
        err instanceof Error ? err.message : 'Failed to build export ZIP.',
    });
  }
});

app.post('/api/parking/nearby', async (req, res) => {
  const body = req.body as {
    latitude?: unknown;
    longitude?: unknown;
    query?: unknown;
  };

  const latitude = typeof body.latitude === 'number' ? body.latitude : NaN;
  const longitude = typeof body.longitude === 'number' ? body.longitude : NaN;
  const query = typeof body.query === 'string' ? body.query.trim() : '';

  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    res.status(400).json({
      error: 'Valid latitude and longitude coordinates are required.',
    });
    return;
  }

  const ai = getGeminiClient();
  if (!ai) {
    res.status(503).json({
      error:
        'Gemini API key is not configured. Check your API key in Settings > Secrets.',
    });
    return;
  }

  try {
    const prompt = query
      ? `Find available public parking garages, parking lots, or street parking near (${latitude.toFixed(5)}, ${longitude.toFixed(5)}) matching "${query}". List the best nearby parking options clearly with names and practical details.`
      : `Find the closest public parking garages, parking lots, and parking areas near (${latitude.toFixed(5)}, ${longitude.toFixed(5)}). List the top nearby options clearly so a driver can pick one to park at.`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        tools: [{ googleMaps: {} }],
        toolConfig: {
          retrievalConfig: {
            latLng: {
              latitude,
              longitude,
            },
          },
        },
      },
    });

    const summary = (response.text ?? '').trim();
    const rawChunks =
      response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];

    const places: Array<{
      title: string;
      uri: string;
      placeId?: string;
      reviewSnippets?: string[];
    }> = [];

    for (const chunk of rawChunks) {
      const mapsChunk = (
        chunk as {
          maps?: {
            title?: string;
            uri?: string;
            placeId?: string;
            placeAnswerSources?: {
              reviewSnippets?: Array<{ reviewText?: string }>;
            };
          };
        }
      ).maps;

      if (mapsChunk?.uri) {
        const snippets =
          mapsChunk.placeAnswerSources?.reviewSnippets
            ?.map((s) => s.reviewText)
            .filter((t): t is string => Boolean(t)) ?? [];

        places.push({
          title: mapsChunk.title || 'Nearby Parking Spot',
          uri: mapsChunk.uri,
          placeId: mapsChunk.placeId,
          reviewSnippets: snippets.length > 0 ? snippets : undefined,
        });
      }
    }

    res.json({
      summary,
      places,
    });
  } catch (err: unknown) {
    const rawMessage =
      err instanceof Error ? err.message : 'Failed to look up nearby parking.';
    const isQuota =
      rawMessage.includes('429') || rawMessage.includes('RESOURCE_EXHAUSTED');
    res.status(isQuota ? 429 : 500).json({
      error: isQuota
        ? 'AI parking search quota reached. You can still pick any nearby green P pin on the map.'
        : rawMessage,
      quotaExceeded: isQuota,
    });
  }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
        watch: null,
      },
      appType: 'spa',
    });

    // Prevent Vite 8's default /@vite/client from opening a wss://...:24678 WebSocket
    // when HMR is disabled behind Cloud Run's HTTPS reverse proxy.
    app.get('/@vite/client', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style && style.parentNode) {
    style.parentNode.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  const data = {};
  return {
    data,
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (search ? '&' + search.slice(1) : '') + (hash || '');
}
export class ErrorOverlay extends HTMLElement {}
`);
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distPath, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
