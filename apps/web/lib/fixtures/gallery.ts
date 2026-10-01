import { GalleryPage } from '@fgg/types';
import { fid } from './ids';

const harbor = {
  eventId: fid('01JEVT', 6),
  eventName: 'Harbor Fest',
  eventLabel: 'Harbor Fest 2026',
};
const summer = {
  eventId: fid('01JEVT', 7),
  eventName: 'Summer Fest',
  eventLabel: 'Summer Fest 2026',
};
const spring = {
  eventId: fid('01JEVT', 8),
  eventName: 'Spring Fest',
  eventLabel: 'Spring Fest 2026',
};
const halloween = {
  eventId: fid('01JEVT', 9),
  eventName: 'Halloween Fest',
  eventLabel: 'Halloween Fest 2025',
};

const P = (file: string) => `https://fixture.local/posters/${file}`;

export const galleryFixture: GalleryPage = GalleryPage.parse({
  events: [
    { id: harbor.eventId, label: harbor.eventLabel },
    { id: summer.eventId, label: summer.eventLabel },
    { id: spring.eventId, label: spring.eventLabel },
    { id: halloween.eventId, label: halloween.eventLabel },
  ],
  items: [
    {
      type: 'photo',
      id: fid('01JGAL', 1),
      ...harbor,
      url: P('harbor-fest-og.jpg'),
      thumbUrl: P('harbor-fest-og.jpg'),
      caption: 'Aug 7–9, 2026 · Baltimore Convention Center',
      featured: true,
      takenOn: '2026-08-08',
    },
    {
      type: 'photo',
      id: fid('01JGAL', 10),
      ...harbor,
      url: P('harbor-fest-og.jpg'),
      thumbUrl: P('harbor-fest-og.jpg'),
      caption: 'Trading tables',
      featured: false,
      takenOn: '2026-08-08',
    },
    {
      type: 'video',
      id: fid('01JGAL', 3),
      ...harbor,
      url: 'https://fixture.local/media/harbor-recap.mp4',
      posterUrl: P('harbor-fest-og.jpg'),
      durationSeconds: 84,
      caption: 'Recap',
      featured: false,
    },
    {
      type: 'photo',
      id: fid('01JGAL', 2),
      ...summer,
      url: P('summer-fest-og.png'),
      thumbUrl: P('summer-fest-og.png'),
      caption: 'Summer Fest · Jun 2026',
      featured: false,
      takenOn: '2026-06-27',
    },
    {
      type: 'quote',
      id: fid('01JGAL', 11),
      ...summer,
      text: '"Best day of my summer, and I\'m 41."',
      attribution: 'Dad, Summer Fest',
    },
    {
      type: 'photo',
      id: fid('01JGAL', 4),
      ...spring,
      url: P('spring-fest-og.png'),
      thumbUrl: P('spring-fest-og.png'),
      caption: 'Spring Fest · Apr 2026',
      featured: false,
      takenOn: '2026-04-25',
    },
    {
      type: 'photo',
      id: fid('01JGAL', 12),
      ...spring,
      url: P('spring-fest-og.png'),
      thumbUrl: P('spring-fest-og.png'),
      caption: 'Art station',
      featured: false,
      takenOn: '2026-04-26',
    },
    {
      type: 'stat',
      id: fid('01JGAL', 13),
      ...spring,
      value: '1,180',
      label: 'Cans donated · Spring Fest',
    },
    {
      type: 'photo',
      id: fid('01JGAL', 14),
      ...halloween,
      url: P('halloween-fest-og.jpg'),
      thumbUrl: P('halloween-fest-og.jpg'),
      caption: 'Costume contest',
      featured: false,
      takenOn: '2025-10-25',
    },
    {
      type: 'video',
      id: fid('01JGAL', 15),
      ...halloween,
      url: 'https://fixture.local/media/tournament-final.mp4',
      posterUrl: P('halloween-fest-og.jpg'),
      durationSeconds: 48,
      caption: 'Tournament final',
      featured: false,
    },
  ],
});
