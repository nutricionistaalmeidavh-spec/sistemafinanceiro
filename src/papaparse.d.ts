declare module 'papaparse' {
 const Papa:{
  parse(input:string,config:{header:true;skipEmptyLines:true;transformHeader?:(header:string)=>string}):{
   data:Record<string,string>[];errors:Array<{message:string}>
  };
  parse(input:File,config:{
    header:true;skipEmptyLines:true;transformHeader?:(header:string)=>string;
    step:(result:{data:Record<string,string>;errors:Array<{message:string}>},parser:{pause():void;resume():void;abort():void})=>void;
    complete:()=>void;error:(error:Error)=>void
  }):void;
 };
 export default Papa;
}
