import { createHash } from "node:crypto";

export function reviewContentDigest(content: Record<string, unknown>) {
  const editorial = Object.fromEntries(
    Object.entries(content)
      .filter(([key]) => key !== "audioPath" && key !== "privateAudio")
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash("sha256").update(JSON.stringify(editorial)).digest("hex");
}

/** First release accepts bounded PCM WAV only. No decoder subprocess or MIME trust. */
export function inspectMaterialWav(input: Uint8Array) {
  const bytes = Buffer.from(input);
  function invalid(): never {
    throw new Error(
      "材料音频必须是完整、可解码且不超过 120 秒／8 MiB 的 PCM WAV。",
    );
  }
  if (
    bytes.length < 44 ||
    bytes.length > 8 * 1024 * 1024 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE" ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  )
    invalid();
  let rate = 0;
  let alignment = 0;
  let payload = 0;
  let format = false;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const name = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > bytes.length) invalid();
    if (name === "fmt ") {
      if (format || size < 16 || bytes.readUInt16LE(start) !== 1) invalid();
      const channels = bytes.readUInt16LE(start + 2);
      rate = bytes.readUInt32LE(start + 4);
      alignment = bytes.readUInt16LE(start + 12);
      const bits = bytes.readUInt16LE(start + 14);
      if (
        ![1, 2].includes(channels) ||
        ![8, 16, 24, 32].includes(bits) ||
        rate < 8000 ||
        rate > 48000 ||
        alignment !== (channels * bits) / 8 ||
        bytes.readUInt32LE(start + 8) !== rate * alignment
      )
        invalid();
      format = true;
    }
    if (name === "data") {
      if (payload || !size) invalid();
      payload = size;
    }
    offset = start + size + (size % 2);
  }
  if (
    offset !== bytes.length ||
    !format ||
    !payload ||
    payload % alignment ||
    payload / alignment / rate > 120
  )
    invalid();
  return {
    digest: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.length,
    mediaType: "audio/wav" as const,
    durationSeconds: payload / alignment / rate,
  };
}
