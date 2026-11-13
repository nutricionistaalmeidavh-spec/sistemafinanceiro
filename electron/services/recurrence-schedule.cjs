'use strict';
const {assertDateOnly}=require('./date-utils.cjs');
const DAY_MS=86400000;
function dateOnly(value,label='date'){return assertDateOnly(String(value),label);}
function addDays(dateText,count){
  const date=dateOnly(dateText);const days=Number(count);
  if(!Number.isSafeInteger(days)||days<1)throw new Error('intervalDays must be positive');
  return new Date(Date.parse(date+'T00:00:00Z')+days*DAY_MS).toISOString().slice(0,10);
}
function addMonthsClamped(dateText,months,dueDay=Number(String(dateText).slice(-2))){
  const date=dateOnly(dateText),count=Number(months),day=Number(dueDay);
  if(!Number.isSafeInteger(count)||count<0||!Number.isInteger(day)||day<1||day>31)throw new Error('invalid month schedule');
  const d=new Date(date+'T00:00:00Z'),absolute=d.getUTCFullYear()*12+d.getUTCMonth()+count;
  const year=Math.floor(absolute/12),month=absolute%12;
  const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
  return year+'-'+String(month+1).padStart(2,'0')+'-'+String(Math.min(day,last)).padStart(2,'0');
}
function firstDue(rule){
  const start=dateOnly(rule.startDate,'start date');
  if(rule.intervalDays!=null)return start;
  const months=Number(rule.intervalMonths??1),day=Number(rule.dueDay);
  if(!Number.isInteger(months)||months<1||months>12)throw new Error('invalid intervalMonths');
  const candidate=addMonthsClamped(start,0,day);
  return candidate>=start?candidate:addMonthsClamped(candidate,months,day);
}
function nextDue(rule,after){
  const date=dateOnly(after);
  if(rule.intervalDays!=null){
    const days=Number(rule.intervalDays);
    if(![7,14].includes(days))throw new Error('intervalDays must be 7 or 14');
    return addDays(date,days);
  }
  const months=Number(rule.intervalMonths??1);
  if(!Number.isInteger(months)||months<1||months>12)throw new Error('invalid intervalMonths');
  return addMonthsClamped(date,months,Number(rule.dueDay));
}
function annualCycles(start,due){
  const startDate=dateOnly(start),dueDate=dateOnly(due);
  const years=Number(dueDate.slice(0,4))-Number(startDate.slice(0,4));
  if(years<=0)return 0;
  let cycles=years;
  while(cycles>0&&addMonthsClamped(startDate,cycles*12,Number(startDate.slice(-2)))>dueDate)cycles--;
  return cycles;
}
function amountAtDue(rule,due){
  const base=Number(rule.amountCents),bps=Number(rule.annualAdjustmentBps??0);
  if(!Number.isSafeInteger(base)||base<=0)throw new Error('invalid recurring amount');
  if(!Number.isInteger(bps)||bps<0||bps>10000)throw new Error('annualAdjustmentBps must be 0 to 10000');
  let amount=base;
  const anniversary=firstDue(rule);
  for(let year=0;year<annualCycles(anniversary,due);year++){
    amount=Math.round(amount*(10000+bps)/10000);
    if(!Number.isSafeInteger(amount))throw new Error('recurring amount overflow');
  }
  return amount;
}
function forecastRule(rule,state={},options={}){
  if(state.active===false||rule.active===false)return [];
  const from=dateOnly(options.from??rule.startDate),to=dateOnly(options.to??from);
  if(to<from)return [];
  const max=state.maxOccurrences??rule.maxOccurrences??null;
  const endDate=state.endDate??rule.endDate??null;
  let due=dateOnly(state.nextDueAt??rule.nextDueAt??firstDue(rule));
  let count=Number(state.generatedCount??rule.generatedCount??0);
  const limit=Math.min(Math.max(1,Number(options.limit??2000)),10000);
  const rows=[];
  for(let guard=0;due<=to&&guard<10000&&rows.length<limit;guard++){
    if((max!=null&&count>=Number(max))||(endDate&&due>endDate))break;
    if(due>=from)rows.push({dueAt:due,amountCents:amountAtDue(rule,due)});
    const future=nextDue(rule,due);
    if(future<=due)throw new Error('non-progressing recurring schedule');
    due=future;count++;
  }
  return rows;
}
module.exports={addDays,addMonthsClamped,firstDue,nextDue,amountAtDue,forecastRule};
