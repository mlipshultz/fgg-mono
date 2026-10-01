import { Dashboard, type AdminUserRow, type Me } from '@fgg/types';
import { fixtureEvents } from './home';

const BADGE_NAMES = [
  'First Fest',
  'Trader',
  'Artist',
  'Good Neighbor',
  'Harbor 2026',
  'Raffle Regular',
  'Found Em All',
  'Bracket Buster',
  'Summer 2026',
  'Costume Champ',
  'Volunteer',
  'Level 10',
];

const me: Me = {
  sub: '2f1a3a1e-6b2a-4c0e-9d1c-0f3c2b1a9e8d',
  email: 'maya@example.com',
  displayName: 'Maya Johnson',
  roles: ['attendee'],
  memberSince: '2026-04-12T15:00:00Z',
};

export const dashboardFixture = Dashboard.parse({
  me,
  progress: {
    level: 7,
    title: 'Trader',
    xp: 3150,
    xpIntoLevel: 1060,
    xpForLevel: 1400,
    xpToNext: 340,
    pct: 1060 / 1400,
    nextLevel: 8,
    nextTitle: 'Collector',
    nextUnlocks: 'Early-entry pass + "Collector" title',
  },
  stats: { fests: 6, badgesEarned: 9, badgesTotal: 12, memberSince: me.memberSince },
  badges: BADGE_NAMES.map((title, i) => ({
    id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    title,
    description: `${title} badge`,
    earned: i < 9,
    ...(i < 9 ? { awardedAt: '2026-08-08T18:00:00Z' } : {}),
  })),
  savedEvents: fixtureEvents.slice(0, 3),
});

export const adminUsersFixture: AdminUserRow[] = [
  {
    sub: me.sub,
    email: me.email,
    displayName: me.displayName,
    roles: ['attendee'],
    memberSince: me.memberSince,
  },
  {
    sub: '7c0d2b4e-1f3a-4a5b-8c6d-9e0f1a2b3c4d',
    email: 'sam@cardshop.example',
    displayName: 'Sam Rivera',
    roles: ['attendee', 'vendor'],
    vendorId: '01JVND00000000000000000001',
    memberSince: '2026-05-02T12:00:00Z',
  },
  {
    sub: '0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d',
    email: 'crew@feelgoodgaming.com',
    displayName: 'FGG Crew',
    roles: ['attendee', 'staff'],
    memberSince: '2026-03-20T12:00:00Z',
  },
];
