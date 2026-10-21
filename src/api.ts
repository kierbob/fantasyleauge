const env=(import.meta as ImportMeta & {env:Record<string,string>}).env;
export const API_BASE=(env.VITE_API_URL??'').replace(/\/$/,'');
export const APP_BASE=env.BASE_URL??'/';
export const token=()=>localStorage.getItem('courtside-session');
export async function api<T>(path:string,body?:unknown):Promise<T>{
  const auth=token();
  const res=await fetch(`${API_BASE}/api/${path}`,{method:body===undefined?'GET':'POST',credentials:API_BASE?'omit':'same-origin',headers:{...(auth?{Authorization:`Bearer ${auth}`}:{ }),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await res.json();if(!res.ok)throw Error(data.error??'Request failed');
  if(path==='auth'&&data.token)localStorage.setItem('courtside-session',data.token);
  if(path==='logout')localStorage.removeItem('courtside-session');
  return data;
}
export function openLeagueStream(id:string,onMessage:(data:string)=>void,onStatus:(connected:boolean)=>void){
  const abort=new AbortController();let stopped=false;let retry:ReturnType<typeof setTimeout>;
  async function connect(){
    try{
      const auth=token();const res=await fetch(`${API_BASE}/api/leagues/${id}/events`,{credentials:API_BASE?'omit':'same-origin',headers:auth?{Authorization:`Bearer ${auth}`}:{},signal:abort.signal});
      if(!res.ok||!res.body)throw Error('Stream disconnected');
      const reader=res.body.getReader(),decoder=new TextDecoder();let pending='';onStatus(true);
      while(!stopped){const part=await reader.read();if(part.done)break;pending+=decoder.decode(part.value,{stream:true});let end;
        while((end=pending.indexOf('\n\n'))>=0){const packet=pending.slice(0,end);pending=pending.slice(end+2);if(packet.startsWith('data: '))onMessage(packet.slice(6));}
      }
    }catch{ /* Reconnect to the authoritative snapshot after an interrupted network. */ }
    if(!stopped){onStatus(false);retry=setTimeout(connect,2000);}
  }
  void connect();return()=>{stopped=true;abort.abort();clearTimeout(retry);};
}
