export async function pickProjectDirectory() {
  if (!('showDirectoryPicker' in window)) {
    throw new Error(
      'File System Access API not supported. Use Chrome, Edge, or Opera on localhost.'
    );
  }
  try {
    const dirHandle = await window.showDirectoryPicker({
      id: 'orgpulse-dev-project',
      mode: 'read',
      startIn: 'documents',
    });
    return dirHandle;
  } catch (err) {
    if (err.name === 'AbortError') return null;
    throw err;
  }
}

export async function* walkDirectory(dirHandle, path = '') {
  for await (const entry of dirHandle.values()) {
    const entryPath = path ? `${path}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      if (['.git', 'node_modules', '.sfdx', '.sf'].includes(entry.name)) continue;
      yield* walkDirectory(entry, entryPath);
    } else {
      yield { path: entryPath, handle: entry };
    }
  }
}
