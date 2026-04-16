import { nanoid } from 'nanoid';

export const createCorrelationId = (): string => `corr_${nanoid(12)}`;
