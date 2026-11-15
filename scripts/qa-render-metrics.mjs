// Pure, dependency-free QA analysis. Events/counters originate exclusively from the local Electron QA renderer.
const round = (value) => Math.round((Number(value) || 0) * 100) / 100;

export function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted=[...values].map(Number).sort((a,b)=>a-b);
  return round(sorted[Math.max(0, Math.ceil((pct/100)*sorted.length)-1)]);
}

export function summarizeRenderInteraction(interaction, before, after, elapsedMs) {
  const oldRender=before?.render || {}, newRender=after?.render || {};
  const oldEvents=oldRender.events || [], newEvents=newRender.events || [];
  const updatedEvents=newEvents.length>=oldEvents.length ? newEvents.slice(oldEvents.length) : [];
  const durations=updatedEvents.map(e=>Number(e.durationMs)||0);
  const ipc={};
  for(const [name,value] of Object.entries(after?.ipc || {})){
    const delta=Math.max(0,Number(value||0)-Number(before?.ipc?.[name]||0));
    if(delta>0)ipc[name]=delta;
  }
  return {
    interaction,
    commits:Math.max(0,Number(newRender.commits||0)-Number(oldRender.commits||0)),
    totalReactMs:round(Math.max(0,Number(newRender.totalMs||0)-Number(oldRender.totalMs||0))),
    maxCommitMs:round(durations.length?Math.max(...durations):0),
    p50CommitMs:percentile(durations,50),
    p95CommitMs:percentile(durations,95),
    elapsedMs:round(elapsedMs),
    ipc
  };
}

export function compareRenderBaseline(current, baseline) {
  return {
    commitsDelta:Number(current.commits||0)-Number(baseline.commits||0),
    totalReactMsDelta:round(Number(current.totalReactMs||0)-Number(baseline.totalReactMs||0))
  };
}
