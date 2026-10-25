// Updates never reload, message skipWaiting, or claim live clients.
export function watchRegistration(registration, notify) {
 let worker;
 const changed=()=>{if(registration.waiting)notify()};
 const found=()=>{worker?.removeEventListener('statechange',changed);worker=registration.installing;worker?.addEventListener('statechange',changed);changed()};
 registration.addEventListener('updatefound',found);found();
 return ()=>{registration.removeEventListener('updatefound',found);worker?.removeEventListener('statechange',changed)};
}
