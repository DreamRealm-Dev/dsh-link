/**
 * link-interconnect/1 peer SDK - zero dependencies, plain ESM.
 *
 * Three entry points, one import:
 *
 *   declare(manifest)   validate and normalise the PeerManifest your software serves at
 *                       GET /.well-known/link-interconnect.json (throws a coded LinkSdkError).
 *   serve(options)      start the peer side: well-known + POST /link/v1/invoke + GET
 *                       /link/v1/events, plus GET /v1/models and POST /v1/chat/completions when
 *                       the manifest declares models.provide. Answers {url, manifestUrl, publish,
 *                       close} once the port is listening.
 *   linkClient(opts)    the reverse direction: contract, invoke, embedToken, and the OpenAI /
 *                       Anthropic proxy prefixes, as a peer calling back into LINK.
 *
 * Everything is node:http and node built-ins. No dependency, no build step, no install:
 * the package is plain ESM so a peer can vendor src/ if it prefers.
 */
export {
  PROTOCOL_ID,
  PROTOCOL_MAJOR,
  PROTOCOL_MINOR,
  CONTRACT_VERSION,
  LINK_PREFIX,
  ROUTES,
  SCOPES,
  CAPS,
  ERROR_CODES,
  LIMITS,
  LinkSdkError,
  statusForCode,
  parseProtocolId,
  declare,
} from './protocol.mjs'
export { serve } from './server.mjs'
export { linkClient } from './client.mjs'

/** The SDK release. The protocol id and contract version are the compatibility statement. */
export const SDK_VERSION = '0.1.0'
