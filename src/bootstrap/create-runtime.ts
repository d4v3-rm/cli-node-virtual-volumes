import type { Logger } from 'pino';

import { VolumeService } from '../application/volume-service.js';
import type { AppConfig, RuntimeOverrides } from '../config/env.js';
import { loadAppConfig } from '../config/env.js';
import { createAppLogger } from '../logging/logger.js';
import { VolumeRepository } from '../storage/volume-repository.js';

export interface AppRuntime {
  config: AppConfig;
  logger: Logger;
  volumeService: VolumeService;
}

export const createRuntime = async (
  overrides: RuntimeOverrides = {},
): Promise<AppRuntime> => {
  const config = loadAppConfig(overrides);
  const logger = createAppLogger(config);
  const repository = new VolumeRepository(config, logger.child({ scope: 'repository' }));

  await repository.initialize();

  const volumeService = new VolumeService(
    repository,
    config,
    logger.child({ scope: 'volume-service' }),
  );

  logger.info({ dataDir: config.dataDir, logDir: config.logDir }, 'Runtime initialized.');

  return {
    config,
    logger,
    volumeService,
  };
};
