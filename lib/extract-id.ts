/**
 * Extract a numeric ID from scanned QR text.
 *
 * Booth QR codes are expected to hold a bare number (e.g. "199"), but we
 * also accept a full URL carrying `?id=199` (e.g.
 * `.../kitchen/dson/scanbooth?id=199`) so a mixed batch of printed codes
 * still scans. Returns null when nothing usable is present.
 */
export function extractId(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  // Bare number.
  if (/^\d+$/.test(text)) return text;

  // URL with an id query parameter.
  try {
    const url = new URL(text);
    const id = url.searchParams.get("id");
    if (id && /^\d+$/.test(id.trim())) return id.trim();
  } catch {
    // Not a URL — fall through to the last-ditch scan below.
  }

  // Last resort: pull the first run of digits anywhere in the string.
  const match = text.match(/\d+/);
  return match ? match[0] : null;
}
