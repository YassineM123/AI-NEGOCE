/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  /** Development only: identity requested from the API's local-dev session endpoint. */
  readonly VITE_DEV_IDENTITY?: string
}
