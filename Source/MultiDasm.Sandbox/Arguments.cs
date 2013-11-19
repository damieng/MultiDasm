using System;

namespace MultiDasm.Sandbox
{
    class Arguments
    {
        private readonly string inputFile;

        public string InputFile { get { return inputFile; } }

        public bool IsValid { get { return !String.IsNullOrWhiteSpace(inputFile); } }

        public Arguments(string[] args)
        {
            if (args.Length > 0)
                inputFile = args[0];
        }
    }}