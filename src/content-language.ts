export interface EnglishEvidence {
  is_english: boolean;
  basis: 'spoken_and_on_screen' | 'spoken' | 'on_screen' | 'insufficient' | 'human_override';
  common_word_ratio: number;
  classification_version: 'english_evidence_v2';
  classification_confidence: number;
  human_override: EnglishEvidenceOverride | null;
}

export interface EnglishEvidenceOverride {
  is_english: boolean;
  reviewed_by: string;
  reviewed_at: string;
  reason: string;
}

const ENGLISH_COMMON_WORDS = new Set([
  'a', 'after', 'all', 'am', 'an', 'and', 'are', 'as', 'at', 'be', 'because', 'but',
  'by', 'can', 'do', 'for', 'from', 'get', 'go', 'have', 'here', 'how', 'i', 'if',
  'in', 'is', 'it', 'just', 'like', 'make', 'me', 'more', 'my', 'no', 'not', 'now',
  'of', 'on', 'one', 'or', 'our', 'out', 'people', 'so', 'some', 'that', 'the',
  'their', 'them', 'then', 'there', 'they', 'this', 'to', 'up', 'was', 'we', 'what',
  'when', 'with', 'will', 'you', 'your',
]);

export function classifyEnglishEvidence(
  spokenText: string,
  onScreenText: string,
  humanOverride: EnglishEvidenceOverride | null = null,
): EnglishEvidence {
  const spoken = cleanEvidenceText(spokenText);
  const onScreen = cleanEvidenceText(onScreenText);
  const combined = `${spoken} ${onScreen}`.trim();
  const tokens = combined.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
  const commonWords = tokens.filter((token) => ENGLISH_COMMON_WORDS.has(token)).length;
  const commonWordRatio = tokens.length ? commonWords / tokens.length : 0;
  const automatedIsEnglish = tokens.length >= 8 && commonWords >= 3 && commonWordRatio >= 0.1;
  const isEnglish = humanOverride?.is_english ?? automatedIsEnglish;
  return {
    is_english: isEnglish,
    basis: humanOverride
      ? 'human_override'
      : !isEnglish
      ? 'insufficient'
      : spoken && onScreen
        ? 'spoken_and_on_screen'
        : spoken
          ? 'spoken'
          : 'on_screen',
    common_word_ratio: Number(commonWordRatio.toFixed(4)),
    classification_version: 'english_evidence_v2',
    classification_confidence: humanOverride
      ? 1
      : classificationConfidence(tokens.length, commonWordRatio, automatedIsEnglish),
    human_override: humanOverride,
  };
}

function classificationConfidence(
  tokenCount: number,
  commonWordRatio: number,
  isEnglish: boolean,
): number {
  if (tokenCount < 8) return 0.4;
  const distance = Math.abs(commonWordRatio - 0.1);
  const base = isEnglish ? 0.7 : 0.65;
  return Number(Math.min(0.99, base + Math.min(0.2, tokenCount / 200) + Math.min(0.2, distance)).toFixed(4));
}

function cleanEvidenceText(value: string): string {
  return value
    .replace(/\bnone\b/gi, ' ')
    .replace(/\([^)]*(?:text|center|white|black|top|bottom|screen|outline|box)[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
