  ORG $E000

start:
  LDA #$42
  STA $10
  LDB #$00
  LDX #$C000
loop:
  STA ,X+
  DECB
  BNE loop
  BSR subroutine
  PSHS A,B,X
  TFR X,Y
  PULS A,B,X
  LBRA start

subroutine:
  LDA $20
  ADDA #$01
  STA $20
  RTS
