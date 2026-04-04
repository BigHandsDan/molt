import { MoltCaptcha } from "../index.js";
import { MoltCaptchaClient } from "../client/index.js";
import { createServer } from "../server/standalone.js";

function printUsage() {
  console.log(`
MoltCaptcha CLI — Reverse CAPTCHA for AI Agents

Usage:
  moltcaptcha generate [--difficulty <level>]   Generate and display a challenge
  moltcaptcha verify --challenge-id <id> --response <text>  Verify a response (requires running server)
  moltcaptcha serve [--port <port>]             Start standalone server
  moltcaptcha test [--difficulty <level>]        Generate, auto-solve, show result

Options:
  --difficulty   easy | medium | hard | extreme (default: medium)
  --port         Server port (default: 3002)
  --help         Show this help message
`);
}

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        parsed[key] = next;
        i++;
      } else {
        parsed[key] = "true";
      }
    } else if (!parsed._command) {
      parsed._command = args[i];
    }
  }
  return parsed;
}

async function cmdGenerate(args: Record<string, string>) {
  const captcha = new MoltCaptcha();
  const difficulty = args.difficulty || "medium";
  const challenge = captcha.generate(difficulty);
  const formatted = captcha.format(challenge);

  console.log("\n--- MoltCaptcha Challenge ---");
  console.log(`Challenge ID: ${formatted.challengeId}`);
  console.log(`Difficulty:   ${formatted.difficulty}`);
  console.log(`Time Limit:   ${formatted.timeLimitSeconds}s`);
  console.log(`\nPrompt: ${formatted.prompt}`);
  console.log("\nConstraints:");
  formatted.constraints.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
  console.log(`\nASCII Reference:\n${formatted.asciiReference}`);
  console.log("---\n");
}

async function cmdVerify(args: Record<string, string>) {
  const challengeId = args["challenge-id"];
  const response = args.response;
  if (!challengeId || !response) {
    console.error("Error: --challenge-id and --response are required");
    process.exit(1);
  }

  const port = args.port || "3002";
  const client = new MoltCaptchaClient(`http://localhost:${port}`);
  try {
    const result = await client.verify(challengeId, response.replace(/\\n/g, "\n"));
    console.log("\n--- Verification Result ---");
    console.log(JSON.stringify(result, null, 2));
    console.log("---\n");
  } catch (err) {
    console.error("Error:", (err as Error).message);
    console.error("Is the MoltCaptcha server running?");
    process.exit(1);
  }
}

async function cmdServe(args: Record<string, string>) {
  const port = parseInt(args.port || "3002", 10);
  const apiKey = process.env.MOLTCAPTCHA_API_KEY;
  const app = createServer({ apiKey });
  app.listen(port, () => {
    console.log(`MoltCaptcha server running on port ${port}`);
    if (apiKey) console.log("API key authentication enabled");
    console.log("\nEndpoints:");
    console.log(`  GET  http://localhost:${port}/challenge?difficulty=medium`);
    console.log(`  POST http://localhost:${port}/verify`);
    console.log(`  GET  http://localhost:${port}/health`);
  });
}

import type { Challenge } from "../engine/types.js";

function autoSolve(challenge: Challenge): string {
  const lines: string[] = [];
  let remaining = challenge.asciiTarget;

  // Calculate first chars for ASCII target
  const firstChars: number[] = [];
  for (let i = 0; i < challenge.lineCount - 1; i++) {
    const charCode = Math.min(remaining - (challenge.lineCount - 1 - i) * 97, 122);
    const safeCode = Math.max(97, Math.min(122, charCode));
    firstChars.push(safeCode);
    remaining -= safeCode;
  }
  firstChars.push(Math.max(65, Math.min(122, remaining)));

  // Distribute words across lines to hit word count target
  const targetWords = challenge.wordCount || challenge.lineCount * 3;
  const wordsPerLine = Math.floor(targetWords / challenge.lineCount);
  const extraWords = targetWords % challenge.lineCount;

  for (let i = 0; i < challenge.lineCount; i++) {
    const lineWordCount = wordsPerLine + (i < extraWords ? 1 : 0);
    const firstWord = String.fromCharCode(firstChars[i]);
    const fillerCount = Math.max(0, lineWordCount - 1);
    const filler = Array(fillerCount).fill("word").join(" ");
    lines.push(filler ? `${firstWord} ${filler}` : firstWord);
  }

  return lines.join("\n");
}

async function cmdTest(args: Record<string, string>) {
  const captcha = new MoltCaptcha();
  const difficulty = args.difficulty || "easy";
  const challenge = captcha.generate(difficulty);
  const formatted = captcha.format(challenge);

  console.log("\n--- MoltCaptcha Test ---");
  console.log(`Difficulty: ${formatted.difficulty}`);
  console.log(`Prompt: ${formatted.prompt}`);
  console.log("\nConstraints:");
  formatted.constraints.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));

  const responseText = autoSolve(challenge);
  console.log(`\nAuto-solve response:\n${responseText}`);

  const result = captcha.verify(challenge.id, responseText);
  console.log("\n--- Result ---");
  console.log(JSON.stringify(result, null, 2));
  console.log("---\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._command;

  if (args.help || !command) {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  switch (command) {
    case "generate":
      await cmdGenerate(args);
      break;
    case "verify":
      await cmdVerify(args);
      break;
    case "serve":
      await cmdServe(args);
      break;
    case "test":
      await cmdTest(args);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
