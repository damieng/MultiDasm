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
  OperandTypeDef,
  IndexedOperandDef,
  RegisterPairDef,
  RegisterListDef,
  RegisterList16Def,
  EffectiveAddressDef,
  EAModeDef,
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

function parseBitRange(s: string): [number, number] {
  const parts = s.split("-").map((x) => parseInt(x.trim(), 10));
  return [parts[0]!, parts[1]!];
}

// --- Operand type parsing ---

function parseOperandTypes(raw: Record<string, Record<string, unknown>>): Map<string, OperandTypeDef> {
  const result = new Map<string, OperandTypeDef>();
  for (const [name, def] of Object.entries(raw)) {
    const kind = def["kind"] as string;
    switch (kind) {
      case "indexed":
        result.set(name, parseIndexedDef(def));
        break;
      case "register_pair":
        result.set(name, parseRegPairDef(def));
        break;
      case "register_list":
        result.set(name, parseRegListDef(def));
        break;
      case "register_list_16":
        result.set(name, parseRegList16Def(def));
        break;
      case "effective_address":
        result.set(name, parseEADef(def));
        break;
    }
  }
  return result;
}

function parseRegList16Def(raw: Record<string, unknown>): RegisterList16Def {
  const bitsRaw = raw["bits"] as Record<number, string>;
  const bits = new Map<number, string>();
  const reverseMap = new Map<string, number>();
  for (const [pos, name] of Object.entries(bitsRaw)) {
    const bitPos = parseInt(pos, 10);
    bits.set(bitPos, name.toUpperCase());
    reverseMap.set(name.toUpperCase(), bitPos);
  }
  return { kind: "register_list_16", bits, reverseMap };
}

function parseEAModeDef(raw: Record<string, unknown>): EAModeDef {
  const result: EAModeDef = {
    format: (raw["format"] as string) ?? "",
    extensionWords: (raw["extension_words"] as number | "size") ?? 0,
  };
  if (raw["sub_modes"]) {
    result.subModes = new Map<number, EAModeDef>();
    const subsRaw = raw["sub_modes"] as Record<string, Record<string, unknown>>;
    for (const [key, val] of Object.entries(subsRaw)) {
      result.subModes.set(parseOpcodeKey(key), parseEAModeDef(val));
    }
  }
  return result;
}

function parseEADef(raw: Record<string, unknown>): EffectiveAddressDef {
  const modesRaw = raw["modes"] as Record<string, Record<string, unknown>>;
  const modes = new Map<number, EAModeDef>();
  for (const [key, val] of Object.entries(modesRaw)) {
    modes.set(parseOpcodeKey(key), parseEAModeDef(val));
  }
  return {
    kind: "effective_address",
    modeBits: parseBitRange((raw["mode_bits"] as string) ?? "5-3"),
    registerBits: parseBitRange((raw["register_bits"] as string) ?? "2-0"),
    sizeBits: raw["size_bits"] ? parseBitRange(raw["size_bits"] as string) : undefined,
    dataRegisters: (raw["data_registers"] as string[]) ?? [],
    addressRegisters: (raw["address_registers"] as string[]) ?? [],
    modes,
  };
}

function parseIndexedDef(raw: Record<string, unknown>): IndexedOperandDef {
  const registers = raw["index_registers"] as string[];
  const indirectBit = (raw["indirect_bit"] as number) ?? 4;
  const autoOff = raw["auto_offset"] as Record<string, unknown> | undefined;
  const regBits = autoOff?.["register_bits"]
    ? parseBitRange(autoOff["register_bits"] as string)
    : [6, 5] as [number, number];
  const offBits = autoOff?.["offset_bits"]
    ? parseBitRange(autoOff["offset_bits"] as string)
    : [4, 0] as [number, number];

  const modesRaw = raw["modes"] as Record<string, Record<string, unknown>>;
  const modes = new Map<number, { format: string; extra: number; noIndirect?: boolean; indirectOnly?: boolean; noRegister?: boolean }>();
  for (const [key, val] of Object.entries(modesRaw)) {
    const code = parseOpcodeKey(key);
    modes.set(code, {
      format: val["format"] as string,
      extra: (val["extra"] as number) ?? 0,
      noIndirect: val["no_indirect"] as boolean | undefined,
      indirectOnly: val["indirect_only"] as boolean | undefined,
      noRegister: val["no_register"] as boolean | undefined,
    });
  }

  return {
    kind: "indexed",
    registers,
    indirectBit,
    shortOffset: {
      registerBits: regBits,
      offsetBits: offBits,
      signed: (autoOff?.["signed"] as boolean) ?? true,
    },
    modes,
  };
}

function parseRegPairDef(raw: Record<string, unknown>): RegisterPairDef {
  const regsRaw = raw["registers"] as Record<string, number>;
  const registers = new Map<string, number>();
  const reverseMap = new Map<number, string>();
  for (const [name, code] of Object.entries(regsRaw)) {
    registers.set(name.toUpperCase(), code);
    reverseMap.set(code, name.toUpperCase());
  }
  return {
    kind: "register_pair",
    registers,
    reverseMap,
    sourceBits: parseBitRange((raw["source_bits"] as string) ?? "7-4"),
    destBits: parseBitRange((raw["dest_bits"] as string) ?? "3-0"),
  };
}

function parseRegListDef(raw: Record<string, unknown>): RegisterListDef {
  const bitsRaw = raw["bits"] as Record<number, string>;
  const bits = new Map<number, string>();
  const reverseMap = new Map<string, number>();
  for (const [pos, name] of Object.entries(bitsRaw)) {
    const bitPos = parseInt(pos, 10);
    bits.set(bitPos, name.toUpperCase());
    reverseMap.set(name.toUpperCase(), bitPos);
  }
  return { kind: "register_list", bits, reverseMap };
}

// --- Instruction resolution ---

function resolveOpcodeDef(
  entry: OpcodeDef,
  opcode: number,
  prefix: number[],
  operandTypeNames: Set<string>,
  resolvedTypes?: Map<string, OperandTypeDef>,
): ResolvedInstruction {
  const template = entry[0];
  const second = entry[1];
  let operandBytes: number;

  if (typeof second === "string") {
    // custom operand type — determine base bytes from kind
    const typeDef = resolvedTypes?.get(second);
    if (typeDef?.kind === "effective_address") {
      operandBytes = 0; // EA extension words are dynamic
    } else if (typeDef?.kind === "register_list_16") {
      operandBytes = 1; // will consume 2 bytes (handled by decoder)
    } else {
      operandBytes = 1; // default: 1 postbyte (indexed, register_pair, register_list)
    }
  } else {
    operandBytes = second;
  }

  const flow = entry[2] as string | undefined;
  const customOperands = detectCustomOperands(template, operandTypeNames);

  return { template, operandBytes, encoding: [...prefix, opcode], flow, customOperands };
}

function detectCustomOperands(template: string, typeNames: Set<string>): string[] | undefined {
  const found: string[] = [];
  for (const name of typeNames) {
    const idx = template.indexOf(name);
    if (idx >= 0) {
      const before = template[idx - 1];
      const after = template[idx + name.length];
      if ((!before || !/[a-zA-Z_]/.test(before)) && (!after || !/[a-zA-Z_]/.test(after))) {
        found.push(name);
      }
    }
  }
  return found.length > 0 ? found : undefined;
}

function resolvePatterns(
  patterns: PatternDef[],
  registerSets: Record<string, string[]>,
  prefix: number[],
  operandTypeNames: Set<string>,
  resolvedTypes?: Map<string, OperandTypeDef>,
): Map<number, ResolvedInstruction> {
  const result = new Map<number, ResolvedInstruction>();
  for (const pat of patterns) {
    const [lo, hi] = pat.range;
    for (let opcode = lo; opcode <= hi; opcode++) {
      if (pat.exclude) {
        const keys = [
          `0x${opcode.toString(16).toUpperCase().padStart(2, "0")}`,
          `0x${opcode.toString(16).padStart(2, "0")}`,
          opcode.toString(),
        ];
        let excluded = false;
        for (const k of keys) {
          if (pat.exclude[k]) {
            result.set(opcode, resolveOpcodeDef(pat.exclude[k]!, opcode, prefix, operandTypeNames, resolvedTypes));
            excluded = true;
            break;
          }
        }
        if (excluded) continue;
      }

      const template = expandTemplate(pat.template, opcode, registerSets);
      const customOperands = detectCustomOperands(template, operandTypeNames);
      result.set(opcode, {
        template,
        operandBytes: pat.operand_bytes ?? 0,
        encoding: [...prefix, opcode],
        flow: pat.flow,
        customOperands,
      });
    }
  }
  return result;
}

// --- Model building ---

export function buildCpuModel(def: CpuDef): CpuModel {
  const registerSets = def.register_sets ?? {};
  const operandTypes = def.operand_types
    ? parseOperandTypes(def.operand_types as Record<string, Record<string, unknown>>)
    : new Map<string, OperandTypeDef>();
  const operandTypeNames = new Set(operandTypes.keys());

  const opcodeTable = new Map<number, ResolvedInstruction>();
  const prefixTables = new Map<number, PrefixTable>();
  const prefixBytes = new Set<number>();
  const assemblyIndex = new Map<string, AssemblyEntry[]>();

  // explicit opcodes
  if (def.opcodes) {
    for (const [key, entry] of Object.entries(def.opcodes)) {
      const opcode = parseOpcodeKey(key);
      opcodeTable.set(opcode, resolveOpcodeDef(entry, opcode, [], operandTypeNames, operandTypes));
    }
  }

  // patterns
  if (def.patterns) {
    const resolved = resolvePatterns(def.patterns, registerSets, [], operandTypeNames, operandTypes);
    for (const [opcode, instr] of resolved) {
      if (!opcodeTable.has(opcode)) opcodeTable.set(opcode, instr);
    }
  }

  // prefix groups
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
          table.opcodes.set(opcode, resolveOpcodeDef(entry, opcode, group.prefix, operandTypeNames, operandTypes));
        }
      }

      if (group.patterns) {
        const resolved = resolvePatterns(group.patterns, registerSets, group.prefix, operandTypeNames, operandTypes);
        for (const [opcode, instr] of resolved) {
          if (!table.opcodes.has(opcode)) table.opcodes.set(opcode, instr);
        }
      }

      prefixBytes.add(group.prefix[0]!);

      if (group.prefix.length === 2) {
        prefixTables.set((group.prefix[0]! << 8) | group.prefix[1]!, table);
      } else {
        prefixTables.set(group.prefix[0]!, table);
      }
    }
  }

  // assembly index
  function addToIndex(instr: ResolvedInstruction) {
    const base = instr.template.split(/[\s,]/)[0]!;
    if (!assemblyIndex.has(base)) assemblyIndex.set(base, []);
    assemblyIndex.get(base)!.push({
      encoding: instr.encoding,
      operandBytes: instr.operandBytes,
      template: instr.template,
      customOperands: instr.customOperands,
    });
  }

  for (const instr of opcodeTable.values()) addToIndex(instr);
  for (const table of prefixTables.values()) {
    for (const instr of table.opcodes.values()) addToIndex(instr);
  }

  return {
    name: def.cpu.name,
    endian: def.cpu.endian,
    opcodeWidth: def.cpu.opcode_width ?? 1,
    registerSets,
    opcodeTable,
    prefixTables,
    prefixBytes,
    assemblyIndex,
    operandTypes,
  };
}
