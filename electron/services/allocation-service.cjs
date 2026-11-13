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
module.exports={splitCents,scopedSplitCents};
