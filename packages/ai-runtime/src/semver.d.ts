declare module "semver" {
  interface SemVerApi {
    valid(version: string): string | null;
    validRange(range: string): string | null;
    satisfies(version: string, range: string): boolean;
    coerce(version: string): { version: string } | null;
  }

  const semver: SemVerApi;
  export default semver;
}
