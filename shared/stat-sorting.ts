import {latestStats}from'./catalog.ts';
import type{Box,Model,Player}from'./types.ts';
export function comparePlayerStats(a:string,b:string,key:string,direction:number,players:Map<string,Player>,models:Record<string,Model>,minutes?:Record<string,number>){
  const value=(id:string):string|number|null=>key==='name'?players.get(id)!.fullName:key==='rating'?models[id].overall:key==='minutes'?(minutes?.[id]??0):latestStats(players.get(id)!)?.[1][key as 'points']??null;
  const x=value(a),y=value(b);if(x===null)return y===null?0:1;if(y===null)return-1;
  return(typeof x==='string'&&typeof y==='string'?x.localeCompare(y):Number(x)-Number(y))*direction;
}
export function boxValue(b:Box & {gp?:number},key:string,average=false){
  const divisor=average?(b.gp??1):1;
  if(key==='reb')return(b.orb+b.drb)/divisor;
  if(key==='fgPct')return b.fga?b.fgm/b.fga:-1;if(key==='tpPct')return b.tpa?b.tpm/b.tpa:-1;
  return Number(b[key as keyof Box]??0)/(key==='gp'?1:divisor);
}
