const MAX_FILE_SIZE = 2 * 1024 * 1024;

export async function readFile(fileHandle) {
  const file = await fileHandle.getFile();
  if (file.size > MAX_FILE_SIZE) {
    return {
      skipped: true,
      reason: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB).`,
      path: file.name,
    };
  }
  try {
    const content = await file.text();
    return { skipped: false, content, size: file.size, path: file.name };
  } catch (err) {
    return { skipped: true, reason: `Read error: ${err.message}`, path: file.name };
  }
}
