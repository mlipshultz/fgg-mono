import type { ReactElement } from 'react';

const paths: Record<string, ReactElement> = {
  discord: (
    <path d="M20.3 4.4A19 19 0 0 0 15.6 3l-.6 1.2a17.6 17.6 0 0 0-6 0L8.4 3a19 19 0 0 0-4.7 1.4C.7 8.9-.1 13.3.3 17.6a19 19 0 0 0 5.8 2.9l1.2-2a12 12 0 0 1-2-.9l.5-.4a13.6 13.6 0 0 0 12.4 0l.5.4-2 1 1.2 2a19 19 0 0 0 5.8-3c.5-5-.8-9.3-3.4-13.2ZM8.5 15c-1.1 0-2-1-2-2.3s.9-2.3 2-2.3 2 1 2 2.3-.9 2.3-2 2.3Zm7 0c-1.1 0-2-1-2-2.3s.9-2.3 2-2.3 2 1 2 2.3-.9 2.3-2 2.3Z" />
  ),
  instagram: (
    <path d="M12 2.2c3.2 0 3.6 0 4.8.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.8.1s-3.6 0-4.8-.1c-3.3-.1-4.8-1.7-4.9-4.9C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.8C2.4 3.9 4 2.4 7.2 2.3c1.2-.1 1.6-.1 4.8-.1ZM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 8.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4Zm5.2-9.6a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z" />
  ),
  tiktok: (
    <path d="M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.1v12.4a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.7a5.8 5.8 0 1 0 4.9 5.7V9a7.4 7.4 0 0 0 4.3 1.4V7.3a4.3 4.3 0 0 1-3.2-1.5Z" />
  ),
  youtube: (
    <path d="M23 7.2a2.9 2.9 0 0 0-2-2C19.2 4.7 12 4.7 12 4.7s-7.2 0-9 .5a2.9 2.9 0 0 0-2 2C.5 9 .5 12 .5 12s0 3 .5 4.8a2.9 2.9 0 0 0 2 2c1.8.5 9 .5 9 .5s7.2 0 9-.5a2.9 2.9 0 0 0 2-2c.5-1.8.5-4.8.5-4.8s0-3-.5-4.8ZM9.7 15.1V8.9l6 3.1-6 3.1Z" />
  ),
  facebook: (
    <path d="M13.5 21v-7.6h2.6l.4-3h-3V8.5c0-.9.2-1.5 1.5-1.5h1.6V4.3c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.8v3h2.6V21h3.1Z" />
  ),
};

export function SocialIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
}

export const SOCIAL_NAMES = ['discord', 'instagram', 'tiktok', 'youtube', 'facebook'] as const;
export const SOCIAL_LABELS: Record<(typeof SOCIAL_NAMES)[number], string> = {
  discord: 'Discord',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  facebook: 'Facebook',
};
