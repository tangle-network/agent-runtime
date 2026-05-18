/**
 * `@tangle-network/agent-runtime/platform` — typed server-side clients
 * for the Tangle platform's cross-site SSO bridge and integrations
 * hub. Apps consume these to avoid rolling their own OAuth, session,
 * and connection storage.
 *
 * See:
 *   - {@link PlatformAuthClient} for "Login with Tangle"
 *   - {@link PlatformHubClient} for the `/v1/integrations/*` surface
 */

export {
  type AuthorizeUrlOptions,
  type ExchangeCodeResult,
  PlatformAuthClient,
  PlatformAuthError,
  type PlatformAuthClientOptions,
} from './auth.js'

export {
  type BundleCapabilityInput,
  type BundleCapabilityResult,
  type HealthCheck,
  type PlatformCatalogConnector,
  type PlatformCatalogProvider,
  type PlatformConnection,
  PlatformHubClient,
  PlatformHubError,
  type PlatformHubClientOptions,
  type StartAuthInput,
  type StartAuthResult,
} from './integrations.js'
