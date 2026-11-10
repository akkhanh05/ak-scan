/**
 * Browser-safe helpers that turn Tesseract word/line data into dependable text.
 *
 * Integrity rules (see 05-IMAGE-OCR-PIPELINE.md):
 *  - Never rewrite recognised words with dictionary or sample-specific rules.
 *  - Never delete digits; uncertain numbers are flagged for review instead.
 *  - Only remove an identical line when it also occupies the same position.
 *
 * The module accepts the subset of the Tesseract result shape that we use so it
 * can be exercised in Node without loading an OCR worker.
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
export interface ProcessedOcrLine { text: string; words: ProcessedOcrWord[]; runs: OcrTextRun[]; metrics: OcrQualityMetrics }

/** A recognised visual line with its position on the rendered page. */
export interface PositionedOcrLine {
  text: string;
  confidence: number;
  bbox: OcrBoundingBox;
  words: Array<{ text: string; confidence: number; bbox: OcrBoundingBox }>;
  /** Tesseract block/paragraph identity from the pass that produced the line. */
  paragraphKey?: string;
}

export const LOW_CONFIDENCE = 82;

const punctuationOnly = /^[.,;:!?…'"”’)}\]»]+$/u;
const noSpaceBefore = /^[.,;:!?%…”’)}\]»]+$/u;
const noSpaceAfter = /^[({\[“‘«]+$/u;
const symbolNoise = /^[©®|¦~^`_¬¤]+$/u;

/**
 * One-letter tokens that are real words. Vietnamese has many (à, á, ở, ý, ủ, ư…),
 * and every vowel with or without a tone mark can stand alone, so all vowels are
 * accepted. Uppercase letters are kept as initials/labels and digits are content.
 */
const vowelWord = /^[aàáảãạăằắẳẵặâầấẩẫậeèéẻẽẹêềếểễệiìíỉĩịoòóỏõọôồốổỗộơờớởỡợuùúủũụưừứửữựyỳýỷỹỵ]$/u;

export function isLegitimateSingleCharacter(token: string, previous?: string) {
  if (!/^[\p{L}\p{N}]$/u.test(token)) return false;
  if (/^\p{N}$/u.test(token)) return true;
  if (/^\p{Lu}$/u.test(token)) return true;
  if (vowelWord.test(token)) return true;
  // Units after numbers: "5 m", "10 g", "2 l".
  return Boolean(previous && /\p{N}$/u.test(previous));
}

export function normalizeOcrToken(value: string) {
  return value
    .normalize("NFC")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whitespace and punctuation spacing only. Words are never substituted. */
export function normalizeOcrText(value: string) {
  return normalizeOcrToken(value)
    .replace(/\s+([,.;:!?%…])(?=\s|$)/g, "$1")
    .replace(/([([{“‘«])\s+/g, "$1")
    .replace(/\s{2,}/g, " ");
}

/** Content-first OCR lines in Tesseract's reading order. */
export function recognizedTextLines(value: string) {
  return value.split(/\r?\n/)
    .map((line) => normalizeOcrText(line))
    .filter((line) => /[\p{L}\p{N}]/u.test(line));
}

function isNoiseToken(token: string, previous?: string) {
  if (symbolNoise.test(token)) return true;
  if (/[\p{L}][!|¦][\p{L}]/u.test(token)) return true;
  if (/^[\p{L}\p{N}]$/u.test(token)) return !isLegitimateSingleCharacter(token, previous);
  return false;
}

/** Scores a recognition by engine confidence and language-neutral noise evidence. */
export function scoreOcrCandidate(text: string, confidence: number) {
  const normalized = normalizeOcrText(text);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const noisy = tokens.filter((token, index) => isNoiseToken(token, tokens[index - 1])).length;
  // "end.Next" — a sentence boundary without the space OCR normally keeps.
  const suspiciousJoins = normalized.match(/[.!?][\p{Lu}][\p{Ll}]/gu)?.length ?? 0;
  // Very long alphabetic tokens are usually several words fused together.
  const fusedWords = tokens.filter((token) => /^\p{L}{20,}$/u.test(token)).length;
  return confidence + Math.min(8, tokens.length / 60) - noisy * 5 - suspiciousJoins * 3 - fusedWords * 10;
}

export function isSuspiciousOcrLine(text: string, confidence: number) {
  const normalized = normalizeOcrText(text);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return confidence < 84 || scoreOcrCandidate(normalized, confidence) < 80
    || tokens.some((token, index) => isNoiseToken(token, tokens[index - 1]));
}

function height(word: OcrWord) { return word.bbox ? Math.max(1, word.bbox.y1 - word.bbox.y0) : 1; }
function bottom(word: OcrWord) { return word.baseline?.y1 ?? word.bbox?.y1 ?? 0; }
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 1;
}
function overlapOnBaseline(a: OcrWord, b: OcrWord, typicalHeight: number) {
  return Math.abs(bottom(a) - bottom(b)) <= typicalHeight * .8;
}

/**
 * Removes only very likely OCR specks: a low-confidence single letter that is
 * not a real one-letter word, much smaller than its neighbours and sitting
 * between two words on the same baseline. Digits are never removed; a
 * low-confidence digit is flagged so the user can confirm it.
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
    const singleLetter = /^\p{L}$/u.test(word.text) && !isLegitimateSingleCharacter(word.text, previous?.text);
    const removable = (singleLetter || symbolNoise.test(word.text)) && inline && betweenWords
      && ((word.confidence < 55 && compactGlyph) || word.confidence < 32);
    const lowConfidence = word.confidence < LOW_CONFIDENCE && !punctuationOnly.test(word.text);
    return {
      ...word,
      normalizedText: word.text,
      removed: removable,
      flagged: !removable && lowConfidence,
      reason: removable ? "isolated-noise" : lowConfidence ? "low-confidence" : undefined,
    };
  });
  const retained = words.filter((word) => !word.removed);
  return { text: normalizeOcrText(joinWords(retained)), words, runs: toRuns(retained), metrics: qualityMetrics(words) };
}

function verticalCenter(box: OcrBoundingBox) { return (box.y0 + box.y1) / 2; }
function boxHeight(box: OcrBoundingBox) { return Math.max(1, box.y1 - box.y0); }
function horizontalOverlap(a: OcrBoundingBox, b: OcrBoundingBox) {
  return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
}

/** True when two boxes describe the same visual row region. */
export function sameLineRegion(a: OcrBoundingBox, b: OcrBoundingBox) {
  const maxHeight = Math.max(boxHeight(a), boxHeight(b));
  const narrower = Math.max(1, Math.min(a.x1 - a.x0, b.x1 - b.x0));
  return Math.abs(verticalCenter(a) - verticalCenter(b)) <= maxHeight * .6 && horizontalOverlap(a, b) / narrower >= .5;
}

/**
 * Chooses, for each visual line, the best recognition across several passes.
 * The first non-empty pass is the anchor and its order is kept: Tesseract's
 * layout analysis already orders columns, so a global y/x sort would interleave
 * the rows of side-by-side columns.
 */
export function selectBestOcrLines<T extends PositionedOcrLine>(candidateSets: T[][]): T[] {
  const anchor = candidateSets.find((lines) => lines.length) ?? [];
  const consumed = new Set<T>();
  const selected = anchor.map((line) => {
    const lineHeight = boxHeight(line.bbox);
    const center = verticalCenter(line.bbox);
    const candidates = candidateSets.flatMap((lines) => lines.filter((candidate) => {
      // Must be the same visual row: Vietnamese diacritics make line boxes tall,
      // so a loose tolerance would match the next line and let it replace this
      // one (the line would then be lost). Require most of the rows to overlap.
      const overlapY = Math.min(candidate.bbox.y1, line.bbox.y1) - Math.max(candidate.bbox.y0, line.bbox.y0);
      const verticalMatch = overlapY >= Math.min(lineHeight, boxHeight(candidate.bbox)) * .6
        && Math.abs(verticalCenter(candidate.bbox) - center) <= Math.min(lineHeight, boxHeight(candidate.bbox)) * .5;
      // Two unrelated rows can share a y coordinate in multi-column pages.
      const narrowerWidth = Math.max(1, Math.min(candidate.bbox.x1 - candidate.bbox.x0, line.bbox.x1 - line.bbox.x0));
      const horizontalMatch = horizontalOverlap(candidate.bbox, line.bbox) / narrowerWidth >= .22
        || Math.abs((candidate.bbox.x0 + candidate.bbox.x1) / 2 - (line.bbox.x0 + line.bbox.x1) / 2) <= Math.max(lineHeight, boxHeight(candidate.bbox)) * 2.5;
      return verticalMatch && horizontalMatch;
    }));
    candidates.forEach((candidate) => consumed.add(candidate));
    const best = candidates.reduce((current, candidate) => scoreOcrCandidate(candidate.text, candidate.confidence) > scoreOcrCandidate(current.text, current.confidence) ? candidate : current, line);
    // The anchor pass owns the paragraph structure; the chosen text inherits it.
    return best === line ? line : { ...best, paragraphKey: line.paragraphKey };
  });

  // Alternate passes sometimes find a complete row the anchor missed (faint
  // italic subtitle, light table row). Insert it after the anchor line above it
  // in the same column so the reading order stays intact.
  const output = [...selected];
  const residual = candidateSets.flat().filter((line) => !consumed.has(line) && scoreOcrCandidate(line.text, line.confidence) >= 58);
  for (const line of residual) {
    if (output.some((existing) => sameLineRegion(existing.bbox, line.bbox))) continue;
    let insertAt = output.length;
    let bestDistance = Number.POSITIVE_INFINITY;
    output.forEach((existing, index) => {
      const distance = line.bbox.y0 - existing.bbox.y1;
      const sameColumn = horizontalOverlap(existing.bbox, line.bbox) > 0;
      if (sameColumn && distance >= -boxHeight(line.bbox) * .5 && distance < bestDistance) { bestDistance = distance; insertAt = index + 1; }
    });
    output.splice(insertAt, 0, { ...line, paragraphKey: line.paragraphKey ? `residual:${line.paragraphKey}` : undefined });
  }
  return deduplicatePositionedLines(output);
}

/** Removes a repeated line only when it repeats the same text at the same place. */
export function deduplicatePositionedLines<T extends { text: string; bbox: OcrBoundingBox }>(lines: T[]): T[] {
  const output: T[] = [];
  for (const line of lines) {
    const key = normalizeOcrText(line.text).toLocaleLowerCase();
    if (!key) continue;
    if (output.some((previous) => normalizeOcrText(previous.text).toLocaleLowerCase() === key && sameLineRegion(previous.bbox, line.bbox))) continue;
    output.push(line);
  }
  return output;
}

/** Rejoins a word split into a single letter plus the rest ("s" + "ocial"). */
export function repairFragmentedOcrWords<T extends { text: string; confidence: number; bbox: OcrBoundingBox }>(words: T[]): T[] {
  const repaired: T[] = [];
  for (const word of [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0)) {
    const previous = repaired.at(-1);
    if (previous) {
      const lineHeight = Math.max(1, Math.min(previous.bbox.y1 - previous.bbox.y0, word.bbox.y1 - word.bbox.y0));
      const gap = word.bbox.x0 - previous.bbox.x1;
      const fragment = (previous.text.length === 1 && !isLegitimateSingleCharacter(previous.text)) || (word.text.length === 1 && !isLegitimateSingleCharacter(word.text, previous.text));
      if (gap >= -lineHeight * .15 && gap < lineHeight * .38 && fragment
        && /\p{L}$/u.test(previous.text) && /^\p{L}/u.test(word.text)) {
        previous.text += word.text; previous.confidence = Math.min(previous.confidence, word.confidence);
        previous.bbox = { x0: previous.bbox.x0, y0: Math.min(previous.bbox.y0, word.bbox.y0), x1: Math.max(previous.bbox.x1, word.bbox.x1), y1: Math.max(previous.bbox.y1, word.bbox.y1) };
        continue;
      }
    }
    repaired.push({ ...word, bbox: { ...word.bbox } });
  }
  return repaired;
}

/** Final text for one positioned line after fragment repair and speck filtering. */
export function cleanPositionedLine<T extends PositionedOcrLine>(line: T): T & { flaggedWords: number } {
  if (!line.words.length) return { ...line, text: normalizeOcrText(line.text), flaggedWords: line.confidence < LOW_CONFIDENCE ? 1 : 0 };
  const repaired = repairFragmentedOcrWords(line.words);
  const processed = postProcessOcrLine({ words: repaired });
  return {
    ...line,
    text: processed.text,
    words: processed.words.filter((word) => !word.removed).map((word) => ({ text: word.normalizedText, confidence: word.confidence, bbox: word.bbox! })),
    flaggedWords: processed.words.filter((word) => word.flagged).length,
  };
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
    lowConfidenceWordCount: retained.filter((word) => word.confidence < LOW_CONFIDENCE).length,
    filteredNoiseCount: words.filter((word) => word.removed).length,
    retainedWordCount: retained.length,
    suspiciousWordCount: words.filter((word) => word.flagged || word.removed).length,
  };
}

type TesseractLikeResult = {
  blocks?: Array<{ paragraphs: Array<{ lines: Array<{ text: string; confidence: number; bbox: OcrBoundingBox; words?: Array<{ text: string; confidence: number; bbox: OcrBoundingBox }> }> }> }> | null;
};

/** Flattens a Tesseract result into positioned lines that remember their paragraph. */
export function positionedLinesFromResult(data: TesseractLikeResult, pass: string): PositionedOcrLine[] {
  return (data.blocks ?? []).flatMap((block, blockIndex) => block.paragraphs.flatMap((paragraph, paragraphIndex) => paragraph.lines
    .filter((line) => line.text.trim() && line.bbox)
    .map((line) => ({
      text: normalizeOcrText(line.text),
      confidence: line.confidence,
      bbox: line.bbox,
      paragraphKey: `${pass}:${blockIndex}:${paragraphIndex}`,
      words: (line.words ?? []).filter((word) => word.text?.trim() && word.bbox).map((word) => ({ text: word.text.trim(), confidence: word.confidence, bbox: word.bbox })),
    }))));
}
