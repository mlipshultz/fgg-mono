import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { z } from 'zod';
import type { ApiError } from '@fgg/types';

export type Req = APIGatewayProxyEventV2;
export type Res = APIGatewayProxyResultV2;

const ORIGINS = (process.env.WEB_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function corsHeaders(req: Req): Record<string, string> {
  const origin = req.headers?.origin ?? req.headers?.Origin;
  if (!origin || !ORIGINS.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    vary: 'Origin',
  };
}

export function json(
  req: Req,
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Res {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json', ...corsHeaders(req), ...extra },
    body: JSON.stringify(body),
  };
}

export function error(
  req: Req,
  code: string,
  message: string,
  status: number,
  details?: unknown,
): Res {
  const body: ApiError = {
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  };
  return json(req, body, status);
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Parse and validate a JSON body. Throws HttpError(400) on failure. */
export function parseBody<T extends z.ZodTypeAny>(req: Req, schema: T): z.infer<T> {
  let raw: unknown;
  try {
    const text = req.isBase64Encoded
      ? Buffer.from(req.body ?? '', 'base64').toString('utf8')
      : req.body;
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new HttpError(
      400,
      'validation_failed',
      'Request body failed validation',
      result.error.issues,
    );
  }
  return result.data;
}

export type Handler = (req: Req, params: Record<string, string>) => Promise<Res>;

interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  handler: Handler;
}

/** Minimal path router: `/public/events/{id}/availability`. */
export class Router {
  private routes: Route[] = [];

  add(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, handler: Handler): this {
    const names: string[] = [];
    const source = path
      .split('/')
      .map((seg) => {
        const m = /^\{(\w+)\}$/.exec(seg);
        if (m) {
          names.push(m[1]!);
          return '([^/]+)';
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.routes.push({ method, pattern: new RegExp(`^${source}/?$`), names, handler });
    return this;
  }

  async handle(req: Req): Promise<Res> {
    const method = req.requestContext.http.method.toUpperCase();
    const path = req.rawPath;
    if (method === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(req), body: '' };
    try {
      for (const r of this.routes) {
        if (r.method !== method) continue;
        const m = r.pattern.exec(path);
        if (!m) continue;
        const params: Record<string, string> = {};
        r.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1]!)));
        return await r.handler(req, params);
      }
      return error(req, 'not_found', `No route for ${method} ${path}`, 404);
    } catch (e) {
      if (e instanceof HttpError) return error(req, e.code, e.message, e.status, e.details);
      console.error('unhandled', e);
      return error(req, 'internal', 'Something went wrong', 500);
    }
  }
}
