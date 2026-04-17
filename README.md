# MultiDasm

A multi-CPU assembler and disassembler driven by a declarative YAML DSL. Add a new CPU by writing an opcode table — not by writing code.

## Supported CPUs

| CPU | Status | Notes |
|---|---|---|
| MOS 6502 | Working | Standard NMOS opcode set |
| Zilog Z80 | Working | Full CB / DD / FD / ED / DDCB / FDCB prefix coverage |
| Motorola 6809 | Working | Indexed addressing (pre/post inc-dec, PCR, indirect) |
| Motorola 68000 | Working | Word-based opcodes, full effective-address decoding |

Each CPU definition lives in a single YAML file under [`cpus/`](cpus/).

## Install

```
npm install
npm run build
```

This produces `dist/cli.js`. Optionally `npm link` to get a global `multidasm` command.

## CLI

### Disassemble

Recursive-descent disassembly from one or more entry points:

```
multidasm disasm --cpu 6502 --file rom.bin --base 0xC000
multidasm disasm --cpu z80  --hex  "3E 42 32 00 C0 C9" --base 0x8000
```

Options:

- `-c, --cpu <name>` — CPU name (resolves to `cpus/<name>.yaml`) or a path to a YAML file
- `-f, --file <path>` — binary input
- `-x, --hex <data>` — hex-string input (whitespace/commas ignored)
- `-b, --base <addr>` — base load address (default `0`)
- `-e, --entry <addrs>` — comma-separated entry points (default: `base`)
- `-o, --output <path>` — write output to file instead of stdout

### Assemble

```
multidasm asm --cpu 6809 --file prog.asm --output prog.bin
multidasm asm --cpu z80  --file prog.asm --hex
```

Source files support `ORG`, labels (`name:`), and the mnemonics defined in the CPU's YAML.

### Round-trip

Assemble then immediately disassemble — useful when developing a CPU definition:

```
multidasm roundtrip --cpu 68000 --file prog.asm
```

## DSL overview

A CPU definition is a YAML file with these top-level sections:

```yaml
cpu:
  name: "MOS 6502"
  endian: little
  opcode_width: 1         # 1 (default) or 2 for word-based ISAs like 68000

register_sets:            # named sets referenced from templates
  r8: [B, C, D, E, H, L, "(HL)", A]

operand_types:            # custom operand decoders (indexed, effective_address, …)
  idx:
    kind: indexed
    # …

opcodes:
  0x00: ["BRK", 0]                      # mnemonic with 0 operand bytes
  0x10: ["BPL e", 1, cond_branch]       # relative branch
  0xA9: ["LDA #n", 1]                   # 8-bit immediate

patterns:                 # opcode ranges with bit-field substitution
  - range: [0x40, 0x7F]
    template: "LD {r8:5-3},{r8:2-0}"

prefix_groups:            # CB/DD/FD/ED-style second tables
  CB:
    prefix: [0xCB]
    opcodes:
      0x00: ["RLC B", 0]
```

Template placeholders:

| Token | Meaning |
|---|---|
| `n` | 8-bit immediate (displayed `$XX`) |
| `nn` | 16-bit immediate/address (`$XXXX`) |
| `e` | 8-bit relative offset (rendered as target address) |
| `+d` | signed displacement (`+N` / `-N`) |
| `{r8:5-3}` | register from set `r8`, encoded in bits 5–3 of the opcode |
| `{bit:5-3}` | literal bit number 0–7 |

Flow annotations (`jump`, `cond_branch`, `call`, `cond_call`, `return`, `cond_return`, `indirect`) drive the disassembler's recursive descent.

## Repository layout

```
cpus/         CPU definitions (YAML)
src/
  cli.ts          commander-based CLI
  dsl/parser.ts   YAML → CpuModel
  core/
    assembler.ts       source → bytes
    disassembler.ts    bytes → instructions (recursive descent)
    operand-types.ts   shared encoders/decoders for custom operand kinds
  types.ts        DSL + runtime type definitions
test/         sample `.asm` files per CPU
```

## License

[MIT](LICENSE) © Damien Guard
