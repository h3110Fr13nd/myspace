/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user: string;
    authType: string;
    scopes: string[];
    /** Claims from the verified session cookie, when the request had one. */
    session?: {
      userId: string;
      email?: string;
      displayName?: string;
    } | null;
    /** Canonical pretty URL of the resource being served (set for /{slug}-{shortId} routes). */
    canonicalUrl?: string;
    /** Resource id resolved by the pretty-URL middleware, consumed by the index renderer. */
    docId?: string;
  }
}
