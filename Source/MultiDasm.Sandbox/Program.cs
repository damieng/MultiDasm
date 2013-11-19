using System;
using System.Diagnostics;
using System.IO;
using MultiDasm.Library;

namespace MultiDasm.Sandbox
{
    class Program
    {
        public static void Main(string[] args)
        {
            var arguments = new Arguments(args);
            var info = FileVersionInfo.GetVersionInfo(typeof(Disassembler).Assembly.Location);

            Console.WriteLine("{0} v{1}.{2}", info.ProductName, info.FileMajorPart, info.FileMinorPart);

            if (!arguments.IsValid) {
                Console.Error.WriteLine("Command line arguments invalid.");
                return;
            }

            var disassembler = Disassemblers.Resolve("z80");
            Console.WriteLine("Processor {0}", disassembler.Processor);

            Console.WriteLine("Reading {0}", arguments.InputFile);

            using (var file = File.Open(arguments.InputFile, FileMode.Open))
                disassembler.Disassemble(file, Console.Out);
        }
    }
}