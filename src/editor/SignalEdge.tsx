import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';
import { formatSignal } from './model';

export interface SignalEdgeData extends Record<string, unknown> {
  value: number | undefined;
  width: number;
  invalid: boolean;
  probed: boolean;
}

export type CircuitFlowEdge = Edge<SignalEdgeData, 'signal'>;

export function SignalEdge(props: EdgeProps<CircuitFlowEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX: props.sourceX, sourceY: props.sourceY, sourcePosition: props.sourcePosition, targetX: props.targetX, targetY: props.targetY, targetPosition: props.targetPosition, borderRadius: 7, offset: 19 });
  const data = props.data;
  const high = data?.value !== undefined && data.value !== 0;
  const className = `nf-signal-edge${high ? ' is-high' : ''}${props.selected ? ' is-selected' : ''}${data?.invalid ? ' is-invalid' : ''}${data?.value === undefined ? ' is-unknown' : ''}${data?.probed ? ' is-probed' : ''}`;
  return <>
    <BaseEdge id={props.id} path={path} className={className} interactionWidth={22} />
    {(props.selected || data?.probed || (data?.width ?? 1) > 1) && <EdgeLabelRenderer>
      <span className={`nf-wire-label nodrag nopan${high ? ' is-high' : ''}${data?.invalid ? ' is-invalid' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}>
        {data?.probed && <span className="nf-probe-dot" />}{formatSignal(data?.value, data?.width ?? 1, data?.width === 1 ? 'decimal' : 'hex')}<small>{data?.width ?? 1}b</small>
      </span>
    </EdgeLabelRenderer>}
  </>;
}
