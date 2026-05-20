#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const https = require("https");

const DEFAULT_GITHUB_CSV_URL = 'https://github.com/OpenForgeProject/supply-chain-scanner/tree/main/csv';

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function extractAffectedEntriesFromCsvContent(content, sourceFile, seen) {
  const affectedEntries = [];
  const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');

  if (lines.length < 2) {
    return affectedEntries;
  }

  const header = parseCsvLine(lines[0]).map(col => col.toLowerCase());
  const ecosystemIndex = header.indexOf('ecosystem');
  const nameIndex = header.indexOf('name');
  const versionIndex = header.indexOf('version');

  if (nameIndex === -1 || versionIndex === -1) {
    return affectedEntries;
  }

  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    const ecosystem = ecosystemIndex >= 0 ? (row[ecosystemIndex] || '').toLowerCase() : 'npm';
    const packageName = (row[nameIndex] || '').trim();
    const version = (row[versionIndex] || '').trim();

    // This scanner validates node_modules, so we only keep npm packages.
    if (ecosystem !== 'npm' || !packageName || !version) {
      continue;
    }

    const key = `${packageName}@${version}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    affectedEntries.push({ packageName, affectedVersion: version, sourceFile });
  }

  return affectedEntries;
}

function httpsGet(url, token) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'supply-chain-scanner',
      'Accept': 'application/vnd.github+json'
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    https.get(url, { headers }, response => {
      let data = '';

      response.on('data', chunk => {
        data += chunk;
      });

      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(data);
          return;
        }

        reject(new Error(`Request failed (${response.statusCode}) for ${url}`));
      });
    }).on('error', reject);
  });
}

async function loadAffectedVersionsFromGithubCsvFolder(config) {
  const owner = config.owner;
  const repo = config.repo;
  const ref = config.ref;
  const folderPath = config.folderPath;
  const token = process.env.GITHUB_TOKEN || '';

  const listUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(folderPath)}?ref=${encodeURIComponent(ref)}`;
  const listResponse = await httpsGet(listUrl, token);
  const entries = JSON.parse(listResponse);

  if (!Array.isArray(entries)) {
    return [];
  }

  const csvFiles = entries.filter(item => item.type === 'file' && item.name.toLowerCase().endsWith('.csv'));
  const affectedEntries = [];
  const seen = new Set();

  for (const file of csvFiles) {
    const downloadUrl = file.download_url;
    if (!downloadUrl) {
      continue;
    }

    try {
      const content = await httpsGet(downloadUrl, token);
      const sourceFile = `${owner}/${repo}/${folderPath}/${file.name}@${ref}`;
      const parsed = extractAffectedEntriesFromCsvContent(content, sourceFile, seen);
      affectedEntries.push(...parsed);
    } catch (error) {
      // Skip unreadable files, continue with remaining CSVs.
    }
  }

  return affectedEntries;
}

function loadAffectedVersionsFromCsv(csvDirectory) {
  if (!fs.existsSync(csvDirectory)) {
    return [];
  }

  const csvFiles = fs.readdirSync(csvDirectory)
    .filter(file => file.toLowerCase().endsWith('.csv'));

  const affectedEntries = [];
  const seen = new Set();

  for (const fileName of csvFiles) {
    const filePath = path.join(csvDirectory, fileName);
    let content = '';

    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      continue;
    }

    const parsed = extractAffectedEntriesFromCsvContent(content, fileName, seen);
    affectedEntries.push(...parsed);
  }

  return affectedEntries;
}

async function resolveAffectedEntries() {
  const cli = parseCliArgs(process.argv.slice(2));
  const source = (process.env.CSV_SOURCE || (cli.csvGithubUrl ? 'github' : 'github')).toLowerCase();

  if (source === 'github') {
    const githubUrl = cli.csvGithubUrl || process.env.GITHUB_CSV_URL || DEFAULT_GITHUB_CSV_URL;
    const parsedFromUrl = githubUrl ? parseGithubFolderUrl(githubUrl) : null;

    const config = parsedFromUrl || {
      owner: process.env.GITHUB_CSV_OWNER || 'OpenForgeProject',
      repo: process.env.GITHUB_CSV_REPO || 'supply-chain-scanner',
      ref: process.env.GITHUB_CSV_REF || 'main',
      folderPath: process.env.GITHUB_CSV_PATH || 'csv'
    };

    try {
      return await loadAffectedVersionsFromGithubCsvFolder(config);
    } catch (error) {
      console.error(`Failed to load CSV data from GitHub: ${error.message}`);
      return [];
    }
  }

  return loadAffectedVersionsFromCsv(path.join(__dirname, 'csv'));
}

// ANSI Color codes
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function runWithSpinner(label, task) {
  if (!process.stdout.isTTY) {
    return task();
  }

  const frames = ['|', '/', '-', '\\'];
  let frameIndex = 0;

  const draw = () => {
    process.stdout.write(`\r${colors.cyan}${frames[frameIndex]} ${label}${colors.reset}`);
    frameIndex = (frameIndex + 1) % frames.length;
  };

  draw();
  const timer = setInterval(draw, 100);

  try {
    const result = await task();
    clearInterval(timer);
    process.stdout.write(`\r\x1b[2K${colors.green}✓ ${label}${colors.reset}\n`);
    return result;
  } catch (error) {
    clearInterval(timer);
    process.stdout.write('\r\x1b[2K');
    throw error;
  }
}

function parseCliArgs(argv) {
  const options = {
    scanPath: process.cwd(),
    recursive: false,
    help: false,
    csvGithubUrl: ''
  };
  let hasExplicitScanPath = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--recursive' || arg === '-r') {
      options.recursive = true;
      continue;
    }

    if (arg === '--scan-path') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        options.scanPath = path.resolve(next);
        hasExplicitScanPath = true;
        i++;
      }
      continue;
    }

    if (arg === '--csv-github-url') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        options.csvGithubUrl = next;
        i++;
      }
      continue;
    }

    // Allow positional path: node check.js ../path -r
    if (!arg.startsWith('-') && !hasExplicitScanPath) {
      options.scanPath = path.resolve(arg);
      hasExplicitScanPath = true;
    }
  }

  return options;
}

function printHelp() {
  console.log('Usage: node check.js [scanPath] [options]');
  console.log('');
  console.log('Options:');
  console.log('  --scan-path <path>   Directory to scan for node_modules (default: current directory)');
  console.log('  --recursive, -r      Recursively search subdirectories for node_modules');
  console.log('  --csv-github-url <url>  GitHub folder URL for CSV source (e.g. .../tree/main/csv)');
  console.log('  -h, --help           Show this help');
  console.log('');
  console.log('Examples:');
  console.log('  node check.js');
  console.log('  node check.js ../path -r');
  console.log('  node check.js --scan-path ../path/ -r');
  console.log('  node check.js --csv-github-url https://github.com/OWNER/REPO/tree/main/csv');
}

function parseGithubFolderUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') {
      return null;
    }

    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 5 || parts[2] !== 'tree') {
      return null;
    }

    const owner = parts[0];
    const repo = parts[1];
    const ref = parts[3];
    const folderPath = parts.slice(4).join('/');

    if (!owner || !repo || !ref || !folderPath) {
      return null;
    }

    return { owner, repo, ref, folderPath };
  } catch (error) {
    return null;
  }
}

function getInstalledVersion(packageName, nodeModulesPath) {
  const packagePath = path.join(nodeModulesPath, packageName, 'package.json');

  try {
    if (fs.existsSync(packagePath)) {
      const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      return packageData.version;
    }
  } catch (error) {
    // Ignore errors, package not found or invalid JSON
  }

  return null;
}

async function findNodeModules(startPath, recursive) {
  const nodeModulesPaths = [];

  const directNodeModulesPath = path.join(startPath, 'node_modules');
  if (fs.existsSync(directNodeModulesPath)) {
    nodeModulesPaths.push(directNodeModulesPath);
  }

  if (!recursive) {
    return nodeModulesPaths;
  }

  const queue = [startPath];
  let visitedDirs = 0;

  while (queue.length > 0) {
    const currentPath = queue.shift();

    try {
      const items = fs.readdirSync(currentPath);

      for (const item of items) {
        const fullPath = path.join(currentPath, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          if (item === 'node_modules') {
            if (!nodeModulesPaths.includes(fullPath)) {
              nodeModulesPaths.push(fullPath);
            }
          } else if (!item.startsWith('.') && !item.includes('node_modules')) {
            // Search subdirectories, but skip hidden dirs and avoid obvious loops.
            queue.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Ignore permission errors or other issues
    }

    visitedDirs++;
    // Yield periodically so the spinner can animate during deep scans.
    if (visitedDirs % 25 === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  return nodeModulesPaths;
}

async function checkAffectedVersions() {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.help) {
    printHelp();
    return;
  }

  log('', 'reset');
  log('Supply Chain Scanner - Powered by OpenForgeProject', 'cyan');
  log('', 'reset');
  log(`${colors.bold}Checking for compromised packages...${colors.reset}`, 'cyan');
  log('', 'reset');

  if (!fs.existsSync(cli.scanPath)) {
    log(`Scan path not found: ${cli.scanPath}`, 'red');
    process.exitCode = 1;
    return;
  }

  const source = (process.env.CSV_SOURCE || 'local').toLowerCase();
  const affectedEntries = await runWithSpinner('load CSV data', () => resolveAffectedEntries());

  if (affectedEntries.length === 0) {
    if (source === 'github') {
      log('No valid npm entries were loaded from the GitHub CSV source.', 'yellow');
      log('Check GITHUB_CSV_OWNER, GITHUB_CSV_REPO, GITHUB_CSV_REF, and GITHUB_CSV_PATH.', 'yellow');
      log('If you get a 403, set GITHUB_TOKEN to avoid API rate limits.', 'yellow');
    } else {
      log('No valid npm entries were found in ./csv.', 'yellow');
      log('Add at least one CSV file with Name and Version columns in ./csv.', 'yellow');
    }
    return;
  }

  log(`Loaded affected package versions from CSV: ${affectedEntries.length}`, 'blue');

  log(`Scan path: ${cli.scanPath}`, 'blue');
  log(`Recursive scan: ${cli.recursive ? 'enabled' : 'disabled'}`, 'blue');

  const nodeModulesPaths = await runWithSpinner(
    'Search node_modules directories ...',
    () => findNodeModules(cli.scanPath, cli.recursive)
  );

  if (nodeModulesPaths.length === 0) {
    log('No node_modules directories found.', 'yellow');
    return;
  }

  log(`Found node_modules paths: ${nodeModulesPaths.length}`, 'blue');
  nodeModulesPaths.forEach(p => log(`  - ${p}`, 'blue'));
  log('', 'reset');

  const { vulnerablePackages, checkedPackages } = await runWithSpinner('Vergleiche installierte Pakete', async () => {
    const foundVulnerablePackages = [];
    const foundCheckedPackages = [];

    for (let i = 0; i < affectedEntries.length; i++) {
      const { packageName, affectedVersion, sourceFile } = affectedEntries[i];
      let foundLocations = [];
      let isVulnerable = false;
      let vulnerableLocation = null;

      for (const nodeModulesPath of nodeModulesPaths) {
        const installedVersion = getInstalledVersion(packageName, nodeModulesPath);

        if (installedVersion) {
          foundLocations.push({
            path: nodeModulesPath,
            version: installedVersion
          });

          if (installedVersion === affectedVersion) {
            isVulnerable = true;
            vulnerableLocation = nodeModulesPath;
            foundVulnerablePackages.push({
              name: packageName,
              version: installedVersion,
              path: path.join(nodeModulesPath, packageName),
              nodeModulesPath: nodeModulesPath
            });
          }
        }
      }

      foundCheckedPackages.push({
        name: packageName,
        affectedVersion,
        sourceFile,
        foundLocations,
        isVulnerable,
        vulnerableLocation
      });

      // Yield periodically so the spinner can update during larger scans.
      if ((i + 1) % 25 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }

    return {
      vulnerablePackages: foundVulnerablePackages,
      checkedPackages: foundCheckedPackages
    };
  });

  // Results
  log(`${colors.bold}Results:${colors.reset}`, 'cyan');
  log('', 'reset');

  if (vulnerablePackages.length > 0) {
    log(`${colors.bold}⚠️  WARNING: ${vulnerablePackages.length} compromised packages found!${colors.reset}`, 'red');
    log('', 'reset');

    vulnerablePackages.forEach(pkg => {
      log(`❌ ${pkg.name}@${pkg.version} (compromised)`, 'red');
      log(`   Found in: ${pkg.nodeModulesPath}`, 'red');
      log(`   Full path: ${pkg.path}`, 'red');
    });
    log('', 'reset');

    log('These packages should be updated immediately!', 'red');
    log('Run "npm update" or "yarn upgrade".', 'yellow');
  } else {
    log(`✅ No compromised packages found in the exact affected versions!`, 'green');
  }

  log('', 'reset');
  log(`${colors.bold}Detailed Overview:${colors.reset}`, 'cyan');

  checkedPackages.forEach(pkg => {
    if (pkg.foundLocations.length === 0) {
      log(`○ ${pkg.name} - not installed`, 'green');
    } else if (pkg.isVulnerable) {
      log(`❌ ${pkg.name} - COMPROMISED (v${pkg.affectedVersion}, source: ${pkg.sourceFile})`, 'red');
      log(`   Found in: ${pkg.vulnerableLocation}`, 'red');
    } else {
      log(`✅ ${pkg.name} - installed, but not in affected version (source: ${pkg.sourceFile})`, 'green');
      pkg.foundLocations.forEach(location => {
        log(`   v${location.version} in: ${location.path}`, 'green');
      });
    }
  });

  log('', 'reset');
  log(`Checked packages: ${checkedPackages.length}`, 'blue');
  log(`Found packages: ${checkedPackages.filter(p => p.foundLocations.length > 0).length}`, 'blue');
  log(`Compromised packages: ${vulnerablePackages.length}`, vulnerablePackages.length > 0 ? 'red' : 'green');
}

// Run the check
checkAffectedVersions().catch(error => {
  log(`Scanner failed: ${error.message}`, 'red');
  process.exitCode = 1;
});
