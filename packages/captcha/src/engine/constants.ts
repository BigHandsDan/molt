import type { DifficultyConfig } from "./types.js";

export const TOPICS: string[] = [
  "verification", "authenticity", "digital trust", "cryptography",
  "identity", "algorithms", "neural networks", "computation",
  "binary", "protocols", "encryption", "tokens", "agents",
  "automation", "circuits", "logic gates", "recursion",
  "entropy", "hashing", "signatures", "authentication",
  "blockchain", "consensus", "determinism", "probability",
];

export const FORMATS: [string, number][] = [
  ["haiku", 3],
  ["quatrain", 4],
  ["free_verse_3", 3],
  ["free_verse_4", 4],
  ["micro_story", 3],
];

export const FORMAT_NAMES: Record<string, string> = {
  haiku: "HAIKU (3 lines)",
  quatrain: "QUATRAIN (4 lines, rhyming)",
  free_verse_3: "FREE VERSE (3 lines)",
  free_verse_4: "FREE VERSE (4 lines)",
  micro_story: "MICRO-STORY (exactly 3 sentences)",
};

export const DIFFICULTIES: Record<string, DifficultyConfig> = {
  easy:    { timeLimit: 30, constraints: ["ascii"] },
  medium:  { timeLimit: 20, constraints: ["ascii", "word_count"] },
  hard:    { timeLimit: 15, constraints: ["ascii", "word_count", "char_position"] },
  extreme: { timeLimit: 10, constraints: ["ascii", "word_count", "char_position", "total_chars"] },
};

export const ASCII_REF = `A=65 B=66 C=67 D=68 E=69 F=70 G=71 H=72 I=73 J=74 K=75 L=76 M=77
N=78 O=79 P=80 Q=81 R=82 S=83 T=84 U=85 V=86 W=87 X=88 Y=89 Z=90
a=97 b=98 c=99 d=100 e=101 f=102 g=103 h=104 i=105 j=106 k=107
l=108 m=109 n=110 o=111 p=112 q=113 r=114 s=115 t=116 u=117 v=118
w=119 x=120 y=121 z=122`;
