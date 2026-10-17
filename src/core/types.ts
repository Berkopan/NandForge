export type ComponentType =
  | 'INPUT' | 'OUTPUT' | 'CONST' | 'CLOCK' | 'NAND' | 'NOT' | 'AND' | 'OR'
  | 'NOR' | 'XOR' | 'XNOR' | 'BUFFER' | 'MUX' | 'DEMUX' | 'DECODER'
  | 'HALF_ADDER' | 'FULL_ADDER' | 'ADDER' | 'SUBTRACTOR' | 'COMPARATOR'
  | 'DFF' | 'REGISTER' | 'COUNTER' | 'RAM' | 'ROM' | 'SPLIT' | 'JOIN' | 'CHIP';

export interface Position { x: number; y: number }
export interface ComponentConfig {
  width?: number;
  addressWidth?: number;
  value?: number;
  initial?: number;
  contents?: number[];
  chipId?: string;
  display?: 'switch' | 'button' | 'led' | 'binary' | 'hex' | 'seven';
}
export interface Component {
  id: string;
  type: ComponentType;
  label?: string;
  position: Position;
  config: ComponentConfig;
}
export interface Endpoint { node: string; pin: string }
export interface Connection { id: string; from: Endpoint; to: Endpoint }
export interface Circuit {
  id: string;
  name: string;
  description?: string;
  version: 1;
  components: Component[];
  connections: Connection[];
}
export interface PinSpec {
  name: string;
  width: number;
  optional?: boolean;
  /** An explicitly documented value for an optional, unconnected pin. */
  defaultValue?: number;
}
export interface ComponentSpec {
  label: string;
  category: string;
  description: string;
  inputs: PinSpec[];
  outputs: PinSpec[];
}
export interface PortBinding { name: string; width: number; nodeId: string }
export interface ChipDefinition {
  id: string;
  name: string;
  description: string;
  version: number;
  inputs: PortBinding[];
  outputs: PortBinding[];
  circuit: Circuit;
}
export interface Diagnostic {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  nodeId?: string;
  connectionId?: string;
  pin?: string;
}
export interface CircuitStats {
  components: number;
  wires: number;
  gates: number;
  sequential: number;
  depth: number;
}
