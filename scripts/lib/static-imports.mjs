import ts from 'typescript'

export function findStaticPackageImports(
  source,
  packageNames,
  sourceFileName = 'shipped.js',
) {
  const importedSpecifiers = findStaticModuleSpecifiers(source, sourceFileName)

  return packageNames.filter((packageName) =>
    importedSpecifiers.some(
      (specifier) => specifier === packageName || specifier.startsWith(`${packageName}/`),
    ),
  )
}

export function findStaticModuleSpecifiers(source, sourceFileName = 'shipped.js') {
  return findModuleSpecifiers(source, sourceFileName, false)
}

export function findLiteralModuleSpecifiers(source, sourceFileName = 'shipped.js') {
  return findModuleSpecifiers(source, sourceFileName, true)
}

function findModuleSpecifiers(source, sourceFileName, includeDynamicImports) {
  const sourceFile = ts.createSourceFile(
    sourceFileName,
    source,
    ts.ScriptTarget.Latest,
    false,
  )
  const importedSpecifiers = new Set()

  const visit = (node) => {
    const specifier = moduleSpecifier(node, includeDynamicImports)
    if (specifier) importedSpecifiers.add(specifier)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return [...importedSpecifiers]
}

function moduleSpecifier(node, includeDynamicImports) {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text
  }

  if (
    ts.isCallExpression(node) &&
    isCommonJsRequire(node.expression) &&
    node.arguments[0] &&
    ts.isStringLiteralLike(node.arguments[0])
  ) {
    return node.arguments[0].text
  }

  if (
    includeDynamicImports &&
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments[0] &&
    ts.isStringLiteralLike(node.arguments[0])
  ) {
    return node.arguments[0].text
  }

  return undefined
}

function isCommonJsRequire(expression) {
  if (ts.isIdentifier(expression)) return expression.text === 'require'
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'module' &&
    expression.name.text === 'require'
  )
}
