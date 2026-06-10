declare module "@vscode/ripgrep" {
  /** Absolute path to the bundled `rg` binary for the current platform. */
  export const rgPath: string;
  /** Version of the bundled ripgrep build. */
  export const rgVersion: string;
}
