declare module "semver" {
  interface SemVerApi {
    valid(version: string): string | null;
    validRange(range: string): string | null;
    satisfies(version: string, range: string): boolean;
    coerce(version: string): { version: string } | null;
    rcompare(left: string, right: string): number;
  }

  const semver: SemVerApi;
  export default semver;
}
