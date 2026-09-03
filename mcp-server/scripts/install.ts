#!/usr/bin/env node

/**
 * Stake Engine Docs MCP Server - Universal Installer
 *
 * A single command to install and configure the MCP server for all supported editors.
 * Supports: VS Code, GitHub Copilot, Claude Desktop, Cursor, Windsurf, and more.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const MCP_SERVER_DIR = resolve(PROJECT_ROOT, 'mcp-server');

interface EditorConfig {
  name: string;
  configPath: string;
  configFormat: 'json' | 'jsonc';
  mcpKey: string;
  args: string[];
}

const EDITORS: EditorConfig[] = [
  {
    name: 'VS Code',
    configPath: join(homedir(), '.vscode', 'mcp.json'),
    configFormat: 'jsonc',
    mcpKey: 'mcpServers',
    args: ['node', '${workspaceFolder}/mcp-server/dist/index.js'],
  },
  {
    name: 'GitHub Copilot',
    configPath: join(homedir(), '.github', 'copilot', 'mcp.json'),
    configFormat: 'json',
    mcpKey: 'mcpServers',
    args: ['node', '${workspaceFolder}/mcp-server/dist/index.js'],
  },
  {
    name: 'Claude Desktop',
    configPath: process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : process.platform === 'win32'
        ? join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json')
        : join(homedir(), '.config', 'Claude', 'claude_desktop_config.json'),
    configFormat: 'json',
    mcpKey: 'mcpServers',
    args: ['node', '${projectRoot}/mcp-server/dist/index.js'],
  },
  {
    name: 'Cursor',
    configPath: join(homedir(), '.cursor', 'mcp.json'),
    configFormat: 'json',
    mcpKey: 'mcpServers',
    args: ['node', '${projectRoot}/mcp-server/dist/index.js'],
  },
  {
    name: 'Windsurf',
    configPath: join(homedir(), '.windsurf', 'mcp.json'),
    configFormat: 'json',
    mcpKey: 'mcpServers',
    args: ['node', '${projectRoot}/mcp-server/dist/index.js'],
  },
];

function log(message: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') {
  const colors = {
    info: '\x1b[36m',
    success: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    reset: '\x1b[0m',
  };
  const icons = {
    info: 'ℹ',
    success: '✓',
    warn: '⚠',
    error: '✗',
  };
  console.log(`${colors[type]}${icons[type]} ${message}${colors.reset}`);
}

function runCommand(command: string, cwd: string = PROJECT_ROOT): boolean {
  try {
    execSync(command, { cwd, stdio: 'inherit', shell: true });
    return true;
  } catch (error) {
    return false;
  }
}

function detectPackageManager(): string {
  if (existsSync(join(PROJECT_ROOT, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(PROJECT_ROOT, 'package-lock.json'))) return 'npm';
  if (existsSync(join(PROJECT_ROOT, 'yarn.lock'))) return 'yarn';
  return 'pnpm';
}

function installDependencies(): boolean {
  const pm = detectPackageManager();
  log(`Installing dependencies with ${pm}...`);

  const commands = [
    `${pm} install --frozen-lockfile`,
    `cd mcp-server && ${pm} install --frozen-lockfile`,
  ];

  for (const cmd of commands) {
    if (!runCommand(cmd)) {
      log(`Failed to run: ${cmd}`, 'error');
      return false;
    }
  }
  return true;
}

function buildMcpServer(): boolean {
  log('Building MCP server...');
  return runCommand('pnpm run build', MCP_SERVER_DIR);
}

function verifyBuild(): boolean {
  const distPath = join(MCP_SERVER_DIR, 'dist', 'index.js');
  const indexPath = join(MCP_SERVER_DIR, 'data', 'docs-index.json');

  if (!existsSync(distPath)) {
    log(`Build output not found: ${distPath}`, 'error');
    return false;
  }
  if (!existsSync(indexPath)) {
    log(`Documentation index not found: ${indexPath}`, 'error');
    return false;
  }

  const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
  log(`MCP server built successfully - ${index.pageCount} pages indexed`, 'success');
  return true;
}

function readJsonConfig(path: string): any {
  if (!existsSync(path)) return {};
  try {
    const content = readFileSync(path, 'utf-8');
    // Strip comments for jsonc
    const stripped = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    return JSON.parse(stripped);
  } catch {
    return {};
  }
}

function writeJsonConfig(path: string, config: any, format: 'json' | 'jsonc'): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let content: string;
  if (format === 'jsonc') {
    content = JSON.stringify(config, null, 2);
  } else {
    content = JSON.stringify(config, null, 2);
  }
  writeFileSync(path, content, 'utf-8');
}

function configureEditor(editor: EditorConfig, projectRoot: string): boolean {
  log(`Configuring ${editor.name}...`);

  const config = readJsonConfig(editor.configPath);
  if (!config[editor.mcpKey]) {
    config[editor.mcpKey] = {};
  }

  const serverName = 'engineio-docs';
  const resolvedArgs = editor.args.map(arg =>
    arg.replace('${workspaceFolder}', projectRoot)
      .replace('${projectRoot}', projectRoot)
  );

  config[editor.mcpKey][serverName] = {
    command: resolvedArgs[0],
    args: resolvedArgs.slice(1),
  };

  try {
    writeJsonConfig(editor.configPath, config, editor.configFormat);
    log(`${editor.name} configured at ${editor.configPath}`, 'success');
    return true;
  } catch (error) {
    log(`Failed to configure ${editor.name}: ${error}`, 'error');
    return false;
  }
}

function configureAllEditors(projectRoot: string): void {
  log('\nConfiguring editors...');
  for (const editor of EDITORS) {
    configureEditor(editor, projectRoot);
  }
}

function createProjectMcpConfig(projectRoot: string): void {
  const configPath = join(projectRoot, '.mcp.json');
  const config = {
    mcpServers: {
      'engineio-docs': {
        command: 'node',
        args: [join(projectRoot, 'mcp-server', 'dist', 'index.js')],
      },
    },
  };
  writeJsonConfig(configPath, config, 'json');
  log(`Project-level MCP config created at ${configPath}`, 'success');
}

function printUsageInstructions(): void {
  console.log('\n' + '='.repeat(60));
  log('INSTALLATION COMPLETE!', 'success');
  console.log('='.repeat(60));

  console.log('\n📋 Next Steps:');
  console.log('  1. Restart your editor/IDE to load the MCP server');
  console.log('  2. The Stake Engine Docs will be available via MCP tools');

  console.log('\n🔧 Available MCP Tools:');
  console.log('  • search_docs - Search documentation by keywords');
  console.log('  • get_page - Get full page content by route');
  console.log('  • list_pages - List all pages with metadata');
  console.log('  • get_section_tree - Get hierarchical navigation');

  console.log('\n📖 Example Usage:');
  console.log('  Ask your AI assistant: "How do I authenticate with the RGS?"');
  console.log('  The assistant will use search_docs and get_page automatically.');

  console.log('\n🔄 Updating Documentation:');
  console.log('  Run this installer again after pulling latest changes:');
  console.log('    npx @engineio/docs-mcp-install');
  console.log('  Or manually:');
  console.log('    cd mcp-server && pnpm run build');

  console.log('\n🌐 Online Documentation:');
  console.log('  https://engine.io/docs');

  console.log('\n🆘 Troubleshooting:');
  console.log('  • If tools don\'t appear: Restart your editor completely');
  console.log('  • If server fails to start: Check Node.js version (18+ required)');
  console.log('  • If config not found: Verify the config path exists');
  console.log('  • For issues: https://github.com/engineio/docs/issues');

  console.log('\n' + '='.repeat(60));
}

function printBanner(): void {
  console.log('\n' + '='.repeat(60));
  log('Stake Engine Docs MCP Server - Universal Installer', 'info');
  console.log('='.repeat(60));
  console.log('This will install and configure the MCP server for:');
  EDITORS.forEach(e => console.log(`  • ${e.name}`));
  console.log('='.repeat(60) + '\n');
}

async function main() {
  printBanner();

  // Check Node.js version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (majorVersion < 18) {
    log(`Node.js 18+ required. Current: ${nodeVersion}`, 'error');
    process.exit(1);
  }
  log(`Node.js ${nodeVersion} ✓`, 'success');

  // Check if we're in the right directory
  if (!existsSync(join(PROJECT_ROOT, 'package.json'))) {
    log('Run this script from the engineio-docs repository root', 'error');
    process.exit(1);
  }

  // Step 1: Install dependencies
  log('\n[1/4] Installing dependencies...');
  if (!installDependencies()) {
    log('Dependency installation failed', 'error');
    process.exit(1);
  }
  log('Dependencies installed', 'success');

  // Step 2: Build MCP server
  log('\n[2/4] Building MCP server...');
  if (!buildMcpServer()) {
    log('MCP server build failed', 'error');
    process.exit(1);
  }

  // Step 3: Verify build
  log('\n[3/4] Verifying build...');
  if (!verifyBuild()) {
    log('Build verification failed', 'error');
    process.exit(1);
  }

  // Step 4: Configure editors
  log('\n[4/4] Configuring editors...');
  configureAllEditors(PROJECT_ROOT);
  createProjectMcpConfig(PROJECT_ROOT);

  // Print usage instructions
  printUsageInstructions();
}

main().catch((err) => {
  log(`Fatal error: ${err.message}`, 'error');
  process.exit(1);
});
