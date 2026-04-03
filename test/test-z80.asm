  ORG $8000

start:
  LD A,$42
  LD HL,$C000
  LD (HL),A
  INC HL
  LD B,$10
loop:
  LD (HL),A
  INC HL
  DJNZ loop
  CALL subroutine
  JP start

subroutine:
  XOR A
  LD ($FF00),A
  RET
