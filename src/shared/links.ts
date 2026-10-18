/**
 * Share-link helpers shared by main and renderer.
 */

/** A complete link: scheme + 64 hex characters. */
export const SHARE_LINK_RE = /peardrop:\/\/[a-f0-9]{64}/i

/**
 * Pull a usable link out of whatever was pasted (chat lines, wrapped e-mail
 * text, CLI output). Whitespace is removed first because mail clients wrap
 * long keys across lines. Lower-cased: keys are hex and compared by equality.
 */
export function extractShareLink(raw: string | null | undefined): string | null {
  const compact = String(raw ?? '').replace(/\s+/g, '')
  const m = compact.match(SHARE_LINK_RE)
  return m ? m[0].toLowerCase() : null
}

/** Why a pasted value is not a link, in user-facing words. */
export function describeInvalidLink(raw: string): string {
  return raw.toLowerCase().includes('peardrop://')
    ? 'Invalid link — the key must be exactly 64 characters'
    : 'Invalid link'
}
