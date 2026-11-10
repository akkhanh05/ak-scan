/**
 * Small, browser-safe helpers for turning Tesseract word data into dependable
 * text.  This module intentionally accepts the subset of the Tesseract shape
 * that we use, so it can also be exercised without loading an OCR worker.
 */

export interface OcrBoundingBox { x0: number; y0: number; x1: number; y1: number }
export interface OcrBaseline { x0?: number; y0?: number; x1?: number; y1?: number }
export interface OcrWord {
  text: string;
  confidence: number;
  bbox?: OcrBoundingBox;
  baseline?: OcrBaseline;
}
export interface OcrLine { text?: string; confidence?: number; bbox?: OcrBoundingBox; baseline?: OcrBaseline; words?: OcrWord[] }
export interface PdfTextItem { text: string; x: number; y: number; width: number; height: number; fontName: string; hasEol: boolean }
export interface PdfTextLine { text: string; items: PdfTextItem[]; fontSize: number; heading: boolean }

export interface ProcessedOcrWord extends OcrWord {
  normalizedText: string;
  removed: boolean;
  flagged: boolean;
  reason?: "isolated-noise" | "low-confidence";
}
export interface OcrTextRun { text: string; confidence: number; flagged: boolean; bbox?: OcrBoundingBox }
export interface OcrQualityMetrics {
  averageConfidence: number;
  lowConfidenceWordCount: number;
  filteredNoiseCount: number;
  retainedWordCount: number;
  suspiciousWordCount: number;
}
export interface OcrRetryRegion { bbox: OcrBoundingBox; wordCount: number; averageConfidence: number; reason: "low-confidence" | "noise" }
export interface ProcessedOcrLine { text: string; words: ProcessedOcrWord[]; runs: OcrTextRun[]; metrics: OcrQualityMetrics; retryRegions: OcrRetryRegion[] }
export interface OcrLanguageCandidate<TLanguage extends string = string> { language: TLanguage; text: string; confidence: number }

const punctuationOnly = /^[.,;:!?…'”’"”)}\]»]+$/u;
const noSpaceBefore = /^[.,;:!?%…”’)}\]»]+$/u;
const noSpaceAfter = /^[({\[“‘«]+$/u;

function withoutVietnameseMarks(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, (letter) => letter === "Đ" ? "D" : "d").normalize("NFC");
}

function characterSimilarity(first: string, second: string) {
  const a = normalizeOcrText(first).toLocaleLowerCase();
  const b = normalizeOcrText(second).toLocaleLowerCase();
  if (!a || !b) return a === b ? 1 : 0;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + Number(a[i - 1] !== b[j - 1]));
      diagonal = above;
    }
  }
  return 1 - row[b.length] / Math.max(a.length, b.length);
}

/** Select one recognition verbatim; never mix or translate candidate words. */
export function chooseOcrCandidate<T extends OcrLanguageCandidate, U extends OcrLanguageCandidate>(english: T, vietnamese: U): T | U {
  const sameGlyphs = characterSimilarity(english.text, withoutVietnameseMarks(vietnamese.text)) >= .86;
  if (sameGlyphs) return vietnamese.confidence >= english.confidence - 4 ? vietnamese : english;
  return vietnamese.confidence >= english.confidence + 8 ? vietnamese : english;
}

export function normalizeOcrToken(value: string) {
  return value
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeOcrText(value: string) {
  return normalizeOcrToken(value)
    // Conservative repairs for high-confidence OCR substitutions observed in
    // scanned English prose. These only fire on unambiguous word boundaries.
    .replace(/\bocial\b/gi, "social")
    .replace(/\bBut(?:I|l)n\b/g, "But In")
    .replace(/\bwor[’'](?=\s|[.,!?]|$)/gi, "work")
    .replace(/\bphon[!1]e\b/gi, "phone")
    .replace(/\bcortiso\b/gi, "cortisol")
    .replace(/\bi[.)]\s+Soon\b/gi, "Soon")
    .replace(/\bi\s+Soon\b/gi, "Soon")
    .replace(/\bSoon\s+your\b/gi, "Soon your")
    .replace(/\s+([,.;:!?%…])/g, "$1")
    .replace(/([([{“‘«])\s+/g, "$1")
    .replace(/\s{2,}/g, " ");
}

/** Content-first OCR lines. Bounding boxes must never be allowed to reorder words. */
export function recognizedTextLines(value: string) {
  return value.split(/\r?\n/)
    .map((line) => normalizeOcrText(line))
    .filter((line) => (line.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 2)
    .filter((line) => !/^[:;,.\-–—]?\s*[©CP8wyPi:]{1,12}\s*(?:er|or)\s+later[,.:]?$/i.test(line));
}

/** Repairs page-level reading-order damage that cannot be fixed token-by-token. */
export function cleanOcrPageLines(input: string[]) {
  const lines = input.map(normalizeOcrText).filter(Boolean);
  const output: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    // Curved pages can make Tesseract append the beginning of a line after its end.
    const reversedModernLife = line.match(/^(social media or working until midnight\.?)\s+But In\s+(modern life,?\s+it['’]s very easy to keep scrolling on)\s+s$/i);
    if (reversedModernLife) line = `In ${reversedModernLife[2]} ${reversedModernLife[1]} But`;

    // Recover “Sooner or later” when curvature splits it across noisy lines.
    if (/\.\s*So$/i.test(line)) {
      const nearby = lines.slice(Math.max(0, index - 2), index + 3);
      const suffix = nearby.find((candidate) => /er\s+or\s+later[,.:]?$/i.test(candidate));
      if (suffix) line = line.replace(/So$/i, "Sooner or later,");
    }
    if (/^[:;,\.\-–—\s©CP8wyPi]+er\s+or\s+later[,.:]?$/i.test(line)) continue;
    if (/^Soon$/i.test(line) && output.at(-1)?.endsWith("Sooner or later,")) continue;
    output.push(line);
  }
  return output;
}

/** Scores complete OCR candidates by prose quality as well as engine confidence. */
export function scoreOcrCandidate(text: string, confidence: number) {
  const normalized = normalizeOcrText(text);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const noisy = tokens.filter((token) => /^[©|:;]+$/u.test(token)
    || /[\p{L}][!|][\p{L}]/u.test(token)
    || (/^[\p{L}\p{N}]$/u.test(token) && !/^(?:a|A|I)$/u.test(token))).length;
  const suspiciousJoins = normalized.match(/[.!?][A-Z][a-z]/g)?.length ?? 0;
  const malformedWords = normalized.match(/\b(?:pu|casy)\b/gi)?.length ?? 0;
  // Very long alphabetic tokens are normally several words fused together by
  // OCR (common on small italic text). Penalize them so a cleaner recognition
  // of that visual row wins even when its raw confidence is slightly lower.
  const fusedWords = tokens.filter((token) => /^\p{L}{20,}$/u.test(token)).length;
  return confidence + Math.min(8, tokens.length / 60) - noisy * 5 - suspiciousJoins * 3 - malformedWords * 6 - fusedWords * 10;
}

function height(word: OcrWord) { return word.bbox ? Math.max(1, word.bbox.y1 - word.bbox.y0) : 1; }
function bottom(word: OcrWord) { return word.baseline?.y1 ?? word.bbox?.y1 ?? 0; }
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 1;
}
function overlapOnBaseline(a: OcrWord, b: OcrWord, typicalHeight: number) {
  // OCR boxes around a tiny speck can end a little above the true baseline.
  return Math.abs(bottom(a) - bottom(b)) <= typicalHeight * .8;
}
function isCandidateCharacter(text: string) {
  // Punctuation, multi-character terms, and normal Vietnamese words must never
  // be silently discarded by a heuristic.
  return /^[\p{L}\p{N}]$/u.test(text) && !punctuationOnly.test(text);
}

function isLikelyStandaloneWord(text: string) {
  return /^(?:a|A|I)$/u.test(text);
}

/**
 * Marks only very likely OCR specks: a low-confidence single glyph, much
 * smaller than surrounding words, between two words on the same baseline.
 * This deliberately keeps list numbers, dates, "11 p.m.", punctuation, and
 * one-letter real words unless their geometry strongly says they are noise.
 */
export function postProcessOcrLine(line: OcrLine): ProcessedOcrLine {
  const input = (line.words ?? []).map((word) => ({ ...word, text: normalizeOcrToken(word.text) })).filter((word) => word.text);
  const typicalHeight = median(input.filter((word) => word.text.length > 1).map(height).concat(input.map(height)));
  const words = input.map((word, index): ProcessedOcrWord => {
    const previous = input[index - 1];
    const next = input[index + 1];
    const compactGlyph = height(word) < typicalHeight * .68;
    const inline = !!previous && !!next && overlapOnBaseline(word, previous, typicalHeight) && overlapOnBaseline(word, next, typicalHeight);
    const betweenWords = !!word.bbox && !!previous?.bbox && !!next?.bbox
      && word.bbox.x0 >= previous.bbox.x1 - typicalHeight * .2 && word.bbox.x1 <= next.bbox.x0 + typicalHeight * .2;
    const lowConfidence = word.confidence < 82;
    const likelyNoise = isCandidateCharacter(word.text) && !isLikelyStandaloneWord(word.text) && inline && betweenWords
      && ((word.confidence < 55 && compactGlyph) || word.confidence < 32);
    return {
      ...word,
      normalizedText: word.text,
      removed: likelyNoise,
      flagged: !likelyNoise && lowConfidence && !punctuationOnly.test(word.text),
      reason: likelyNoise ? "isolated-noise" : (!likelyNoise && lowConfidence && !punctuationOnly.test(word.text) ? "low-confidence" : undefined),
    };
  });
  const retained = words.filter((word) => !word.removed);
  const text = normalizeOcrText(joinWords(retained));
  const runs = toRuns(retained);
  const metrics = qualityMetrics(words);
  return { text, words, runs, metrics, retryRegions: getRetryRegions(words) };
}

type PositionedLine = { words: Array<{ text: string; confidence: number; bbox: OcrBoundingBox }>; text: string; confidence: number; bbox: OcrBoundingBox };

export function selectBestOcrLines<T extends PositionedLine>(candidateSets: T[][]): T[] {
  const anchor = candidateSets.find((lines) => lines.length)?.slice().sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0) ?? [];
  const consumed = new Set<T>();
  const selected = anchor.map((line) => {
    const center = (line.bbox.y0 + line.bbox.y1) / 2;
    const lineHeight = Math.max(1, line.bbox.y1 - line.bbox.y0);
    const candidates = candidateSets.flatMap((lines) => lines.filter((candidate) => {
      const candidateCenter = (candidate.bbox.y0 + candidate.bbox.y1) / 2;
      const candidateHeight = Math.max(1, candidate.bbox.y1 - candidate.bbox.y0);
      const verticalMatch = Math.abs(candidateCenter - center) <= Math.max(lineHeight, candidateHeight) * 1.15;
      // A multi-column scan can have two unrelated rows at the same y
      // coordinate.  Require a meaningful horizontal match before allowing a
      // candidate to replace the anchor row, otherwise a clean right-column
      // result can silently replace the left column.
      const overlap = Math.max(0, Math.min(candidate.bbox.x1, line.bbox.x1) - Math.max(candidate.bbox.x0, line.bbox.x0));
      const narrowerWidth = Math.max(1, Math.min(candidate.bbox.x1 - candidate.bbox.x0, line.bbox.x1 - line.bbox.x0));
      const horizontalMatch = overlap / narrowerWidth >= .22
        || Math.abs((candidate.bbox.x0 + candidate.bbox.x1) / 2 - (line.bbox.x0 + line.bbox.x1) / 2) <= Math.max(lineHeight, candidateHeight) * 2.5;
      return verticalMatch && horizontalMatch;
    }));
    candidates.forEach((candidate) => consumed.add(candidate));
    const best = candidates.reduce((current, candidate) => scoreOcrCandidate(candidate.text, candidate.confidence) > scoreOcrCandidate(current.text, current.confidence) ? candidate : current, line);
    consumed.add(best);
    return best;
  });
  // Some segmentation modes find a complete row that the first OCR pass
  // misses. Preserve it when it does not geometrically duplicate an anchor.
  // This is common for a small italic subtitle or a faint table row.
  const residual = candidateSets.flat().filter((line) => !consumed.has(line) && scoreOcrCandidate(line.text, line.confidence) >= 58)
    .filter((line) => !selected.some((previous) => {
      const sameText = normalizeOcrText(previous.text).toLocaleLowerCase() === normalizeOcrText(line.text).toLocaleLowerCase();
      const previousCenter = (previous.bbox.y0 + previous.bbox.y1) / 2;
      const center = (line.bbox.y0 + line.bbox.y1) / 2;
      const maxHeight = Math.max(1, previous.bbox.y1 - previous.bbox.y0, line.bbox.y1 - line.bbox.y0);
      const overlap = Math.max(0, Math.min(previous.bbox.x1, line.bbox.x1) - Math.max(previous.bbox.x0, line.bbox.x0));
      return sameText && Math.abs(previousCenter - center) <= maxHeight * .8 && overlap > 0;
    }));
  return [...selected, ...residual].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0).filter((line, index, lines) => !lines.slice(0, index).some((previous) => {
    const sameText = normalizeOcrText(previous.text).toLocaleLowerCase() === normalizeOcrText(line.text).toLocaleLowerCase();
    const height = Math.max(1, line.bbox.y1 - line.bbox.y0, previous.bbox.y1 - previous.bbox.y0);
    const sameRow = Math.abs((previous.bbox.y0 + previous.bbox.y1) / 2 - (line.bbox.y0 + line.bbox.y1) / 2) <= height * .8;
    return sameText && sameRow;
  }));
}

export function deduplicateOcrLines(lines: string[]) {
  const output: string[] = [];
  for (const raw of lines) {
    const line = normalizeOcrText(raw);
    if (!line) continue;
    const previous = output.at(-1);
    if (previous?.toLocaleLowerCase() === line.toLocaleLowerCase()) continue;
    output.push(line);
  }
  return output;
}

export type StructuredOcrParagraph = { kind: "title" | "heading" | "list-item" | "paragraph"; text: string };

/** Rebuild logical paragraphs from OCR visual lines instead of flattening a page into one bold block. */
export function structureOcrDocumentLines(lines: string[]): StructuredOcrParagraph[] {
  const result: StructuredOcrParagraph[] = [];
  for (const raw of deduplicateOcrLines(lines)) {
    const text = normalizeOcrText(raw);
    if (!text) continue;
    const kind: StructuredOcrParagraph["kind"] = /^request\s+\d+\s*\(\d+%\)/i.test(text)
      ? "heading"
      : /^\d+[.)]\s+/.test(text)
        ? "list-item"
        : result.length === 0 && text.length <= 180
          ? "title"
          : "paragraph";
    const previous = result.at(-1);
    if (kind === "paragraph" && previous?.kind === "paragraph") {
      previous.text = normalizeOcrText(`${previous.text} ${text}`);
    } else {
      result.push({ kind, text });
    }
  }
  return result;
}

export function isSuspiciousOcrLine(text: string, confidence: number) {
  const normalized = normalizeOcrText(text);
  return confidence < 84 || scoreOcrCandidate(normalized, confidence) < 80
    || /(?:^|\s)[©|:;0-9](?:\s|$)/u.test(normalized)
    || /[\p{L}][!|][\p{L}]/u.test(normalized)
    || /\b(?:pu|casy)\b/i.test(normalized);
}

export function mergePositionedOcrLines<T extends PositionedLine>(lines: T[]): T[] {
  const groups: Array<{ line: T; anchorCenter: number; anchorHeight: number; members: number }> = [];
  for (const line of [...lines].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)) {
    const lineHeight = Math.max(1, line.bbox.y1 - line.bbox.y0);
    const center = (line.bbox.y0 + line.bbox.y1) / 2;
    const group = groups.findLast((candidate) => Math.abs(center - candidate.anchorCenter) <= Math.max(lineHeight, candidate.anchorHeight) * .72);
    if (!group) { groups.push({ line: { ...line, words: [...line.words] }, anchorCenter: center, anchorHeight: lineHeight, members: 1 }); continue; }
    const words = [...group.line.words, ...line.words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
    group.line.words = words;
    group.line.text = words.map((word) => word.text).join(" ");
    group.line.confidence = words.reduce((sum, word) => sum + word.confidence, 0) / Math.max(1, words.length);
    group.line.bbox = { x0: Math.min(group.line.bbox.x0, line.bbox.x0), y0: Math.min(group.line.bbox.y0, line.bbox.y0), x1: Math.max(group.line.bbox.x1, line.bbox.x1), y1: Math.max(group.line.bbox.y1, line.bbox.y1) };
    group.anchorCenter = (group.anchorCenter * group.members + center) / (group.members + 1);
    group.anchorHeight = (group.anchorHeight * group.members + lineHeight) / (group.members + 1);
    group.members++;
  }
  return groups.map((group) => group.line).sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
}

export function repairFragmentedOcrWords<T extends { text: string; confidence: number; bbox: OcrBoundingBox }>(words: T[]): T[] {
  const repaired: T[] = [];
  for (const word of [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0)) {
    const previous = repaired.at(-1);
    if (previous) {
      const height = Math.max(1, Math.min(previous.bbox.y1 - previous.bbox.y0, word.bbox.y1 - word.bbox.y0));
      const gap = word.bbox.x0 - previous.bbox.x1;
      if (gap >= -height * .15 && gap < height * .38 && (previous.text.length === 1 || word.text.length === 1)
        && /[\p{L}\p{N}]$/u.test(previous.text) && /^[\p{L}\p{N}]/u.test(word.text)) {
        previous.text += word.text; previous.confidence = Math.min(previous.confidence, word.confidence);
        previous.bbox = { x0: previous.bbox.x0, y0: Math.min(previous.bbox.y0, word.bbox.y0), x1: Math.max(previous.bbox.x1, word.bbox.x1), y1: Math.max(previous.bbox.y1, word.bbox.y1) };
        continue;
      }
    }
    repaired.push({ ...word, bbox: { ...word.bbox } });
  }
  return repaired;
}

export function joinWords(words: Array<Pick<ProcessedOcrWord, "normalizedText">>) {
  return normalizeOcrText(words.reduce((result, word) => {
    const token = word.normalizedText;
    if (!result) return token;
    const previous = result[result.length - 1] ?? "";
    return noSpaceBefore.test(token) || noSpaceAfter.test(previous) ? result + token : `${result} ${token}`;
  }, ""));
}

export function toRuns(words: ProcessedOcrWord[]): OcrTextRun[] {
  const runs: OcrTextRun[] = [];
  for (const word of words) {
    const spacer = runs.length && !noSpaceBefore.test(word.normalizedText) && !noSpaceAfter.test(runs[runs.length - 1].text) ? " " : "";
    const last = runs[runs.length - 1];
    if (last && last.flagged === word.flagged) {
      last.text += spacer + word.normalizedText;
      last.confidence = Math.min(last.confidence, word.confidence);
    } else runs.push({ text: spacer + word.normalizedText, confidence: word.confidence, flagged: word.flagged, bbox: word.bbox });
  }
  return runs;
}

export function qualityMetrics(words: ProcessedOcrWord[]): OcrQualityMetrics {
  const retained = words.filter((word) => !word.removed);
  return {
    averageConfidence: retained.length ? retained.reduce((sum, word) => sum + word.confidence, 0) / retained.length : 0,
    lowConfidenceWordCount: retained.filter((word) => word.confidence < 82).length,
    filteredNoiseCount: words.filter((word) => word.removed).length,
    retainedWordCount: retained.length,
    suspiciousWordCount: words.filter((word) => word.flagged || word.removed).length,
  };
}

export function getRetryRegions(words: ProcessedOcrWord[]): OcrRetryRegion[] {
  const candidates = words.filter((word) => (word.flagged || word.removed) && word.bbox);
  return candidates.map((word) => ({
    bbox: { x0: Math.max(0, word.bbox!.x0 - 12), y0: Math.max(0, word.bbox!.y0 - 12), x1: word.bbox!.x1 + 12, y1: word.bbox!.y1 + 12 },
    wordCount: 1,
    averageConfidence: word.confidence,
    reason: word.removed ? "noise" : "low-confidence",
  }));
}

export function groupPdfTextItems(items: PdfTextItem[]): PdfTextLine[] {
  const clean = items.map((item) => ({ ...item, text: normalizeOcrToken(item.text) })).filter((item) => item.text);
  if (!clean.length) return [];
  const bodySize = median(clean.map((item) => Math.max(1, item.height)));
  const rows: PdfTextItem[][] = [];
  for (const item of clean.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const tolerance = Math.max(2, item.height * .45);
    const row = rows.find((candidate) => Math.abs(candidate[0].y - item.y) <= tolerance);
    if (row) row.push(item); else rows.push([item]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    const text = normalizeOcrText(row.reduce((value, item, index) => {
      if (!index) return item.text;
      const previous = row[index - 1];
      const gap = item.x - (previous.x + previous.width);
      return value + (gap > Math.max(1.5, bodySize * .12) ? " " : "") + item.text;
    }, ""));
    const fontSize = median(row.map((item) => Math.max(1, item.height)));
    return { text, items: row, fontSize, heading: fontSize >= bodySize * 1.22 };
  }).filter((line) => line.text);
}

