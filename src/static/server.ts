/**
 * Minimal static web server for local servers of kind "static" (bundled to dist/static-server.js, no dependencies).
 *
 *   node static-server.js --root <dir> --port <port> [--live-reload]
 *
 * Listens on 127.0.0.1 only. Serves index.html for folders, `/about` → `about.html`, never leaves the root (also not via
 * symlinks). With --live-reload, HTML pages get a small script that reloads the page when a file below the root changes
 * (Server-Sent Events on /__rmi-live).
 */
import { createReadStream, promises as fs, watch } from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4',
    '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.pdf': 'application/pdf',
    '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.vtt': 'text/vtt; charset=utf-8',
};

const LIVE_PATH = '/__rmi-live';
const LIVE_SCRIPT = `<script>(()=>{const s=new EventSource(${JSON.stringify(LIVE_PATH)});s.onmessage=()=>location.reload();})();</script>`;

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
    const root = await fs.realpath(path.resolve(arg('--root') ?? '.'));
    const port = Number(arg('--port') ?? '8100');
    const live = process.argv.includes('--live-reload');
    const clients = new Set<http.ServerResponse>();

    const resolveFile = async (urlPath: string): Promise<string | undefined> => {
        let rel: string;
        try {
            rel = decodeURIComponent(urlPath.split('?')[0]);
        } catch {
            return undefined;
        }
        const target = path.join(root, path.normalize(`/${rel}`));
        for (const candidate of [target, path.join(target, 'index.html'), `${target}.html`]) {
            const stat = await fs.stat(candidate).catch(() => undefined);
            if (stat?.isFile()) {
                const real = await fs.realpath(candidate);
                return real === root || real.startsWith(root + path.sep) ? real : undefined;
            }
            if (stat?.isDirectory() && !urlPath.split('?')[0].endsWith('/') && candidate === target) {
                return `${'\0'}redirect`; // folder without trailing slash
            }
        }
        return undefined;
    };

    const server = http.createServer(async (req, res) => {
        const url = req.url ?? '/';
        const started = Date.now();
        res.on('finish', () => console.log(`${new Date().toISOString()} ${req.method} ${url} ${res.statusCode} ${Date.now() - started}ms`));
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { Allow: 'GET, HEAD' }).end();
            return;
        }
        if (live && url === LIVE_PATH) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
            res.write(': connected\n\n');
            clients.add(res);
            req.on('close', () => clients.delete(res));
            return;
        }
        const file = await resolveFile(url);
        if (file === '\0redirect') {
            const [p, q] = url.split('?');
            res.writeHead(301, { Location: `${p}/${q ? `?${q}` : ''}` }).end();
            return;
        }
        if (!file) {
            const notFound = await resolveFile('/404.html');
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            if (notFound && notFound !== '\0redirect') {
                createReadStream(notFound).pipe(res);
            } else {
                res.end(`<!doctype html><meta charset="utf-8"><title>404</title><p>Not found: ${escapeHtml(url)}</p>`);
            }
            return;
        }
        const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
        const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
        if (live && type.startsWith('text/html')) {
            const html = await fs.readFile(file, 'utf8');
            const body = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${LIVE_SCRIPT}</body>`) : html + LIVE_SCRIPT;
            res.writeHead(200, { ...headers, 'Content-Length': Buffer.byteLength(body) });
            res.end(req.method === 'HEAD' ? undefined : body);
            return;
        }
        const stat = await fs.stat(file);
        res.writeHead(200, { ...headers, 'Content-Length': stat.size });
        if (req.method === 'HEAD') {
            res.end();
        } else {
            createReadStream(file).pipe(res);
        }
    });

    if (live) {
        let timer: NodeJS.Timeout | undefined;
        try {
            watch(root, { recursive: true }, (_event, name) => {
                if (name && /(^|[/\\])(\.git|node_modules)([/\\]|$)/.test(String(name))) {
                    return;
                }
                clearTimeout(timer);
                timer = setTimeout(() => {
                    for (const c of clients) {
                        c.write('data: reload\n\n');
                    }
                }, 150);
            });
        } catch (error) {
            console.error(`Live reload not available: ${String(error)}`);
        }
        // keep the event streams open behind proxies
        setInterval(() => {
            for (const c of clients) {
                c.write(': ping\n\n');
            }
        }, 25_000).unref();
    }

    server.listen(port, '127.0.0.1', () => console.log(`Serving ${root} on http://127.0.0.1:${port}/${live ? ' (live reload)' : ''}`));
    const stop = () => server.close(() => process.exit(0));
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
