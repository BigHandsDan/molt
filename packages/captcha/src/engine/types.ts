export interface Challenge {
  id: string;
  topic: string;
  format: string;
  lineCount: number;
  asciiTarget: number;
  wordCount: number | null;
  charPosition: [number, string] | null;
  totalChars: number | null;
  timeLimitSeconds: number;
  difficulty: string;
  createdAt: number;
}

export interface VerificationResult {
  lineCountPass: boolean;
  lineCountActual: number;
  lineCountTarget: number;
  asciiSumPass: boolean;
  asciiSumActual: number;
  asciiSumTarget: number;
  wordCountPass: boolean | null;
  wordCountActual: number | null;
  wordCountTarget: number | null;
  charPositionPass: boolean | null;
  totalCharsPass: boolean | null;
  totalCharsActual: number | null;
  timingPass: boolean;
  elapsedSeconds: number;
  overallPass: boolean;
  verdict: "VERIFIED_AI_AGENT" | "VERIFICATION_FAILED";
}

export type Difficulty = "easy" | "medium" | "hard" | "extreme";

export interface DifficultyConfig {
  timeLimit: number;
  constraints: string[];
}

export interface MoltCaptchaStats {
  challengesGenerated: number;
  verificationsAttempted: number;
  verificationsPassed: number;
  verificationsFailed: number;
  challengesExpired: number;
}

export interface ChallengeFormatted {
  challengeId: string;
  difficulty: string;
  timeLimitSeconds: number;
  prompt: string;
  constraints: string[];
  asciiReference: string;
  instructions: {
    description: string;
    note: string;
  };
}
