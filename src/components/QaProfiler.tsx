import { Profiler, type ReactNode } from 'react';

type CommitEvent = {
  phase: string;
  durationMs: number;
  baseDurationMs: number;
  startTimeMs: number;
  commitTimeMs: number;
};
type CommitTotals = { commits:number; totalMs:number; maxMs:number; events:CommitEvent[] };
type QaRenderTotals = Record<string, CommitTotals>;

function onRender(id:string,phase:string,actualDuration:number,baseDuration:number,startTime:number,commitTime:number) {
  if(!import.meta.env.DEV)return;
  const host=window as Window & { __ARTISYS_RENDER_STATS?:QaRenderTotals };
  const metrics=host.__ARTISYS_RENDER_STATS;
  if(!metrics)return;
  const prev=metrics[id] || {commits:0,totalMs:0,maxMs:0,events:[]};
  const sample={phase,durationMs:actualDuration,baseDurationMs:baseDuration,startTimeMs:startTime,commitTimeMs:commitTime};
  metrics[id]={
    commits:prev.commits+1,
    totalMs:prev.totalMs+actualDuration,
    maxMs:Math.max(prev.maxMs,actualDuration),
    events:[...prev.events,sample].slice(-2000)
  };
}

// Not mounted for production builds. No React state or financial data is stored in metrics.
export function qaProfile(id:string,component:ReactNode) {
  return import.meta.env.DEV ? <Profiler id={id} onRender={onRender}>{component}</Profiler> : component;
}
