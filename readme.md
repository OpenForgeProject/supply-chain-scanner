# Supply Chain Scanner

By default, this scanner loads affected package versions directly from the GitHub csv folder and then checks your node_modules.

## Quick Start (curl)

1. Download the script

curl -L -o check.js https://raw.githubusercontent.com/OpenForgeProject/supply-chain-scanner/main/check.js

2. Run it in your target project

node check.js

## Recursively scan multiple projects

node check.js --scan-path /path/to/projects --recursive

## Use a custom GitHub CSV source

node check.js --csv-github-url https://github.com/OWNER/REPO/tree/main/csv

## If GitHub rate limit is hit (403)

GITHUB_TOKEN=YOUR_TOKEN node check.js

## Help

node check.js --help
