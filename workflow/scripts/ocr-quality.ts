/** Pure OCR quality metrics used by the local regression benchmark. */

export type OcrQuality = {
  characterErrors: number;
  wordErrors: number;
  cer: number;
  wer: number;
  referenceCharacters: number;
  referenceWords: number;
};

export type QualityThreshold = { maxCer: number; maxWer: number };

/** Normalizes Unicode and whitespace while keeping punctuation, numbers, and Vietnamese marks significant. */
export function normalizeOcrText(text: string): string {
  return text.normalize("NFC").replace(/\s+/gu, " ").trim();
}

export function tokenizeOcrWords(text: string): string[] {
  const normalized = normalizeOcrText(text);
  return normalized ? normalized.split(" ") : [];
}

/** Levenshtein edit distance, with O(min(a,b)) memory. */
export function editDistance<T>(left: readonly T[], right: readonly T[]): number {
  if (left.length < right.length) return editDistance(right, left);
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      const substitution = previous[rightIndex - 1] + Number(left[leftIndex - 1] !== right[rightIndex - 1]);
      current[rightIndex] = Math.min(previous[rightIndex] + 1, current[rightIndex - 1] + 1, substitution);
    }
    previous = current;
  }
  return previous[right.length];
}

export function measureOcrQuality(expected: string, actual: string): OcrQuality {
  const reference = Array.from(normalizeOcrText(expected));
  const result = Array.from(normalizeOcrText(actual));
  const referenceWords = tokenizeOcrWords(expected);
  const resultWords = tokenizeOcrWords(actual);
  const characterErrors = editDistance(reference, result);
  const wordErrors = editDistance(referenceWords, resultWords);
  return {
    characterErrors,
    wordErrors,
    cer: reference.length === 0 ? Number(result.length > 0) : characterErrors / reference.length,
    wer: referenceWords.length === 0 ? Number(resultWords.length > 0) : wordErrors / referenceWords.length,
    referenceCharacters: reference.length,
    referenceWords: referenceWords.length,
  };
}

export function meetsQualityThreshold(quality: OcrQuality, threshold: QualityThreshold): boolean {
  return quality.cer <= threshold.maxCer && quality.wer <= threshold.maxWer;
}

/** Candidate may not worsen either metric beyond the explicit tolerance. */
export function isRegression(baseline: OcrQuality, candidate: OcrQuality, tolerance: Partial<QualityThreshold> = {}): boolean {
  return candidate.cer > baseline.cer + (tolerance.maxCer ?? 0)
    || candidate.wer > baseline.wer + (tolerance.maxWer ?? 0);
}


