# vendor

`omj21-mcp21-0.1.1.tgz` is the packed `@omj21/mcp21` package (source: github.com/Roof-ER21/mcp21,
an OMJ 21 package licensed to Roof-ER apps). It is vendored so Railway's build resolves it
with no registry credentials — the Dockerfile copies `vendor/` BEFORE `npm ci` for exactly this
reason (Nixpacks copies the whole repo, so it needs nothing extra). Refresh with
`cd ~/mcp21 && npm pack --pack-destination <this dir>` and update the version in package.json;
swap to the npm registry once `@omj21/mcp21` is published.
