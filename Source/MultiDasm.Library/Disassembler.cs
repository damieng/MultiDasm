using System;
using System.Collections.Generic;
using System.IO;

namespace MultiDasm.Library
{
    public class Disassembler
    {
        private readonly string processor;
        private readonly OpcodeTables tables;

        internal Disassembler(string processor, OpcodeTables tables)
        {
            this.processor = processor;
            this.tables = tables;
        }

        public string Processor { get { return processor; } }

        public void Disassemble(FileStream stream, TextWriter output)
        {
            using (var r = new BinaryReader(stream)) {
                var table = tables["#"];
                long address = 0;

                do {
                    var opcode = table[r.ReadByte()];

                    OpcodeTable newTable;
                    if (tables.TryGetValue(opcode.Mnemonic, out newTable)) {
                        table = newTable;
                    } else {
                        var final = ResolveAddress(opcode.Mnemonic, r, address);
                        output.WriteLine("{0:X4}\t{1}", address, final);
                        table = tables["#"];
                        address = stream.Position;
                    }
                } while (stream.Position < stream.Length);
            }
        }

        private static string ResolveAddress(string instruction, BinaryReader r, long address)
        {
            if (instruction.Contains("nn"))
                instruction = instruction.Replace("nn", r.ReadUInt16().ToString("X4"));
            if (instruction.Contains("n"))
                instruction = instruction.Replace("n", r.ReadByte().ToString("X2"));
            if (instruction.Contains("e"))
                instruction = instruction.Replace("e", (address + r.ReadSByte()).ToString("X4"));
            return instruction;
        }
    }
}