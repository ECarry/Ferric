export function decodeTerminalChunk(decoder: TextDecoder, bytes: Uint8Array): string {
  return decoder.decode(bytes, { stream: true })
}
