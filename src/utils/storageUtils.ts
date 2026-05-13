import LZString from 'lz-string';

/**
 * Compresses a string using LZString.
 * Adds a prefix 'lz:' to indicate it's compressed.
 */
export const compressText = (text: string): string => {
  if (!text) return '';
  // Only compress if it's long enough to benefit
  if (text.length < 100) return text;
  const compressed = LZString.compressToUTF16(text);
  return `lz:${compressed}`;
};

/**
 * Decompresses a string if it has the 'lz:' prefix.
 */
export const decompressText = (text: string): string => {
  if (!text || !text.startsWith('lz:')) return text;
  const compressed = text.substring(3);
  return LZString.decompressFromUTF16(compressed) || text;
};

/**
 * Calculates the expiration timestamp (48 hours from now).
 */
export const getExpirationTimestamp = (): number => {
  const hours = 48;
  return performance.now() + hours * 60 * 60 * 1000;
};

/**
 * Checks if a document has expired images.
 */
export const isExpired = (expiresAt?: number): boolean => {
  if (!expiresAt) return false;
  return performance.now() > expiresAt;
};
