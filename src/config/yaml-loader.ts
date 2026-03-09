import * as fs from 'node:fs';
import * as yaml from 'js-yaml';

/**
 * Reads a YAML file from disk and returns the parsed content as unknown.
 * Throws if the file does not exist or contains invalid YAML.
 *
 * @param filePath - Absolute path to the YAML file
 * @returns Parsed YAML content (unknown type, to be validated by Zod)
 */
export function loadYamlFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `YAML configuration file not found: ${filePath}. ` +
        `Verify the path specified in the corresponding environment variable.`
    );
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = yaml.load(content);
  if (parsed === null || parsed === undefined) {
    throw new Error(
      `YAML configuration file is empty or invalid: ${filePath}`
    );
  }
  return parsed;
}
