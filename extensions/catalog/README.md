# Tower extension catalog sources

This directory contains reviewable catalog source documents and versioned JSON
schemas. It is intentionally independent from a publication host so the whole
layout can move to a standalone official extension repository later.

Provider source lives under `../cli-providers/`. Add one source declaration per
provider under `sources/`, then build the provider before generating the index:

```sh
pnpm --filter tower-extension-qwen-code build
pnpm extensions:catalog:build -- \
  --base-url https://<authorized-host>/<path>/ \
  --output <directory>
```

The publication workflow must supply the HTTPS base URL. The generator writes
deterministic prebuilt artifacts plus `index.v1.json`; it does not upload or
publish them. Generated artifacts contain no lifecycle scripts, dependency
metadata, native modules, or source-time workspace imports.

Tower consumes the index only through server configuration
(`TOWER_EXTENSION_CATALOG_URL`, with `extensions.catalogUrl` as the database
fallback). Tests must use temporary output and fake fetch or temporary HTTPS.
