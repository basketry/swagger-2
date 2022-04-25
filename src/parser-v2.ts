import { major } from 'semver';
import { singular } from 'pluralize';
import { camel, pascal } from 'case';
import * as parse from 'json-to-ast';

import * as AST from './types-v2';

import {
  Enum,
  Interface,
  Method,
  MethodSpec,
  ObjectValidationRule,
  Parameter,
  PathSpec,
  Property,
  ReturnType,
  Service,
  ServiceFactory,
  SecurityOption,
  SecurityScheme,
  Type,
  ValidationRule,
} from 'basketry';

export class OAS2Parser implements ServiceFactory {
  constructor(schema: string) {
    this.schema = new AST.SchemaNode(parse(schema, { loc: true }));
  }

  private readonly schema: AST.SchemaNode;

  private readonly ruleFactories: ValidationRuleFactory[] = factories;
  private enums: Enum[];
  private anonymousTypes: Type[];

  parse(): Service {
    this.enums = [];
    this.anonymousTypes = [];
    const interfaces = this.parseInterfaces();
    const types = this.parseDefinitions();

    const typesByName = [...types, ...this.anonymousTypes].reduce(
      (acc, item) => ({ ...acc, [item.name]: item }),
      {},
    );

    const enumsByName = this.enums.reduce(
      (acc, item) => ({ ...acc, [item.name]: item }),
      {},
    );

    return {
      title: pascal(this.schema.info.title.value),
      majorVersion: major(this.schema.info.version.value),
      interfaces,
      types: Object.keys(typesByName).map((name) => typesByName[name]),
      enums: Object.keys(enumsByName).map((name) => enumsByName[name]),
    };
  }

  private parseInterfaces(): Interface[] {
    return this.schema.paths.keys
      .map((path) => path.split('/')[1])
      .filter((v, i, a) => a.indexOf(v) === i)
      .map((name) => ({
        name: singular(name),
        methods: this.parseMethods(name),
        protocols: {
          http: this.parseHttpProtocol(name),
        },
      }));
  }

  private parseResponseCode(
    verb: string,
    operation: AST.OperationNode,
  ): number {
    const primary = this.parsePrimaryResponseKey(operation);

    if (typeof primary === 'number') {
      return primary;
    } else if (primary === 'default') {
      const res = operation.responses.read(primary);
      if (res && this.resolve(res, AST.ResponseNode).schema) {
        switch (verb) {
          case 'delete':
            return 202;
          case 'options':
            return 204;
          case 'post':
            return 201;
        }
      } else {
        return 204;
      }
    }

    return 200;
  }

  private parseHttpProtocol(interfaceName: string): PathSpec[] {
    const paths = this.schema.paths.keys.filter(
      (path) => path.split('/')[1] === interfaceName,
    );

    const pathSpecs: PathSpec[] = [];

    for (const path of paths) {
      const pathItem = this.resolve(
        this.schema.paths.read(path)!,
        AST.PathItemNode,
      );
      const commonParameters = pathItem.parameters || [];

      const pathSpec: PathSpec = {
        path,
        methods: [],
      };

      for (const verb of pathItem.keys) {
        if (verb === 'parameters') continue;

        const operation = pathItem[verb]! as AST.OperationNode;

        const methodSpec: MethodSpec = {
          name: operation.operationId?.value || 'unknown',
          verb: verb as any,
          parameters: [],
          successCode: this.parseResponseCode(verb, operation),
        };

        for (const param of [
          ...(operation.parameters || []),
          ...commonParameters,
        ]) {
          const name = this.parseParameterName(param).value;

          const resolved = AST.resolveParam(this.schema.node, param);
          if (!resolved) throw new Error('Cannot resolve reference');

          if (
            (resolved.in.value === 'header' ||
              resolved.in.value === 'path' ||
              resolved.in.value === 'query') &&
            resolved.nodeType === 'ArrayParameter'
          ) {
            methodSpec.parameters.push({
              name,
              in: this.parseParameterLocation(param).value,
              array: resolved.collectionFormat?.value || 'csv',
            });
          } else {
            methodSpec.parameters.push({
              name,
              in: this.parseParameterLocation(param).value,
            });
          }
        }

        pathSpec.methods.push(methodSpec);
      }

      pathSpecs.push(pathSpec);
    }
    return pathSpecs;
  }

  private parseMethods(interfaceName: string): Method[] {
    const paths = this.schema.paths.keys.filter(
      (path) => path.split('/')[1] === interfaceName,
    );

    const methods: Method[] = [];

    for (const path of paths) {
      const commonParameters = this.schema.paths.read(path)!.parameters || [];
      for (const verb of this.schema.paths.read(path)!.keys) {
        if (verb === 'parameters') continue;

        const operation: AST.OperationNode =
          this.schema.paths.read(path)![verb];
        methods.push({
          name: operation.operationId?.value || 'UNNAMED',
          security: this.parseSecurity(operation),
          parameters: this.parseParameters(operation, commonParameters),
          description: this.parseDescription(
            operation.summary?.value,
            operation.description?.value,
          ),
          returnType: this.parseReturnType(operation),
        });
      }
    }
    return methods;
  }

  private parseDescription(
    summary: string | undefined,
    description: string | undefined,
  ): string | string[] | undefined {
    if (summary && description) return [summary, description];
    if (summary) return summary;
    if (description) return description;
    return;
  }

  private parseSecurity(operation: AST.OperationNode): SecurityOption[] {
    const { securityDefinitions, security: defaultSecurity } = this.schema;
    const { security: operationSecurity } = operation;
    const security = operationSecurity || defaultSecurity || [];

    const options: SecurityOption[] = security.map((requirements) =>
      requirements.keys
        .map((key): SecurityScheme | undefined => {
          const requirement = requirements.read(key);
          const definition = securityDefinitions?.read(key);

          if (!requirement || !definition) return;

          switch (definition.nodeType) {
            case 'BasicSecurityScheme':
              return {
                type: 'basic',
                name: key,
              };
            case 'ApiKeySecurityScheme':
              return {
                type: 'apiKey',
                name: key,
                description: definition.description?.value,
                parameter: definition.name.value,
                in: definition.in.value,
              };
            case 'OAuth2SecurityScheme': {
              switch (definition.flow.value) {
                case 'implicit':
                  return {
                    type: 'oauth2',
                    name: key,
                    description: definition.description?.value,
                    flows: [
                      {
                        type: 'implicit',
                        authorizationUrl: definition.authorizationUrl.value,
                        // WARNING! This is different than the others
                        scopes: requirement.map((name) => ({
                          name: name.value,
                          description: definition.scopes.read(name.value)!
                            .value,
                        })),
                      },
                    ],
                  };
                case 'password':
                  return {
                    type: 'oauth2',
                    name: key,
                    description: definition.description?.value,
                    flows: [
                      {
                        type: 'password',
                        tokenUrl: definition.tokenUrl.value,
                        // WARNING! This is different than implicit
                        scopes: definition.scopes.keys.map((name) => ({
                          name,
                          description: definition.scopes.read(name)!.value,
                        })),
                      },
                    ],
                  };
                case 'application':
                  return {
                    type: 'oauth2',
                    name: key,
                    description: definition.description?.value,
                    flows: [
                      {
                        type: 'clientCredentials',
                        tokenUrl: definition.tokenUrl.value,
                        // WARNING! This is different than implicit
                        scopes: definition.scopes.keys.map((name) => ({
                          name,
                          description: definition.scopes.read(name)!.value,
                        })),
                      },
                    ],
                  };
                case 'accessCode':
                  return {
                    type: 'oauth2',
                    name: key,
                    description: definition.description?.value,
                    flows: [
                      {
                        type: 'authorizationCode',
                        authorizationUrl: definition.authorizationUrl.value,
                        tokenUrl: definition.tokenUrl.value,
                        // WARNING! This is different than implicit
                        scopes: definition.scopes.keys.map((name) => ({
                          name,
                          description: definition.scopes.read(name)!.value,
                        })),
                      },
                    ],
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
    operation: AST.OperationNode,
    commonParameters: (AST.ParameterNode | AST.RefNode)[],
  ): Parameter[] {
    const allParameters = [
      ...commonParameters,
      ...(operation.parameters || []),
    ];
    if (!allParameters.length) return [];

    return allParameters.map((p) =>
      this.parseParameter(
        AST.resolveParam(this.schema.node, p)!,
        operation.operationId?.value || '',
      ),
    );
  }

  private parseParameter(
    param: AST.ParameterNode,
    methodName: string,
  ): Parameter {
    const unresolved = isBodyParameter(param) ? param.schema : param;
    const resolved = AST.resolveParamOrSchema(this.schema.node, unresolved);
    if (!resolved) throw new Error('Cannot resolve reference');
    if (resolved.nodeType === 'BodyParameter') {
      throw new Error('Unexpected body parameter');
    }

    const { typeName, isUnknown, isLocal, isArray } = this.parseType(
      unresolved,
      param.name.value,
      methodName,
    );
    return {
      name: param.name.value,
      description: this.parseDescription(undefined, param.description?.value),
      typeName,
      isUnknown,
      isLocal,
      isArray,
      rules: this.parseRules(resolved, param.required?.value),
    };
  }

  private parseParameterLocation(
    def: AST.ParameterNode | AST.RefNode,
  ): AST.ParameterNode['in'] {
    const resolved = AST.resolveParam(this.schema.node, def);
    if (!resolved) throw new Error('Cannot resolve reference');

    return resolved.in;
  }

  private parseParameterName(
    def: AST.ParameterNode | AST.RefNode,
  ): AST.ParameterNode['name'] {
    const resolved = AST.resolveParam(this.schema.node, def);
    if (!resolved) throw new Error('Cannot resolve reference');

    return resolved.name;
  }

  private parseType(
    def:
      | Exclude<AST.ParameterNode, AST.BodyParameterNode>
      | AST.JsonSchemaNode
      | AST.RefNode,
    localName: string,
    parentName: string,
  ): {
    typeName: string;
    isUnknown: boolean;
    enumValues?: string[];
    isLocal: boolean;
    isArray: boolean;
    rules: ValidationRule[];
  } {
    if (AST.isRefNode(def)) {
      const res = AST.resolveParamOrSchema(this.schema.node, def);
      if (!res) throw new Error('Cannot resolve reference');
      if (res.nodeType === 'BodyParameter') {
        throw new Error('Unexpected body parameter');
      }

      if (def.$ref.value.startsWith('#/definitions/')) {
        if (AST.isObject(res)) {
          return {
            typeName: def.$ref.value.substring(14),
            isUnknown: false,
            isLocal: true,
            isArray: false,
            rules: this.parseRules(res),
          };
        } else if (AST.isString(res) && res.enum) {
          const name = def.$ref.value.substring(14);

          this.enums.push({
            name,
            values: res.enum.map((n) => n.value),
          });
          return {
            typeName: name,
            isUnknown: false,
            isLocal: true,
            isArray: false,
            rules: this.parseRules(res),
          };
        } else {
          return {
            typeName: res.type.value,
            isUnknown: false,
            isLocal: false,
            isArray: false,
            rules: this.parseRules(res),
          };
        }
      } else {
        return {
          typeName: def.$ref.value,
          isUnknown: true,
          isLocal: true,
          isArray: false,
          rules: this.parseRules(res),
        };
      }
    }
    const rules = this.parseRules(def);

    switch (def.nodeType) {
      case 'StringParameter':
      case 'StringSchema':
        if (def.enum) {
          const enumName = camel(`${parentName}_${singular(localName)}`);
          this.enums.push({
            name: enumName,
            values: def.enum.map((n) => n.value),
          });
          return {
            typeName: enumName,
            isUnknown: false,
            isLocal: true,
            isArray: false,
            rules,
          };
        } else {
          return {
            typeName: def.type.value,
            isUnknown: false,
            isLocal: false,
            isArray: false,
            rules,
          };
        }
      case 'NumberParameter':
      case 'NumberSchema':
      case 'BooleanParameter':
      case 'BooleanSchema':
      case 'NullSchema':
        return {
          typeName: def.type.value,
          isUnknown: false,
          isLocal: false,
          isArray: false,
          rules,
        };
      case 'ArrayParameter':
      case 'ArraySchema':
        const items = this.parseType(def.items, localName, parentName);
        return {
          typeName: items.typeName,
          isUnknown: false,
          isLocal: items.isLocal,
          isArray: true,
          rules,
        };
      case 'ObjectSchema':
        const typeName = camel(`${parentName}_${localName}`);
        this.anonymousTypes.push({
          name: typeName,
          properties: this.parseProperties(
            def.properties,
            def.required,
            def.allOf,
            typeName,
          ),
          description: def.description?.value,
          rules: this.parseObjectRules(def),
        });

        return {
          typeName,
          isUnknown: false,
          isLocal: true,
          isArray: false,
          rules,
        };
      default:
        return {
          typeName: 'unknown',
          isUnknown: true,
          isLocal: false,
          isArray: false,
          rules,
        };
    }
  }

  private parsePrimaryResponseKey(
    operation: AST.OperationNode,
  ): number | 'default' | undefined {
    const hasDefault =
      typeof operation.responses.read('default') !== 'undefined';
    const code = operation.responses.keys.filter((c) => c.startsWith('2'))[0];

    if (code === 'default') return 'default';

    const n = Number(code);

    if (!Number.isNaN(n)) return n;
    if (hasDefault) return 'default';
    return;
  }

  private parseReturnType(
    operation: AST.OperationNode,
  ): ReturnType | undefined {
    const primaryCode = this.parsePrimaryResponseKey(operation);
    const success = operation.responses.read(`${primaryCode}`);
    if (!success) return;

    const response = this.resolve(success, AST.ResponseNode);
    const name =
      AST.isRefNode(success) && success.$ref.value.startsWith('#/responses/')
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
      .map<[string, AST.JsonSchemaNode]>((name) => [
        name,
        this.schema.definitions!.read(name)!,
      ])
      .filter(([, node]) => node.nodeType === 'ObjectSchema');

    return definitions.map(([name, node]) => {
      return {
        name,
        description: node.description?.value,
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
      };
    });
  }

  private parseProperties(
    properties: AST.PropertiesNode | undefined,
    required: AST.LiteralNode<string>[] | undefined,
    allOf: (AST.RefNode | AST.ObjectSchemaNode)[] | undefined,
    parentName?: string,
  ): Property[] {
    if (allOf) {
      return allOf
        .map((subDef) => {
          const resolved = this.resolve(subDef, AST.ObjectSchemaNode);
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

        const resolvedProp = AST.resolveSchema(this.schema.node, prop);
        if (!resolvedProp) throw new Error('Cannot resolve reference');

        const { typeName, isUnknown, isArray, isLocal } = this.parseType(
          prop,
          name,
          parentName || '',
        );
        props.push({
          name,
          description: resolvedProp.description?.value,
          typeName,
          isUnknown,
          isArray,
          isLocal,
          rules: this.parseRules(resolvedProp, requiredSet.has(name)),
        });
      }
      return props;
    }
  }

  private resolve<T extends AST.JsonNode>(
    itemOrRef: T | AST.RefNode,
    Node: new (n: AST.RawNode) => T,
  ): T {
    return AST.resolve(this.schema.node, itemOrRef, Node);
  }

  private parseRules(
    def: AST.JsonSchemaNode | Exclude<AST.ParameterNode, AST.BodyParameterNode>,
    required?: boolean,
  ): ValidationRule[] {
    const localRules = this.ruleFactories
      .map((f) => f(def))
      .filter((x): x is ValidationRule => !!x);

    const itemRules =
      def.nodeType === 'ArrayParameter' || def.nodeType === 'ArraySchema'
        ? this.ruleFactories
            .map((f) => f(AST.resolveSchema(this.schema.node, def.items)!))
            .filter((x): x is ValidationRule => !!x)
        : [];

    const rules = [...localRules, ...itemRules];

    return required ? [{ id: 'required' }, ...rules] : rules;
  }

  private parseObjectRules(
    def: AST.JsonSchemaNode | Exclude<AST.ParameterNode, AST.BodyParameterNode>,
  ): ObjectValidationRule[] {
    return objectFactories
      .map((f) => f(def))
      .filter((x): x is ObjectValidationRule => !!x);
  }
}

export interface ValidationRuleFactory {
  (
    def: AST.JsonSchemaNode | Exclude<AST.ParameterNode, AST.BodyParameterNode>,
  ): ValidationRule | undefined;
}

export interface ObjectValidationRuleFactory {
  (
    def: AST.JsonSchemaNode | Exclude<AST.ParameterNode, AST.BodyParameterNode>,
  ): ObjectValidationRule | undefined;
}

const stringMaxLengthFactory: ValidationRuleFactory = (def) => {
  if (AST.isString(def) && typeof def.maxLength?.value === 'number') {
    return {
      id: 'string-max-length',
      length: def.maxLength.value,
    };
  } else {
    return;
  }
};

const stringMinLengthFactory: ValidationRuleFactory = (def) => {
  if (AST.isString(def) && typeof def.minLength?.value === 'number') {
    return {
      id: 'string-min-length',
      length: def.minLength.value,
    };
  } else {
    return;
  }
};

const stringPatternFactory: ValidationRuleFactory = (def) => {
  if (AST.isString(def) && typeof def.pattern?.value === 'string') {
    return {
      id: 'string-pattern',
      pattern: def.pattern.value,
    };
  } else {
    return;
  }
};

const stringFormatFactory: ValidationRuleFactory = (def) => {
  if (AST.isString(def) && typeof def.format?.value === 'string') {
    return {
      id: 'string-format',
      format: def.format.value,
    };
  } else {
    return;
  }
};

const stringEnumFactory: ValidationRuleFactory = (def) => {
  if (AST.isString(def) && Array.isArray(def.enum)) {
    return {
      id: 'string-enum',
      values: def.enum.map((n) => n.value),
    };
  } else {
    return;
  }
};

const numberMultipleOfFactory: ValidationRuleFactory = (def) => {
  if (AST.isNumber(def) && typeof def.multipleOf?.value === 'number') {
    return {
      id: 'number-multiple-of',
      value: def.multipleOf.value,
    };
  } else {
    return;
  }
};

const numberGreaterThanFactory: ValidationRuleFactory = (def) => {
  if (AST.isNumber(def) && typeof def.minimum?.value === 'number') {
    return {
      id: def.exclusiveMinimum?.value ? 'number-gt' : 'number-gte',
      value: def.minimum.value,
    };
  } else {
    return;
  }
};

const numberLessThanFactory: ValidationRuleFactory = (def) => {
  if (AST.isNumber(def) && typeof def.maximum?.value === 'number') {
    return {
      id: def.exclusiveMinimum?.value ? 'number-lt' : 'number-lte',
      value: def.maximum.value,
    };
  } else {
    return;
  }
};

const arrayMinItemsFactory: ValidationRuleFactory = (def) => {
  if (AST.isArray(def) && typeof def.minItems?.value === 'number') {
    return {
      id: 'array-min-items',
      min: def.minItems.value,
    };
  } else {
    return;
  }
};

const arrayMaxItemsFactory: ValidationRuleFactory = (def) => {
  if (AST.isArray(def) && typeof def.maxItems?.value === 'number') {
    return {
      id: 'array-max-items',
      max: def.maxItems.value,
    };
  } else {
    return;
  }
};

const arrayUniqueItemsFactory: ValidationRuleFactory = (def) => {
  if (AST.isArray(def) && def.uniqueItems) {
    return {
      id: 'array-unique-items',
      required: true,
    };
  } else {
    return;
  }
};

const objectMinPropertiesFactory: ObjectValidationRuleFactory = (def) => {
  if (AST.isObject(def) && typeof def.minProperties?.value === 'number') {
    return {
      id: 'object-min-properties',
      min: def.minProperties.value,
    };
  } else {
    return;
  }
};

const objectMaxPropertiesFactory: ObjectValidationRuleFactory = (def) => {
  if (AST.isObject(def) && typeof def.maxProperties?.value === 'number') {
    return {
      id: 'object-max-properties',
      max: def.maxProperties.value,
    };
  } else {
    return;
  }
};

const objectAdditionalPropertiesFactory: ObjectValidationRuleFactory = (
  def,
) => {
  if (
    AST.isObject(def) &&
    AST.isLiteral(def.additionalProperties) &&
    def.additionalProperties.value === false
  ) {
    return {
      id: 'object-additional-properties',
      forbidden: true,
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

function isBodyParameter(obj: any): obj is AST.BodyParameterNode {
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
