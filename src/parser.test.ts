import { readFileSync } from 'fs';
import { join } from 'path';
import * as https from 'https';

import { ReturnType, validate } from 'basketry';
import parser from '.';

describe('parser', () => {
  it('recreates a valid snapshot', () => {
    // ARRANGE
    const snapshot = JSON.parse(
      readFileSync(join('src', 'snapshot', 'snapshot.json')).toString(),
    );
    const schema = readFileSync(
      join('src', 'snapshot', 'example.oas2.json'),
    ).toString();

    // ACT
    const result = JSON.parse(JSON.stringify(parser(schema)));

    // ASSERT
    expect(result).toStrictEqual(snapshot);
  });

  it('creates a type for every local typeName', () => {
    // ARRANGE
    const schema = readFileSync(
      join('src', 'snapshot', 'example.oas2.json'),
    ).toString();

    // ACT
    const result = parser(schema);

    // ASSERT
    const fromMethodParameters = new Set(
      result.interfaces
        .map((i) => i.methods)
        .reduce((a, b) => a.concat(b), [])
        .map((i) => i.parameters)
        .reduce((a, b) => a.concat(b), [])
        .filter((p) => p.isLocal)
        .map((p) => p.typeName),
    );

    const fromMethodReturnTypes = new Set(
      result.interfaces
        .map((i) => i.methods)
        .reduce((a, b) => a.concat(b), [])
        .map((i) => i.returnType)
        .filter((t): t is ReturnType => !!t)
        .filter((p) => p.isLocal)
        .map((p) => p.typeName),
    );

    const fromTypes = new Set(
      result.types
        .map((t) => t.properties)
        .reduce((a, b) => a.concat(b), [])
        .filter((p) => p.isLocal)
        .map((p) => p.typeName),
    );

    const typeNames = new Set([
      ...result.types.map((t) => t.name),
      ...result.enums.map((e) => e.name),
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
    const schema = readFileSync(
      join('src', 'snapshot', 'example.oas2.json'),
    ).toString();

    // ACT
    const result = parser(schema);

    // ASSERT
    const typeNames = result.types.map((t) => t.name);

    expect(typeNames.length).toEqual(new Set(typeNames).size);
  });

  it('creates a valid service', () => {
    // ARRANGE
    const schema = readFileSync(
      join('src', 'snapshot', 'example.oas2.json'),
    ).toString();

    const service = parser(schema);

    // ACT
    const errors = validate(service);

    // ASSERT
    expect(errors).toEqual([]);
  });

  it('creates a valid service from the example Pet Store schema', async () => {
    // ARRANGE
    const schema = await getText('https://petstore.swagger.io/v2/swagger.json');

    const service = parser(schema);

    // ACT
    const errors = validate(service);

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
