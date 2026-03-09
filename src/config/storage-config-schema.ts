import { z } from 'zod';

// --- Sub-schemas for each storage provider ---

const sqliteConfigSchema = z.object({
  databasePath: z.string().min(1, 'sqlite.databasePath is required'),
});

const sqlServerConfigSchema = z.object({
  server: z.string().min(1, 'sqlserver.server is required'),
  port: z.number().int().min(1).max(65535, 'sqlserver.port must be 1-65535'),
  database: z.string().min(1, 'sqlserver.database is required'),
  user: z.string().min(1, 'sqlserver.user is required'),
  password: z.string().min(1, 'sqlserver.password is required'),
  encrypt: z.boolean({ required_error: 'sqlserver.encrypt is required' }),
  trustServerCertificate: z.boolean({
    required_error: 'sqlserver.trustServerCertificate is required',
  }),
});

const azureBlobConfigSchema = z
  .object({
    authMethod: z.enum(['connection-string', 'azure-identity'], {
      required_error:
        'azure-blob.authMethod must be "connection-string" or "azure-identity"',
    }),
    connectionString: z.string().min(1).optional(),
    accountName: z.string().min(1).optional(),
    containerName: z.string().min(1, 'azure-blob.containerName is required'),
    timePeriodFormat: z.enum(['monthly', 'weekly', 'daily'], {
      required_error:
        'azure-blob.timePeriodFormat must be "monthly", "weekly", or "daily"',
    }),
  })
  .refine(
    (data) => {
      if (data.authMethod === 'connection-string') {
        return (
          data.connectionString !== undefined &&
          data.connectionString.length > 0
        );
      }
      return true;
    },
    {
      message:
        'azure-blob.connectionString is required when authMethod is "connection-string"',
      path: ['connectionString'],
    }
  )
  .refine(
    (data) => {
      if (data.authMethod === 'azure-identity') {
        return data.accountName !== undefined && data.accountName.length > 0;
      }
      return true;
    },
    {
      message:
        'azure-blob.accountName is required when authMethod is "azure-identity"',
      path: ['accountName'],
    }
  );

// --- Top-level storage config schema with conditional validation ---

const storageProviderEnum = z.enum(['sqlite', 'sqlserver', 'azure-blob']);

export const storageConfigSchema = z
  .object({
    storage: z.object({
      provider: storageProviderEnum,
      sqlite: sqliteConfigSchema.optional(),
      sqlserver: sqlServerConfigSchema.optional(),
      'azure-blob': azureBlobConfigSchema.optional(),
    }),
  })
  .refine(
    (data) => {
      const p = data.storage.provider;
      if (p === 'sqlite') return data.storage.sqlite !== undefined;
      if (p === 'sqlserver') return data.storage.sqlserver !== undefined;
      if (p === 'azure-blob') return data.storage['azure-blob'] !== undefined;
      return false;
    },
    {
      message:
        'The configuration section for the active storage provider is missing. ' +
        'Ensure the YAML contains the section matching the selected provider.',
    }
  );

export type StorageConfigYaml = z.infer<typeof storageConfigSchema>;

/**
 * Parses and validates raw YAML content against the storage config schema.
 * Throws a descriptive error if validation fails.
 *
 * @param raw - Parsed YAML content (unknown type)
 * @returns Validated storage configuration
 */
export function parseStorageConfig(raw: unknown): StorageConfigYaml['storage'] {
  const result = storageConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      'Invalid storage configuration:\n' +
        result.error.issues
          .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
          .join('\n')
    );
  }
  return result.data.storage;
}
