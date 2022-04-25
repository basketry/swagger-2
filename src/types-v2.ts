// import { readFileSync } from 'fs';
// import { join } from 'path';
import * as parse from 'json-to-ast';

export function resolveRef(root: parse.ASTNode, ref: string): parse.ASTNode {
  if (!ref.startsWith('#')) throw new Error(`Cannot resolve ref '${ref}'`);

  let result: parse.ASTNode = root;

  for (const segment of ref.split('/')) {
    if (segment === '#') {
      result = root;
    } else {
      if (isObjectNode(result)) {
        const child = result.children.find((n) => n.key.value === segment);
        if (!child) throw new Error(`Cannot resolve ref '${ref}'`);
        result = child.value;
      } else {
        throw new Error(`Cannot resolve ref '${ref}'`);
      }
    }
  }

  return result;
}

export type RawNode = parse.ASTNode;

export function resolve<T extends JsonNode>(
  root: parse.ASTNode,
  itemOrRef: T | RefNode,
  Node: new (n: parse.ASTNode) => T,
): T {
  return isRefNode(itemOrRef)
    ? new Node(resolveRef(root, itemOrRef.$ref.value))
    : itemOrRef;
}

export type ParameterNode =
  | BodyParameterNode
  | StringParameterNode
  | NumberParameterNode
  | BooleanParameterNode
  | ArrayParameterNode;

export function resolveParam(
  root: parse.ASTNode,
  paramOrRef: RefNode | ParameterNode,
): ParameterNode | undefined {
  if (!isRefNode(paramOrRef)) return paramOrRef;

  const node = resolveRef(root, paramOrRef.$ref.value);
  if (!isObjectNode(node)) return;

  const inNode = node.children.find((n) => n.key.value === 'in')?.value;
  if (!isLiteralNode(inNode)) return;

  if (inNode.value === 'body') return new BodyParameterNode(node);

  const typeNode = node.children.find((n) => n.key.value === 'type')?.value;
  if (!isLiteralNode(typeNode)) return;
  switch (typeNode.value) {
    case 'string':
      return new StringParameterNode(node);
    case 'integer':
    case 'number':
      return new NumberParameterNode(node);
    case 'boolean':
      return new BooleanParameterNode(node);
    case 'array':
      return new ArrayParameterNode(node);
    default:
      return;
  }
}

export type JsonSchemaNode =
  | StringSchemaNode
  | NumberSchemaNode
  | BooleanSchemaNode
  | NullSchemaNode
  | ArraySchemaNode
  | ObjectSchemaNode;

export function resolveSchema(
  root: parse.ASTNode,
  paramOrRef: RefNode | JsonSchemaNode,
): JsonSchemaNode | undefined {
  if (!isRefNode(paramOrRef)) return paramOrRef;

  const node = resolveRef(root, paramOrRef.$ref.value);
  if (!isObjectNode(node)) return;

  const typeNode = node.children.find((n) => n.key.value === 'type')?.value;
  if (!isLiteralNode(typeNode)) return;

  switch (typeNode.value) {
    case 'string':
      return new StringSchemaNode(node);
    case 'integer':
    case 'number':
      return new NumberSchemaNode(node);
    case 'boolean':
      return new BooleanSchemaNode(node);
    case 'null':
      return new NullSchemaNode(node);
    case 'array':
      return new ArraySchemaNode(node);
    case 'object':
      return new ObjectSchemaNode(node);
    default:
      return;
  }
}

export function resolveParamOrSchema(
  root: parse.ASTNode,
  itemOrRef: RefNode | ParameterNode | JsonSchemaNode,
): ParameterNode | JsonSchemaNode | undefined {
  if (!isRefNode(itemOrRef)) return itemOrRef;

  const node = resolveRef(root, itemOrRef.$ref.value);
  if (!isObjectNode(node)) return;

  const inNode = node.children.find((n) => n.key.value === 'in')?.value;
  if (isLiteralNode(inNode)) {
    return resolveParam(root, itemOrRef);
  } else {
    return resolveSchema(root, itemOrRef);
  }
}

export abstract class JsonNode {
  constructor(readonly node: parse.ASTNode) {}

  abstract readonly nodeType: string;

  get loc(): parse.Location | undefined {
    return this.node.loc;
  }

  get keys(): string[] {
    return isObjectNode(this.node)
      ? this.node.children.map((n) => n.key.value)
      : [];
  }

  protected getChild<T extends JsonNode>(
    key: string,
    Node: new (n: parse.ASTNode) => T,
  ): T | undefined {
    const prop = this.getProperty(key);
    return prop?.value ? new Node(prop.value) : undefined;
  }

  protected getArray<T extends JsonNode>(
    key: string,
    Node: new (n: parse.ASTNode) => T,
  ): T[] | undefined {
    const array = this.getProperty(key)?.value;

    return isArrayNode(array)
      ? array.children.map((n) => new Node(n))
      : undefined;
  }

  protected getProperty(key: string) {
    if (isObjectNode(this.node)) {
      return this.node.children.find((n) => n.key.value === key);
    }
    return;
  }

  protected getLiteral<T extends string | number | boolean | null>(
    key: string,
  ): LiteralNode<T> | undefined {
    return this.getChild(key, LiteralNode) as LiteralNode<T> | undefined;
  }
}

export class SchemaNode extends JsonNode {
  public readonly nodeType = 'Schema';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get swagger() {
    return this.getLiteral<'2.0'>('swagger')!;
  }

  get info() {
    return this.getChild('info', InfoNode)!;
  }

  get host() {
    return this.getLiteral<string>('host');
  }

  get basePath() {
    return this.getLiteral<string>('basePath');
  }

  get schemes() {
    return this.getArray<LiteralNode<string>>('schemes', LiteralNode);
  }

  get consumes() {
    return this.getArray<LiteralNode<string>>('consumes', LiteralNode);
  }

  get produces() {
    return this.getArray<LiteralNode<string>>('produces', LiteralNode);
  }

  get paths() {
    return this.getChild('paths', PathsNode)!;
  }

  get definitions() {
    return this.getChild('definitions', DefinitionsNode);
  }

  // get parameters() {
  //   return this.getChild('parameters');
  // }

  // get responses() {
  //   return this.getChild('responses');
  // }

  get securityDefinitions() {
    return this.getChild('securityDefinitions', SecurityDefinitionsNode);
  }

  get security() {
    return this.getArray('security', SecurityRequirementNode);
  }

  get tags() {
    return this.getArray('tags', TagNode);
  }

  get externalDocs() {
    return this.getChild('externalDocs', ExternalDocumentationNode);
  }
}

export class TagNode extends JsonNode {
  public readonly nodeType = 'Tag';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get name() {
    return this.getLiteral<string>('name')!;
  }

  get description() {
    return this.getLiteral<string>('description');
  }

  get externalDocs() {
    return this.getChild('externalDocs', ExternalDocumentationNode);
  }
}

export class DefinitionsNode extends JsonNode {
  public readonly nodeType = 'Definitions';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  read(key: string): JsonSchemaNode | undefined {
    const value = this.getProperty(key)?.value;
    if (!isObjectNode(value)) return;

    const typeNode = value.children.find((n) => n.key.value === 'type')?.value;

    if (isLiteralNode(typeNode)) {
      switch (typeNode.value) {
        case 'string':
          return new StringSchemaNode(value);
        case 'integer':
        case 'number':
          return new NumberSchemaNode(value);
        case 'boolean':
          return new BooleanSchemaNode(value);
        case 'null':
          return new NullSchemaNode(value);
        case 'array':
          return new ArraySchemaNode(value);
        case 'object':
          return new ObjectSchemaNode(value);
      }
    }

    return;
  }
}

export class PathsNode extends JsonNode {
  public readonly nodeType = 'Paths';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  read(key: string) {
    return this.getChild(key, PathItemNode);
  }
}

export class InfoNode extends JsonNode {
  public readonly nodeType = 'Info';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get version() {
    return this.getLiteral<string>('version')!;
  }

  get title() {
    return this.getLiteral<string>('title')!;
  }

  get description() {
    return this.getLiteral<string>('description');
  }

  get termsOfService() {
    return this.getLiteral<string>('termsOfService');
  }

  get contact() {
    return this.getChild('contact', ContactNode);
  }

  get license() {
    return this.getChild('license', LicenseNode);
  }
}

export class ContactNode extends JsonNode {
  public readonly nodeType = 'Contact';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get name() {
    return this.getLiteral<string>('name');
  }

  get url() {
    return this.getLiteral<string>('url');
  }

  get email() {
    return this.getLiteral<string>('email');
  }
}

export class LicenseNode extends JsonNode {
  public readonly nodeType = 'License';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get name() {
    return this.getLiteral<string>('name')!;
  }

  get url() {
    return this.getLiteral<string>('url');
  }
}

export class PathItemNode extends JsonNode {
  public readonly nodeType = 'PathItem';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get get() {
    return this.getChild('get', OperationNode);
  }

  get put() {
    return this.getChild('put', OperationNode);
  }

  get post() {
    return this.getChild('post', OperationNode);
  }

  get delete() {
    return this.getChild('delete', OperationNode);
  }

  get options() {
    return this.getChild('options', OperationNode);
  }

  get head() {
    return this.getChild('head', OperationNode);
  }

  get patch() {
    return this.getChild('patch', OperationNode);
  }

  get parameters(): (ParameterNode | RefNode)[] | undefined {
    const array = this.getProperty('parameters')?.value;
    if (!array) return;

    if (!isArrayNode(array)) throw new Error('Value is not an array');

    return array.children.map((value) => {
      if (isRef(value)) return new RefNode(value);
      if (isObjectNode(value)) {
        const inNode = value.children.find((n) => n.key.value === 'in')?.value;
        if (isLiteralNode(inNode)) {
          switch (inNode.value) {
            case 'body':
              return new BodyParameterNode(value);
            case 'query':
            case 'header':
            case 'path':
            case 'formData': {
              const typeNode = value.children.find(
                (n) => n.key.value === 'type',
              )?.value;
              if (isLiteralNode(typeNode)) {
                switch (typeNode.value) {
                  case 'string':
                    return new StringParameterNode(value);
                  case 'integer':
                  case 'number':
                    return new NumberParameterNode(value);
                  case 'boolean':
                    return new BooleanParameterNode(value);
                  case 'array':
                    return new ArrayParameterNode(value);
                }
              }
            }
          }
        }
      }

      throw new Error('Unknown parameter definition');
    });
  }
}

export class BodyParameterNode extends JsonNode {
  public readonly nodeType = 'BodyParameter';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get name() {
    return this.getLiteral<string>('name')!;
  }

  get in() {
    return this.getLiteral<'body'>('in')!;
  }

  get description() {
    return this.getLiteral<string>('description');
  }

  get required() {
    return this.getLiteral<boolean>('required');
  }

  get schema() {
    const value = this.getProperty('schema')?.value;

    if (isRef(value)) return new RefNode(value!);

    if (isObjectNode(value)) {
      const typeNode = value.children.find(
        (n) => n.key.value === 'type',
      )?.value;
      if (isLiteralNode(typeNode)) {
        switch (typeNode.value) {
          case 'string':
            return new StringSchemaNode(value);
          case 'number':
          case 'integer':
            return new NumberSchemaNode(value);
          case 'boolean':
            return new BooleanSchemaNode(value);
          case 'null':
            return new NullSchemaNode(value);
          case 'array':
            return new ArraySchemaNode(value);
          case 'object':
            return new ObjectSchemaNode(value);
        }
      }
    }

    throw new Error('Unknown schema definition');
  }
}

export abstract class NonBodyParameterNode extends JsonNode {
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get name() {
    return this.getLiteral<string>('name')!;
  }

  get in() {
    return this.getLiteral<'query' | 'header' | 'path' | 'formData'>('in')!;
  }

  get description() {
    return this.getLiteral<string>('description');
  }

  get required() {
    return this.getLiteral<boolean>('required');
  }

  get allowEmptyValue() {
    return this.getLiteral<boolean>('allowEmptyValue');
  }

  get collectionFormat() {
    return this.getLiteral<'csv' | 'ssv' | 'tsv' | 'pipes' | 'multi'>(
      'collectionFormat',
    );
  }
}

export class OperationNode extends JsonNode {
  public readonly nodeType = 'Operation';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get tags() {
    throw new Error('Method not implemented');
  }

  get summary() {
    return this.getLiteral<string>('summary');
  }

  get description() {
    return this.getLiteral<string>('description');
  }

  get externalDocs() {
    return this.getChild('externalDocs', ExternalDocumentationNode);
  }

  get operationId() {
    return this.getLiteral<string>('operationId');
  }

  get consumes() {
    return this.getArray<LiteralNode<string>>('consumes', LiteralNode);
  }

  get produces() {
    return this.getArray<LiteralNode<string>>('produces', LiteralNode);
  }

  get parameters(): (ParameterNode | RefNode)[] | undefined {
    const array = this.getProperty('parameters')?.value;
    if (!array) return;

    if (!isArrayNode(array)) throw new Error('Value is not an array');

    return array.children
      .map((value) => {
        if (isRef(value)) return new RefNode(value);
        if (isObjectNode(value)) {
          const inNode = value.children.find(
            (n) => n.key.value === 'in',
          )?.value;
          if (isLiteralNode(inNode)) {
            switch (inNode.value) {
              case 'body':
                return new BodyParameterNode(value);
              case 'query':
              case 'header':
              case 'path':
              case 'formData': {
                const typeNode = value.children.find(
                  (n) => n.key.value === 'type',
                )?.value;
                if (isLiteralNode(typeNode)) {
                  switch (typeNode.value) {
                    case 'string':
                      return new StringParameterNode(value);
                    case 'integer':
                    case 'number':
                      return new NumberParameterNode(value);
                    case 'boolean':
                      return new BooleanParameterNode(value);
                    case 'array':
                      return new ArrayParameterNode(value);
                    default:
                      return undefined;
                  }
                }
              }
            }
          }
        }

        throw new Error('Unknown parameter definition');
      })
      .filter((x): x is ParameterNode | RefNode => !!x);
  }

  get responses() {
    return this.getChild('responses', ResponseDefinitionsNode)!;
  }

  get schemes() {
    return this.getArray<LiteralNode<string>>('schemes', LiteralNode);
  }

  get deprecated() {
    return this.getLiteral<boolean>('deprecated');
  }

  get security() {
    return this.getArray('security', SecurityRequirementNode);
  }
}

export class SecurityRequirementNode extends JsonNode {
  public readonly nodeType = 'SecurityRequirement';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  read(key: string) {
    return this.getArray<LiteralNode<string>>(key, LiteralNode);
  }
}

export class SecurityDefinitionsNode extends JsonNode {
  public readonly nodeType = 'SecurityDefinitions';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  read(
    key: string,
  ):
    | BasicSecuritySchemeNode
    | ApiKeySecuritySchemeNode
    | OAuth2SecuritySchemeNode
    | undefined {
    const child = this.getProperty(key)?.value;
    if (!isObjectNode(child)) return;
    const typeNode = child.children.find((n) => n.key.value === 'type')?.value;

    if (!isLiteralNode(typeNode)) return;

    switch (typeNode.value) {
      case 'basic':
        return new BasicSecuritySchemeNode(child);
      case 'apiKey':
        return new ApiKeySecuritySchemeNode(child);
      case 'oauth2':
        return new OAuth2SecuritySchemeNode(child);
      default:
        return;
    }
  }
}

export type SecuritySchemeNode =
  | BasicSecuritySchemeNode
  | ApiKeySecuritySchemeNode
  | OAuth2SecuritySchemeNode;

export class BasicSecuritySchemeNode extends JsonNode {
  public readonly nodeType = 'BasicSecurityScheme';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'basic'>('type')!;
  }

  get description() {
    return this.getLiteral<string>('description')!;
  }
}

export class ApiKeySecuritySchemeNode extends JsonNode {
  public readonly nodeType = 'ApiKeySecurityScheme';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'apiKey'>('type')!;
  }

  get name() {
    return this.getLiteral<string>('name')!;
  }

  get description() {
    return this.getLiteral<string>('description');
  }

  get in() {
    return this.getLiteral<'header' | 'query'>('in')!;
  }
}

export class OAuth2SecuritySchemeNode extends JsonNode {
  public readonly nodeType = 'OAuth2SecurityScheme';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'oauth2'>('type')!;
  }

  get description() {
    return this.getLiteral<string>('description');
  }

  get flow() {
    return this.getLiteral<
      'implicit' | 'password' | 'application' | 'accessCode'
    >('flow')!;
  }

  get authorizationUrl() {
    return this.getLiteral<string>('authorizationUrl')!;
  }

  get tokenUrl() {
    return this.getLiteral<string>('tokenUrl')!;
  }

  get scopes() {
    return this.getChild('scopes', ScopesNode)!;
  }
}

export class ScopesNode extends JsonNode {
  public readonly nodeType = 'Scopes';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  read(key: string): LiteralNode<string> | undefined {
    const child = this.getProperty(key)?.value;
    return isLiteralNode(child) ? new LiteralNode<string>(child) : undefined;
  }
}

export class ResponseDefinitionsNode extends JsonNode {
  public readonly nodeType = 'ResponseDefinitions';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  read(key: string): ResponseNode | RefNode | undefined {
    const child = this.getProperty(key)?.value;
    if (!isObjectNode(child)) return;
    return isRef(child) ? new RefNode(child) : new ResponseNode(child);
  }
}

export class ResponseNode extends JsonNode {
  public readonly nodeType = 'Response';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get description() {
    return this.getLiteral<string>('description')!;
  }

  get schema() {
    const value = this.getProperty('schema')?.value;
    if (!value) return;

    if (isRef(value)) return new RefNode(value!);

    if (isObjectNode(value)) {
      const typeNode = value.children.find(
        (n) => n.key.value === 'type',
      )?.value;
      if (isLiteralNode(typeNode)) {
        switch (typeNode.value) {
          case 'string':
            return new StringSchemaNode(value);
          case 'number':
          case 'integer':
            return new NumberSchemaNode(value);
          case 'boolean':
            return new BooleanSchemaNode(value);
          case 'null':
            return new NullSchemaNode(value);
          case 'array':
            return new ArraySchemaNode(value);
          case 'object':
            return new ObjectSchemaNode(value);
        }
      }
    }

    throw new Error('Unknown schema definition');
  }

  get headers() {
    return this.getChild('headers', HeadersNode);
  }
}

export class HeadersNode extends JsonNode {
  public readonly nodeType = 'Headers';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  read(key: string): HeaderNode | undefined {
    return this.getChild(key, HeaderNode);
  }
}

export class HeaderNode extends JsonNode {
  public readonly nodeType = 'Header';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get description() {
    return this.getLiteral<string>('description');
  }

  get collectionFormat() {
    return this.getLiteral<string>('collectionFormat');
  }
}

export class StringParameterNode extends NonBodyParameterNode {
  public readonly nodeType = 'StringParameter';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'string'>('type')!;
  }

  get minLength() {
    return this.getLiteral<number>('minLength');
  }

  get maxLength() {
    return this.getLiteral<number>('maxLength');
  }

  get pattern() {
    return this.getLiteral<string>('pattern');
  }

  get format() {
    return this.getLiteral<string>('format');
  }

  get enum() {
    return this.getArray<LiteralNode<string>>('enum', LiteralNode);
  }
}

export class StringSchemaNode extends JsonNode {
  public readonly nodeType = 'StringSchema';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'string'>('type')!;
  }

  get description() {
    return this.getLiteral<string>('description');
  }

  get minLength() {
    return this.getLiteral<number>('minLength');
  }

  get maxLength() {
    return this.getLiteral<number>('maxLength');
  }

  get pattern() {
    return this.getLiteral<string>('pattern');
  }

  get format() {
    return this.getLiteral<string>('format');
  }

  get enum() {
    return this.getArray<LiteralNode<string>>('enum', LiteralNode);
  }
}

export class NumberParameterNode extends NonBodyParameterNode {
  public readonly nodeType = 'NumberParameter';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'integer' | 'number'>('type')!;
  }

  get multipleOf() {
    return this.getLiteral<number>('multipleOf');
  }

  get minimum() {
    return this.getLiteral<number>('minimum');
  }

  get exclusiveMinimum() {
    return this.getLiteral<boolean>('exclusiveMinimum');
  }

  get maximum() {
    return this.getLiteral<number>('maximum');
  }

  get exclusiveMaximum() {
    return this.getLiteral<boolean>('exclusiveMaximum');
  }
}

export class NumberSchemaNode extends JsonNode {
  public readonly nodeType = 'NumberSchema';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'integer' | 'number'>('type')!;
  }

  get description() {
    return this.getLiteral<string>('description');
  }

  get multipleOf() {
    return this.getLiteral<number>('multipleOf');
  }

  get minimum() {
    return this.getLiteral<number>('minimum');
  }

  get exclusiveMinimum() {
    return this.getLiteral<boolean>('exclusiveMinimum');
  }

  get maximum() {
    return this.getLiteral<number>('maximum');
  }

  get exclusiveMaximum() {
    return this.getLiteral<boolean>('exclusiveMaximum');
  }
}

export class BooleanParameterNode extends NonBodyParameterNode {
  public readonly nodeType = 'BooleanParameter';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'boolean'>('type')!;
  }
}

export class BooleanSchemaNode extends JsonNode {
  public readonly nodeType = 'BooleanSchema';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'boolean'>('type')!;
  }

  get description() {
    return this.getLiteral<string>('description');
  }
}

export class NullSchemaNode extends JsonNode {
  public readonly nodeType = 'NullSchema';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'null'>('type')!;
  }

  get description() {
    return this.getLiteral<string>('description');
  }
}

export class ArrayParameterNode extends NonBodyParameterNode {
  public readonly nodeType = 'ArrayParameter';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'array'>('type')!;
  }

  get items() {
    const value = this.getProperty('items')?.value;

    if (isRef(value)) return new RefNode(value!);

    if (isObjectNode(value)) {
      const typeNode = value.children.find(
        (n) => n.key.value === 'type',
      )?.value;
      if (isLiteralNode(typeNode)) {
        switch (typeNode.value) {
          case 'string':
            return new StringSchemaNode(value);
          case 'number':
          case 'integer':
            return new NumberSchemaNode(value);
          case 'boolean':
            return new BooleanSchemaNode(value);
          case 'null':
            return new NullSchemaNode(value);
          case 'array':
            return new ArraySchemaNode(value);
          case 'object':
            return new ObjectSchemaNode(value);
        }
      }
    }

    throw new Error('Unknown items definition');
  }

  get minItems() {
    return this.getLiteral<number>('minItems');
  }

  get maxItems() {
    return this.getLiteral<number>('maxItems');
  }

  get uniqueItems() {
    return this.getLiteral<boolean>('uniqueItems');
  }
}

export class ArraySchemaNode extends JsonNode {
  public readonly nodeType = 'ArraySchema';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'array'>('type')!;
  }

  get description() {
    return this.getLiteral<string>('description');
  }

  get items() {
    const value = this.getProperty('items')?.value;

    if (isRef(value)) return new RefNode(value!);

    if (isObjectNode(value)) {
      const typeNode = value.children.find(
        (n) => n.key.value === 'type',
      )?.value;
      if (isLiteralNode(typeNode)) {
        switch (typeNode.value) {
          case 'string':
            return new StringSchemaNode(value);
          case 'number':
          case 'integer':
            return new NumberSchemaNode(value);
          case 'boolean':
            return new BooleanSchemaNode(value);
          case 'null':
            return new NullSchemaNode(value);
          case 'array':
            return new ArraySchemaNode(value);
          case 'object':
            return new ObjectSchemaNode(value);
        }
      }
    }

    throw new Error('Unknown items definition');
  }

  get minItems() {
    return this.getLiteral<number>('minItems');
  }

  get maxItems() {
    return this.getLiteral<number>('maxItems');
  }

  get uniqueItems() {
    return this.getLiteral<boolean>('uniqueItems');
  }
}

export class ObjectSchemaNode extends JsonNode {
  public readonly nodeType = 'ObjectSchema';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'object'>('type')!;
  }

  get description() {
    return this.getLiteral<string>('description');
  }

  get required() {
    return this.getArray<LiteralNode<string>>('required', LiteralNode);
  }

  get properties() {
    return this.getChild('properties', PropertiesNode);
  }

  get allOf() {
    const prop = this.getProperty('allOf')?.value;
    if (!isArrayNode(prop)) return;

    return prop.children.map((child) =>
      isRef(child) ? new RefNode(child) : new ObjectSchemaNode(child),
    );
  }

  get minProperties() {
    return this.getLiteral<number>('minProperties');
  }

  get maxProperties() {
    return this.getLiteral<number>('maxProperties');
  }

  get additionalProperties() {
    const value = this.getProperty('additionalProperties')?.value;
    if (isLiteralNode(value)) {
      return this.getLiteral<boolean>('additionalProperties');
    } else if (isObjectNode(value)) {
      const typeNode = value.children.find(
        (n) => n.key.value === 'type',
      )?.value;
      if (isLiteralNode(typeNode)) {
        switch (typeNode.value) {
          case 'string':
            return new StringSchemaNode(value);
          case 'number':
          case 'integer':
            return new NumberSchemaNode(value);
          case 'boolean':
            return new BooleanSchemaNode(value);
          case 'null':
            return new NullSchemaNode(value);
          case 'array':
            return new ArraySchemaNode(value);
          case 'object':
            return new ObjectSchemaNode(value);
        }
      }
    }
    return;
  }
}

export class PropertiesNode extends JsonNode {
  public readonly nodeType = 'Properties';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  read(key: string): JsonSchemaNode | RefNode | undefined {
    const value = this.getProperty(key)?.value;

    if (isRef(value) && value) return new RefNode(value);

    if (!isObjectNode(value)) return;

    const typeNode = value.children.find((n) => n.key.value === 'type')?.value;

    if (isLiteralNode(typeNode)) {
      switch (typeNode.value) {
        case 'string':
          return new StringSchemaNode(value);
        case 'integer':
        case 'number':
          return new NumberSchemaNode(value);
        case 'boolean':
          return new BooleanSchemaNode(value);
        case 'null':
          return new NullSchemaNode(value);
        case 'array':
          return new ArraySchemaNode(value);
        case 'object':
          return new ObjectSchemaNode(value);
      }
    }

    return;
  }
}

export class ExternalDocumentationNode extends JsonNode {
  public readonly nodeType = 'ExternalDocumentation';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get description() {
    return this.getLiteral<string>('description');
  }

  get url() {
    return this.getLiteral<string>('url')!;
  }
}

export class RefNode extends JsonNode {
  public readonly nodeType = 'Ref';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get $ref() {
    return this.getLiteral<string>('$ref')!;
  }
}

export class LiteralNode<
  T extends string | number | boolean | null,
> extends JsonNode {
  public readonly nodeType = 'Literal';
  constructor(node: parse.ASTNode) {
    super(node);
  }

  get value(): T {
    if (isLiteralNode(this.node) || isIdentifierNode(this.node)) {
      return this.node.value as T;
    }
    console.log(this.node);
    throw new Error('Cannot parse literal');
  }
}

export function isRefNode(node: JsonNode): node is RefNode {
  return node.nodeType === 'Ref';
}

export function isString(
  item: JsonSchemaNode | ParameterNode,
): item is StringParameterNode | StringSchemaNode {
  return (
    item.nodeType === 'StringParameter' || item.nodeType === 'StringSchema'
  );
}

export function isNumber(
  item: JsonSchemaNode | ParameterNode,
): item is NumberParameterNode | NumberSchemaNode {
  return (
    item.nodeType === 'NumberParameter' || item.nodeType === 'NumberSchema'
  );
}

export function isArray(
  item: JsonSchemaNode | ParameterNode,
): item is ArrayParameterNode | ArraySchemaNode {
  return item.nodeType === 'ArrayParameter' || item.nodeType === 'ArraySchema';
}

export function isObject(
  item: JsonSchemaNode | ParameterNode,
): item is ObjectSchemaNode {
  return item.nodeType === 'ObjectSchema';
}

export function isLiteral<T extends string | number | boolean | null>(
  item: JsonNode | undefined,
): item is LiteralNode<T> {
  return item?.nodeType === 'Literal';
}

function isRef(node: parse.ASTNode | undefined): boolean {
  return (
    isObjectNode(node) && node.children.some((n) => n.key.value === '$ref')
  );
}

function isLiteralNode(
  node: parse.ASTNode | undefined,
): node is parse.LiteralNode {
  return node?.type === 'Literal';
}

function isIdentifierNode(
  node: parse.ASTNode | undefined,
): node is parse.IdentifierNode {
  return node?.type === 'Identifier';
}

function isObjectNode(
  node: parse.ASTNode | undefined,
): node is parse.ObjectNode {
  return node?.type === 'Object';
}

function isArrayNode(node: parse.ASTNode | undefined): node is parse.ArrayNode {
  return node?.type === 'Array';
}
