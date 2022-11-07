import { readFileSync } from 'fs';
import { join } from 'path';
import * as https from 'https';

import { ReturnType, Service, validate } from 'basketry';
import parser from '.';
import { stringify } from './snapshot/create-snapshot';

function noSource(service: Service): Omit<Service, 'sourcePath'> {
  const { sourcePath, ...rest } = service;
  return rest;
}
import { dump as yamlStringify } from 'yaml-ast-parser';

describe('parser', () => {
  it('recreates a valid exhaustive snapshot', () => {
    // ARRANGE
    const snapshot = JSON.parse(
      readFileSync(join('src', 'snapshot', 'snapshot.json')).toString(),
    );

    const sourcePath: string = join('src', 'snapshot', 'example.oas2.json');
    const sourceContent = readFileSync(sourcePath).toString();

    // ACT
    const result = JSON.parse(
      stringify(parser(sourceContent, sourcePath).service),
    );

    // ASSERT
    expect(noSource(result)).toStrictEqual(noSource(snapshot));
  });

  it('parses identical services from JSON and YAML content', () => {
    // ARRANGE
    const jsonPath: string = join('src', 'snapshot', 'example.oas2.json');
    const jsonContent = readFileSync(jsonPath).toString();
    const yamlContent = yamlStringify(JSON.parse(jsonContent), {});

    const replacer = (key: string, value: any) => {
      return key === 'loc' ? 'REDACTED' : value;
    };

    // ACT
    const jsonResult = JSON.parse(
      JSON.stringify(parser(jsonContent, jsonPath).service, replacer),
    );

    const yamlResult = JSON.parse(
      JSON.stringify(parser(yamlContent, jsonPath).service, replacer),
    );

    // ASSERT
    expect(jsonResult).toStrictEqual(yamlResult);
  });

  it('recreates a valid petstore snapshot', () => {
    // ARRANGE
    const snapshot = JSON.parse(
      readFileSync(join('src', 'snapshot', 'petstore.json')).toString(),
    );

    const sourcePath = join('src', 'snapshot', 'petstore.oas2.json');
    const sourceContent = readFileSync(sourcePath).toString();

    // ACT
    const result = JSON.parse(
      stringify(parser(sourceContent, sourcePath).service),
    );

    // ASSERT
    expect(noSource(result)).toStrictEqual(noSource(snapshot));
  });

  it('creates a type for every custom typeName', () => {
    // ARRANGE

    const sourcePath = join('src', 'snapshot', 'example.oas2.json');
    const sourceContent = readFileSync(sourcePath).toString();

    // ACT
    const result = parser(sourceContent, sourcePath).service;

    // ASSERT
    const fromMethodParameters = new Set(
      result.interfaces
        .map((i) => i.methods)
        .reduce((a, b) => a.concat(b), [])
        .map((i) => i.parameters)
        .reduce((a, b) => a.concat(b), [])
        .filter((p) => !p.isPrimitive)
        .map((p) => p.typeName.value),
    );

    const fromMethodReturnTypes = new Set(
      result.interfaces
        .map((i) => i.methods)
        .reduce((a, b) => a.concat(b), [])
        .map((i) => i.returnType)
        .filter((t): t is ReturnType => !!t)
        .filter((p) => !p.isPrimitive)
        .map((p) => p.typeName.value),
    );

    const fromTypes = new Set(
      result.types
        .map((t) => t.properties)
        .reduce((a, b) => a.concat(b), [])
        .filter((p) => !p.isPrimitive)
        .map((p) => p.typeName.value),
    );

    const typeNames = new Set([
      ...result.types.map((t) => t.name.value),
      ...result.enums.map((e) => e.name.value),
    ]);

    for (const localTypeName of [
      ...fromMethodParameters,
      ...fromMethodReturnTypes,
      ...fromTypes,
    ]) {
      expect(typeNames.has(localTypeName)).toEqual(true);
    }
  });

  it('creates types with unique names', () => {
    // ARRANGE

    const sourcePath = join('src', 'snapshot', 'example.oas2.json');
    const sourceContent = readFileSync(sourcePath).toString();

    // ACT
    const result = parser(sourceContent, sourcePath).service;

    // ASSERT
    const typeNames = result.types.map((t) => t.name);

    expect(typeNames.length).toEqual(new Set(typeNames).size);
  });

  it('creates a valid service', () => {
    // ARRANGE
    const sourcePath = join('src', 'snapshot', 'example.oas2.json');
    const sourceContent = readFileSync(sourcePath).toString();

    const service = parser(sourceContent, sourcePath).service;

    // ACT
    const errors = validate(service).errors;

    // ASSERT
    expect(errors).toEqual([]);
  });

  it('creates a valid service from the example Pet Store schema', async () => {
    // ARRANGE

    const sourcePath = 'https://petstore.swagger.io/v2/swagger.json';
    const sourceContent = await getText(sourcePath);

    const service = parser(sourceContent, sourcePath).service;

    // ACT
    const errors = validate(service).errors;

    // ASSERT
    expect(errors).toEqual([]);
  });
});

function getText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data: string = '';

        res.on('data', (d) => {
          data += d.toString();
        });

        res.on('end', () => {
          resolve(data);
        });
      })
      .on('error', (e) => {
        reject(e);
      });
  });
}
