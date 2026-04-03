import type {
  CpuModel,
  DisassembledInstruction,
  DisassemblyResult,
  ResolvedInstruction,
} from "../types.js";
import { calcExtraBytes, decodeOperandType } from "./operand-types.js";

// --- Template placeholder helpers ---

function isAlpha(ch: string | undefined): boolean {
  return !!ch && /[a-zA-Z]/.test(ch);
}

function isStandalone(template: string, pos: number, len: number): boolean {
  return !isAlpha(template[pos - 1]) && !isAlpha(template[pos + len]);
}

function read16(lo: number, hi: number, endian: string): number {
  return endian === "little" ? (lo | (hi << 8)) : ((lo << 8) | hi);
}

function signExtend8(v: number): number {
  return v > 127 ? v - 256 : v;
}

function signExtend16(v: number): number {
  return v > 32767 ? v - 65536 : v;
}

function hex8(v: number): string {
  return "$" + (v & 0xff).toString(16).toUpperCase().padStart(2, "0");
}

function hex16(v: number): string {
  return "$" + (v & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

// Format template by replacing placeholders with values.
// customTexts: map of custom operand type name → formatted text (already decoded).
function formatTemplate(
  template: string,
  operandBytes: number[],
  instrAddr: number,
  instrLen: number,
  endian: string,
  displacement?: number,
  customTexts?: Map<string, string>,
): string {
  // first replace any custom operand placeholders
  let tmpl = template;
  if (customTexts) {
    for (const [name, text] of customTexts) {
      tmpl = tmpl.replace(name, text);
    }
  }

  let result = "";
  let byteIdx = 0;
  let i = 0;

  while (i < tmpl.length) {
    // +d displacement
    if (tmpl[i] === "+" && tmpl[i + 1] === "d" && isStandalone(tmpl, i + 1, 1)) {
      let d: number;
      if (displacement !== undefined) {
        d = signExtend8(displacement);
      } else {
        d = signExtend8(operandBytes[byteIdx++] ?? 0);
      }
      result += (d >= 0 ? "+" : "") + d;
      i += 2;
      continue;
    }

    // ee (16-bit relative offset) — check before nn and e
    if (tmpl[i] === "e" && tmpl[i + 1] === "e" && isStandalone(tmpl, i, 2)) {
      const b0 = operandBytes[byteIdx++] ?? 0;
      const b1 = operandBytes[byteIdx++] ?? 0;
      const offset16 = signExtend16(read16(b0, b1, endian));
      const target = (instrAddr + instrLen + offset16) & 0xffff;
      result += hex16(target);
      i += 2;
      continue;
    }

    // nn (16-bit value)
    if (tmpl[i] === "n" && tmpl[i + 1] === "n" && isStandalone(tmpl, i, 2)) {
      const lo = operandBytes[byteIdx++] ?? 0;
      const hi = operandBytes[byteIdx++] ?? 0;
      result += hex16(read16(lo, hi, endian));
      i += 2;
      continue;
    }

    // e (8-bit relative offset)
    if (tmpl[i] === "e" && isStandalone(tmpl, i, 1)) {
      const offset = signExtend8(operandBytes[byteIdx++] ?? 0);
      const target = (instrAddr + instrLen + offset) & 0xffff;
      result += hex16(target);
      i += 1;
      continue;
    }

    // n (8-bit value)
    if (tmpl[i] === "n" && isStandalone(tmpl, i, 1)) {
      result += hex8(operandBytes[byteIdx++] ?? 0);
      i += 1;
      continue;
    }

    result += tmpl[i];
    i += 1;
  }

  return result;
}

// Compute branch/jump target from template placeholders.
function computeBranchTarget(
  template: string,
  operandBytes: number[],
  instrAddr: number,
  instrLen: number,
  endian: string,
): number | undefined {
  let byteIdx = 0;
  let i = 0;

  while (i < template.length) {
    if (template[i] === "+" && template[i + 1] === "d" && isStandalone(template, i + 1, 1)) {
      byteIdx++;
      i += 2;
      continue;
    }
    if (template[i] === "e" && template[i + 1] === "e" && isStandalone(template, i, 2)) {
      const b0 = operandBytes[byteIdx] ?? 0;
      const b1 = operandBytes[byteIdx + 1] ?? 0;
      const offset16 = signExtend16(read16(b0, b1, endian));
      return (instrAddr + instrLen + offset16) & 0xffff;
    }
    if (template[i] === "n" && template[i + 1] === "n" && isStandalone(template, i, 2)) {
      const lo = operandBytes[byteIdx] ?? 0;
      const hi = operandBytes[byteIdx + 1] ?? 0;
      return read16(lo, hi, endian);
    }
    if (template[i] === "e" && isStandalone(template, i, 1)) {
      const offset = signExtend8(operandBytes[byteIdx] ?? 0);
      return (instrAddr + instrLen + offset) & 0xffff;
    }
    if (template[i] === "n" && isStandalone(template, i, 1)) {
      byteIdx++;
      i += 1;
      continue;
    }
    i += 1;
  }
  return undefined;
}

// --- Instruction decoding ---

function readOperandBytes(data: Uint8Array, offset: number, count: number): number[] | null {
  if (offset + count > data.length) return null;
  const result: number[] = [];
  for (let i = 0; i < count; i++) result.push(data[offset + i]!);
  return result;
}

interface DecodeResult {
  instr: ResolvedInstruction;
  operandBytes: number[];
  instrLen: number;
  displacement?: number;
  customTexts?: Map<string, string>;
}

function decodeCustom(
  instr: ResolvedInstruction,
  data: Uint8Array,
  operandStart: number,
  model: CpuModel,
): { allBytes: number[]; totalExtra: number; customTexts: Map<string, string> } | null {
  const customTexts = new Map<string, string>();
  let pos = operandStart;
  let totalExtra = 0;

  for (const name of instr.customOperands!) {
    const def = model.operandTypes.get(name);
    if (!def || pos >= data.length) return null;

    // read the postbyte to determine extra bytes
    const postbyte = data[pos]!;
    const extra = calcExtraBytes(def, postbyte);
    if (pos + 1 + extra > data.length) return null;

    // decode for display
    const decoded = decodeOperandType(def, data, pos, model.endian);
    if (!decoded) return null;

    customTexts.set(name, decoded.text);
    totalExtra += decoded.bytesConsumed;
    pos += decoded.bytesConsumed;
  }

  const allBytes = readOperandBytes(data, operandStart, totalExtra);
  if (!allBytes) return null;
  return { allBytes, totalExtra, customTexts };
}

function decodeOne(data: Uint8Array, offset: number, model: CpuModel): DecodeResult | null {
  if (offset >= data.length) return null;
  const byte0 = data[offset]!;

  // check for prefix bytes
  if (model.prefixBytes.has(byte0) && model.prefixTables.size > 0) {
    if (offset + 1 >= data.length) return null;
    const byte1 = data[offset + 1]!;

    // double prefix
    const compositeKey = (byte0 << 8) | byte1;
    const doubleTable = model.prefixTables.get(compositeKey);
    if (doubleTable) {
      if (doubleTable.hasDisplacement) {
        if (offset + 3 >= data.length) return null;
        const displacement = data[offset + 2]!;
        const opByte = data[offset + 3]!;
        const instr = doubleTable.opcodes.get(opByte);
        if (instr) {
          const opBytes = readOperandBytes(data, offset + 4, instr.operandBytes);
          if (!opBytes) return null;
          return { instr, operandBytes: opBytes, instrLen: 4 + instr.operandBytes, displacement };
        }
      } else {
        if (offset + 2 >= data.length) return null;
        const opByte = data[offset + 2]!;
        const instr = doubleTable.opcodes.get(opByte);
        if (instr) {
          const opBytes = readOperandBytes(data, offset + 3, instr.operandBytes);
          if (!opBytes) return null;
          return { instr, operandBytes: opBytes, instrLen: 3 + instr.operandBytes };
        }
      }
    }

    // single prefix
    const singleTable = model.prefixTables.get(byte0);
    if (singleTable) {
      const instr = singleTable.opcodes.get(byte1);
      if (instr) {
        const prefixOpcodeLen = 2;
        // custom operands?
        if (instr.customOperands?.length) {
          const custom = decodeCustom(instr, data, offset + prefixOpcodeLen, model);
          if (!custom) return null;
          return {
            instr,
            operandBytes: custom.allBytes,
            instrLen: prefixOpcodeLen + custom.totalExtra,
            customTexts: custom.customTexts,
          };
        }
        const opBytes = readOperandBytes(data, offset + prefixOpcodeLen, instr.operandBytes);
        if (!opBytes) return null;
        return { instr, operandBytes: opBytes, instrLen: prefixOpcodeLen + instr.operandBytes };
      }
    }
  }

  // regular opcode
  const instr = model.opcodeTable.get(byte0);
  if (!instr) return null;

  const opcodeLen = 1;

  // custom operands?
  if (instr.customOperands?.length) {
    const custom = decodeCustom(instr, data, offset + opcodeLen, model);
    if (!custom) return null;
    return {
      instr,
      operandBytes: custom.allBytes,
      instrLen: opcodeLen + custom.totalExtra,
      customTexts: custom.customTexts,
    };
  }

  const opBytes = readOperandBytes(data, offset + opcodeLen, instr.operandBytes);
  if (!opBytes) return null;
  return { instr, operandBytes: opBytes, instrLen: opcodeLen + instr.operandBytes };
}

// --- Recursive descent disassembler ---

export function disassemble(
  data: Uint8Array,
  baseAddr: number,
  model: CpuModel,
  entryPoints: number[],
): DisassemblyResult {
  const instructions = new Map<number, DisassembledInstruction>();
  const visited = new Set<number>();
  const queue: number[] = [...entryPoints];
  const codeRegions: [number, number][] = [];

  while (queue.length > 0) {
    const addr = queue.shift()!;
    if (visited.has(addr)) continue;
    if (addr < baseAddr || addr >= baseAddr + data.length) continue;

    let currentAddr = addr;
    const regionStart = addr;

    while (currentAddr >= baseAddr && currentAddr < baseAddr + data.length) {
      if (visited.has(currentAddr)) break;
      visited.add(currentAddr);

      const offset = currentAddr - baseAddr;
      const decoded = decodeOne(data, offset, model);

      if (!decoded) {
        instructions.set(currentAddr, {
          address: currentAddr,
          bytes: [data[offset]!],
          text: ".db " + hex8(data[offset]!),
          raw: "",
          isCode: false,
        });
        break;
      }

      const { instr, operandBytes, instrLen, displacement, customTexts } = decoded;
      const bytes = Array.from(data.slice(offset, offset + instrLen));
      const text = formatTemplate(
        instr.template, operandBytes, currentAddr, instrLen,
        model.endian, displacement, customTexts,
      );
      const flow = instr.flow;

      let branchTarget: number | undefined;
      if (flow) {
        branchTarget = computeBranchTarget(instr.template, operandBytes, currentAddr, instrLen, model.endian);
      }

      const addrStr = currentAddr.toString(16).toUpperCase().padStart(4, "0");
      const bytesStr = bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
      const raw = `${addrStr}  ${bytesStr.padEnd(14)}${text}`;

      instructions.set(currentAddr, {
        address: currentAddr, bytes, text, raw, isCode: true, flow, branchTarget,
      });

      currentAddr += instrLen;

      if (!flow) continue;
      if (branchTarget !== undefined) queue.push(branchTarget);

      switch (flow) {
        case "jump":
          break;
        case "cond_branch":
          continue;
        case "call":
          queue.push(currentAddr);
          break;
        case "cond_call":
          continue;
        case "return":
          break;
        case "cond_return":
          continue;
        case "indirect":
          break;
        default:
          continue;
      }
      break;
    }

    if (currentAddr > regionStart) {
      codeRegions.push([regionStart, currentAddr]);
    }
  }

  const sorted = [...codeRegions].sort((a, b) => a[0] - b[0]);
  const dataRegions: [number, number][] = [];
  let lastEnd = baseAddr;
  for (const [s, e] of sorted) {
    if (s > lastEnd) dataRegions.push([lastEnd, s]);
    lastEnd = Math.max(lastEnd, e);
  }
  if (lastEnd < baseAddr + data.length) dataRegions.push([lastEnd, baseAddr + data.length]);

  return { instructions, entryPoints, codeRegions: sorted, dataRegions };
}

export function formatDisassembly(result: DisassemblyResult, data: Uint8Array, baseAddr: number): string {
  const lines: string[] = [];
  let addr = baseAddr;

  while (addr < baseAddr + data.length) {
    const instr = result.instructions.get(addr);
    if (instr) {
      lines.push(instr.raw);
      addr += instr.bytes.length;
    } else {
      const b = data[addr - baseAddr]!;
      const addrStr = addr.toString(16).toUpperCase().padStart(4, "0");
      lines.push(`${addrStr}  ${b.toString(16).toUpperCase().padStart(2, "0")}              .db ${hex8(b)}`);
      addr++;
    }
  }

  return lines.join("\n");
}
