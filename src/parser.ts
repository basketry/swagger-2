import { major } from 'semver';
import { singular } from 'pluralize';
import { camel, pascal } from 'case';

import { AST, DocumentNode, parse } from '@basketry/ast';
import * as OAS2 from './types';

import {
  Enum,
  HttpMethod,
  HttpPath,
  Interface,
  Method,
  ObjectValidationRule,
  Parameter,
  Property,
  ReturnType,
  Service,
  SecurityOption,
  SecurityScheme,
  Type,
  ValidationRule,
  Literal,
  TypedValue,
  PrimitiveValue,
  Meta,
  encodeRange,
  Violation,
  decodeRange,
} from 'basketry';
import { relative } from 'path';

function range(node: AST.ASTNode | DocumentNode): string {
  return encodeRange(node.loc);
}

export class OAS2Parser {
  constructor(schema: string, private readonly sourcePath: string) {
    this.schema = new OAS2.SchemaNode(parse(schema));
  }

  private readonly schema: OAS2.SchemaNode;
  private readonly violations = new Set<Violation>();

  private readonly ruleFactories: ValidationRuleFactory[] = factories;
  private enums: Enum[];
  private anonymousTypes: Type[];

  parse() {
    this.enums = [];
    this.anonymousTypes = [];
    const interfaces = this.parseInterfaces();
    const types = this.parseDefinitions();

    const typesByName = [...types, ...this.anonymousTypes].reduce(
      (acc, item) => ({ ...acc, [item.name.value]: item }),
      {},
    );

    const enumsByName = this.enums.reduce(
      (acc, item) => ({ ...acc, [item.name.value]: item }),
      {},
    );

    this.schema.info.title.loc;

    const service: Service = {
      basketry: '1',
      sourcePath: relative(process.cwd(), this.sourcePath),
      title: {
        value: pascal(this.schema.info.title.value),
        loc: range(this.schema.info.title),
      },
      majorVersion: {
        value: major(this.schema.info.version.value),
        loc: range(this.schema.info.version),
      },
      interfaces,
      types: Object.keys(typesByName).map((name) => typesByName[name]),
      enums: Object.keys(enumsByName).map((name) => enumsByName[name]),
      unions: [],
      loc: range(this.schema),
      meta: this.parseMeta(this.schema),
    };

    return { service, violations: Array.from(this.violations) };
  }

  private parseMeta(node: DocumentNode): Meta | undefined {
    const n = node.node;
    if (!n.isObject()) return undefined;

    const meta: Meta = n.children
      .filter((child) => child.key.value.startsWith('x-'))
      .map((child) => ({
        key: {
          value: child.key.value.substring(2),
          loc: encodeRange(child.key.loc),
        },
        value: {
          value: OAS2.toJson(child.value),
          loc: encodeRange(child.value.loc),
        },
      }));

    return meta.length ? meta : undefined;
  }

  private parseInterfaces(): Interface[] {
    return this.parserInterfaceNames().map((name) => ({
      name: singular(name),
      methods: this.parseMethods(name),
      protocols: {
        http: this.parseHttpProtocol(name),
      },
    }));
  }

  private parseResponseCode(
    verb: string,
    operation: OAS2.OperationNode,
  ): Literal<number> {
    const primary = this.parsePrimaryResponseKey(operation);

    if (typeof primary?.value === 'number') {
      return primary as Literal<number>;
    } else if (primary?.value === 'default') {
      const res = operation.responses.read(primary.value);
      if (res && this.resolve(res, OAS2.ResponseNode).schema) {
        switch (verb) {
          case 'delete':
            return { value: 202, loc: primary.loc };
          case 'options':
            return { value: 204, loc: primary.loc };
          case 'post':
            return { value: 201, loc: primary.loc };
          default:
            return { value: 200, loc: primary.loc };
        }
      } else {
        return { value: 204, loc: primary.loc };
      }
    }

    return { value: 200 };
  }

  private parseHttpProtocol(interfaceName: string): HttpPath[] {
    const paths = this.schema.paths.keys;

    const httpPaths: HttpPath[] = [];

    for (const path of paths) {
      const pathItem = this.resolve(
        this.schema.paths.read(path)!,
        OAS2.PathItemNode,
      );
      const keyLoc = this.schema.paths.keyRange(path);
      const loc = this.schema.paths.propRange(path)!;
      const commonParameters = pathItem.parameters || [];

      const httpPath: HttpPath = {
        path: { value: path, loc: keyLoc },
        methods: [],
        loc,
      };

      for (const verb of pathItem.keys) {
        if (verb === 'parameters') continue;
        const operation = pathItem[verb]! as OAS2.OperationNode;
        if (this.parseInterfaceName(path, operation) !== interfaceName) {
          continue;
        }

        const verbLoc = pathItem.keyRange(verb);
        const methodLoc = pathItem.propRange(verb)!;

        const httpMethod: HttpMethod = {
          name: {
            value: operation.operationId?.value || 'unknown',
            loc: operation.operationId
              ? range(operation.operationId)
              : undefined,
          },
          verb: { value: verb as any, loc: verbLoc },
          parameters: [],
          successCode: this.parseResponseCode(verb, operation),
          loc: methodLoc,
        };

        for (const param of [
          ...(operation.parameters || []),
          ...commonParameters,
        ]) {
          const name = this.parseParameterName(param);

          const resolved = OAS2.resolveParam(this.schema.node, param);
          if (!resolved) throw new Error('Cannot resolve reference');

          const location = this.parseParameterLocation(param);

          if (
            (resolved.in.value === 'header' ||
              resolved.in.value === 'path' ||
              resolved.in.value === 'query') &&
            resolved.nodeType === 'ArrayParameter'
          ) {
            httpMethod.parameters.push({
              name: { value: name.value, loc: range(name) },
              in: { value: location.value, loc: range(location) },
              array: {
                value: resolved.collectionFormat?.value || 'csv',
                loc: resolved.collectionFormat
                  ? range(resolved.collectionFormat)
                  : undefined,
              },
              loc: range(resolved),
            });
          } else {
            httpMethod.parameters.push({
              name: { value: name.value, loc: range(name) },
              in: { value: location.value, loc: range(location) },
              loc: range(resolved),
            });
          }
        }

        httpPath.methods.push(httpMethod);
      }

      if (httpPath.methods.length) httpPaths.push(httpPath);
    }
    return httpPaths;
  }

  private *allOperations(): Iterable<{
    path: string;
    verb: string;
    operation: OAS2.OperationNode;
  }> {
    for (const path of this.schema.paths.keys) {
      for (const verb of this.schema.paths.read(path)!.keys) {
        if (verb === 'parameters' || verb.startsWith('x-')) continue;

        const operation: OAS2.OperationNode =
          this.schema.paths.read(path)![verb];

        yield { path, verb, operation };
      }
    }
  }

  private parserInterfaceNames(): string[] {
    const interfaceNames = new Set<string>();
    for (const { path, operation } of this.allOperations()) {
      interfaceNames.add(this.parseInterfaceName(path, operation));
    }
    return Array.from(interfaceNames);
  }

  private parseInterfaceName(
    path: string,
    operation: OAS2.OperationNode,
  ): string {
    return operation.tags?.[0].value || path.split('/')[1];
  }

  private parseMethods(interfaceName: string): Method[] {
    const paths = this.schema.paths.keys;

    const methods: Method[] = [];

    for (const { path, verb, operation } of this.allOperations()) {
      const commonParameters = this.schema.paths.read(path)!.parameters || [];

      if (this.parseInterfaceName(path, operation) !== interfaceName) {
        continue;
      }

      const nameLoc = operation.operationId
        ? range(operation.operationId)
        : undefined;
      methods.push({
        name: {
          value: operation.operationId?.value || 'UNNAMED',
          loc: nameLoc,
        },
        security: this.parseSecurity(operation),
        parameters: this.parseParameters(operation, commonParameters),
        description: this.parseDescription(
          operation.summary,
          operation.description,
        ),
        returnType: this.parseReturnType(operation),
        loc: this.schema.paths.read(path)!.propRange(verb)!,
        meta: this.parseMeta(operation),
      });
    }
    return methods;
  }

  private parseDescription(
    summary: OAS2.LiteralNode<string> | undefined,
    description: OAS2.LiteralNode<string> | undefined,
  ): Literal<string> | Literal<string>[] | undefined {
    if (summary && description)
      return [
        { value: summary.value, loc: range(summary) },
        { value: description.value, loc: range(description) },
      ];
    if (summary) return { value: summary.value, loc: range(summary) };
    if (description)
      return { value: description.value, loc: range(description) };
    return;
  }

  private parseDescriptionOnly(
    description: OAS2.LiteralNode<string> | undefined,
  ): Literal<string> | undefined {
    if (description)
      return { value: description.value, loc: range(description) };
    return;
  }

  private parseSecurity(operation: OAS2.OperationNode): SecurityOption[] {
    const { securityDefinitions, security: defaultSecurity } = this.schema;
    const { security: operationSecurity } = operation;
    const security = operationSecurity || defaultSecurity || [];

    const options: SecurityOption[] = security.map((requirements) =>
      requirements.keys
        .map((key): SecurityScheme | undefined => {
          const requirement = requirements.read(key);
          const definition = securityDefinitions?.read(key);

          if (!requirement || !definition) return;

          const keyLoc = securityDefinitions?.keyRange(key);
          const loc = securityDefinitions?.propRange(key)!;

          const name = { value: key, loc: keyLoc };

          switch (definition.nodeType) {
            case 'BasicSecurityScheme':
              return {
                type: { value: 'basic', loc: range(definition.type) },
                name,
                loc,
                meta: this.parseMeta(definition),
              };
            case 'ApiKeySecurityScheme':
              return {
                type: { value: 'apiKey', loc: range(definition.type) },
                name,
                description: this.parseDescriptionOnly(definition.description),
                parameter: literal(definition.name),
                in: literal(definition.in),
                loc,
                meta: this.parseMeta(definition),
              };
            case 'OAuth2SecurityScheme': {
              switch (definition.flow.value) {
                case 'implicit':
                  return {
                    type: { value: 'oauth2', loc: range(definition.type) },
                    name,
                    description: this.parseDescriptionOnly(
                      definition.description,
                    ),
                    flows: [
                      {
                        type: {
                          value: 'implicit',
                          loc: range(definition.flow),
                        },
                        authorizationUrl: literal(definition.authorizationUrl),
                        // WARNING! This is different than the others
                        scopes: requirement.map((r) => ({
                          name: literal(r),
                          description: this.parseDescriptionOnly(
                            definition.scopes.read(r.value),
                          )!,
                          loc: definition.scopes.propRange(r.value)!,
                        })),
                        loc,
                      },
                    ],
                    loc,
                    meta: this.parseMeta(definition),
                  };
                case 'password':
                  return {
                    type: { value: 'oauth2', loc: range(definition.type) },
                    name,
                    description: this.parseDescriptionOnly(
                      definition.description,
                    ),
                    flows: [
                      {
                        type: {
                          value: 'password',
                          loc: range(definition.flow),
                        },
                        tokenUrl: literal(definition.tokenUrl),
                        // WARNING! This is different than implicit
                        scopes: definition.scopes.keys.map((k) => ({
                          name: {
                            value: k,
                            loc: definition.scopes.keyRange(k),
                          },
                          description: this.parseDescriptionOnly(
                            definition.scopes.read(k),
                          )!,
                          loc: definition.scopes.propRange(k)!,
                        })),
                        loc,
                      },
                    ],
                    loc,
                    meta: this.parseMeta(definition),
                  };
                case 'application':
                  return {
                    type: { value: 'oauth2', loc: range(definition.type) },
                    name,
                    description: this.parseDescriptionOnly(
                      definition.description,
                    ),
                    flows: [
                      {
                        type: {
                          value: 'clientCredentials',
                          loc: range(definition.flow),
                        },
                        tokenUrl: literal(definition.tokenUrl),
                        // WARNING! This is different than implicit
                        scopes: definition.scopes.keys.map((k) => ({
                          name: {
                            value: k,
                            loc: definition.scopes.keyRange(k),
                          },
                          description: this.parseDescriptionOnly(
                            definition.scopes.read(k),
                          )!,
                          loc: definition.scopes.propRange(k)!,
                        })),
                        loc,
                      },
                    ],
                    loc,
                    meta: this.parseMeta(definition),
                  };
                case 'accessCode':
                  return {
                    type: { value: 'oauth2', loc: range(definition.type) },
                    name,
                    description: this.parseDescriptionOnly(
                      definition.description,
                    ),
                    flows: [
                      {
                        type: {
                          value: 'authorizationCode',
                          loc: range(definition.flow),
                        },
                        authorizationUrl: literal(definition.authorizationUrl),
                        tokenUrl: literal(definition.tokenUrl),
                        // WARNING! This is different than implicit
                        scopes: definition.scopes.keys.map((k) => ({
                          name: {
                            value: k,
                            loc: definition.scopes.keyRange(k),
                          },
                          description: this.parseDescriptionOnly(
                            definition.scopes.read(k),
                          )!,
                          loc: definition.scopes.propRange(k)!,
                        })),
                        loc,
                      },
                    ],
                    loc,
                    meta: this.parseMeta(definition),
                  };
                default:
                  return;
              }
            }
            default:
              return;
          }
        })
        .filter((scheme): scheme is SecurityScheme => !!scheme),
    );

    return options;
  }

  private parseParameters(
    operation: OAS2.OperationNode,
    commonParameters: (OAS2.ParameterNode | OAS2.RefNode)[],
  ): Parameter[] {
    const allParameters = [
      ...commonParameters,
      ...(operation.parameters || []),
    ];
    if (!allParameters.length) return [];

    return allParameters.map((p) =>
      this.parseParameter(p, operation.operationId?.value || ''),
    );
  }

  private parseParameter(
    paramOrRef: OAS2.ParameterNode | OAS2.RefNode,
    methodName: string,
  ): Parameter {
    const param = OAS2.resolveParam(this.schema.node, paramOrRef)!;
    const unresolved = isBodyParameter(param) ? param.schema : param;
    const resolved = OAS2.resolveParamOrSchema(this.schema.node, unresolved);
    if (!resolved) throw new Error('Cannot resolve reference');
    if (resolved.nodeType === 'BodyParameter') {
      throw new Error('Unexpected body parameter');
    }

    const isSharedParameterEnum =
      OAS2.isRefNode(paramOrRef) &&
      param.nodeType === 'StringParameter' &&
      param.enum;

    const localName = isSharedParameterEnum
      ? paramOrRef.$ref.value.substring(
          paramOrRef.$ref.value.lastIndexOf('/') + 1,
        )
      : param.name.value;
    const parentName = isSharedParameterEnum ? '' : methodName;

    const x = this.parseType(unresolved, localName, parentName);

    if (x.isPrimitive) {
      return {
        name: { value: param.name.value, loc: range(param.name) },
        description: this.parseDescription(undefined, param.description),
        typeName: x.typeName,
        isPrimitive: x.isPrimitive,
        isArray: x.isArray,
        rules: this.parseRules(resolved, param.required?.value),
        loc: range(param),
        meta: this.parseMeta(param),
      };
    } else {
      return {
        name: { value: param.name.value, loc: range(param.name) },
        description: this.parseDescription(undefined, param.description),
        typeName: x.typeName,
        isPrimitive: x.isPrimitive,
        isArray: x.isArray,
        rules: this.parseRules(resolved, param.required?.value),
        loc: range(param),
        meta: this.parseMeta(param),
      };
    }
  }

  private parseParameterLocation(
    def: OAS2.ParameterNode | OAS2.RefNode,
  ): OAS2.ParameterNode['in'] {
    const resolved = OAS2.resolveParam(this.schema.node, def);
    if (!resolved) throw new Error('Cannot resolve reference');

    return resolved.in;
  }

  private parseParameterName(
    def: OAS2.ParameterNode | OAS2.RefNode,
  ): OAS2.ParameterNode['name'] {
    const resolved = OAS2.resolveParam(this.schema.node, def);
    if (!resolved) throw new Error('Cannot resolve reference');

    return resolved.name;
  }
  private validateEnumDescriptions(
    values: Literal<string>[],
    meta: Meta | undefined,
  ): void {
    const description = meta?.find(
      (m) => m.key.value === 'codegen-enum-description',
    );
    if (description && typeof description.value.value !== 'string') {
      this.violations.add({
        code: 'swagger-2/codegen-enum-description',
        message: 'codegen-enum-description must be a string if provided.',
        severity: 'warning',
        range: decodeRange(description.value.loc),
        sourcePath: this.sourcePath,
      });
    }

    const valueDescriptions = meta?.find(
      (m) => m.key.value === 'codegen-enum-value-descriptions',
    );

    if (valueDescriptions) {
      if (typeof valueDescriptions.value.value !== 'object') {
        this.violations.add({
          code: 'swagger-2/codegen-enum-value-descriptions',
          message:
            'codegen-enum-value-descriptions must be an object if provided.',
          severity: 'warning',
          range: decodeRange(valueDescriptions.value.loc),
          sourcePath: this.sourcePath,
        });
      } else {
        const allowedValues = new Set(values.map((v) => v.value));

        for (const key of Object.keys(valueDescriptions.value.value)) {
          if (!allowedValues.has(key)) {
            this.violations.add({
              code: 'swagger-2/codegen-enum-value-descriptions',
              message: `Each key of codegen-enum-value-descriptions must be defined as an Enum value. '${key}' has a description, but is not defined as an Enum value.`,
              severity: 'warning',
              range: decodeRange(valueDescriptions.value.loc),
              sourcePath: this.sourcePath,
            });
          }
        }
      }
    }
  }

  private parseType(
    def:
      | Exclude<OAS2.ParameterNode, OAS2.BodyParameterNode>
      | OAS2.JsonSchemaNode
      | OAS2.RefNode,
    localName: string,
    parentName: string,
  ): {
    enumValues?: Literal<string>[];
    rules: ValidationRule[];
    loc: string;
  } & TypedValue {
    if (OAS2.isRefNode(def)) {
      const res = OAS2.resolveParamOrSchema(this.schema.node, def);
      if (!res) throw new Error('Cannot resolve reference');
      if (res.nodeType === 'BodyParameter') {
        throw new Error('Unexpected body parameter');
      }

      // TODO: do a better job of detecting a definitions ref
      if (def.$ref.value.startsWith('#/definitions/')) {
        if (OAS2.isObject(res)) {
          return {
            typeName: {
              value: def.$ref.value.substring(14),
              loc: OAS2.refRange(this.schema.node, def.$ref.value),
            },
            isPrimitive: false,
            isArray: false,
            rules: this.parseRules(res),
            loc: range(res),
          };
        } else if (OAS2.isString(res) && res.enum) {
          const name = {
            value: def.$ref.value.substring(14),
            loc: OAS2.refRange(this.schema.node, def.$ref.value),
          };
          const meta = this.parseMeta(res);
          const values: Literal<string>[] = res.enum.map((n) => ({
            value: n.value,
            loc: range(n),
          }));
          this.validateEnumDescriptions(values, meta);

          this.enums.push({
            name: name,
            values,
            meta,
            loc: res.propRange('enum')!,
          });
          return {
            typeName: name,
            isPrimitive: false,
            isArray: false,
            rules: this.parseRules(res),
            loc: range(res),
          };
        } else {
          return this.parseType(res, localName, parentName);
        }
      } else {
        return {
          typeName: {
            value: def.$ref.value,
            loc: OAS2.refRange(this.schema.node, def.$ref.value),
          },
          isPrimitive: false,
          isArray: false,
          rules: this.parseRules(res),
          loc: range(res),
        };
      }
    }
    const rules = this.parseRules(def);

    switch (def.nodeType) {
      case 'StringParameter':
      case 'StringSchema':
        if (def.enum) {
          const enumName = camel(`${parentName}_${singular(localName)}`);
          const meta = this.parseMeta(def);
          const values: Literal<string>[] = def.enum.map((n) => ({
            value: n.value,
            loc: range(n),
          }));
          this.validateEnumDescriptions(values, meta);
          this.enums.push({
            name: { value: enumName },
            values,
            meta,
            loc: def.propRange('enum')!,
          });
          return {
            typeName: { value: enumName },
            isPrimitive: false,
            isArray: false,
            rules,
            loc: range(def),
          };
        } else {
          return {
            ...this.parseStringName(def),
            isArray: false,
            rules,
            loc: range(def),
          };
        }
      case 'NumberParameter':
      case 'NumberSchema':
        return {
          ...this.parseNumberName(def),
          isArray: false,
          rules,
          loc: range(def),
        };
      case 'BooleanParameter':
      case 'BooleanSchema':
      case 'NullSchema':
        return {
          typeName: {
            value: def.type.value,
            loc: range(def.type),
          },
          isPrimitive: true,
          isArray: false,
          rules,
          loc: range(def),
        };
      case 'ArrayParameter':
      case 'ArraySchema':
        const items = this.parseType(def.items, localName, parentName);

        if (items.isPrimitive) {
          return {
            typeName: items.typeName,
            isPrimitive: items.isPrimitive,
            isArray: true,
            rules,
            loc: range(def),
          };
        } else {
          return {
            typeName: items.typeName,
            isPrimitive: items.isPrimitive,
            isArray: true,
            rules,
            loc: range(def),
          };
        }

      case 'ObjectSchema':
        const typeName = { value: camel(`${parentName}_${localName}`) };
        this.anonymousTypes.push({
          name: typeName,
          properties: this.parseProperties(
            def.properties,
            def.required,
            def.allOf,
            typeName.value,
          ),
          description: def.description
            ? {
                value: def.description.value,
                loc: range(def.description),
              }
            : undefined,
          rules: this.parseObjectRules(def),
          loc: range(def),
        });

        return {
          typeName,
          isPrimitive: false,
          isArray: false,
          rules,
          loc: range(def),
        };
      default:
        return {
          typeName: { value: 'untyped' },
          isPrimitive: true,
          isArray: false,
          rules,
          loc: range(def),
        };
    }
  }

  private parseStringName(
    def: OAS2.StringParameterNode | OAS2.StringSchemaNode,
  ): Omit<PrimitiveValue, 'isArray' | 'rules'> {
    const { type, format } = def;

    if (format?.value === 'date') {
      return {
        typeName: {
          value: 'date',
          loc: range(def),
        },
        isPrimitive: true,
      };
    } else if (format?.value === 'date-time') {
      return {
        typeName: {
          value: 'date-time',
          loc: range(def),
        },
        isPrimitive: true,
      };
    } else {
      return {
        typeName: {
          value: type.value,
          loc: range(type),
        },
        isPrimitive: true,
      };
    }
  }

  private parseNumberName(
    def: OAS2.NumberParameterNode | OAS2.NumberSchemaNode,
  ): Omit<PrimitiveValue, 'isArray' | 'rules'> {
    const { type, format } = def;

    if (type.value === 'integer') {
      if (format?.value === 'int32') {
        return {
          typeName: {
            value: 'integer',
            loc: range(def),
          },
          isPrimitive: true,
        };
      } else if (format?.value === 'int64') {
        return {
          typeName: {
            value: 'long',
            loc: range(def),
          },
          isPrimitive: true,
        };
      }
    } else if (type.value === 'number') {
      if (format?.value === 'float') {
        return {
          typeName: {
            value: 'float',
            loc: range(def),
          },
          isPrimitive: true,
        };
      } else if (format?.value === 'double') {
        return {
          typeName: {
            value: 'double',
            loc: range(def),
          },
          isPrimitive: true,
        };
      }
    }

    return {
      typeName: {
        value: type.value,
        loc: range(type),
      },
      isPrimitive: true,
    };
  }

  private parsePrimaryResponseKey(
    operation: OAS2.OperationNode,
  ): Literal<number> | Literal<'default'> | undefined {
    const hasDefault =
      typeof operation.responses.read('default') !== 'undefined';
    const code = operation.responses.keys.filter((c) => c.startsWith('2'))[0]; // TODO: sort
    const codeLoc = operation.responses.keyRange(code);
    const defaultLoc = operation.responses.keyRange('default');

    if (code === 'default') return { value: 'default', loc: defaultLoc };

    const n = Number(code);

    if (!Number.isNaN(n)) return { value: n, loc: codeLoc };
    if (hasDefault) return { value: 'default', loc: defaultLoc };
    return;
  }

  private parseReturnType(
    operation: OAS2.OperationNode,
  ): ReturnType | undefined {
    const primaryCode = this.parsePrimaryResponseKey(operation);
    const success = operation.responses.read(`${primaryCode?.value}`);
    if (!success) return;

    const response = this.resolve(success, OAS2.ResponseNode);
    const name =
      OAS2.isRefNode(success) && success.$ref.value.startsWith('#/responses/')
        ? success.$ref.value.substring(12)
        : undefined;

    if (!response.schema) return;

    return this.parseType(
      response.schema,
      'response',
      name || operation.operationId?.value || '',
    );
  }

  private parseDefinitions(): Type[] {
    if (!this.schema.definitions) return [];

    const definitions = this.schema.definitions.keys
      // .map((name) => ({ ...this.schema.definitions![name], name }))
      .map<[string, OAS2.JsonSchemaNode, string | undefined, string]>(
        (name) => [
          name,
          this.schema.definitions!.read(name)!,
          this.schema.definitions!.keyRange(name),
          this.schema.definitions!.propRange(name)!,
        ],
      )
      .filter(([, node]) => node.nodeType === 'ObjectSchema');

    return definitions.map(([name, node, nameLoc, defLoc]) => {
      return {
        name: { value: name, loc: nameLoc },
        description: node.description
          ? {
              value: node.description.value,
              loc: range(node.description),
            }
          : undefined,
        properties:
          node.nodeType === 'ObjectSchema'
            ? this.parseProperties(
                node.properties,
                node.required,
                node.allOf,
                name,
              )
            : [],
        rules: this.parseObjectRules(node),
        loc: defLoc,
        meta: this.parseMeta(node),
      };
    });
  }

  private parseProperties(
    properties: OAS2.PropertiesNode | undefined,
    required: OAS2.LiteralNode<string>[] | undefined,
    allOf: (OAS2.RefNode | OAS2.ObjectSchemaNode)[] | undefined,
    parentName?: string,
  ): Property[] {
    if (allOf) {
      return allOf
        .map((subDef) => {
          const resolved = this.resolve(subDef, OAS2.ObjectSchemaNode);
          const p = resolved.properties;
          const r = safeConcat(resolved.required, required);
          return this.parseProperties(p, r, undefined, parentName);
        })
        .reduce((a, b) => a.concat(b), []);
    } else {
      const requiredSet = new Set<string>(required?.map((r) => r.value) || []);
      const props: Property[] = [];

      for (const name of properties?.keys || []) {
        const prop = properties?.read(name);
        if (!prop) continue;

        const resolvedProp = OAS2.resolveSchema(this.schema.node, prop);
        if (!resolvedProp) throw new Error('Cannot resolve reference');

        const x = this.parseType(prop, name, parentName || '');
        if (x.isPrimitive) {
          props.push({
            name: { value: name, loc: properties?.keyRange(name) },
            description: this.parseDescriptionOnly(resolvedProp.description),
            typeName: x.typeName,
            isPrimitive: x.isPrimitive,
            isArray: x.isArray,
            rules: this.parseRules(resolvedProp, requiredSet.has(name)),
            loc: range(resolvedProp),
            meta: this.parseMeta(resolvedProp),
          });
        } else {
          props.push({
            name: { value: name, loc: properties?.keyRange(name) },
            description: this.parseDescriptionOnly(resolvedProp.description),
            typeName: x.typeName,
            isPrimitive: x.isPrimitive,
            isArray: x.isArray,
            rules: this.parseRules(resolvedProp, requiredSet.has(name)),
            loc: range(resolvedProp),
            meta: this.parseMeta(resolvedProp),
          });
        }
      }
      return props;
    }
  }

  private resolve<T extends OAS2.DocumentNode>(
    itemOrRef: T | OAS2.RefNode,
    Node: new (n: AST.ASTNode) => T,
  ): T {
    return OAS2.resolve(this.schema.node, itemOrRef, Node);
  }

  private parseRules(
    def:
      | OAS2.JsonSchemaNode
      | Exclude<OAS2.ParameterNode, OAS2.BodyParameterNode>,
    required?: boolean,
  ): ValidationRule[] {
    const localRules = this.ruleFactories
      .map((f) => f(def))
      .filter((x): x is ValidationRule => !!x);

    const itemRules =
      def.nodeType === 'ArrayParameter' || def.nodeType === 'ArraySchema'
        ? this.ruleFactories
            .map((f) => f(OAS2.resolveSchema(this.schema.node, def.items)!))
            .filter((x): x is ValidationRule => !!x)
        : [];

    const rules = [...localRules, ...itemRules];

    return required ? [{ id: 'required' }, ...rules] : rules;
  }

  private parseObjectRules(
    def:
      | OAS2.JsonSchemaNode
      | Exclude<OAS2.ParameterNode, OAS2.BodyParameterNode>,
  ): ObjectValidationRule[] {
    return objectFactories
      .map((f) => f(def))
      .filter((x): x is ObjectValidationRule => !!x);
  }
}

export interface ValidationRuleFactory {
  (
    def:
      | OAS2.JsonSchemaNode
      | Exclude<OAS2.ParameterNode, OAS2.BodyParameterNode>,
  ): ValidationRule | undefined;
}

export interface ObjectValidationRuleFactory {
  (
    def:
      | OAS2.JsonSchemaNode
      | Exclude<OAS2.ParameterNode, OAS2.BodyParameterNode>,
  ): ObjectValidationRule | undefined;
}

const stringMaxLengthFactory: ValidationRuleFactory = (def) => {
  if (OAS2.isString(def) && typeof def.maxLength?.value === 'number') {
    return {
      id: 'string-max-length',
      length: { value: def.maxLength.value, loc: range(def.maxLength) },
      loc: def.propRange('maxLength')!,
    };
  } else {
    return;
  }
};

const stringMinLengthFactory: ValidationRuleFactory = (def) => {
  if (OAS2.isString(def) && typeof def.minLength?.value === 'number') {
    return {
      id: 'string-min-length',
      length: { value: def.minLength.value, loc: range(def.minLength) },
      loc: def.propRange('minLength')!,
    };
  } else {
    return;
  }
};

const stringPatternFactory: ValidationRuleFactory = (def) => {
  if (OAS2.isString(def) && typeof def.pattern?.value === 'string') {
    return {
      id: 'string-pattern',
      pattern: { value: def.pattern.value, loc: range(def.pattern) },
      loc: def.propRange('pattern')!,
    };
  } else {
    return;
  }
};

const stringFormatFactory: ValidationRuleFactory = (def) => {
  if (OAS2.isString(def) && typeof def.format?.value === 'string') {
    return {
      id: 'string-format',
      format: { value: def.format.value, loc: range(def.format) },
      loc: def.propRange('format')!,
    };
  } else {
    return;
  }
};

const stringEnumFactory: ValidationRuleFactory = (def) => {
  if (OAS2.isString(def) && Array.isArray(def.enum)) {
    return {
      id: 'string-enum',
      values: def.enum.map((n) => ({ value: n.value, loc: range(n) })),
      loc: def.propRange('enum')!,
    };
  } else {
    return;
  }
};

const numberMultipleOfFactory: ValidationRuleFactory = (def) => {
  if (OAS2.isNumber(def) && typeof def.multipleOf?.value === 'number') {
    return {
      id: 'number-multiple-of',
      value: { value: def.multipleOf.value, loc: range(def.multipleOf) },
      loc: def.propRange('multipleOf')!,
    };
  } else {
    return;
  }
};

const numberGreaterThanFactory: ValidationRuleFactory = (def) => {
  if (OAS2.isNumber(def) && typeof def.minimum?.value === 'number') {
    return {
      id: def.exclusiveMinimum?.value ? 'number-gt' : 'number-gte',
      value: { value: def.minimum.value, loc: range(def.minimum) },
      loc: def.propRange('minimum')!,
    };
  } else {
    return;
  }
};

const numberLessThanFactory: ValidationRuleFactory = (def) => {
  if (OAS2.isNumber(def) && typeof def.maximum?.value === 'number') {
    return {
      id: def.exclusiveMinimum?.value ? 'number-lt' : 'number-lte',
      value: { value: def.maximum.value, loc: range(def.maximum) },
      loc: def.propRange('maximum')!,
    };
  } else {
    return;
  }
};

const arrayMinItemsFactory: ValidationRuleFactory = (def) => {
  if (OAS2.isArray(def) && typeof def.minItems?.value === 'number') {
    return {
      id: 'array-min-items',
      min: { value: def.minItems.value, loc: range(def.minItems) },
      loc: def.propRange('minItems')!,
    };
  } else {
    return;
  }
};

const arrayMaxItemsFactory: ValidationRuleFactory = (def) => {
  if (OAS2.isArray(def) && typeof def.maxItems?.value === 'number') {
    return {
      id: 'array-max-items',
      max: { value: def.maxItems.value, loc: range(def.maxItems) },
      loc: def.propRange('maxItems')!,
    };
  } else {
    return;
  }
};

const arrayUniqueItemsFactory: ValidationRuleFactory = (def) => {
  if (OAS2.isArray(def) && def.uniqueItems) {
    return {
      id: 'array-unique-items',
      required: true,
      loc: def.propRange('uniqueItems')!,
    };
  } else {
    return;
  }
};

const objectMinPropertiesFactory: ObjectValidationRuleFactory = (def) => {
  if (OAS2.isObject(def) && typeof def.minProperties?.value === 'number') {
    return {
      id: 'object-min-properties',
      min: {
        value: def.minProperties.value,
        loc: range(def.minProperties),
      },
      loc: def.propRange('minProperties')!,
    };
  } else {
    return;
  }
};

const objectMaxPropertiesFactory: ObjectValidationRuleFactory = (def) => {
  if (OAS2.isObject(def) && typeof def.maxProperties?.value === 'number') {
    return {
      id: 'object-max-properties',
      max: {
        value: def.maxProperties.value,
        loc: range(def.maxProperties),
      },
      loc: def.propRange('maxProperties')!,
    };
  } else {
    return;
  }
};

const objectAdditionalPropertiesFactory: ObjectValidationRuleFactory = (
  def,
) => {
  if (
    OAS2.isObject(def) &&
    OAS2.isLiteral(def.additionalProperties) &&
    def.additionalProperties.value === false
  ) {
    return {
      id: 'object-additional-properties',
      forbidden: true,
      loc: def.propRange('additionalProperties')!,
    };
  } else {
    return;
  }
};

const factories = [
  stringEnumFactory,
  stringFormatFactory,
  stringMaxLengthFactory,
  stringMinLengthFactory,
  stringPatternFactory,
  numberMultipleOfFactory,
  numberGreaterThanFactory,
  numberLessThanFactory,
  arrayMaxItemsFactory,
  arrayMinItemsFactory,
  arrayUniqueItemsFactory,
];

const objectFactories = [
  objectMaxPropertiesFactory,
  objectMinPropertiesFactory,
  objectAdditionalPropertiesFactory,
];

function isBodyParameter(obj: any): obj is OAS2.BodyParameterNode {
  return typeof obj['in']?.value === 'string' && obj.in.value === 'body';
}

function keysOf<T extends object>(obj: T): (keyof T)[] {
  return Object.keys(obj) as any;
}

function safeConcat<T>(
  a: T[] | undefined,
  b: T[] | undefined,
): T[] | undefined {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.concat(b);
  } else if (Array.isArray(a)) {
    return a;
  } else if (Array.isArray(b)) {
    return b;
  } else {
    return undefined;
  }
}

function literal<T extends string | number | boolean | null>(
  node: OAS2.LiteralNode<T>,
): Literal<T> {
  return {
    value: node.value,
    loc: range(node),
  };
}
