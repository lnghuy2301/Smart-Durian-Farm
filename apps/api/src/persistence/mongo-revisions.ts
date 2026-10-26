import { MONGO_SCHEMA_V1 } from './mongo-schema';
import { AI_MONGO_SCHEMA } from './ai-schema';
import { AI_SOURCE_SCHEMA } from './ai-source-schema';
export const mongoDefinitionsForRevision = (revision: number) => revision >= 18 ? [...MONGO_SCHEMA_V1, ...AI_SOURCE_SCHEMA]
  : revision >= 17 ? [...MONGO_SCHEMA_V1, ...AI_MONGO_SCHEMA] : MONGO_SCHEMA_V1;
