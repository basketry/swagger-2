[![main](https://github.com/basketry/swagger-2/workflows/build/badge.svg?branch=main&event=push)](https://github.com/basketry/swagger-2/actions?query=workflow%3Abuild+branch%3Amain+event%3Apush)
[![master](https://img.shields.io/npm/v/@basketry/swagger-2)](https://www.npmjs.com/package/@basketry/swagger-2)

# Swagger 2.0

[Basketry parser](https://github.com/basketry/basketry) for Swagger 2.0 service definitions. This parser can be coupled with any Basketry generator to translate a Swagger 2.0 document into other artifacts including servers, clients, and human-readable documentation.

## Quick Start

The following example converts a "Swagger" doc into Typescript types:

1. Save `https://petstore.swagger.io/v2/swagger.json` as `petstore.json` in the root of your project.
1. Install packages: `npm install -g basketry @basketry/swagger-2 @basketry/typescript`
1. Generate code: `basketry --source petstore.json --parser @basketry/swagger-2 --generators @basketry/typescript --output src`

When the last step is run, basketry will parse the source file (`petstore.json`) using the specified parser (`@basketry/swagger-2`) and then run each specified generator (in this case only `@basketry/typescript`) writing the output folder (`src`).

### Enum descriptions

Out of the box, OpenAPI does not support adding descriptions to enum values; however, vendor extensions can be added. The `x-codegen-enum-description` and `x-codegen-enum-value-descriptions` can be defined on enums and enum-valued parameters to add this documentation.

Example:

```json
"productSize": {
  "type": "string",
  "x-codegen-enum-description": "The size of a product",
  "x-codegen-enum-value-descriptions": {
    "small": "The small size",
    "medium": "Between the small and large sizes",
    "large": "The larger size"
  },
  "enum": ["small", "medium", "large"]
},
```

The description must be a string and the value descriptions must be an object. Note that not all values must have a description, but all keys in the value descriptions object must also be defined as enum values.

---

## For contributors:

### Run this project

1.  Install packages: `npm ci`
1.  Build the code: `npm run build`
1.  Run it! `npm start`

Note that the `lint` script is run prior to `build`. Auto-fixable linting or formatting errors may be fixed by running `npm run fix`.

### Create and run tests

1.  Add tests by creating files with the `.test.ts` suffix
1.  Run the tests: `npm t`
1.  Test coverage can be viewed at `/coverage/lcov-report/index.html`

### Publish a new package version

1. Ensure latest code is published on the `main` branch.
1. Create the new version number with `npm version {major|minor|patch}`
1. Push the branch and the version tag: `git push origin main --follow-tags`

The [publish workflow](https://github.com/basketry/swagger-2/actions/workflows/publish.yml) will build and pack the new version then push the package to NPM. Note that publishing requires write access to the `main` branch.

---

Generated with [generator-ts-console](https://www.npmjs.com/package/generator-ts-console)
