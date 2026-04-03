// Generic operand type decode/encode for DSL-declared custom operands.
// No CPU-specific code — all behavior driven by OperandTypeDef from the YAML.

import type {
  OperandTypeDef,
  IndexedOperandDef,
  RegisterPairDef,
  RegisterListDef,
} from "../types.js";

function extractBits(value: number, hi: number, lo: number): number {
  return (value >> lo) & ((1 << (hi - lo + 1)) - 1);
}

function signExtend(v: number, bits: number): number {
  const max = 1 << (bits - 1);
  return v >= max ? v - (1 << bits) : v;
}

function read16(data: Uint8Array, offset: number, endian: string): number {
  if (offset + 1 >= data.length) return 0;
  return endian === "big"
    ? (data[offset]! << 8) | data[offset + 1]!
    : data[offset]! | (data[offset + 1]! << 8);
}

function hex8(v: number): string {
  return "$" + (v & 0xff).toString(16).toUpperCase().padStart(2, "0");
}

function hex16(v: number): string {
  return "$" + (v & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

// --- Size calculation (for decodeOne to know how many bytes to read) ---

export function calcExtraBytes(
  def: OperandTypeDef,
  postbyte: number,
): number {
  switch (def.kind) {
    case "indexed": return calcIndexedExtra(def, postbyte);
    case "register_pair": return 0;
    case "register_list": return 0;
  }
}

function calcIndexedExtra(def: IndexedOperandDef, pb: number): number {
  if ((pb & 0x80) === 0) return 0; // short offset
  const modeCode = pb & 0x0f;
  const mode = def.modes.get(modeCode);
  return mode?.extra ?? 0;
}

// --- Disassembly: decode postbyte into formatted text ---

export function decodeOperandType(
  def: OperandTypeDef,
  data: Uint8Array,
  offset: number,
  endian: string,
): { text: string; bytesConsumed: number } | null {
  switch (def.kind) {
    case "indexed": return decodeIndexed(def, data, offset, endian);
    case "register_pair": return decodeRegPair(def, data, offset);
    case "register_list": return decodeRegList(def, data, offset);
  }
}

function decodeIndexed(
  def: IndexedOperandDef,
  data: Uint8Array,
  offset: number,
  endian: string,
): { text: string; bytesConsumed: number } | null {
  if (offset >= data.length) return null;
  const pb = data[offset]!;

  // short offset: bit 7 = 0
  if ((pb & 0x80) === 0) {
    const regIdx = extractBits(pb, def.shortOffset.registerBits[0], def.shortOffset.registerBits[1]);
    const reg = def.registers[regIdx] ?? "?";
    let off = extractBits(pb, def.shortOffset.offsetBits[0], def.shortOffset.offsetBits[1]);
    if (def.shortOffset.signed) {
      const bits = def.shortOffset.offsetBits[0] - def.shortOffset.offsetBits[1] + 1;
      off = signExtend(off, bits);
    }
    const text = off === 0 ? `,${reg}` : `${off},${reg}`;
    return { text, bytesConsumed: 1 };
  }

  // extended mode: bit 7 = 1
  const regIdx = extractBits(pb, def.shortOffset.registerBits[0], def.shortOffset.registerBits[1]);
  const reg = def.registers[regIdx] ?? "?";
  const indirect = ((pb >> def.indirectBit) & 1) === 1;
  const modeCode = pb & 0x0f;
  const mode = def.modes.get(modeCode);
  if (!mode) return null;
  if (mode.noIndirect && indirect) return null;

  const extraStart = offset + 1;
  if (extraStart + mode.extra > data.length) return null;

  let text = mode.format;

  // substitute register
  if (!mode.noRegister) {
    text = text.replace("{R}", reg);
  }

  // substitute n/nn values from extra bytes
  if (mode.extra === 2 && text.includes("nn")) {
    const val = read16(data, extraStart, endian);
    text = text.replace("nn", hex16(val));
  } else if (mode.extra === 1 && /(?<![a-zA-Z])n(?![a-zA-Z])/.test(text)) {
    const val = data[extraStart]!;
    const signed = signExtend(val, 8);
    text = text.replace(/(?<![a-zA-Z])n(?![a-zA-Z])/, signed.toString());
  }

  // wrap in brackets for indirect (unless format already has them)
  if (indirect && !mode.indirectOnly && !text.startsWith("[")) {
    text = `[${text}]`;
  }

  return { text, bytesConsumed: 1 + mode.extra };
}

function decodeRegPair(
  def: RegisterPairDef,
  data: Uint8Array,
  offset: number,
): { text: string; bytesConsumed: number } | null {
  if (offset >= data.length) return null;
  const pb = data[offset]!;
  const srcCode = extractBits(pb, def.sourceBits[0], def.sourceBits[1]);
  const dstCode = extractBits(pb, def.destBits[0], def.destBits[1]);
  const src = def.reverseMap.get(srcCode) ?? "?";
  const dst = def.reverseMap.get(dstCode) ?? "?";
  return { text: `${src},${dst}`, bytesConsumed: 1 };
}

function decodeRegList(
  def: RegisterListDef,
  data: Uint8Array,
  offset: number,
): { text: string; bytesConsumed: number } | null {
  if (offset >= data.length) return null;
  const pb = data[offset]!;
  const regs: string[] = [];
  for (let bit = 7; bit >= 0; bit--) {
    if ((pb >> bit) & 1) {
      const name = def.bits.get(bit);
      if (name) regs.push(name);
    }
  }
  return { text: regs.join(","), bytesConsumed: 1 };
}

// --- Assembly: encode operand text into bytes ---

export function encodeOperandType(
  def: OperandTypeDef,
  text: string,
  endian: string,
): number[] | null {
  switch (def.kind) {
    case "indexed": return encodeIndexed(def, text, endian);
    case "register_pair": return encodeRegPair(def, text);
    case "register_list": return encodeRegList(def, text);
  }
}

function encodeIndexed(
  def: IndexedOperandDef,
  text: string,
  endian: string,
): number[] | null {
  let inner = text.trim();
  let indirect = false;
  if (inner.startsWith("[") && inner.endsWith("]")) {
    indirect = true;
    inner = inner.slice(1, -1).trim();
  }

  const indirectFlag = indirect ? (1 << def.indirectBit) : 0;

  // try each named mode
  for (const [code, mode] of def.modes) {
    if (mode.noIndirect && indirect) continue;
    if (mode.indirectOnly && !indirect) continue;

    const match = tryMatchMode(inner, mode.format, def.registers, mode.noRegister, endian);
    if (match) {
      let pb: number;
      if (mode.noRegister) {
        pb = 0x80 | indirectFlag | code;
      } else {
        pb = 0x80 | (match.regIdx << def.shortOffset.registerBits[1]) | indirectFlag | code;
      }
      return [pb, ...match.extraBytes];
    }
  }

  // try short offset (no indirect)
  if (!indirect) {
    const numMatch = tryMatchNumericOffset(inner, def.registers);
    if (numMatch) {
      const { regIdx, offset: off } = numMatch;
      // 5-bit range
      if (off >= -16 && off <= 15) {
        const pb = (regIdx << def.shortOffset.registerBits[1]) | (off & 0x1f);
        return [pb];
      }
      // 8-bit range
      if (off >= -128 && off <= 127) {
        const pb = 0x80 | (regIdx << def.shortOffset.registerBits[1]) | 0x08;
        return [pb, off & 0xff];
      }
      // 16-bit
      const pb = 0x80 | (regIdx << def.shortOffset.registerBits[1]) | 0x09;
      return endian === "big"
        ? [pb, (off >> 8) & 0xff, off & 0xff]
        : [pb, off & 0xff, (off >> 8) & 0xff];
    }
  }

  // try numeric offset with indirect
  if (indirect) {
    const numMatch = tryMatchNumericOffset(inner, def.registers);
    if (numMatch) {
      const { regIdx, offset: off } = numMatch;
      if (off >= -128 && off <= 127) {
        const pb = 0x80 | (regIdx << def.shortOffset.registerBits[1]) | (1 << def.indirectBit) | 0x08;
        return [pb, off & 0xff];
      }
      const pb = 0x80 | (regIdx << def.shortOffset.registerBits[1]) | (1 << def.indirectBit) | 0x09;
      return endian === "big"
        ? [pb, (off >> 8) & 0xff, off & 0xff]
        : [pb, off & 0xff, (off >> 8) & 0xff];
    }
  }

  return null;
}

function tryMatchMode(
  text: string,
  format: string,
  registers: string[],
  noRegister: boolean | undefined,
  endian: string,
): { regIdx: number; extraBytes: number[] } | null {
  if (noRegister) {
    // format is like "[nn]" — just match directly
    const fmtRegex = format
      .replace("nn", "([^\\s,()\\[\\]]+)")
      .replace(/(?<![a-zA-Z])n(?![a-zA-Z])/, "([^\\s,()\\[\\]]+)")
      .replace(/[[\]()]/g, "\\$&");
    // actually, format might have brackets already
    let pattern = "^";
    for (let i = 0; i < format.length; i++) {
      if (format.substring(i, i + 2) === "nn") {
        pattern += "([^\\s,()\\[\\]]+)";
        i += 1;
      } else if (format[i] === "n" && !isAlpha(format[i - 1]) && !isAlpha(format[i + 1])) {
        pattern += "([^\\s,()\\[\\]]+)";
      } else if ("()[]{}.*+?^$\\|".includes(format[i]!)) {
        pattern += "\\" + format[i];
      } else {
        pattern += format[i];
      }
    }
    pattern += "$";
    const m = text.match(new RegExp(pattern, "i"));
    if (!m) return null;
    // parse captured values
    const extraBytes: number[] = [];
    if (m[1]) {
      const val = parseSimpleValue(m[1]);
      if (val === null) return null;
      if (format.includes("nn")) {
        if (endian === "big") {
          extraBytes.push((val >> 8) & 0xff, val & 0xff);
        } else {
          extraBytes.push(val & 0xff, (val >> 8) & 0xff);
        }
      } else {
        extraBytes.push(val & 0xff);
      }
    }
    return { regIdx: 0, extraBytes };
  }

  // try each register
  for (let regIdx = 0; regIdx < registers.length; regIdx++) {
    const reg = registers[regIdx]!;
    const concrete = format.replace("{R}", reg);
    // build regex from concrete format
    let pattern = "^";
    const captures: string[] = [];
    let i = 0;
    while (i < concrete.length) {
      if (concrete.substring(i, i + 2) === "nn" && !isAlpha(concrete[i + 2])) {
        pattern += "([^\\s,()\\[\\]]+)";
        captures.push("nn");
        i += 2;
      } else if (concrete[i] === "n" && !isAlpha(concrete[i - 1]) && !isAlpha(concrete[i + 1])) {
        pattern += "([^\\s,()\\[\\]]+)";
        captures.push("n");
        i += 1;
      } else if ("()[]{}.*+?^$\\|".includes(concrete[i]!)) {
        pattern += "\\" + concrete[i];
        i += 1;
      } else {
        pattern += concrete[i];
        i += 1;
      }
    }
    pattern += "$";

    const m = text.match(new RegExp(pattern, "i"));
    if (!m) continue;

    const extraBytes: number[] = [];
    for (let ci = 0; ci < captures.length; ci++) {
      const val = parseSimpleValue(m[ci + 1]!);
      if (val === null) return null;
      if (captures[ci] === "nn") {
        if (endian === "big") {
          extraBytes.push((val >> 8) & 0xff, val & 0xff);
        } else {
          extraBytes.push(val & 0xff, (val >> 8) & 0xff);
        }
      } else {
        extraBytes.push(val & 0xff);
      }
    }
    return { regIdx, extraBytes };
  }
  return null;
}

function tryMatchNumericOffset(
  text: string,
  registers: string[],
): { regIdx: number; offset: number } | null {
  // match "VALUE,REG" or ",REG" (zero offset)
  for (let regIdx = 0; regIdx < registers.length; regIdx++) {
    const reg = registers[regIdx]!;
    const commaReg = new RegExp(`^(.*),${reg}$`, "i");
    const m = text.match(commaReg);
    if (!m) continue;
    const valStr = m[1]!.trim();
    if (!valStr) return { regIdx, offset: 0 };
    const val = parseSimpleValue(valStr);
    if (val === null) continue;
    return { regIdx, offset: val > 32767 ? val - 65536 : val };
  }
  return null;
}

function parseSimpleValue(s: string): number | null {
  s = s.trim();
  if (s.startsWith("+")) return parseSimpleValue(s.slice(1));
  if (s.startsWith("-")) {
    const v = parseSimpleValue(s.slice(1));
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
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return null;
}

function isAlpha(ch: string | undefined): boolean {
  return !!ch && /[a-zA-Z]/.test(ch);
}

function encodeRegPair(def: RegisterPairDef, text: string): number[] | null {
  const parts = text.split(",").map((s) => s.trim().toUpperCase());
  if (parts.length !== 2) return null;
  const srcCode = def.registers.get(parts[0]!);
  const dstCode = def.registers.get(parts[1]!);
  if (srcCode === undefined || dstCode === undefined) return null;
  const pb = (srcCode << def.sourceBits[1]) | (dstCode << def.destBits[1]);
  return [pb];
}

function encodeRegList(def: RegisterListDef, text: string): number[] | null {
  const names = text.split(",").map((s) => s.trim().toUpperCase());
  let mask = 0;
  for (const name of names) {
    if (!name) continue;
    const bit = def.reverseMap.get(name);
    if (bit === undefined) return null;
    mask |= 1 << bit;
  }
  return [mask];
}
