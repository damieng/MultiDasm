// --- DSL schema types (what the YAML files describe) ---

export interface CpuDef {
  cpu: {
    name: string;
    endian: "little" | "big";
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

// Raw YAML operand type definitions (before parsing)
export type RawOperandTypeDef = Record<string, unknown>;

// --- Resolved operand type definitions ---

export type OperandTypeDef = IndexedOperandDef | RegisterPairDef | RegisterListDef;

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
  registers: Map<string, number>;  // name → code
  reverseMap: Map<number, string>; // code → name
  sourceBits: [number, number];
  destBits: [number, number];
}

export interface RegisterListDef {
  kind: "register_list";
  bits: Map<number, string>;  // bit position → register name
  reverseMap: Map<string, number>; // name → bit position
}

// --- Resolved runtime types ---

export interface CpuModel {
  name: string;
  endian: "little" | "big";
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
  customOperands?: string[];  // names of operand_types in this template
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
