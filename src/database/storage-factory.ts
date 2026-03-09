import type { StorageBundle } from './interfaces.js';
import type { StorageConfig } from '../config/types.js';
import { createSqliteStorage } from './sqlite/create-sqlite-storage.js';

/**
 * Creates the appropriate StorageBundle based on the storage configuration.
 *
 * @param config - Storage configuration from storage-config.yaml
 * @returns A StorageBundle with repositories for the configured backend
 * @throws Error if the provider is unsupported or required config is missing
 */
export async function createStorage(config: StorageConfig): Promise<StorageBundle> {
  switch (config.provider) {
    case 'sqlite': {
      const sqliteConfig = config.sqlite;
      if (!sqliteConfig) {
        throw new Error('SQLite storage configuration section is missing in storage-config.yaml.');
      }
      return createSqliteStorage(sqliteConfig);
    }

    case 'sqlserver': {
      const sqlserverConfig = config.sqlserver;
      if (!sqlserverConfig) {
        throw new Error('SQL Server storage configuration section is missing in storage-config.yaml.');
      }
      const { createSqlServerStorage } = await import('./sqlserver/create-sqlserver-storage.js');
      return createSqlServerStorage(sqlserverConfig);
    }

    case 'azure-blob': {
      const azureBlobConfig = config['azure-blob'];
      if (!azureBlobConfig) {
        throw new Error('Azure Blob storage configuration section is missing in storage-config.yaml.');
      }
      const { createAzureBlobStorage } = await import('./azure-blob/create-azure-blob-storage.js');
      return createAzureBlobStorage(azureBlobConfig);
    }

    default: {
      const _exhaustive: never = config.provider;
      throw new Error(
        `Unsupported storage provider: "${_exhaustive}". ` +
        `Supported providers: sqlite, sqlserver, azure-blob`
      );
    }
  }
}
