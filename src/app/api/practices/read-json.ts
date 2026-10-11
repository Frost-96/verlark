import { PracticeError } from "../../../modules/practice/contracts";

// Keep transport limits here; each request entry retains its own command schema.
export async function readBoundedJSON(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new PracticeError("invalid");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new PracticeError("invalid");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new PracticeError("invalid");
  }
}
