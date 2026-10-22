/**
 * Share links: `peardrop://<drive key in hex>`.
 *
 * The link carries the drive's public key, which is a read capability: it
 * is never announced. Peers meet on the DHT under the drive's discovery key,
 * which is derived from it.
 */

export const LINK_SCHEME = 'peardrop://'

export function createShareLink(key: string): string {
  return `${LINK_SCHEME}${key}`
}

/**
 * The drive key in a link (lowercase hex), or null if the link is not valid.
 * Accepts the bare 64-character key as well.
 */
export function parseShareLink(link: string | null | undefined): string | null {
  if (!link || typeof link !== 'string') {
    return null
  }

  const raw = link.trim().replace(/^peardrop:\/\//, '')
  return /^[a-f0-9]{64}$/i.test(raw) ? raw.toLowerCase() : null
}

/** The first characters of a key, for log lines. */
export function shortKey(key: Buffer | string, length = 12): string {
  const hex = typeof key === 'string' ? key : key.toString('hex')
  return hex.slice(0, length)
}
