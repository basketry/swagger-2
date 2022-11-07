import { encodeRange } from 'basketry';
import { AST, DocumentNode, LiteralNode } from '@basketry/ast';

export { DocumentNode, LiteralNode };

export function refRange(root: AST.ASTNode, ref: string): string {
  if (!ref.startsWith('#')) throw new Error(`Cannot resolve ref '${ref}'`);

  let node: AST.ASTNode = root;

  let result: string = encodeRange(node.loc);

  for (const segment of ref.split('/')) {
    if (segment === '#') {
      node = root;
    } else {
      if (node.isObject()) {
        const child = node.children.find((n) => n.key.value === segment);
        if (!child) throw new Error(`Cannot resolve ref '${ref}'`);
        node = child.value;
        result = encodeRange(child.key.loc);
      } else {
        throw new Error(`Cannot resolve ref '${ref}'`);
      }
    }
  }

  return result;
}

export function resolveRef(root: AST.ASTNode, ref: string): AST.ASTNode {
  if (!ref.startsWith('#')) throw new Error(`Cannot resolve ref '${ref}'`);

  let result: AST.ASTNode = root;

  for (const segment of ref.split('/')) {
    if (segment === '#') {
      result = root;
    } else {
      if (result.isObject()) {
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

export function resolve<T extends DocumentNode>(
  root: AST.ASTNode,
  itemOrRef: T | RefNode,
  Node: new (n: AST.ASTNode) => T,
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
  root: AST.ASTNode,
  paramOrRef: RefNode | ParameterNode,
): ParameterNode | undefined {
  if (!isRefNode(paramOrRef)) return paramOrRef;

  const node = resolveRef(root, paramOrRef.$ref.value);
  if (!node.isObject()) return;

  const inNode = node.children.find((n) => n.key.value === 'in')?.value;
  if (!inNode?.isLiteral()) return;

  if (inNode.value === 'body') return new BodyParameterNode(node);

  const typeNode = node.children.find((n) => n.key.value === 'type')?.value;
  if (!typeNode?.isLiteral()) return;
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
  root: AST.ASTNode,
  paramOrRef: RefNode | JsonSchemaNode,
): JsonSchemaNode | undefined {
  if (!isRefNode(paramOrRef)) return paramOrRef;

  const node = resolveRef(root, paramOrRef.$ref.value);
  if (!node.isObject()) return;

  const typeNode = node.children.find((n) => n.key.value === 'type')?.value;
  if (!typeNode?.isLiteral()) return;

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
  root: AST.ASTNode,
  itemOrRef: RefNode | ParameterNode | JsonSchemaNode,
): ParameterNode | JsonSchemaNode | undefined {
  if (!isRefNode(itemOrRef)) return itemOrRef;

  const node = resolveRef(root, itemOrRef.$ref.value);
  if (!node.isObject()) return;

  const inNode = node.children.find((n) => n.key.value === 'in')?.value;
  if (inNode?.isLiteral()) {
    return resolveParam(root, itemOrRef);
  } else {
    return resolveSchema(root, itemOrRef);
  }
}

export function toJson(node: AST.ASTNode | undefined) {
  if (node === undefined) return undefined;
  if (node.isLiteral()) {
    return node.value;
  } else if (node.isObject()) {
    return node.children.reduce(
      (acc, child) => ({ ...acc, [child.key.value]: toJson(child.value) }),
      {},
    );
  } else if (node.isArray()) {
    return node.children.map((child) => toJson(child));
  }
}

export class SchemaNode extends DocumentNode {
  public readonly nodeType = 'Schema';
  constructor(node: AST.ASTNode) {
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

export class TagNode extends DocumentNode {
  public readonly nodeType = 'Tag';
  constructor(node: AST.ASTNode) {
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

export class DefinitionsNode extends DocumentNode {
  public readonly nodeType = 'Definitions';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  read(key: string): JsonSchemaNode | undefined {
    const value = this.getProperty(key)?.value;
    if (!value?.isObject()) return;

    const typeNode = value.children.find((n) => n.key.value === 'type')?.value;

    if (typeNode?.isLiteral()) {
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

export class PathsNode extends DocumentNode {
  public readonly nodeType = 'Paths';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  read(key: string) {
    return this.getChild(key, PathItemNode);
  }
}

export class InfoNode extends DocumentNode {
  public readonly nodeType = 'Info';
  constructor(node: AST.ASTNode) {
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

export class ContactNode extends DocumentNode {
  public readonly nodeType = 'Contact';
  constructor(node: AST.ASTNode) {
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

export class LicenseNode extends DocumentNode {
  public readonly nodeType = 'License';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  get name() {
    return this.getLiteral<string>('name')!;
  }

  get url() {
    return this.getLiteral<string>('url');
  }
}

export class PathItemNode extends DocumentNode {
  public readonly nodeType = 'PathItem';
  constructor(node: AST.ASTNode) {
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

    if (!array.isArray()) throw new Error('Value is not an array');

    return array.children.map((value) => {
      if (isRef(value)) return new RefNode(value);
      if (value?.isObject()) {
        const inNode = value.children.find((n) => n.key.value === 'in')?.value;
        if (inNode?.isLiteral()) {
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
              if (typeNode?.isLiteral()) {
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

export class BodyParameterNode extends DocumentNode {
  public readonly nodeType = 'BodyParameter';
  constructor(node: AST.ASTNode) {
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

    if (value?.isObject()) {
      const typeNode = value.children.find(
        (n) => n.key.value === 'type',
      )?.value;
      if (typeNode?.isLiteral()) {
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

export abstract class NonBodyParameterNode extends DocumentNode {
  constructor(node: AST.ASTNode) {
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

export class OperationNode extends DocumentNode {
  public readonly nodeType = 'Operation';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  get tags() {
    return this.getArray<LiteralNode<string>>('tags', LiteralNode);
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

    if (!array.isArray()) throw new Error('Value is not an array');

    return array.children
      .map((value) => {
        if (isRef(value)) return new RefNode(value);
        if (value?.isObject()) {
          const inNode = value.children.find(
            (n) => n.key.value === 'in',
          )?.value;
          if (inNode?.isLiteral()) {
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
                if (typeNode?.isLiteral()) {
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

export class SecurityRequirementNode extends DocumentNode {
  public readonly nodeType = 'SecurityRequirement';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  read(key: string) {
    return this.getArray<LiteralNode<string>>(key, LiteralNode);
  }
}

export class SecurityDefinitionsNode extends DocumentNode {
  public readonly nodeType = 'SecurityDefinitions';
  constructor(node: AST.ASTNode) {
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
    if (!child?.isObject()) return;
    const typeNode = child.children.find((n) => n.key.value === 'type')?.value;

    if (!typeNode?.isLiteral()) return;

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

export class BasicSecuritySchemeNode extends DocumentNode {
  public readonly nodeType = 'BasicSecurityScheme';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'basic'>('type')!;
  }

  get description() {
    return this.getLiteral<string>('description')!;
  }
}

export class ApiKeySecuritySchemeNode extends DocumentNode {
  public readonly nodeType = 'ApiKeySecurityScheme';
  constructor(node: AST.ASTNode) {
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

export class OAuth2SecuritySchemeNode extends DocumentNode {
  public readonly nodeType = 'OAuth2SecurityScheme';
  constructor(node: AST.ASTNode) {
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

export class ScopesNode extends DocumentNode {
  public readonly nodeType = 'Scopes';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  read(key: string): LiteralNode<string> | undefined {
    const child = this.getProperty(key)?.value;
    return child?.isLiteral() ? new LiteralNode<string>(child) : undefined;
  }
}

export class ResponseDefinitionsNode extends DocumentNode {
  public readonly nodeType = 'ResponseDefinitions';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  read(key: string): ResponseNode | RefNode | undefined {
    const child = this.getProperty(key)?.value;
    if (!child?.isObject()) return;
    return isRef(child) ? new RefNode(child) : new ResponseNode(child);
  }
}

export class ResponseNode extends DocumentNode {
  public readonly nodeType = 'Response';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  get description() {
    return this.getLiteral<string>('description')!;
  }

  get schema() {
    const value = this.getProperty('schema')?.value;
    if (!value) return;

    if (isRef(value)) return new RefNode(value!);

    if (value?.isObject()) {
      const typeNode = value.children.find(
        (n) => n.key.value === 'type',
      )?.value;
      if (typeNode?.isLiteral()) {
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

export class HeadersNode extends DocumentNode {
  public readonly nodeType = 'Headers';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  read(key: string): HeaderNode | undefined {
    return this.getChild(key, HeaderNode);
  }
}

export class HeaderNode extends DocumentNode {
  public readonly nodeType = 'Header';
  constructor(node: AST.ASTNode) {
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
  constructor(node: AST.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'string'>('type')!;
  }

  get deprecated() {
    return this.getLiteral<boolean>('deprecated');
  }

  get default() {
    return this.getLiteral<string>('default');
  }

  get const() {
    return this.getLiteral<string>('const');
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

export class StringSchemaNode extends DocumentNode {
  public readonly nodeType = 'StringSchema';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'string'>('type')!;
  }

  get description() {
    return this.getLiteral<string>('description');
  }

  get deprecated() {
    return this.getLiteral<boolean>('deprecated');
  }

  get default() {
    return this.getLiteral<string>('default');
  }

  get const() {
    return this.getLiteral<string>('const');
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
  constructor(node: AST.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'integer' | 'number'>('type')!;
  }

  get deprecated() {
    return this.getLiteral<boolean>('deprecated');
  }

  get default() {
    return this.getLiteral<number>('default');
  }

  get const() {
    return this.getLiteral<number>('const');
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

  get format() {
    return this.getLiteral<string>('format');
  }
}

export class NumberSchemaNode extends DocumentNode {
  public readonly nodeType = 'NumberSchema';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'integer' | 'number'>('type')!;
  }

  get description() {
    return this.getLiteral<string>('description');
  }

  get deprecated() {
    return this.getLiteral<boolean>('deprecated');
  }

  get const() {
    return this.getLiteral<number>('const');
  }

  get default() {
    return this.getLiteral<number>('default');
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

  get format() {
    return this.getLiteral<string>('format');
  }
}

export class BooleanParameterNode extends NonBodyParameterNode {
  public readonly nodeType = 'BooleanParameter';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'boolean'>('type')!;
  }

  get deprecated() {
    return this.getLiteral<boolean>('deprecated');
  }

  get default() {
    return this.getLiteral<boolean>('default');
  }

  get const() {
    return this.getLiteral<boolean>('const');
  }
}

export class BooleanSchemaNode extends DocumentNode {
  public readonly nodeType = 'BooleanSchema';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'boolean'>('type')!;
  }

  get description() {
    return this.getLiteral<string>('description');
  }

  get deprecated() {
    return this.getLiteral<boolean>('deprecated');
  }

  get default() {
    return this.getLiteral<boolean>('default');
  }

  get const() {
    return this.getLiteral<boolean>('const');
  }
}

export class NullSchemaNode extends DocumentNode {
  public readonly nodeType = 'NullSchema';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'null'>('type')!;
  }

  get description() {
    return this.getLiteral<string>('description');
  }

  get deprecated() {
    return this.getLiteral<boolean>('deprecated');
  }

  get default() {
    return this.getLiteral<null>('default');
  }
}

export class ArrayParameterNode extends NonBodyParameterNode {
  public readonly nodeType = 'ArrayParameter';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'array'>('type')!;
  }

  get deprecated() {
    return this.getLiteral<boolean>('deprecated');
  }

  get items() {
    const value = this.getProperty('items')?.value;

    if (isRef(value)) return new RefNode(value!);

    if (value?.isObject()) {
      const typeNode = value.children.find(
        (n) => n.key.value === 'type',
      )?.value;
      if (typeNode?.isLiteral()) {
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

export class ArraySchemaNode extends DocumentNode {
  public readonly nodeType = 'ArraySchema';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'array'>('type')!;
  }

  get description() {
    return this.getLiteral<string>('description');
  }

  get deprecated() {
    return this.getLiteral<boolean>('deprecated');
  }

  get items() {
    const value = this.getProperty('items')?.value;

    if (isRef(value)) return new RefNode(value!);

    if (value?.isObject()) {
      const typeNode = value.children.find(
        (n) => n.key.value === 'type',
      )?.value;
      if (typeNode?.isLiteral()) {
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

export class ObjectSchemaNode extends DocumentNode {
  public readonly nodeType = 'ObjectSchema';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  get type() {
    return this.getLiteral<'object'>('type')!;
  }

  get description() {
    return this.getLiteral<string>('description');
  }

  get deprecated() {
    return this.getLiteral<boolean>('deprecated');
  }

  get required() {
    return this.getArray<LiteralNode<string>>('required', LiteralNode);
  }

  get properties() {
    return this.getChild('properties', PropertiesNode);
  }

  get allOf() {
    const prop = this.getProperty('allOf')?.value;
    if (!prop?.isArray()) return;

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
    if (value?.isLiteral()) {
      return this.getLiteral<boolean>('additionalProperties');
    } else if (value?.isObject()) {
      const typeNode = value.children.find(
        (n) => n.key.value === 'type',
      )?.value;
      if (typeNode?.isLiteral()) {
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

export class PropertiesNode extends DocumentNode {
  public readonly nodeType = 'Properties';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  read(key: string): JsonSchemaNode | RefNode | undefined {
    const value = this.getProperty(key)?.value;

    if (isRef(value) && value) return new RefNode(value);

    if (!value?.isObject()) return;

    const typeNode = value.children.find((n) => n.key.value === 'type')?.value;

    if (typeNode?.isLiteral()) {
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

export class ExternalDocumentationNode extends DocumentNode {
  public readonly nodeType = 'ExternalDocumentation';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  get description() {
    return this.getLiteral<string>('description');
  }

  get url() {
    return this.getLiteral<string>('url')!;
  }
}

export class RefNode extends DocumentNode {
  public readonly nodeType = 'Ref';
  constructor(node: AST.ASTNode) {
    super(node);
  }

  get $ref() {
    return this.getLiteral<string>('$ref')!;
  }
}

export function isRefNode(node: DocumentNode): node is RefNode {
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
  item: DocumentNode | undefined,
): item is LiteralNode<T> {
  return item?.nodeType === 'Literal';
}

function isRef(node: AST.ASTNode | undefined): boolean {
  return !!(
    node?.isObject() && node.children.some((n) => n.key.value === '$ref')
  );
}
