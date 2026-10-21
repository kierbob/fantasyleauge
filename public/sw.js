const CACHE='courtside-shell-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['./offline.html','./icon.svg'])));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('courtside-shell-')&&key!==CACHE).map(key=>caches.delete(key))))]));});
self.addEventListener('fetch',event=>{if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.match(new URL('./offline.html',self.registration.scope))));});
self.addEventListener('push',event=>{
  let data={title:'Courtside',body:'There’s an update in your league.'};try{data={...data,...event.data.json()};}catch{}
  // Every push displays a user-visible notification, including while the app is closed.
  event.waitUntil(self.registration.showNotification(data.title,{body:data.body,tag:data.tag,icon:new URL('./icons/icon-192.png',self.registration.scope).href,badge:new URL('./icons/icon-192.png',self.registration.scope).href,data:{url:data.url??self.registration.scope,leagueId:data.leagueId}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();const info=event.notification.data??{};
  const target=new URL(info.url??self.registration.scope,self.registration.scope);
  const scope=new URL(self.registration.scope);if(target.origin!==scope.origin)return;
  if(info.leagueId)target.searchParams.set('league',info.leagueId);
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    const existing=clients.find(client=>new URL(client.url).origin===target.origin);
    if(existing){await existing.navigate(target.href);return existing.focus();}
    return self.clients.openWindow(target.href);
  }));
});
