// Fixed undo belongs to the scroll content, not scroll-padding (which adds no travel).
const pendingReclaims = new WeakMap();
const disposedOwners = new WeakSet();
// The scroll owner's lifecycle outlives the toast, including deferred reclaim.
export function completionClearanceOwner(owner) {
 disposedOwners.delete(owner);
 return {destroy() {
  disposedOwners.add(owner);
  pendingReclaims.get(owner)?.();
  owner.style.removeProperty('--completion-clearance');
 }};
}
export function reserveCompletionClearance(toast) {
 const panel = toast.closest('.task-panel');
 const owner = panel?.querySelector('.task-panel-body') || document.querySelector('.workspace');
 if (!owner) return;
 pendingReclaims.get(owner)?.();
 const scroll = panel ? owner : document.scrollingElement;
 const baseline = () => parseFloat(getComputedStyle(owner).getPropertyValue('--completion-base'));
 const measure = () => {
  const bottom = panel ? owner.getBoundingClientRect().bottom : window.innerHeight;
  const clearance = Math.max(baseline(), Math.ceil(bottom - toast.getBoundingClientRect().top + 12));
  owner.style.setProperty('--completion-clearance', `${clearance}px`);
 };
 const observer = new ResizeObserver(measure);
 observer.observe(toast);
 if (panel) observer.observe(owner);
 window.addEventListener('resize', measure);
 measure();
 return {destroy() {
  observer.disconnect();
  window.removeEventListener('resize', measure);
  if (disposedOwners.has(owner) || !owner.isConnected) return;
  // Do not clamp the active scroll position when undo expires at the bottom.
  // Reclaim as soon as the user has naturally left the extra tail space.
  const stop = () => {document.removeEventListener('scroll', reclaim, true);pendingReclaims.delete(owner)};
  const reclaim = () => {
   const extra = Math.max(0, parseFloat(getComputedStyle(owner).paddingBottom) - baseline());
   if (!owner.isConnected || scroll.scrollTop <= Math.max(0, scroll.scrollHeight - scroll.clientHeight - extra) + 1) {
    owner.style.removeProperty('--completion-clearance');stop();
   }
  };
  pendingReclaims.set(owner, stop);
  document.addEventListener('scroll', reclaim, true);
  reclaim();
 }};
}
