// Return a detached copy; failed mutations must never adopt a server snapshot as a draft.
export function draftAfterFailure(draft, _status) { return {...draft}; }
