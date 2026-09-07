// PaneCrew's Sentry DSN (project "panecrew" in the `silvio-lindstedt-und-maik-g-y2`
// org, region de.sentry.io). A DSN is a public identifier, not a secret —
// it authorizes sending events into this one project, nothing else (see
// https://docs.sentry.io/product/sentry-basics/dsn-explainer/) — so baking
// it into the published bundle is Sentry's own documented, standard setup
// for client/extension SDKs. Reporting is still off unless the user opts
// in (see docs/logging.md) — merely shipping the DSN sends nothing on its
// own.
export const PANECREW_SENTRY_DSN =
  "https://6d5054e2a1f8ce002970626e8196f1cc@o4511065943441408.ingest.de.sentry.io/4512043740430416";
