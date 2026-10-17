export interface AssemblyDiagnostic {
  line: number;
  column: number;
  message: string;
  code: string;
}

export interface ListingEntry {
  address: number;
  word: number;
  line: number;
  column: number;
  source: string;
  mnemonic: string;
}

export interface AssemblyResult {
  ok: boolean;
  rom: number[];
  listing: ListingEntry[];
  diagnostics: AssemblyDiagnostic[];
  symbols: Record<string, number>;
}

export type Expression =
  | { kind: 'number'; value: number; column: number }
  | { kind: 'symbol'; name: string; column: number }
  | { kind: 'unary'; operator: '+' | '-'; expression: Expression; column: number }
  | { kind: 'binary'; operator: '+' | '-'; left: Expression; right: Expression; column: number };

export interface SymbolLocation { name: string; column: number }

export interface ParsedLine {
  line: number;
  raw: string;
  labels: SymbolLocation[];
  operation?: string;
  column: number;
  expression?: Expression;
  constant?: SymbolLocation;
  address?: number;
}
