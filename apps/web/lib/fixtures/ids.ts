/** Deterministic, schema-valid ULIDs for fixture data (Crockford base32, 26 chars). */
export function fid(prefix: string, n: number): string {
  const body = (prefix.toUpperCase().replace(/[ILOU]/g, 'X') + '0'.repeat(26)).slice(0, 24);
  return body + String(n).padStart(2, '0');
}
