import type { Logger } from 'pino';

import { VolumeService } from '../application/volume-service.js';
import type { AppConfig, RuntimeOverrides } from '../config/env.js';
import { loadAppConfig } from '../config/env.js';
import { createAppLogger, createAuditLogger } from '../logging/logger.js';
import { VolumeRepository } from '../storage/volume-repository.js';
import { createCorrelationId } from '../utils/correlation.js';

export interface AppRuntime {
  auditLogger: Logger;
  config: AppConfig;
  correlationId: string;
  logger: Logger;
  volumeService: VolumeService;
}

export const createRuntime = async (
  overrides: RuntimeOverrides = {},
): Promise<AppRuntime> => {
  const config = loadAppConfig(overrides);
  const correlationId =
    overrides.correlationId?.trim().length
      ? overrides.correlationId.trim()
      : createCorrelationId();
  const logger = createAppLogger(config, { correlationId });
  const auditLogger = createAuditLogger(config, { correlationId });
  const repository = new VolumeRepository(config, logger.child({ scope: 'repository' }));

  await repository.initialize();

  const volumeService = new VolumeService(
    repository,
    config,
    logger.child({ scope: 'volume-service' }),
    auditLogger,
  );

  logger.info(
    { dataDir: config.dataDir, logDir: config.logDir, auditLogDir: config.auditLogDir },
    'Runtime initialized.',
  );

  return {
    auditLogger,
    config,
    correlationId,
    logger,
    volumeService,
  };
};
