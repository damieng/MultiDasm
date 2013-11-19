using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Globalization;

namespace MultiDasm.Library
{
    public static class Disassemblers
    {
        public static Disassembler Resolve(string processor)
        {
            var path = File.Exists(processor)
               ? processor
               : CreateEmbeddedPath(processor); 

            if (!File.Exists(path))
                throw new FileNotFoundException("Processor description file '{0}' not found.", path);

            return Load(path);
        }

        public static Disassembler Load(string path)
        {
            using (var file = File.OpenRead(path)) {
                using (var reader = new StreamReader(file)) {
                    var processor = reader.ReadLine();
                    var specials = new Dictionary<OpcodeType, List<string>>();

                    string line;
                    do {
                        line = reader.ReadLine();
                        if (!String.IsNullOrEmpty(line)) {
                            var parts = line.Split(':');
                            specials.Add((OpcodeType)Enum.Parse(typeof(OpcodeType), parts[0]), parts[1].Split(',').Select(p => p.Trim()).ToList());
                        }
                    } while (!String.IsNullOrWhiteSpace(line));

                    var tables = ReadTables(processor, reader, specials);
                    return new Disassembler(processor, tables);
                }
            }
        }

        private static OpcodeTables ReadTables(string processor, StreamReader reader, Dictionary<OpcodeType, List<string>> specials)
        {
            var tables = new OpcodeTables();
            OpcodeTable table = null;

            do {
                var line = reader.ReadLine();
                if (line.StartsWith("#")) {
                    table = new OpcodeTable(line.Substring(1));
                    tables.Add(line, table);
                } else {
                    var tabIndex = line.IndexOf('\t');
                    var hex = tabIndex > 0 ? line.Substring(0, tabIndex) : line;
                    var byteCode = Byte.Parse(hex.Trim(), NumberStyles.HexNumber);
                    var mnemonic = tabIndex < 1 ? "?" : line.Substring(tabIndex + 1).Replace('\t', ' ').Trim();
                    var type = DetermineType(mnemonic, specials);
                    var opcode = new Opcode(byteCode, mnemonic, type);
                    table.Add(opcode.Code, opcode);
                }
            } while(!reader.EndOfStream);

            return tables;
        }

        private static OpcodeType DetermineType(string mnemonic, Dictionary<OpcodeType, List<string>> specials)
        {
            if (mnemonic == "?")
                return OpcodeType.Invalid;

            if (mnemonic.StartsWith("#"))
                return OpcodeType.InstructionSwitch;

            foreach (var pair in specials)
                foreach (var item in pair.Value)
                    if (mnemonic.Contains(item))
                        return pair.Key;

            return OpcodeType.Regular;
        }

        private static string CreateEmbeddedPath(string processor)
        {
            var basePath = Path.GetDirectoryName(typeof(Disassembler).Assembly.Location);
            var fileName = Path.ChangeExtension(processor, ".txt");
            return Path.Combine(basePath, "Processors", fileName);
        }
    }
}