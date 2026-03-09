/**
 * Watcher types and constants for the File Watcher (Unit F).
 */

/** File extensions supported for automatic ingestion */
export const SUPPORTED_EXTENSIONS = [
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.yaml',
  '.yml',
  '.xml',
] as const;

export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];
