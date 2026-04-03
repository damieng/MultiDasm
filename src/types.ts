// --- DSL schema types (what the YAML files describe) ---

export interface CpuDef {
  cpu: {
    name: string;
    endian: "little" | "big";
    opcode_width?: number;  // 1 (default) or 2
  };
  register_sets?: Record<string, string[]>;
  operand_types?: Record<string, RawOperandTypeDef>;
  opcodes: Record<string, OpcodeDef>;
  patterns?: PatternDef[];
  prefix_groups?: Record<string, PrefixGroupDef>;
}

// [template, operand_bytes_or_type] or [template, operand_bytes_or_type, flow_type]
export type OpcodeDef =
  | [string, number]
  | [string, number, string]
  | [string, string]
  | [string, string, string];

export interface PatternDef {
  range: [number, number];
  template: string;
  operand_bytes?: number;
  flow?: string;
  exclude?: Record<string, OpcodeDef>;
}

export interface PrefixGroupDef {
  prefix: number[];
  opcodes?: Record<string, OpcodeDef>;
  patterns?: PatternDef[];
  has_displacement?: boolean;
}

export type RawOperandTypeDef = Record<string, unknown>;

// --- Resolved operand type definitions ---

export type OperandTypeDef =
  | IndexedOperandDef
  | RegisterPairDef
  | RegisterListDef
  | EffectiveAddressDef
  | RegisterList16Def;

export interface IndexedOperandDef {
  kind: "indexed";
  registers: string[];
  indirectBit: number;
  shortOffset: {
    registerBits: [number, number];
    offsetBits: [number, number];
    signed: boolean;
  };
  modes: Map<number, IndexedModeDef>;
}

export interface IndexedModeDef {
  format: string;
  extra: number;
  noIndirect?: boolean;
  indirectOnly?: boolean;
  noRegister?: boolean;
}

export interface RegisterPairDef {
  kind: "register_pair";
  registers: Map<string, number>;
  reverseMap: Map<number, string>;
  sourceBits: [number, number];
  destBits: [number, number];
}

export interface RegisterListDef {
  kind: "register_list";
  bits: Map<number, string>;
  reverseMap: Map<string, number>;
}

export interface RegisterList16Def {
  kind: "register_list_16";
  bits: Map<number, string>;
  reverseMap: Map<string, number>;
}

export interface EffectiveAddressDef {
  kind: "effective_address";
  modeBits: [number, number];
  registerBits: [number, number];
  sizeBits?: [number, number];  // where size is in opcode word
  dataRegisters: string[];
  addressRegisters: string[];
  modes: Map<number, EAModeDef>;
}

export interface EAModeDef {
  format: string;
  extensionWords: number | "size";  // "size" = depends on instruction size
  subModes?: Map<number, EAModeDef>;
}

// --- Resolved runtime types ---

export interface CpuModel {
  name: string;
  endian: "little" | "big";
  opcodeWidth: number;
  registerSets: Record<string, string[]>;
  opcodeTable: Map<number, ResolvedInstruction>;
  prefixTables: Map<number, PrefixTable>;
  prefixBytes: Set<number>;
  assemblyIndex: Map<string, AssemblyEntry[]>;
  operandTypes: Map<string, OperandTypeDef>;
}

export interface PrefixTable {
  prefix: number[];
  opcodes: Map<number, ResolvedInstruction>;
  hasDisplacement: boolean;
}

export interface ResolvedInstruction {
  template: string;
  operandBytes: number;
  encoding: number[];
  flow?: string;
  customOperands?: string[];
}

export interface AssemblyEntry {
  encoding: number[];
  operandBytes: number;
  template: string;
  customOperands?: string[];
}

// --- Disassembly output ---

export interface DisassembledInstruction {
  address: number;
  bytes: number[];
  text: string;
  raw: string;
  isCode: boolean;
  flow?: string;
  branchTarget?: number;
}

export interface DisassemblyResult {
  instructions: Map<number, DisassembledInstruction>;
  entryPoints: number[];
  codeRegions: [number, number][];
  dataRegions: [number, number][];
}
