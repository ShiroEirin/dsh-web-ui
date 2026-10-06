//#region src/state.ts
const KEY = Symbol.for("dsh-web-all.shell-state");
/** The process-wide shared shell state (one instance across module copies). */
function shellState() {
	const registry = globalThis;
	return registry[KEY] ??= {
		activeRows: /* @__PURE__ */ new Set(),
		degraded: /* @__PURE__ */ new Map(),
		healthRoutes: { count: 0 }
	};
}
//#endregion
//#region src/degraded.ts
/** Longest recorded reason; a reason is one line of copy, not a stack dump. */
const DEGRADED_REASON_MAX = 500;
/**
* Compress a thrown value into the one line a UI can render: the first
* non-empty line of the message, bounded. The full stack stays in `message`
* for the log and for tooling that wants it.
* @param error - the caught value.
* @param maxLength - bound on the returned string.
* @returns one line naming the failure, never empty.
*/
function failureReason(error, maxLength = 500) {
	const line = ((error instanceof Error ? error.message : String(error)).split("\n", 1)[0] ?? "").trim();
	const reason = line === "" ? "unknown failure" : line;
	return reason.length <= maxLength ? reason : reason.slice(0, maxLength - 3) + "...";
}
/** Record (or refresh) one plugin's degraded state. Errors are logged here once. */
function recordDegraded(plugin, stage, error) {
	const message = error instanceof Error ? error.stack ?? error.message : String(error);
	console.error(`[dsh-web-all] plugin degraded (${stage}): ${plugin}\n${message}`);
	shellState().degraded.set(plugin, {
		plugin,
		stage,
		message,
		reason: failureReason(error),
		at: (/* @__PURE__ */ new Date()).toISOString()
	});
}
/** Clear one plugin's degraded record (successful start after a retry/HMR reload). */
function clearDegraded(plugin) {
	shellState().degraded.delete(plugin);
}
/** Snapshot of all currently degraded plugins. */
function listDegraded() {
	return [...shellState().degraded.values()];
}
/** For test teardown and test isolation only. */
function _resetDegradedForTest() {
	shellState().degraded.clear();
}
//#endregion
export { listDegraded as a, failureReason as i, _resetDegradedForTest as n, recordDegraded as o, clearDegraded as r, shellState as s, DEGRADED_REASON_MAX as t };

//# sourceMappingURL=degraded-DtoWhWX-.js.map