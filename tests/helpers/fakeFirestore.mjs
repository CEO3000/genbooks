// A small in-memory stand-in for the parts of Firestore the job system and the preview gate use:
// documents by path, subcollections, collection queries with "==", ordering, auto ids, and transactions.
//
// Transactions run one at a time, which models Firestore's serialisable isolation. So these tests prove the LOGIC of the
// lease, the idempotent kickoff and the weekly gate. They do not prove how real Firestore behaves under contention.

function setPath(target, dotted, value) {
  const parts = dotted.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

export function createFakeDb(seed = {}) {
  const store = new Map(Object.entries(seed).map(([path, data]) => [path, structuredClone(data)]));
  let autoId = 0;
  let queue = Promise.resolve();

  const snapshot = (path) => ({
    id: path.split("/").at(-1),
    exists: store.has(path),
    ref: makeRef(path),
    data: () => (store.has(path) ? structuredClone(store.get(path)) : undefined),
  });

  function makeRef(path) {
    return {
      path,
      id: path.split("/").at(-1),
      async get() {
        return snapshot(path);
      },
      async set(data) {
        store.set(path, structuredClone(data));
      },
      async update(patch) {
        if (!store.has(path)) throw new Error(`NOT_FOUND: ${path}`);
        const doc = store.get(path);
        for (const [key, value] of Object.entries(patch)) setPath(doc, key, structuredClone(value));
      },
      async delete() {
        store.delete(path);
      },
      collection: (name) => db.collection(`${path}/${name}`),
    };
  }

  const directChildren = (name) =>
    [...store.keys()].filter((path) => path.startsWith(`${name}/`) && !path.slice(name.length + 1).includes("/"));

  const db = {
    doc: (path) => makeRef(path),
    collection(name) {
      return {
        doc: (id) => makeRef(`${name}/${id ?? `auto${++autoId}`}`),
        async add(data) {
          const ref = makeRef(`${name}/auto${++autoId}`);
          await ref.set(data);
          return ref;
        },
        where(field, op, value) {
          if (op !== "==") throw new Error("the fake only supports ==");
          return {
            async get() {
              const docs = directChildren(name)
                .filter((path) => store.get(path)[field] === value)
                .map(snapshot);
              return { docs, size: docs.length };
            },
          };
        },
        async get() {
          const docs = directChildren(name).map(snapshot);
          return { docs, size: docs.length };
        },
        orderBy(field) {
          return {
            async get() {
              const docs = directChildren(name)
                .map(snapshot)
                .sort((a, b) => (a.data()[field] > b.data()[field] ? 1 : -1));
              return { docs, size: docs.length };
            },
          };
        },
        async listDocuments() {
          return directChildren(name).map(makeRef);
        },
      };
    },
    runTransaction(fn) {
      const run = queue.then(() =>
        fn({
          get: (ref) => ref.get(),
          set: (ref, data) => ref.set(data),
          update: (ref, patch) => ref.update(patch),
        })
      );
      queue = run.catch(() => {});
      return run;
    },
    // test helpers
    _store: store,
    _paths: (prefix) => directChildren(prefix),
  };
  return db;
}
