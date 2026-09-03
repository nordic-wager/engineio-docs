import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../src/content.js';
import type { DocPage, DocsIndex } from '../src/types.js';

interface ValidationError {
  file: string;
  route: string;
  type: 'error' | 'warning';
  message: string;
  line?: number;
}

interface ValidationResult {
  errors: ValidationError[];
  warnings: ValidationError[];
  stats: {
    totalFiles: number;
    totalPages: number;
    duplicateRoutes: number;
    duplicateTitles: number;
    missingFrontmatter: number;
    brokenInternalLinks: number;
  };
}

function findSvxFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSvxFiles(full));
    } else if (entry.name === '+page.svx') {
      results.push(full);
    }
  }
  return results;
}

function fileToRoute(filePath: string, routesDir: string): string {
  const rel = relative(routesDir, filePath);
  return '/' + rel.replace(/\/?\+page\.svx$/, '');
}

function routeToSection(route: string): string {
  const parts = route.split('/').filter(Boolean);
  return parts[0] || 'docs';
}

function slugToTitle(slug: string): string {
  return slug
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractInternalLinks(content: string): string[] {
  const links: string[] = [];
  // Match markdown links [text](/path) and [text](/path "title")
  const markdownLinkRegex = /\[([^\]]+)\]\((\/[^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = markdownLinkRegex.exec(content)) !== null) {
    links.push(match[2]);
  }
  // Match HTML links <a href="/path">
  const htmlLinkRegex = /<a\s+href="(\/[^"]+)"/g;
  while ((match = htmlLinkRegex.exec(content)) !== null) {
    links.push(match[1]);
  }
  return links;
}

function normalizeRoute(route: string): string {
  // Remove trailing slash except root
  if (route !== '/' && route.endsWith('/')) {
    route = route.slice(0, -1);
  }
  return route;
}

function validateFrontmatter(frontmatter: any, file: string, route: string, errors: ValidationError[], warnings: ValidationError[]) {
  // Check required fields
  if (!frontmatter.title || frontmatter.title.trim() === '') {
    errors.push({ file, route, type: 'error', message: 'Missing or empty title in frontmatter' });
  }

  if (!frontmatter.description || frontmatter.description.trim() === '') {
    warnings.push({ file, route, type: 'warning', message: 'Missing description in frontmatter' });
  }

  if (frontmatter.order !== undefined && (isNaN(frontmatter.order) || !Number.isInteger(frontmatter.order))) {
    errors.push({ file, route, type: 'error', message: 'Order must be an integer' });
  }

  if (frontmatter.tags && !Array.isArray(frontmatter.tags)) {
    errors.push({ file, route, type: 'error', message: 'Tags must be an array' });
  }

  if (frontmatter.updated) {
    // Validate date format (ISO 8601)
    const dateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/;
    if (!dateRegex.test(frontmatter.updated)) {
      warnings.push({ file, route, type: 'warning', message: `Updated date should be ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ), got: ${frontmatter.updated}` });
    }
  }

  // Check for stale page count references
  const staleCountPatterns = [
    /79 pages? indexed/i,
    /74 pages?/i,
    /73 pages?/i,
    /72 pages?/i,
    /71 pages?/i,
    /70 pages?/i,
  ];
  for (const pattern of staleCountPatterns) {
    if (pattern.test(frontmatter.title) || pattern.test(frontmatter.description || '')) {
      warnings.push({ file, route, type: 'warning', message: `Potential stale page count reference in frontmatter: ${frontmatter.title || frontmatter.description}` });
    }
  }
}

function validateContent(body: string, file: string, route: string, errors: ValidationError[], warnings: ValidationError[]) {
  // Check for empty content
  if (!body || body.trim().length === 0) {
    errors.push({ file, route, type: 'error', message: 'Page content is empty' });
  }

  // Check for heading hierarchy (should start with #)
  const headingMatches = body.match(/^(#{1,6})\s+(.+)$/gm);
  if (headingMatches) {
    let prevLevel = 0;
    for (const match of headingMatches) {
      const level = match.match(/^#+/)?.[0].length || 0;
      if (prevLevel === 0 && level > 1) {
        warnings.push({ file, route, type: 'warning', message: `First heading should be h1, found h${level}` });
      }
      if (level > prevLevel + 1) {
        warnings.push({ file, route, type: 'warning', message: `Heading level jumps from h${prevLevel} to h${level}` });
      }
      prevLevel = level;
    }
  } else {
    warnings.push({ file, route, type: 'warning', message: 'No headings found in content' });
  }

  // Check for malformed code fences
  const codeFenceMatches = body.match(/^```/gm);
  if (codeFenceMatches && codeFenceMatches.length % 2 !== 0) {
    errors.push({ file, route, type: 'error', message: 'Unclosed code fence detected' });
  }

  // Check for suspicious placeholders
  const placeholderPatterns = [
    /TODO/i,
    /FIXME/i,
    /XXX/i,
    /\[.*\]/,
    /\{\{.*\}\}/,
  ];
  for (const pattern of placeholderPatterns) {
    if (pattern.test(body)) {
      warnings.push({ file, route, type: 'warning', message: `Potential placeholder found: ${pattern.source}` });
    }
  }

  // Check for stale page count references in body
  const staleCountPatterns = [
    /79 pages? indexed/i,
    /74 pages?/i,
    /73 pages?/i,
    /72 pages?/i,
    /71 pages?/i,
    /70 pages?/i,
  ];
  for (const pattern of staleCountPatterns) {
    if (pattern.test(body)) {
      warnings.push({ file, route, type: 'warning', message: `Stale page count reference in content: ${pattern.source}` });
    }
  }
}

function validateInternalLinks(links: string[], allRoutes: Set<string>, file: string, route: string, errors: ValidationError[], warnings: ValidationError[]) {
  for (const link of links) {
    const normalized = normalizeRoute(link);
    // Skip external links
    if (link.startsWith('http://') || link.startsWith('https://') || link.startsWith('mailto:')) {
      continue;
    }
    // Skip anchor links
    if (link.startsWith('#')) {
      continue;
    }
    // Check if route exists
    if (!allRoutes.has(normalized)) {
      // Check if it's a parent route that might exist
      const parts = normalized.split('/').filter(Boolean);
      let parentExists = false;
      for (let i = parts.length - 1; i > 0; i--) {
        const parent = '/' + parts.slice(0, i).join('/');
        if (allRoutes.has(parent)) {
          parentExists = true;
          break;
        }
      }
      if (!parentExists) {
        errors.push({ file, route, type: 'error', message: `Broken internal link: ${link} (normalized: ${normalized})` });
      }
    }
  }
}

function main() {
  const scriptDir = fileURLToPath(new URL('.', import.meta.url));
  const projectRoot = resolve(scriptDir, '..', '..');
  const routesDir = resolve(projectRoot, 'src', 'routes');
  const outputDir = resolve(scriptDir, '..', 'data');
  const outputPath = resolve(outputDir, 'validation-report.json');

  // Scan docs, faq, and changelog directories
  const scanDirs = ['docs', 'faq', 'changelog']
    .map((d) => resolve(routesDir, d))
    .filter((d) => existsSync(d));

  console.log(`Scanning .svx files in ${routesDir}...`);

  const svxFiles: string[] = [];
  for (const dir of scanDirs) {
    svxFiles.push(...findSvxFiles(dir));
  }
  console.log(`Found ${svxFiles.length} .svx files`);

  const pages: DocPage[] = [];
  const allRoutes = new Set<string>();
  const routeToFile = new Map<string, string>();
  const titleToRoutes = new Map<string, string[]>();

  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // First pass: collect all routes and parse frontmatter
  for (const filePath of svxFiles) {
    const raw = readFileSync(filePath, 'utf-8');
    const route = fileToRoute(filePath, routesDir);
    const section = routeToSection(route);

    const { frontmatter, body } = parseFrontmatter(raw);

    // Track routes
    allRoutes.add(route);
    routeToFile.set(route, filePath);

    // Track titles for duplicate detection
    const title = frontmatter.title || slugToTitle(route.split('/').filter(Boolean).pop() || 'Untitled');
    if (!titleToRoutes.has(title)) {
      titleToRoutes.set(title, []);
    }
    titleToRoutes.get(title)!.push(route);

    // Validate frontmatter
    validateFrontmatter(frontmatter, filePath, route, errors, warnings);

    // Validate content
    validateContent(body, filePath, route, errors, warnings);

    pages.push({
      route,
      section,
      title,
      body,
      tags: frontmatter.tags || [],
    });
  }

  // Check for duplicate routes
  const routeCounts = new Map<string, number>();
  for (const route of allRoutes) {
    routeCounts.set(route, (routeCounts.get(route) || 0) + 1);
  }
  for (const [route, count] of routeCounts) {
    if (count > 1) {
      errors.push({ file: routeToFile.get(route) || '', route, type: 'error', message: `Duplicate route: ${route} (${count} files)` });
    }
  }

  // Check for duplicate titles
  for (const [title, routes] of titleToRoutes) {
    if (routes.length > 1) {
      warnings.push({ file: routeToFile.get(routes[0]) || '', route: routes[0], type: 'warning', message: `Duplicate title "${title}" used in routes: ${routes.join(', ')}` });
    }
  }

  // Second pass: validate internal links
  for (const page of pages) {
    const links = extractInternalLinks(page.body);
    validateInternalLinks(links, allRoutes, routeToFile.get(page.route) || '', page.route, errors, warnings);
  }

  // Validate navigation config files
  const navConfigPaths = [
    resolve(projectRoot, 'src', 'lib', 'config', 'navigation.ts'),
    resolve(projectRoot, 'src', 'lib', 'config', 'faq-navigation.ts'),
    resolve(projectRoot, 'src', 'lib', 'config', 'changelog.ts'),
  ];

  for (const navPath of navConfigPaths) {
    if (existsSync(navPath)) {
      const navContent = readFileSync(navPath, 'utf-8');
      // Extract route references from navigation config
      const routeMatches = navContent.match(/\/docs\/[^'"]+|\/faq\/[^'"]+|\/changelog\/[^'"]+/g);
      if (routeMatches) {
        for (const navRoute of routeMatches) {
          const normalized = normalizeRoute(navRoute);
          if (!allRoutes.has(normalized)) {
            warnings.push({ file: navPath, route: normalized, type: 'warning', message: `Navigation references non-existent route: ${navRoute}` });
          }
        }
      }
    }
  }

  // Validate llm.txt parity
  const llmPaths = [
    resolve(projectRoot, 'static', 'llm.txt'),
    resolve(projectRoot, 'build', 'llm.txt'),
  ];
  for (const llmPath of llmPaths) {
    if (existsSync(llmPath)) {
      const llmContent = readFileSync(llmPath, 'utf-8');
      // Count entries in llm.txt (rough heuristic)
      const llmEntries = llmContent.split('\n').filter(l => l.startsWith('- [') || l.startsWith('* [')).length;
      if (llmEntries > 0 && Math.abs(llmEntries - pages.length) > 5) {
        warnings.push({ file: llmPath, route: '', type: 'warning', message: `llm.txt entry count (${llmEntries}) differs significantly from page count (${pages.length})` });
      }
    }
  }

  // Validate MCP index parity
  const mcpIndexPath = resolve(outputDir, 'docs-index.json');
  if (existsSync(mcpIndexPath)) {
    const mcpIndex: DocsIndex = JSON.parse(readFileSync(mcpIndexPath, 'utf-8'));
    if (mcpIndex.pageCount !== pages.length) {
      warnings.push({ file: mcpIndexPath, route: '', type: 'warning', message: `MCP index page count (${mcpIndex.pageCount}) differs from source page count (${pages.length})` });
    }
  }

  // Compile stats
  const stats = {
    totalFiles: svxFiles.length,
    totalPages: pages.length,
    duplicateRoutes: Array.from(routeCounts.values()).filter(c => c > 1).length,
    duplicateTitles: Array.from(titleToRoutes.values()).filter(r => r.length > 1).length,
    missingFrontmatter: errors.filter(e => e.message.includes('title')).length,
    brokenInternalLinks: errors.filter(e => e.message.includes('Broken internal link')).length,
  };

  const result: ValidationResult = { errors, warnings, stats };

  // Write report
  if (!existsSync(outputDir)) {
    writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  } else {
    writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  }

  // Print summary
  console.log('\n=== Validation Summary ===');
  console.log(`Total files: ${stats.totalFiles}`);
  console.log(`Total pages: ${stats.totalPages}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Warnings: ${warnings.length}`);
  console.log(`Duplicate routes: ${stats.duplicateRoutes}`);
  console.log(`Duplicate titles: ${stats.duplicateTitles}`);
  console.log(`Broken internal links: ${stats.brokenInternalLinks}`);
  console.log(`Report written to: ${outputPath}`);

  // Print errors
  if (errors.length > 0) {
    console.log('\n=== ERRORS ===');
    for (const err of errors) {
      console.log(`  [ERROR] ${err.route} (${err.file}): ${err.message}`);
    }
  }

  // Print warnings
  if (warnings.length > 0) {
    console.log('\n=== WARNINGS ===');
    for (const warn of warnings) {
      console.log(`  [WARN] ${warn.route || warn.file}: ${warn.message}`);
    }
  }

  // Exit with error code if errors found
  if (errors.length > 0) {
    process.exit(1);
  }
}

main();
