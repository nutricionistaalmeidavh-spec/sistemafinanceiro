'use strict';

function assertDateOnly(value, label='date') {
  const text=String(value ?? '').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`invalid ${label}`);
  const [year,month,day]=text.split('-').map(Number);
  const d=new Date(Date.UTC(year,month-1,day));
  if(d.getUTCFullYear()!==year || d.getUTCMonth()!==month-1 || d.getUTCDate()!==day) throw new Error(`invalid ${label}`);
  return text;
}
function localDay(value=new Date()) {
  const d=value instanceof Date ? value : new Date(value);
  if(Number.isNaN(d.valueOf())) throw new Error('invalid current date');
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
module.exports={ assertDateOnly, localDay };
