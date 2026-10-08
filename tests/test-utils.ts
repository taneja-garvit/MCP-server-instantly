export function parseMcpResponse(rawText: string): any {
  if (!rawText) return {};
  const lines = rawText.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        return JSON.parse(line.slice(6));
      } catch {
        // continue
      }
    }
  }
  try {
    return JSON.parse(rawText);
  } catch {
    return { raw: rawText };
  }
}
