declare module 'papaparse' {
 const Papa:{
  parse(input:string,config:{header:true;skipEmptyLines:true;transformHeader?:(header:string)=>string}):{
   data:Record<string,string>[];errors:Array<{message:string}>
  };
 };
 export default Papa;
}
