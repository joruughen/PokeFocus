// 1 Hz heartbeat for hidden tabs (best effort, see docs/ux-research.md §3).
// Typed against the DOM lib on purpose (one tsconfig for the whole app).
setInterval(() => self.postMessage(0), 1000)
export {}
