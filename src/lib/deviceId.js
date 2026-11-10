// A random id kept in this browser, so the free-preview rules can tell the
// same browser switching between email accounts (previewGate.js). A
// private window or cleared storage gets a new one, so it is one signal
// among several, never relied on alone.
const KEY = "gb_device";

export function getDeviceId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}
