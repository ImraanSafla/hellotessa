import { parseSentences } from "../sentence-parser.js";

const CASES = [
  {
    name: "basic punctuation",
    input: "Hello there. How are you? Great!",
    expected: ["Hello there.", "How are you?", "Great!"]
  },
  {
    name: "decimal should not split",
    input: "Pi is 3.14 in short. Next sentence.",
    expected: ["Pi is 3.14 in short.", "Next sentence."]
  },
  {
    name: "common abbreviations",
    input: "Dr. Smith arrived at 9 a.m. He left at 5 p.m.",
    expected: ["Dr. Smith arrived at 9 a.m.", "He left at 5 p.m."]
  },
  {
    name: "initialisms",
    input: "The U.S. market opened. Investors reacted.",
    expected: ["The U.S. market opened.", "Investors reacted."]
  },
  {
    name: "ellipsis continuation",
    input: "Wait... maybe this still continues. Now it ends.",
    expected: ["Wait... maybe this still continues.", "Now it ends."]
  },
  {
    name: "trailing closers",
    input: 'She said "go now." Then we left.',
    expected: ['She said "go now."', "Then we left."]
  },
  {
    name: "whitespace and tail",
    input: "  One sentence without terminator",
    expected: ["One sentence without terminator"]
  }
];

let failures = 0;

for (const t of CASES) {
  const got = parseSentences(t.input).map((s) => s.text);
  const ok = shallowEqual(got, t.expected);
  if (!ok) {
    failures += 1;
    console.error(`FAIL: ${t.name}`);
    console.error(`  input:    ${JSON.stringify(t.input)}`);
    console.error(`  expected: ${JSON.stringify(t.expected)}`);
    console.error(`  got:      ${JSON.stringify(got)}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} parser regression test(s) failed.`);
  process.exit(1);
}

console.log(`All ${CASES.length} parser regression tests passed.`);

function shallowEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
