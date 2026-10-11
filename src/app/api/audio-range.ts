/** Single byte range policy shared by authenticated audio endpoints. Null means 416. */
export function singleAudioRange(
  value: string,
  size: number,
  maxBytes = 1024 * 1024,
): { start: number; end: number } | null {
  if (value.length > 80 || !Number.isSafeInteger(size) || size <= 0)
    return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (
    !match ||
    (!match[1] && !match[2]) ||
    !match
      .slice(1)
      .filter(Boolean)
      .every((part) => Number.isSafeInteger(Number(part)))
  )
    return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    const count = Number(match[2]);
    if (count <= 0 || count > maxBytes) return null;
    start = Math.max(0, size - count);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2]
      ? Math.min(Number(match[2]), size - 1)
      : Math.min(start + maxBytes - 1, size - 1);
  }
  return start >= size || end < start || end - start + 1 > maxBytes
    ? null
    : { start, end };
}
