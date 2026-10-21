import React,{useEffect,useRef,useState}from'react';
import {api,APP_BASE}from'./api.ts';
type Notice={id:string;title:string;body:string;leagueId:string;created:number;seen:number};
type InstallEvent=Event&{prompt:()=>Promise<void>};
export function PhoneTools({onLeague,userId}:{onLeague:(id:string)=>void;userId:string}){
  const [open,setOpen]=useState(false),[items,setItems]=useState<Notice[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[install,setInstall]=useState<InstallEvent|null>(null);
  const [toast,setToast]=useState<Notice|null>(null),known=useRef<Set<string>|null>(null);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),8000);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{
    const load=()=>void api<Notice[]>('notifications').then(next=>{if(known.current){const fresh=next.find(n=>!n.seen&&!known.current!.has(n.id));if(fresh)setToast(fresh);}known.current=new Set(next.map(n=>n.id));setItems(next);}).catch(()=>{});load();const timer=setInterval(load,10000);
    const resumed=()=>{if(document.visibilityState==='visible')load();};document.addEventListener('visibilitychange',resumed);
    const receive=(e:Event)=>{e.preventDefault();setInstall(e as InstallEvent);};window.addEventListener('beforeinstallprompt',receive);
    return()=>{clearInterval(timer);window.removeEventListener('beforeinstallprompt',receive);document.removeEventListener('visibilitychange',resumed);};
  },[userId]);
  async function enable(){
    setBusy(true);setMessage('');
    try{
      if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))throw Error('On iPhone, add Courtside to your Home Screen and open it there. Use a current browser on Android.');
      const config=await api<{configured:boolean;publicKey:string|null}>('push');
      if(!config.configured||!config.publicKey)throw Error('Phone push needs the online HTTPS league server configured first. Your in-app notification inbox already works.');
      const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Notifications were not enabled. You can change permission in your phone’s site settings.');
      const registration=await navigator.serviceWorker.ready;
      const key=config.publicKey.replace(/-/g,'+').replace(/_/g,'/');const bytes=Uint8Array.from(atob(key+'='.repeat((4-key.length%4)%4)),c=>c.charCodeAt(0));
      const subscription=await registration.pushManager.getSubscription()??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
      await api('push',{subscription:subscription.toJSON()});setMessage('Phone notifications enabled for draft turns, tip-offs, final scores, and trade offers.');
    }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  async function disable(){setBusy(true);try{const registration=await navigator.serviceWorker.ready;const subscription=await registration.pushManager.getSubscription();if(subscription){await api('push',{action:'unsubscribe',subscription:subscription.toJSON()});await subscription.unsubscribe();}setMessage('Phone notifications disabled on this device.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  return <><button className="bell-button" aria-label={`Notifications${items.some(n=>!n.seen)?' · unread':''}`} onClick={()=>{setOpen(!open);if(!open)void api('notifications',{}).then(()=>setItems(items.map(n=>({...n,seen:1}))));}}><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 20h4"/></svg>{items.some(n=>!n.seen)&&<i/>}</button>{toast&&!open&&<aside className="notification-toast" role="status"><button onClick={()=>{onLeague(toast.leagueId);setToast(null);}}><strong>{toast.title}</strong><span>{toast.body}</span></button><button aria-label="Dismiss notification" onClick={()=>setToast(null)}>×</button></aside>}{open&&<div className="phone-overlay" onClick={()=>setOpen(false)}><section className="notification-sheet" role="dialog" aria-modal="true" aria-label="Notifications" onClick={e=>e.stopPropagation()}><div className="section-heading"><h2>Your league, in the loop.</h2><button aria-label="Close notifications" onClick={()=>setOpen(false)}>×</button></div><div className="push-settings"><button className="primary" disabled={busy} onClick={()=>void enable()}>Enable phone alerts</button><button className="text-button" disabled={busy||!('serviceWorker'in navigator)} onClick={()=>void disable()}>Disable alerts</button><p>iPhone: Safari → Share → Add to Home Screen, then open the installed app to enable alerts. Android / Samsung: install from your browser menu, then allow notifications.</p>{install?<button className="subtle" onClick={()=>void install.prompt()}>Install Courtside ↗</button>:<a className="text-button" href={APP_BASE+'manifest.webmanifest'} onClick={e=>{e.preventDefault();setMessage('Use your browser’s Add to Home Screen or Install app option.');}}>How to install →</a>}{message&&<div className="push-message" role="status">{message}</div>}</div><div className="notification-list">{items.length?items.map(n=><button key={n.id} onClick={()=>{onLeague(n.leagueId);setOpen(false);}}><strong>{n.title}</strong><p>{n.body}</p><small>{new Date(n.created).toLocaleString()}</small></button>):<div className="empty">Draft turns, game results, and trade offers will appear here.</div>}</div></section></div>}</>;
}
