import { Position, Range } from 'basketry';
import * as yaml from 'yaml-ast-parser';

import * as AST from './ast';

export const parse: AST.ParseFunction = (doc) => {
  const node = yaml.load(doc);
  const locator = new Locator(doc);

  switch (node.kind) {
    case yaml.Kind.SEQ:
      return new YamlSequenceNode(node as yaml.YAMLSequence, locator);
    case yaml.Kind.SCALAR:
      return new YamlScalarNode(node as yaml.YAMLScalar, locator);
    case yaml.Kind.MAP:
      return new YamlMapNode(node as yaml.YamlMap, locator);
    default:
      throw new Error('Unexpected node kind');
  }
};

class Locator {
  constructor(doc: string) {
    let total = 0;
    this.totals = doc.split('\n').map((line) => (total += line.length + 1));
  }

  private readonly totals: number[];

  getPosition(offset: number): Position {
    let line = 1;
    let previousTotal = 0;
    for (const total of this.totals) {
      if (total >= offset) {
        return {
          offset,
          line,
          column: offset - previousTotal + 1,
        };
      } else {
        line++;
        previousTotal = total;
      }
    }
    throw new Error('Offset outside of source bounds');
  }
}

export abstract class YamlNode<
    TNode extends
      | yaml.YAMLScalar
      | yaml.YAMLMapping
      | yaml.YAMLSequence
      | yaml.YamlMap,
  >
  extends AST.BaseNode
  implements AST.ASTNode
{
  constructor(
    protected readonly source: TNode,
    protected readonly locator: Locator,
  ) {
    super();
  }

  get loc(): Range {
    return {
      start: this.locator.getPosition(this.source.startPosition),
      end: this.locator.getPosition(this.source.endPosition),
    };
  }
}

export class YamlMapNode
  extends YamlNode<yaml.YamlMap>
  implements AST.ObjectNode
{
  public readonly type = 'Object';
  constructor(node: yaml.YamlMap, locator: Locator) {
    super(node, locator);
  }

  get children() {
    return this.source.mappings.map(
      (child) => new YamlMappingNode(child, this.locator),
    );
  }
}

export class YamlMappingNode
  extends YamlNode<yaml.YAMLMapping>
  implements AST.PropertyNode
{
  public readonly type = 'Property';
  constructor(node: yaml.YAMLMapping, locator: Locator) {
    super(node, locator);
  }

  get key() {
    return new YamlKeyNode(this.source.key, this.locator);
  }

  get value() {
    switch (this.source.value.kind) {
      case yaml.Kind.SEQ:
        return new YamlSequenceNode(
          this.source.value as yaml.YAMLSequence,
          this.locator,
        );
      case yaml.Kind.SCALAR:
        return new YamlScalarNode(
          this.source.value as yaml.YAMLScalar,
          this.locator,
        );
      case yaml.Kind.MAP:
        return new YamlMapNode(this.source.value as yaml.YamlMap, this.locator);
      default:
        throw new Error('Unexpected node kind');
    }
  }
}

export class YamlKeyNode
  extends YamlNode<yaml.YAMLScalar>
  implements AST.IdentifierNode
{
  public readonly type = 'Identifier';
  constructor(node: yaml.YAMLScalar, locator: Locator) {
    super(node, locator);
  }

  get value() {
    // if (this.source.value === 'multipleOf') throw this.source;
    return this.source.value;
  }
}

export class YamlSequenceNode
  extends YamlNode<yaml.YAMLSequence>
  implements AST.ArrayNode
{
  public readonly type = 'Array';
  constructor(node: yaml.YAMLSequence, locator: Locator) {
    super(node, locator);
  }

  get children() {
    return this.source.items.map((child) => {
      switch (child.kind) {
        case yaml.Kind.SEQ:
          return new YamlSequenceNode(child as yaml.YAMLSequence, this.locator);
        case yaml.Kind.SCALAR:
          return new YamlScalarNode(child as yaml.YAMLScalar, this.locator);
        case yaml.Kind.MAP:
          return new YamlMapNode(child as yaml.YamlMap, this.locator);
        default:
          throw new Error('Unexpected node kind');
      }
    });
  }
}

export class YamlScalarNode
  extends YamlNode<yaml.YAMLScalar>
  implements AST.LiteralNode
{
  public readonly type = 'Literal';
  constructor(node: yaml.YAMLScalar, locator: Locator) {
    super(node, locator);
  }

  get value() {
    return this.source.valueObject === undefined
      ? this.source.value
      : this.source.valueObject;
  }
}
