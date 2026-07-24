declare module "semver" {
  interface SemVerApi {
    valid(version: string): string | null;
    validRange(range: string): string | null;
    satisfies(version: string, range: string): boolean;
  }

  const semver: SemVerApi;
  export default semver;
}
