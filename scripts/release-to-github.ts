#!/usr/bin/env tsx

import { execSync, spawn } from 'child_process';
import { readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';

// Colors for output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

// Utility functions for colored output
const printStatus = (message: string) =>
  console.log(`${colors.blue}[INFO]${colors.reset} ${message}`);
const printSuccess = (message: string) =>
  console.log(`${colors.green}[SUCCESS]${colors.reset} ${message}`);
const printWarning = (message: string) =>
  console.log(`${colors.yellow}[WARNING]${colors.reset} ${message}`);
const printError = (message: string) =>
  console.log(`${colors.red}[ERROR]${colors.reset} ${message}`);

// Utility function to check if command exists
const commandExists = (command: string): boolean => {
  try {
    execSync(`which ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

// Utility function to execute command and return output
const execCommand = async (
  command: string[],
  options: { cwd?: string; stdio?: 'pipe' | 'inherit' } = {},
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = command;
    const child = spawn(cmd, args, {
      cwd: options.cwd || process.cwd(),
      stdio: options.stdio || 'pipe',
    });

    let output = '';
    let errorOutput = '';

    if (options.stdio !== 'inherit') {
      child.stdout?.on('data', data => {
        output += data.toString();
      });

      child.stderr?.on('data', data => {
        errorOutput += data.toString();
      });
    }

    child.on('close', code => {
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new Error(`Command failed with code ${code ?? 'null'}: ${errorOutput}`));
      }
    });

    child.on('error', error => {
      reject(new Error(`Command failed: ${command.join(' ')}\n${error.message}`));
    });
  });
};

// Utility function to ask for user input
const askQuestion = (question: string): Promise<string> => {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
};

// Main release function
async function releaseToGithub() {
  try {
    printStatus('Starting release process...');

    // Check prerequisites
    printStatus('Checking prerequisites...');

    if (!commandExists('gh')) {
      printError('GitHub CLI (gh) is not installed. Please install it first:');
      printError('  brew install gh');
      process.exit(1);
    }

    if (!commandExists('npm')) {
      printError('npm is not installed. Please install Node.js and npm first.');
      process.exit(1);
    }

    // Check if we're in a git repository
    try {
      await execCommand(['git', 'rev-parse', '--git-dir']);
    } catch {
      printError('Not in a git repository. Please run this script from the project root.');
      process.exit(1);
    }

    // Check if there are uncommitted changes
    try {
      await execCommand(['git', 'diff-index', '--quiet', 'HEAD', '--']);
    } catch {
      printWarning('You have uncommitted changes. Please commit or stash them before releasing.');
      const answer = await askQuestion('Do you want to continue anyway? (y/N): ');
      if (!answer.toLowerCase().startsWith('y')) {
        printStatus('Release cancelled.');
        process.exit(1);
      }
    }

    // Read package.json
    const packageJsonPath = join(process.cwd(), 'package.json');
    if (!existsSync(packageJsonPath)) {
      printError('package.json not found. Please run this script from the project root.');
      process.exit(1);
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const version = packageJson.version as string;
    const packageName = packageJson.name as string;
    // Handle scoped packages - npm pack converts @scope/name to scope-name
    const tgzFilename = packageName.startsWith('@')
      ? `${packageName.replace('@', '').replace('/', '-')}-${version}.tgz`
      : `${packageName}-${version}.tgz`;

    printStatus(`Preparing release for version: ${version}`);
    printStatus(`Package name: ${packageName}`);
    printStatus(`TGZ filename: ${tgzFilename}`);

    // Check if GitHub CLI is authenticated
    printStatus('Checking GitHub authentication...');
    try {
      await execCommand(['gh', 'auth', 'status']);
    } catch {
      printError('Not authenticated with GitHub CLI. Please run: gh auth login');
      process.exit(1);
    }

    // Get repository info
    const repoOwner = await execCommand([
      'gh',
      'repo',
      'view',
      '--json',
      'owner',
      '-q',
      '.owner.login',
    ]);
    const repoName = await execCommand(['gh', 'repo', 'view', '--json', 'name', '-q', '.name']);
    printStatus(`Repository: ${repoOwner}/${repoName}`);

    // Check if tag already exists (GitHub CLI will handle tag creation automatically)
    let tagExists = false;
    try {
      // Check if tag exists on remote
      const remoteTags = await execCommand(['git', 'ls-remote', '--tags', 'origin', `v${version}`]);
      if (remoteTags.trim()) {
        tagExists = true;
        printStatus(`Tag v${version} already exists on remote`);
      } else {
        printStatus(`Tag v${version} will be created automatically by GitHub CLI`);
      }
    } catch {
      // Error checking remote tags, assume tag doesn't exist
      printStatus(`Tag v${version} will be created automatically by GitHub CLI`);
    }

    if (tagExists) {
      printWarning(`Tag v${version} already exists.`);
      const answer = await askQuestion(
        'Do you want to create a new release for this existing tag? (y/N): ',
      );
      if (!answer.toLowerCase().startsWith('y')) {
        printStatus('Release cancelled.');
        process.exit(1);
      }
    }

    // Clean previous builds
    printStatus('Cleaning previous builds...');
    if (existsSync('./lib')) {
      rmSync('./lib', { recursive: true, force: true });
    }

    // Remove existing .tgz files
    try {
      await execCommand(['rm', '-f', './*.tgz']);
    } catch {
      // Ignore if no .tgz files exist
    }

    // Build the project
    printStatus('Building the project...');
    await execCommand(['npm', 'run', 'build'], { stdio: 'inherit' });

    if (!existsSync('./lib')) {
      printError('Build failed - lib directory not found');
      process.exit(1);
    }

    printSuccess('Build completed successfully');

    // Create .tgz file
    printStatus('Creating .tgz file...');
    await execCommand(['npm', 'pack']);

    if (!existsSync(tgzFilename)) {
      printError('Failed to create .tgz file');
      process.exit(1);
    }

    printSuccess(`Created ${tgzFilename}`);

    // Get file size
    const fileSize = await execCommand(['sh', '-c', `ls -lh ${tgzFilename} | awk '{print $5}'`]);
    printStatus(`File size: ${fileSize}`);

    // Create release notes
    const releaseNotes = `## What's Changed

This release includes the latest updates and improvements to react-native-modalize.

### Installation
\`\`\`bash
npm install ${tgzFilename}
\`\`\`

### Files
- **Package**: \`${tgzFilename}\` (${fileSize})
- **Version**: ${version}

---

Full Changelog: https://github.com/${repoOwner}/${repoName}/compare/v${version}...HEAD`;

    // Create GitHub release
    printStatus('Creating GitHub release...');

    try {
      await execCommand(
        [
          'gh',
          'release',
          'create',
          `v${version}`,
          '--title',
          `Release v${version}`,
          '--notes',
          releaseNotes,
          tgzFilename,
        ],
        { stdio: 'inherit' },
      );

      printSuccess('GitHub release created successfully!');
      printStatus(
        `Release URL: https://github.com/${repoOwner}/${repoName}/releases/tag/v${version}`,
      );
    } catch (error) {
      printError('Failed to create GitHub release');
      console.error(error);
      process.exit(1);
    }

    // GitHub CLI automatically creates and pushes the tag when creating a release
    printStatus('GitHub CLI will automatically handle tag creation and pushing');

    // Ask if user wants to clean up .tgz file
    const cleanupAnswer = await askQuestion('Do you want to keep the .tgz file? (Y/n): ');
    if (cleanupAnswer.toLowerCase().startsWith('n')) {
      printStatus('Cleaning up .tgz file...');
      rmSync(tgzFilename);
    }

    printSuccess('Release process completed successfully!');
    printStatus(`Version: ${version}`);
    printStatus(`TGZ file: ${tgzFilename}`);
    printStatus(
      `Release URL: https://github.com/${repoOwner}/${repoName}/releases/tag/v${version}`,
    );
  } catch (error) {
    printError(`Release failed: ${(error as Error).message}`);
    process.exit(1);
  }
}

// Run the release process
if (require.main === module) {
  await releaseToGithub();
}

export { releaseToGithub };
