export async function detectProjectLayout(dirHandle) {
  try {
    await dirHandle.getFileHandle('sfdx-project.json');
    return {
      layout: 'SFDX_ROOT',
      metadataRoot: 'force-app/main/default',
      confidence: 'high',
    };
  } catch {
    /* not found */
  }

  const childNames = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'directory') childNames.push(entry.name);
  }

  if (
    childNames.includes('classes') &&
    (childNames.includes('triggers') || childNames.includes('lwc'))
  ) {
    return { layout: 'SFDX_DEFAULT', metadataRoot: '', confidence: 'high' };
  }
  if (childNames.includes('src')) {
    return {
      layout: 'MDAPI',
      metadataRoot: 'src',
      confidence: 'medium',
      warning: 'Legacy metadata API format detected.',
    };
  }
  if (childNames.includes('classes')) {
    return {
      layout: 'PARTIAL_APEX',
      metadataRoot: '',
      confidence: 'low',
      warning: 'Partial project detected.',
    };
  }
  return {
    layout: 'UNKNOWN',
    metadataRoot: '',
    confidence: 'none',
    error: 'No recognizable Salesforce project structure found.',
  };
}
