/**
 * The one spelling of this package's reading route.
 *
 * Two halves name it: the host half binds it (apply, through the composition's webServer) and the
 * browser half reads it (the LINK panel's own status row). A second spelling inside either half would
 * be a second answer to "where does this package's reading live", free to drift from the route that
 * is really served - the failure mode R203 named for the relay path.
 */
export const STATUS_PATH = '/api/dsh-link-collab/status'
