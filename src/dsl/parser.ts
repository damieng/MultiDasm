import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import type {
  CpuDef,
  CpuModel,
  ResolvedInstruction,
  PrefixTable,
  AssemblyEntry,
  PatternDef,
  OpcodeDef,
} from "../types.js";

export function loadCpuDef(path: string): CpuDef {
  const text = readFileSync(path, "utf-8");
  return yaml.load(text) as CpuDef;
}

function extractBits(value: number, hi: number, lo: number): number {
  return (value >> lo) & ((1 << (hi - lo + 1)) - 1);
}

function expandTemplate(
  template: string,
  opcode: number,
  registerSets: Record<string, string[]>,
): string {
  return template.replace(/\{(\w+):(\d+)-(\d+)\}/g, (_match, setName, hiStr, loStr) => {
    const hi = parseInt(hiStr, 10);
    const lo = parseInt(loStr, 10);
    const idx = extractBits(opcode, hi, lo);
    if (setName === "bit") return idx.toString();
    const set = registerSets[setName];
    if (!set) return `?${setName}?`;
    return set[idx] ?? `?${idx}?`;
  });
}

function parseOpcodeKey(key: string): number {
  if (key.startsWith("0x") || key.startsWith("0X")) return parseInt(key, 16);
  return parseInt(key, 10);
}

function resolveOpcodeDef(
  entry: OpcodeDef,
  opcode: number,
  prefix: number[],
): ResolvedInstruction {
  return {
    template: entry[0],
    operandBytes: entry[1],
    encoding: [...prefix, opcode],
    flow: entry[2] as string | undefined,
  };
}

function resolvePatterns(
  patterns: PatternDef[],
  registerSets: Record<string, string[]>,
  prefix: number[],
): Map<number, ResolvedInstruction> {
  const result = new Map<number, ResolvedInstruction>();
  for (const pat of patterns) {
    const [lo, hi] = pat.range;
    for (let opcode = lo; opcode <= hi; opcode++) {
      // check excludes
      if (pat.exclude) {
        const keys = [
          `0x${opcode.toString(16).toUpperCase().padStart(2, "0")}`,
          `0x${opcode.toString(16).padStart(2, "0")}`,
          opcode.toString(),
        ];
        let excluded = false;
        for (const k of keys) {
          if (pat.exclude[k]) {
            result.set(opcode, resolveOpcodeDef(pat.exclude[k]!, opcode, prefix));
            excluded = true;
            break;
          }
        }
        if (excluded) continue;
      }

      const template = expandTemplate(pat.template, opcode, registerSets);
      result.set(opcode, {
        template,
        operandBytes: pat.operand_bytes ?? 0,
        encoding: [...prefix, opcode],
        flow: pat.flow,
      });
    }
  }
  return result;
}

export function buildCpuModel(def: CpuDef): CpuModel {
  const registerSets = def.register_sets ?? {};
  const opcodeTable = new Map<number, ResolvedInstruction>();
  const prefixTables = new Map<number, PrefixTable>();
  const prefixBytes = new Set<number>();
  const assemblyIndex = new Map<string, AssemblyEntry[]>();

  // resolve explicit opcodes
  if (def.opcodes) {
    for (const [key, entry] of Object.entries(def.opcodes)) {
      const opcode = parseOpcodeKey(key);
      opcodeTable.set(opcode, resolveOpcodeDef(entry, opcode, []));
    }
  }

  // resolve patterns
  if (def.patterns) {
    const resolved = resolvePatterns(def.patterns, registerSets, []);
    for (const [opcode, instr] of resolved) {
      if (!opcodeTable.has(opcode)) opcodeTable.set(opcode, instr);
    }
  }

  // resolve prefix groups
  if (def.prefix_groups) {
    for (const [_name, group] of Object.entries(def.prefix_groups)) {
      const table: PrefixTable = {
        prefix: group.prefix,
        opcodes: new Map(),
        hasDisplacement: group.has_displacement ?? false,
      };

      if (group.opcodes) {
        for (const [key, entry] of Object.entries(group.opcodes)) {
          const opcode = parseOpcodeKey(key);
          table.opcodes.set(opcode, resolveOpcodeDef(entry, opcode, group.prefix));
        }
      }

      if (group.patterns) {
        const resolved = resolvePatterns(group.patterns, registerSets, group.prefix);
        for (const [opcode, instr] of resolved) {
          if (!table.opcodes.has(opcode)) table.opcodes.set(opcode, instr);
        }
      }

      // register prefix bytes
      prefixBytes.add(group.prefix[0]!);

      // key: single prefix → first byte, double prefix → composite
      if (group.prefix.length === 2) {
        prefixTables.set((group.prefix[0]! << 8) | group.prefix[1]!, table);
      } else {
        prefixTables.set(group.prefix[0]!, table);
      }
    }
  }

  // build assembly index: base mnemonic → entries
  function addToIndex(instr: ResolvedInstruction) {
    const base = instr.template.split(/[\s,]/)[0]!;
    if (!assemblyIndex.has(base)) assemblyIndex.set(base, []);
    assemblyIndex.get(base)!.push({
      encoding: instr.encoding,
      operandBytes: instr.operandBytes,
      template: instr.template,
    });
  }

  for (const instr of opcodeTable.values()) addToIndex(instr);
  for (const table of prefixTables.values()) {
    for (const instr of table.opcodes.values()) addToIndex(instr);
  }

  return {
    name: def.cpu.name,
    endian: def.cpu.endian,
    registerSets,
    opcodeTable,
    prefixTables,
    prefixBytes,
    assemblyIndex,
  };
}
