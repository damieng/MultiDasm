import type { CpuModel, AssemblyEntry } from "../types.js";

// --- Line parsing ---

interface Line {
  label?: string;
  mnemonic?: string;
  operand?: string;
  directive?: string;
  directiveArg?: string;
  lineNum: number;
  raw: string;
}

function parseLine(raw: string, lineNum: number): Line {
  let line = raw.replace(/;.*$/, "").trim();
  if (!line) return { lineNum, raw };

  const result: Line = { lineNum, raw };

  const labelMatch = line.match(/^([a-zA-Z_]\w*)\s*:/);
  if (labelMatch) {
    result.label = labelMatch[1];
    line = line.slice(labelMatch[0].length).trim();
  }

  if (!line) return result;

  const directiveMatch = line.match(/^\.?(ORG|DB|DW|BYTE|WORD|EQU)\s*(.*)?$/i);
  if (directiveMatch) {
    result.directive = directiveMatch[1]!.toUpperCase();
    result.directiveArg = directiveMatch[2]?.trim() ?? "";
    return result;
  }

  const parts = line.match(/^(\S+)\s*(.*)$/);
  if (parts) {
    result.mnemonic = parts[1]!.toUpperCase();
    result.operand = parts[2]?.trim() ?? "";
  }

  return result;
}

// --- Value parsing ---

function parseValue(s: string, labels: Map<string, number>): number | null {
  s = s.trim();
  if (!s) return null;

  // signed prefix
  if (s.startsWith("+")) return parseValue(s.slice(1), labels);
  if (s.startsWith("-")) {
    const v = parseValue(s.slice(1), labels);
    return v !== null ? -v : null;
  }

  if (s.startsWith("$")) {
    const v = parseInt(s.slice(1), 16);
    return isNaN(v) ? null : v;
  }
  if (s.startsWith("0x") || s.startsWith("0X")) {
    const v = parseInt(s.slice(2), 16);
    return isNaN(v) ? null : v;
  }
  if (s.startsWith("%")) {
    const v = parseInt(s.slice(1), 2);
    return isNaN(v) ? null : v;
  }
  if (/^\d+$/.test(s)) return parseInt(s, 10);

  return labels.get(s) ?? null;
}

// --- Template matching ---
// Converts a DSL template into a regex and captures operand values.
// Placeholders: nn (16-bit), n (8-bit), e (relative), +d (displacement)
// Fixed parts match case-insensitively.

function isAlpha(ch: string | undefined): boolean {
  return !!ch && /[a-zA-Z]/.test(ch);
}

function isStandalone(template: string, pos: number, len: number): boolean {
  return !isAlpha(template[pos - 1]) && !isAlpha(template[pos + len]);
}

interface TemplateMatch {
  captures: { type: string; value: number }[];
}

function matchTemplate(
  input: string,
  template: string,
  labels: Map<string, number>,
): TemplateMatch | null {
  // quick exact match (case-insensitive)
  if (input.toUpperCase() === template.toUpperCase()) return { captures: [] };

  // build regex from template
  let pattern = "^";
  const captureTypes: string[] = [];
  let i = 0;

  while (i < template.length) {
    // +d displacement
    if (template[i] === "+" && template[i + 1] === "d" && isStandalone(template, i + 1, 1)) {
      pattern += "([+-]?[^\\s,()]+)";
      captureTypes.push("d");
      i += 2;
      continue;
    }
    // nn 16-bit
    if (template[i] === "n" && template[i + 1] === "n" && isStandalone(template, i, 2)) {
      pattern += "([^\\s,()]+)";
      captureTypes.push("nn");
      i += 2;
      continue;
    }
    // e relative
    if (template[i] === "e" && isStandalone(template, i, 1)) {
      pattern += "([^\\s,()]+)";
      captureTypes.push("e");
      i += 1;
      continue;
    }
    // n 8-bit
    if (template[i] === "n" && isStandalone(template, i, 1)) {
      pattern += "([^\\s,()]+)";
      captureTypes.push("n");
      i += 1;
      continue;
    }
    // escape regex specials
    if ("()[]{}.*+?^$\\|".includes(template[i]!)) {
      pattern += "\\" + template[i];
    } else {
      pattern += template[i];
    }
    i += 1;
  }
  pattern += "$";

  try {
    const re = new RegExp(pattern, "i");
    const m = input.match(re);
    if (!m) return null;

    const captures: { type: string; value: number }[] = [];
    for (let ci = 0; ci < captureTypes.length; ci++) {
      const raw = m[ci + 1]!.trim();
      const val = parseValue(raw, labels);
      if (val === null) return null;

      const type = captureTypes[ci]!;
      // validate range
      if (type === "n" && (val < 0 || val > 255)) return null;
      if (type === "d" && (val < -128 || val > 127)) return null;

      captures.push({ type, value: val });
    }
    return { captures };
  } catch {
    return null;
  }
}

// Try matching input against all templates for a mnemonic.
// Returns the best match (fewest operand bytes).
function matchInstruction(
  mnemonic: string,
  operand: string,
  model: CpuModel,
  labels: Map<string, number>,
  pc: number,
): { encoding: number[]; emitBytes: number[] } | null {
  const entries = model.assemblyIndex.get(mnemonic);
  if (!entries) return null;

  const fullInput = operand ? `${mnemonic} ${operand}` : mnemonic;
  const normalized = fullInput.replace(/\s+/g, " ").trim();

  let bestMatch: { encoding: number[]; emitBytes: number[]; totalLen: number } | null = null;

  for (const entry of entries) {
    const tmatch = matchTemplate(normalized, entry.template, labels);
    if (!tmatch) continue;

    // compute emitted operand bytes
    const emitBytes: number[] = [];
    const instrLen = entry.encoding.length + entry.operandBytes;

    for (const cap of tmatch.captures) {
      switch (cap.type) {
        case "nn":
          if (model.endian === "little") {
            emitBytes.push(cap.value & 0xff);
            emitBytes.push((cap.value >> 8) & 0xff);
          } else {
            emitBytes.push((cap.value >> 8) & 0xff);
            emitBytes.push(cap.value & 0xff);
          }
          break;
        case "n":
          emitBytes.push(cap.value & 0xff);
          break;
        case "e": {
          const offset = cap.value - (pc + instrLen);
          if (offset < -128 || offset > 127) continue; // out of range, skip
          emitBytes.push(offset & 0xff);
          break;
        }
        case "d":
          emitBytes.push(cap.value & 0xff);
          break;
      }
    }

    // verify byte count matches
    if (emitBytes.length !== entry.operandBytes) continue;

    const totalLen = entry.encoding.length + emitBytes.length;
    if (!bestMatch || totalLen < bestMatch.totalLen) {
      bestMatch = { encoding: entry.encoding, emitBytes, totalLen };
    }
  }

  return bestMatch;
}

// Estimate instruction size for pass 1 (may have unresolved forward references)
function estimateSize(
  mnemonic: string,
  operand: string,
  model: CpuModel,
  labels: Map<string, number>,
  pc: number,
): number {
  const matched = matchInstruction(mnemonic, operand, model, labels, pc);
  if (matched) return matched.encoding.length + matched.emitBytes.length;

  // forward reference — try with dummy labels
  const dummyLabels = new Map(labels);
  const tokens = operand.split(/[\s,]+/).filter((t) => /^[a-zA-Z_]\w*$/.test(t));
  for (const t of tokens) {
    if (!dummyLabels.has(t)) dummyLabels.set(t, 0x1000);
  }

  const matched2 = matchInstruction(mnemonic, operand, model, dummyLabels, pc);
  if (matched2) return matched2.encoding.length + matched2.emitBytes.length;

  return 1;
}

// --- Assembler ---

export interface AssembleResult {
  data: Uint8Array;
  origin: number;
  labels: Map<string, number>;
  errors: { line: number; message: string }[];
}

export function assemble(source: string, model: CpuModel): AssembleResult {
  const lines = source.split(/\r?\n/).map((raw, i) => parseLine(raw, i + 1));
  const errors: { line: number; message: string }[] = [];

  // --- Pass 1: collect labels ---
  const labels = new Map<string, number>();
  let pc = 0;
  let origin = 0;

  for (const line of lines) {
    if (line.directive === "ORG") {
      const val = parseValue(line.directiveArg ?? "0", labels);
      if (val !== null) { pc = val; origin = val; }
      continue;
    }
    if (line.label) labels.set(line.label, pc);

    if (line.directive === "DB" || line.directive === "BYTE") {
      pc += (line.directiveArg ?? "").split(",").length;
      continue;
    }
    if (line.directive === "DW" || line.directive === "WORD") {
      pc += (line.directiveArg ?? "").split(",").length * 2;
      continue;
    }
    if (!line.mnemonic) continue;

    pc += estimateSize(line.mnemonic, line.operand ?? "", model, labels, pc);
  }

  // --- Pass 2: emit bytes ---
  const output: number[] = [];
  pc = origin;

  for (const line of lines) {
    if (line.directive === "ORG") {
      const val = parseValue(line.directiveArg ?? "0", labels);
      if (val !== null) pc = val;
      continue;
    }
    if (line.directive === "EQU") continue;

    if (line.directive === "DB" || line.directive === "BYTE") {
      for (const arg of (line.directiveArg ?? "").split(",")) {
        const val = parseValue(arg.trim(), labels);
        if (val !== null) { output.push(val & 0xff); pc++; }
      }
      continue;
    }
    if (line.directive === "DW" || line.directive === "WORD") {
      for (const arg of (line.directiveArg ?? "").split(",")) {
        const val = parseValue(arg.trim(), labels);
        if (val !== null) {
          if (model.endian === "little") {
            output.push(val & 0xff);
            output.push((val >> 8) & 0xff);
          } else {
            output.push((val >> 8) & 0xff);
            output.push(val & 0xff);
          }
          pc += 2;
        }
      }
      continue;
    }
    if (!line.mnemonic) continue;

    const matched = matchInstruction(line.mnemonic, line.operand ?? "", model, labels, pc);
    if (!matched) {
      errors.push({ line: line.lineNum, message: `Cannot encode: ${line.mnemonic} ${line.operand ?? ""}` });
      continue;
    }

    for (const b of matched.encoding) output.push(b);
    for (const b of matched.emitBytes) output.push(b);
    pc += matched.encoding.length + matched.emitBytes.length;
  }

  return { data: new Uint8Array(output), origin, labels, errors };
}
