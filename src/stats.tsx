import React from'react';
export {comparePlayerStats,boxValue}from'../shared/stat-sorting.ts';
export function StatHeader({label,field,current,direction,onSort}:{label:string;field:string;current:string;direction:number;onSort:(field:string)=>void}){
  return <th aria-sort={current===field?(direction===1?'ascending':'descending'):'none'}><button className="sortable-stat" onClick={()=>onSort(field)} aria-label={`Sort by ${label}${current===field?(direction===1?', lowest first':', highest first'):''}`}>{label}<span>{current===field?(direction===1?'↑':'↓'):'↕'}</span></button></th>;
}
export const BOX_FIELDS:Record<string,string>={PLAYER:'name',MIN:'seconds',PTS:'pts',FG:'fgm','3PT':'tpm',FT:'ftm',REB:'reb',AST:'ast',STL:'stl',BLK:'blk',TO:'tov',PF:'pf','+/−':'plusMinus',GP:'gp','FG%':'fgPct','3P%':'tpPct'};
