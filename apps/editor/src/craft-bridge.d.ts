/**
 * Desktop app bridge — exposed by the Electron preload script.
 * Optional: falls back to undefined in the browser, where the Browse…
 * button is hidden.
 */
interface CraftBridge {
  openDirectoryDialog?: () => Promise<string | null>
}

declare global {
  interface Window {
    craft?: CraftBridge
  }
}

export {}
