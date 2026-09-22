// The post step of action.yml (record 0077). Written by hand, not built: it
// tells the bundle that this is the post step and loads it, so the action
// ships one bundle. After an auto step that was stopped before it settled,
// the bundle settles the deploys of the run. Otherwise it does nothing.
globalThis.sluicewayPost = true;
await import("./index.js");
