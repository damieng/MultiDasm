using System;

namespace MultiDasm.Library
{
    public enum OpcodeType
    {
        Regular,
        InstructionSwitch,
        RegisterSwitch,
        Jump,
        Call,
        Return,
        Invalid
    }

    public class Opcode
    {
        private readonly Byte code;
        private readonly string mnemonic;
        private readonly OpcodeType type;

        public Opcode(Byte code, string mnemonic, OpcodeType type)
        {
            this.code = code;
            this.mnemonic = mnemonic;
            this.type = type;
        }

        public Byte Code { get { return code; } }

        public string Mnemonic { get { return mnemonic; } }

        public OpcodeType Type { get { return type; } }
    }
}