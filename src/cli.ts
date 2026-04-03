#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { loadCpuDef, buildCpuModel } from "./dsl/parser.js";
import { disassemble, formatDisassembly } from "./core/disassembler.js";
import { assemble } from "./core/assembler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cpuDir = resolve(__dirname, "..", "cpus");

function resolveCpuPath(cpu: string): string {
  // if it looks like a path, use directly
  if (cpu.includes("/") || cpu.includes("\\") || cpu.endsWith(".yaml") || cpu.endsWith(".yml")) {
    return resolve(cpu);
  }
  return resolve(cpuDir, `${cpu}.yaml`);
}

function parseHex(hex: string): Uint8Array {
  const clean = hex.replace(/[\s,]/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.substring(i, i + 2), 16));
  }
  return new Uint8Array(bytes);
}

const program = new Command();

program
  .name("multidasm")
  .description("Multi-CPU assembler/disassembler")
  .version("0.1.0");

program
  .command("disasm")
  .description("Disassemble binary data (recursive descent)")
  .requiredOption("-c, --cpu <name>", "CPU definition (e.g. 6502, z80, or path to YAML)")
  .option("-f, --file <path>", "Binary file to disassemble")
  .option("-x, --hex <data>", "Hex string to disassemble")
  .option("-b, --base <addr>", "Base address", "0")
  .option("-e, --entry <addrs>", "Entry point addresses (comma-separated), defaults to base")
  .option("-o, --output <path>", "Output file (default: stdout)")
  .action((opts) => {
    const cpuPath = resolveCpuPath(opts.cpu);
    const def = loadCpuDef(cpuPath);
    const model = buildCpuModel(def);

    let data: Uint8Array;
    if (opts.file) {
      data = readFileSync(resolve(opts.file));
    } else if (opts.hex) {
      data = parseHex(opts.hex);
    } else {
      console.error("Error: provide --file or --hex");
      process.exit(1);
    }

    const baseAddr = parseInt(opts.base.replace("$", "0x"), 16) || 0;
    const entryPoints = opts.entry
      ? opts.entry.split(",").map((s: string) => parseInt(s.trim().replace("$", "0x"), 16))
      : [baseAddr];

    const result = disassemble(data, baseAddr, model, entryPoints);
    const output = formatDisassembly(result, data, baseAddr);

    if (opts.output) {
      writeFileSync(resolve(opts.output), output);
      console.log(`Written to ${opts.output}`);
    } else {
      console.log(output);
    }

    // summary
    console.error(`\n--- ${model.name} ---`);
    console.error(`Code regions: ${result.codeRegions.length}`);
    console.error(`Instructions: ${result.instructions.size}`);
    console.error(`Data regions: ${result.dataRegions.length}`);
  });

program
  .command("asm")
  .description("Assemble source code")
  .requiredOption("-c, --cpu <name>", "CPU definition")
  .requiredOption("-f, --file <path>", "Source file to assemble")
  .option("-o, --output <path>", "Output binary file")
  .option("--hex", "Output as hex string instead of binary")
  .action((opts) => {
    const cpuPath = resolveCpuPath(opts.cpu);
    const def = loadCpuDef(cpuPath);
    const model = buildCpuModel(def);

    const source = readFileSync(resolve(opts.file), "utf-8");
    const result = assemble(source, model);

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        console.error(`Error line ${err.line}: ${err.message}`);
      }
    }

    if (opts.hex) {
      const hex = Array.from(result.data)
        .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
        .join(" ");
      console.log(hex);
    } else if (opts.output) {
      writeFileSync(resolve(opts.output), result.data);
      console.log(`Written ${result.data.length} bytes to ${opts.output}`);
    } else {
      // hex to stdout
      const hex = Array.from(result.data)
        .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
        .join(" ");
      console.log(hex);
    }

    console.error(`\nOrigin: $${result.origin.toString(16).toUpperCase().padStart(4, "0")}`);
    console.error(`Size: ${result.data.length} bytes`);
    console.error(`Labels: ${[...result.labels.entries()].map(([k, v]) => `${k}=$${v.toString(16).toUpperCase().padStart(4, "0")}`).join(", ")}`);
  });

program
  .command("roundtrip")
  .description("Assemble then disassemble to verify")
  .requiredOption("-c, --cpu <name>", "CPU definition")
  .requiredOption("-f, --file <path>", "Source file")
  .action((opts) => {
    const cpuPath = resolveCpuPath(opts.cpu);
    const def = loadCpuDef(cpuPath);
    const model = buildCpuModel(def);

    const source = readFileSync(resolve(opts.file), "utf-8");
    const asmResult = assemble(source, model);

    if (asmResult.errors.length > 0) {
      for (const err of asmResult.errors) {
        console.error(`ASM Error line ${err.line}: ${err.message}`);
      }
    }

    console.log("=== Assembled ===");
    const hex = Array.from(asmResult.data)
      .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
      .join(" ");
    console.log(hex);

    console.log("\n=== Disassembled ===");
    const disResult = disassemble(asmResult.data, asmResult.origin, model, [asmResult.origin]);
    console.log(formatDisassembly(disResult, asmResult.data, asmResult.origin));
  });

program.parse();
