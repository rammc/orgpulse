const ENABLED = true; // Always on during prototype

export const log = {
  info: (stage, message, data) => {
    if (!ENABLED) return;
    if (data !== undefined) console.log(`[${stage}]`, message, data);
    else console.log(`[${stage}]`, message);
  },
  warn: (stage, message, data) => {
    if (!ENABLED) return;
    if (data !== undefined) console.warn(`[${stage}]`, message, data);
    else console.warn(`[${stage}]`, message);
  },
  error: (stage, message, data) => {
    if (data !== undefined) console.error(`[${stage}]`, message, data);
    else console.error(`[${stage}]`, message);
  },
};
