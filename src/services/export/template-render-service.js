import path from 'node:path';
import { readFile } from 'node:fs/promises';

import nunjucks from 'nunjucks';

const viewRoot = path.resolve(process.cwd(), 'src/views');
const exportEnv = nunjucks.configure(viewRoot, {
  autoescape: true,
  noCache: process.env.NODE_ENV !== 'production'
});
const cssCache = new Map();

const loadCssText = async (relativePath) => {
  if (cssCache.has(relativePath)) {
    return cssCache.get(relativePath);
  }

  const cssText = await readFile(
    path.resolve(process.cwd(), relativePath),
    'utf8'
  );
  cssCache.set(relativePath, cssText);
  return cssText;
};

export const renderExportTemplate = async ({
  templateName,
  templateContext,
  cssFiles = []
}) => {
  const cssText = (
    await Promise.all(cssFiles.map((filePath) => loadCssText(filePath)))
  ).join('\n');

  return exportEnv.render(templateName, {
    ...templateContext,
    cssText
  });
};

