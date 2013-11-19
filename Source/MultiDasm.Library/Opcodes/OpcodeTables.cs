using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace MultiDasm.Library
{
    [DebuggerDisplay("{Name}")]
    public class OpcodeTable : Dictionary<Byte, Opcode>
    {
        private readonly string name;

        public OpcodeTable(string name)
        {
            this.name = name;
        }

        public string Name { get { return name; } }
    }

    public class OpcodeTables : Dictionary<string, OpcodeTable>
    {
    }
}