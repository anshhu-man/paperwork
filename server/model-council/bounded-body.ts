interface ReadableBodyV1 {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly headers: Headers;
}
/** Reads a UTF-8 body without ever buffering beyond the declared application cap. */
export async function readUtf8BodyWithinLimitV1(
  input: ReadableBodyV1,
  maximumBytes: number,
): Promise<string | undefined> {
  const declared = input.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maximumBytes) return undefined;
  if (!input.body) return '';

  const reader = input.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel('body_limit_exceeded');
        return undefined;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}
