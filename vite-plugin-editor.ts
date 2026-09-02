import fs from 'node:fs';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

const PREFIX = '/__dev/editor';
const MAX_BODY_SIZE = 1024 * 1024;

function routeToFile(routePath: string, root: string): string {
	// /docs/api/play → src/routes/docs/api/play/+page.svx
	const clean = routePath.replace(/^\/+|\/+$/g, '');
	return path.join(root, 'src', 'routes', clean, '+page.svx');
}

function validatePath(filePath: string, root: string): boolean {
	const routesDir = path.resolve(root, 'src', 'routes');
	let routesRealPath: string;
	try {
		routesRealPath = fs.realpathSync(routesDir);
	} catch {
		return false;
	}

	try {
		const stat = fs.lstatSync(filePath);
		if (stat.isSymbolicLink()) return false;
		const target = fs.realpathSync(filePath);
		return target.startsWith(routesRealPath + path.sep) || target === routesRealPath;
	} catch {
		try {
			const parent = fs.realpathSync(path.dirname(filePath));
			return parent.startsWith(routesRealPath + path.sep) || parent === routesRealPath;
		} catch {
			return false;
		}
	}
}

function validateSection(section: string): boolean {
	return section === 'docs' || section === 'faq';
}

function validateRoute(routePath: string): boolean {
	const parts = routePath.replace(/^\/+|\/+$/g, '').split('/');
	return parts.length >= 1 && validateSection(parts[0]) && parts.slice(1).every(validateSlug);
}

function validateSlug(slug: string): boolean {
	return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}

class RequestError extends Error {
	constructor(public status: number, message: string) {
		super(message);
	}
}

function readBody(req: import('http').IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = '';
		req.on('data', (chunk: Buffer) => {
			data += chunk.toString();
			if (Buffer.byteLength(data) > MAX_BODY_SIZE) {
				req.destroy();
				reject(new RequestError(413, 'Request body is too large'));
			}
		});
		req.on('end', () => resolve(data));
		req.on('error', reject);
	});
}

async function readJsonBody(req: import('http').IncomingMessage): Promise<Record<string, unknown>> {
	try {
		const body = JSON.parse(await readBody(req));
		if (!body || typeof body !== 'object' || Array.isArray(body)) {
			throw new RequestError(400, 'Request body must be a JSON object');
		}
		return body as Record<string, unknown>;
	} catch (err) {
		if (err instanceof RequestError) throw err;
		throw new RequestError(400, 'Request body must contain valid JSON');
	}
}

function sendJson(res: import('http').ServerResponse, status: number, data: unknown) {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(data));
}

const LOCALHOST_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLocalhost(req: import('http').IncomingMessage): boolean {
	return LOCALHOST_ADDRS.has(req.socket.remoteAddress ?? '');
}

interface DevEditorOptions {
	/** Allow all editor operations from any host. Default: false (localhost only). */
	insecure?: boolean;
}

export default function devEditor(options?: DevEditorOptions): Plugin {
	const insecure = options?.insecure ?? false;

	return {
		name: 'dev-editor',
		apply: 'serve',

		configureServer(server: ViteDevServer) {
			const root = server.config.root || process.cwd();

			server.middlewares.use(async (req, res, next) => {
				const url = new URL(req.url || '/', `http://${req.headers.host}`);

				if (!url.pathname.startsWith(PREFIX)) {
					return next();
				}

				const endpoint = url.pathname.slice(PREFIX.length);

				if (!insecure && !isLocalhost(req)) {
					return sendJson(res, 403, {
						error: 'Editor operations are restricted to localhost. Use { insecure: true } to allow remote access.'
					});
				}

				try {
					// GET /__dev/editor/file?path=/docs/api/play
					if (req.method === 'GET' && endpoint === '/file') {
						const routePath = url.searchParams.get('path');
						if (!routePath) {
							return sendJson(res, 400, { error: 'Missing "path" query parameter' });
						}
						if (!validateRoute(routePath)) {
							return sendJson(res, 400, { error: 'Route must start with /docs/ or /faq/' });
						}

						const filePath = routeToFile(routePath, root);
						if (!validatePath(filePath, root)) {
							return sendJson(res, 403, { error: 'Path outside allowed directory' });
						}

						if (!fs.existsSync(filePath)) {
							return sendJson(res, 404, { error: 'File not found' });
						}

						const content = fs.readFileSync(filePath, 'utf-8');
						return sendJson(res, 200, { content, routePath });
					}

					// PUT /__dev/editor/file - update existing file
					if (req.method === 'PUT' && endpoint === '/file') {
						const body = await readJsonBody(req);
						const { routePath, content } = body;

						if (typeof routePath !== 'string' || !routePath || typeof content !== 'string') {
							return sendJson(res, 400, { error: 'Missing routePath or content' });
						}
						if (!validateRoute(routePath)) {
							return sendJson(res, 400, { error: 'Route must start with /docs/ or /faq/' });
						}

						const filePath = routeToFile(routePath, root);
						if (!validatePath(filePath, root)) {
							return sendJson(res, 403, { error: 'Path outside allowed directory' });
						}

						if (!fs.existsSync(filePath)) {
							return sendJson(res, 404, { error: 'File not found' });
						}

						fs.writeFileSync(filePath, content, 'utf-8');
						return sendJson(res, 200, { ok: true });
					}

					// POST /__dev/editor/file - create new file
					if (req.method === 'POST' && endpoint === '/file') {
						const body = await readJsonBody(req);
						const { routePath, content } = body;

						if (typeof routePath !== 'string' || !routePath || typeof content !== 'string') {
							return sendJson(res, 400, { error: 'Missing routePath or content' });
						}

						// Validate route structure: must start with /docs/ or /faq/
						const parts = routePath.replace(/^\/+/, '').split('/');
						if (parts.length < 2 || !validateSection(parts[0])) {
							return sendJson(res, 400, { error: 'Route must start with /docs/ or /faq/' });
						}

						// Validate slug (last segment)
						const slug = parts[parts.length - 1];
						if (!validateSlug(slug)) {
							return sendJson(res, 400, {
								error: 'Invalid slug. Use lowercase letters, numbers, and hyphens only.'
							});
						}

						const filePath = routeToFile(routePath, root);
						if (!validatePath(filePath, root)) {
							return sendJson(res, 403, { error: 'Path outside allowed directory' });
						}

						if (fs.existsSync(filePath)) {
							return sendJson(res, 409, { error: 'File already exists' });
						}

						const dir = path.dirname(filePath);
						fs.mkdirSync(dir, { recursive: true });
						fs.writeFileSync(filePath, content, 'utf-8');
						return sendJson(res, 201, { ok: true, routePath });
					}

					// DELETE /__dev/editor/file?path=/docs/api/play
					if (req.method === 'DELETE' && endpoint === '/file') {
						const routePath = url.searchParams.get('path');
						if (!routePath) {
							return sendJson(res, 400, { error: 'Missing "path" query parameter' });
						}
						if (!validateRoute(routePath)) {
							return sendJson(res, 400, { error: 'Route must start with /docs/ or /faq/' });
						}

						const filePath = routeToFile(routePath, root);
						if (!validatePath(filePath, root)) {
							return sendJson(res, 403, { error: 'Path outside allowed directory' });
						}

						if (!fs.existsSync(filePath)) {
							return sendJson(res, 404, { error: 'File not found' });
						}

						fs.unlinkSync(filePath);

						// Clean up empty directory
						const dir = path.dirname(filePath);
						const remaining = fs.readdirSync(dir);
						if (remaining.length === 0) {
							fs.rmdirSync(dir);
						}

						return sendJson(res, 200, { ok: true });
					}

					// GET /__dev/editor/directories?section=docs
					if (req.method === 'GET' && endpoint === '/directories') {
						const section = url.searchParams.get('section');
						if (!section || !validateSection(section)) {
							return sendJson(res, 400, { error: 'Invalid section. Use "docs" or "faq".' });
						}

						const sectionDir = path.join(root, 'src', 'routes', section);
						const dirs: string[] = [];

						// Add root section itself
						dirs.push(`/${section}`);

						function walk(dir: string) {
							if (!fs.existsSync(dir)) return;
							for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
								if (entry.isDirectory() && !entry.name.startsWith('+') && !entry.name.startsWith('.')) {
									const rel = path.relative(path.join(root, 'src', 'routes'), path.join(dir, entry.name));
									dirs.push('/' + rel.replace(/\\/g, '/'));
									walk(path.join(dir, entry.name));
								}
							}
						}

						walk(sectionDir);
						return sendJson(res, 200, { directories: dirs.sort() });
					}

					return sendJson(res, 404, { error: 'Unknown editor endpoint' });
				} catch (err) {
					console.error('[dev-editor]', err);
					const status = err instanceof RequestError ? err.status : 500;
					return sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
				}
			});
		}
	};
}
