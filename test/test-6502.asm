  ORG $C000

start:
  LDA #$42
  STA $0200
  LDX #$00
loop:
  STA $0200,X
  INX
  CPX #$10
  BNE loop
  JSR subroutine
  JMP start

subroutine:
  LDA #$00
  STA $FF
  RTS
