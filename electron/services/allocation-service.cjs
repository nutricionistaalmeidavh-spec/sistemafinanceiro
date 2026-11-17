'use strict';

// One authoritative allocation function for documents, budgets and DRE.
// Largest-remainder distribution preserves every cent, with stable tie-breaking.
function splitCents(totalCents, allocations=[]) {
  if(!Number.isSafeInteger(totalCents)||totalCents<0)throw new TypeError('totalCents must be a non-negative safe integer');
  if(!Array.isArray(allocations))throw new TypeError('allocations must be an array');
  if(!allocations.length)return new Map();
  const seen=new Set();
  const items=allocations.map((row,index)=>{
    const id=String(row.costCenterId??row.cost_center_id??'').trim();
    const weight=Number(row.amountCents??row.amount_cents);
    if(!id||seen.has(id)||!Number.isSafeInteger(weight)||weight<=0)throw new TypeError('invalid or duplicated allocation');
    seen.add(id);
    return {id,weight:BigInt(weight),index};
  });
  const denominator=items.reduce((sum,row)=>sum+row.weight,0n);
  const total=BigInt(totalCents);
  const remainders=items.map(item=>{
    const scaled=total*item.weight;
    return {...item,allocated:Number(scaled/denominator),remainder:scaled%denominator};
  });
  let remaining=totalCents-remainders.reduce((sum,item)=>sum+item.allocated,0);
  const ranked=[...remainders].sort((a,b)=>a.remainder===b.remainder?a.id.localeCompare(b.id):a.remainder>b.remainder?-1:1);
  for(let i=0;i<remaining;i++)ranked[i].allocated+=1;
  return new Map(remainders.map(row=>[row.id,row.allocated]));
}
// Some legacy records assign less than 100% to cost centers. The remainder is
// explicitly unallocated; it must not be redistributed to configured centers.
function scopedSplitCents(totalCents,entryTotalCents,allocations=[]) {
  if(!Number.isSafeInteger(entryTotalCents)||entryTotalCents<=0)throw new TypeError('invalid entryTotalCents');
  if(!Array.isArray(allocations))throw new TypeError('invalid allocations');
  const sum=allocations.reduce((n,row)=>n+Number(row.amountCents??row.amount_cents),0);
  if(!Number.isSafeInteger(sum)||sum>entryTotalCents)throw new Error('cost-center allocations exceed entry amount');
  if(sum===0)return new Map();
  const fallbackId='\\u0000unallocated';
  const normalized=sum===entryTotalCents?allocations:[...allocations,{costCenterId:fallbackId,amountCents:entryTotalCents-sum}];
  const shares=splitCents(totalCents,normalized);
  shares.delete(fallbackId);
  return shares;
}
function normalizeAllocations(totalCents, allocations = []) {
  const total = integer(totalCents, 'totalCents', { min: 1 });
  if (!Array.isArray(allocations) || allocations.length === 0) throw new TypeError('at least one allocation is required');
  const ids = new Set();
  for (const row of allocations) {
    const id = required(row?.costCenterId, 'costCenterId');
    if (ids.has(id)) throw new Error('duplicate cost center allocation');
    ids.add(id);
  }
  const explicit = allocations.every((row) => row.amountCents != null);
  const percent = allocations.every((row) => row.percentage != null || row.percentageBasisPoints != null);
  if (!explicit && !percent) throw new TypeError('allocations must use either amountCents or percentage');
  if (explicit) {
    const amounts = allocations.map((row) => integer(row.amountCents, 'amountCents', { min: 1 }));
    if (amounts.reduce((sum, value) => sum + value, 0) !== total) throw new Error('allocation values must equal entry amount');
    let bpUsed = 0;
    return allocations.map((row, index) => {
      const amountCents = amounts[index];
      const percentageBasisPoints = index === allocations.length - 1 ? 10000 - bpUsed : Math.round((amountCents / total) * 10000);
      bpUsed += percentageBasisPoints;
      return Object.freeze({ costCenterId: required(row.costCenterId, 'costCenterId'), amountCents, percentageBasisPoints });
    });
  }
  const basis = allocations.map((row) => row.percentageBasisPoints != null
    ? integer(row.percentageBasisPoints, 'percentageBasisPoints', { min: 1, max: 10000 })
    : Math.round(Number(row.percentage) * 100));
  if (basis.some((value) => !Number.isSafeInteger(value) || value <= 0) || basis.reduce((sum, value) => sum + value, 0) !== 10000) {
    throw new Error('allocation percentages must equal 100%');
  }
  const raw = basis.map((bp) => (total * bp) / 10000);
  const amounts = raw.map(Math.floor);
  let remaining = total - amounts.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < remaining; i += 1) amounts[order[i % order.length].index] += 1;
  return allocations.map((row, index) => Object.freeze({ costCenterId: required(row.costCenterId, 'costCenterId'), amountCents: amounts[index], percentageBasisPoints: basis[index] }));
}
module.exports={splitCents,scopedSplitCents,normalizeAllocations};
