using System;
using System.Collections.Generic;
using System.IO;

namespace MultiDasm.Library
{
    public class Disassembler
    {
        private readonly string processor;
        private readonly OpcodeTables tables;
        private readonly HashSet<long> visited = new HashSet<long>();
        private readonly Queue<long> unvisited = new Queue<long>();
        private OpcodeTable table;
        private long address;

        internal Disassembler(string processor, OpcodeTables tables)
        {
            this.processor = processor;
            this.tables = tables;
        }

        public string Processor { get { return processor; } }

        private void Reset()
        {
            visited.Clear();
            unvisited.Clear();
            table = tables["#"];
            address = 0;
        }

        public void Disassemble(FileStream stream, TextWriter output)
        {
            Reset();

            using (var r = new BinaryReader(stream)) {
                do {
                    var opcode = table[r.ReadByte()];

                    OpcodeTable newTable;
                    if (tables.TryGetValue(opcode.Mnemonic, out newTable)) {
                        table = newTable;
                    } else {
                        ProcessOpcode(r, opcode, output);
                    }
                } while (!visited.Contains(address) && address >= 0);
            }
        }

        private void AddAddress(long address)
        {
            if (!visited.Contains(address) && !unvisited.Contains(address))
                unvisited.Enqueue(address);
        }

        private void DoNextUnvisited()
        {
            if (unvisited.Count > 0)
                address = unvisited.Dequeue();
            else
                address = -1;
        }

        private void ProcessOpcode(BinaryReader r, Opcode opcode, TextWriter output)
        {
            var resolvedMnemonic = opcode.Mnemonic;
            long? decodedAddress = null;

            if (resolvedMnemonic.Contains("nn")) {
                decodedAddress = r.ReadUInt16();
                resolvedMnemonic = opcode.Mnemonic.Replace("nn", decodedAddress.Value.ToString("X4"));
            }

            if (resolvedMnemonic.Contains("n")) {
                resolvedMnemonic = opcode.Mnemonic.Replace("n", r.ReadByte().ToString("X2"));
            }

            if (resolvedMnemonic.Contains("e")) {
                decodedAddress = address + r.ReadSByte();
                resolvedMnemonic = opcode.Mnemonic.Replace("e", decodedAddress.Value.ToString("X4"));
            }

            switch (opcode.Type) {
                case OpcodeType.InstructionSwitch:
                case OpcodeType.RegisterSwitch:
                case OpcodeType.Invalid:
                    break;

                default:
                    output.WriteLine("{0:X4}\t{1}", address, resolvedMnemonic);
                    table = tables["#"];
                    visited.Add(address);
                    address = r.BaseStream.Position;
                    break;
            }

            switch (opcode.Type) {
                case OpcodeType.JumpAlways:
                    AddAddress(decodedAddress.Value);
                    DoNextUnvisited();
                    break;

                case OpcodeType.Call:
                case OpcodeType.JumpMaybe:
                    AddAddress(decodedAddress.Value);
                    break;

                case OpcodeType.ReturnAlways:
                    DoNextUnvisited();
                    break;

                case OpcodeType.ReturnMaybe:
                    break;
            }

            r.BaseStream.Position = address;
        }
    }
}