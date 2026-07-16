/**
 * @kraken-e2e/config — typed kraken.config.ts (ADR-0001 §5.10).
 * The config file is the COMPOSITION ROOT: drivers arrive as values from typed
 * factory imports (ESLint-flat-config style). Loaded via jiti. zod is internal
 * and never appears in the public surface.
 */
export { findConfigPath, loadConfig, loadEnvFiles } from './loader.js';
export {
  type ActorConfig,
  type DriverRegistrationInput,
  defineConfig,
  type KrakenConfig,
  type ResolvedKrakenConfig,
  validateConfig,
} from './schema.js';
