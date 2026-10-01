/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Event, FloorPlan, Venue } from '@fgg/types';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

export const EVENT_ID = '01HZX3V9K7Q2M4N8P6R5T1W0YA';
export const VENUE_ID = '01HZX3V9K7Q2M4N8P6R5T1W0YB';

export const venue: Venue = {
  id: VENUE_ID,
  name: 'Maryland State Fairgrounds',
  address: '2200 York Rd',
  city: 'Timonium',
  state: 'MD',
  timeZone: 'America/New_York',
};

export const event: Event = {
  id: EVENT_ID,
  slug: 'halloween-fest-2026',
  seriesId: 'halloween-fest',
  name: 'Halloween Fest',
  blurb: 'Costume contest and more.',
  venueId: VENUE_ID,
  timeZone: 'America/New_York',
  days: [
    { date: '2026-10-24', opens: '11:00', closes: '17:00', vendorLoadIn: '09:00' },
    { date: '2026-10-25', opens: '11:00', closes: '17:00', vendorLoadIn: '09:00' },
  ],
  startsAt: '2026-10-24T15:00:00Z',
  endsAt: '2026-10-25T21:00:00Z',
  posterKey: 'events/halloween-fest-2026/poster.jpg',
  published: true,
  vendorStatus: 'open',
  tableRateCents: 20000,
  pokeBucksRateCents: 10000,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

export const floorPlan: FloorPlan = {
  venueId: VENUE_ID,
  version: 1,
  width: 20,
  height: 20,
  zones: [],
  tables: ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'].map((id, i) => ({
    id,
    row: id[0]!,
    position: Number(id.slice(1)),
    x: i,
    y: 0,
    nearby: [],
  })),
};

export function req(
  method: 'GET' | 'POST',
  path: string,
  opts: { body?: unknown; query?: Record<string, string>; origin?: string } = {},
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${method} /public/{proxy+}`,
    rawPath: path,
    rawQueryString: '',
    headers: {
      ...(opts.origin ? { origin: opts.origin } : {}),
      'content-type': 'application/json',
    },
    ...(opts.query ? { queryStringParameters: opts.query } : {}),
    requestContext: {
      accountId: '1',
      apiId: 'x',
      domainName: 'x',
      domainPrefix: 'x',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '1.1.1.1', userAgent: 'test' },
      requestId: 'r',
      routeKey: `${method} /public/{proxy+}`,
      stage: '$default',
      time: '',
      timeEpoch: 0,
    },
    isBase64Encoded: false,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  } as APIGatewayProxyEventV2;
}

export function parse(res: unknown): {
  status: number;
  body: any;
  headers: Record<string, string>;
} {
  const r = res as { statusCode: number; body: string; headers: Record<string, string> };
  return {
    status: r.statusCode,
    body: r.body ? JSON.parse(r.body) : undefined,
    headers: r.headers,
  };
}
