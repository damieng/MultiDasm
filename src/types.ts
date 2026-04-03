// --- DSL schema types (what the YAML files describe) ---

export interface CpuDef {
  cpu: {
    name: string;
    endian: "little" | "big";
  };
  register_sets?: Record<string, string[]>;
  opcodes: Record<string, OpcodeDef>;
  patterns?: PatternDef[];
  prefix_groups?: Record<string, PrefixGroupDef>;
}

// [template, operand_bytes] or [template, operand_bytes, flow_type]
export type OpcodeDef =
  | [string, number]
  | [string, number, string];

export interface PatternDef {
  range: [number, number];
  template: string;        // e.g. "LD {r8:5-3},{r8:2-0}"
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

// --- Resolved runtime types ---

export interface CpuModel {
  name: string;
  endian: "little" | "big";
  registerSets: Record<string, string[]>;
  opcodeTable: Map<number, ResolvedInstruction>;
  prefixTables: Map<number, PrefixTable>;
  prefixBytes: Set<number>;
  assemblyIndex: Map<string, AssemblyEntry[]>;
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
}

export interface AssemblyEntry {
  encoding: number[];
  operandBytes: number;
  template: string;
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
