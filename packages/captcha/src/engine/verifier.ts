import type { Challenge, VerificationResult } from "./types.js";

export function verifyResponse(challenge: Challenge, responseText: string): VerificationResult {
  const responseTime = Date.now() / 1000;
  const lines = responseText.trim().split("\n").map(l => l.trim()).filter(l => l.length > 0);

  // Line count check
  const lineCountPass = lines.length === challenge.lineCount;

  // ASCII sum of first characters of each line
  const firstChars = lines.map(l => l[0]).filter(Boolean);
  const asciiSum = firstChars.reduce((sum, c) => sum + c.charCodeAt(0), 0);
  const asciiPass = asciiSum === challenge.asciiTarget;

  // Word count
  const allText = lines.join(" ");
  const words = allText.split(/\s+/).filter(w => w.length > 0);
  const wordCountActual = words.length;
  let wordCountPass: boolean | null = null;
  if (challenge.wordCount !== null) {
    wordCountPass = wordCountActual === challenge.wordCount;
  }

  // Character position
  let charPositionPass: boolean | null = null;
  if (challenge.charPosition !== null) {
    const [pos, requiredChar] = challenge.charPosition;
    charPositionPass = pos < allText.length ? allText[pos] === requiredChar : false;
  }

  // Total characters
  let totalCharsPass: boolean | null = null;
  const totalCharsActual = allText.length;
  if (challenge.totalChars !== null) {
    totalCharsPass = totalCharsActual === challenge.totalChars;
  }

  // Timing
  const elapsed = responseTime - challenge.createdAt;
  const timingPass = elapsed <= challenge.timeLimitSeconds;

  // Overall
  const checks = [lineCountPass, asciiPass, timingPass];
  if (wordCountPass !== null) checks.push(wordCountPass);
  if (charPositionPass !== null) checks.push(charPositionPass);
  if (totalCharsPass !== null) checks.push(totalCharsPass);
  const overallPass = checks.every(Boolean);

  return {
    lineCountPass,
    lineCountActual: lines.length,
    lineCountTarget: challenge.lineCount,
    asciiSumPass: asciiPass,
    asciiSumActual: asciiSum,
    asciiSumTarget: challenge.asciiTarget,
    wordCountPass,
    wordCountActual: challenge.wordCount !== null ? wordCountActual : null,
    wordCountTarget: challenge.wordCount,
    charPositionPass,
    totalCharsPass,
    totalCharsActual: challenge.totalChars !== null ? totalCharsActual : null,
    timingPass,
    elapsedSeconds: Math.round(elapsed * 100) / 100,
    overallPass,
    verdict: overallPass ? "VERIFIED_AI_AGENT" : "VERIFICATION_FAILED",
  };
}
