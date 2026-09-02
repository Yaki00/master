/** Extraction texte depuis un fichier CV (.txt, .md, .pdf basique). */

export function extractCvText(buffer: Buffer, fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return extractPdfText(buffer);
  return buffer.toString("utf8").replace(/\u0000/g, "").trim();
}

/** Extraction heuristique sans dépendance externe (PDF texte natif). */
function extractPdfText(buffer: Buffer): string {
  const raw = buffer.toString("latin1");
  const chunks: string[] = [];

  const parenMatches = raw.match(/\(([^\\()]{2,200})\)/g) ?? [];
  for (const m of parenMatches) {
    const inner = m.slice(1, -1);
    if (/^[\x00-\x1f]+$/.test(inner)) continue;
    const decoded = inner
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .trim();
    if (decoded.length > 1 && /[a-zA-ZÀ-ÿ0-9]/.test(decoded)) chunks.push(decoded);
  }

  const streamMatches = raw.match(/stream[\r\n]+([\s\S]*?)endstream/g) ?? [];
  for (const block of streamMatches) {
    const inner = block.replace(/^stream[\r\n]+/, "").replace(/endstream$/, "");
    const readable = inner.replace(/[^\x20-\x7EÀ-ÿ\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
    if (readable.length > 20 && /[a-zA-Z]{3,}/.test(readable)) chunks.push(readable);
  }

  const text = [...new Set(chunks)].join("\n").trim();
  if (text.length < 40) {
    throw new Error(
      "PDF peu lisible — exportez en .txt/.md ou collez le contenu dans le champ CV",
    );
  }
  return text;
}

export function cvTextToMarkdown(text: string, fileName: string): string {
  const cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.startsWith("#")) return cleaned;
  return `# CV importé (${fileName})\n\n${cleaned}`;
}
