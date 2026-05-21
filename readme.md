# Supply Chain Scanner for NPM Packages

By default, this scanner loads affected package versions directly from the GitHub csv folder and then checks your node_modules.

## Quick Start (curl)

1. Download the script

`curl -L -o check.js https://raw.githubusercontent.com/OpenForgeProject/supply-chain-scanner/main/check.js`

2. Options to run it in your target project

- `node check.js`
- `node check.js -r`
- `node check.js /path/to/scan -r`

## Use a custom GitHub CSV source

`node check.js --csv-github-url https://github.com/OWNER/REPO/tree/main/csv`

## Help

`node check.js --help`

## Verbose output

By default, only found packages are shown in the detailed overview, including compromised and safe installed versions.

Use verbose mode to also list packages that are not installed:

`node check.js --verbose`
or
`node check.js -r --verbose`


---

## Authenticating with GitHub (for higher API limits)

Use a bearer token in the Authorization header:

`curl -H "Authorization: Bearer YOUR_TOKEN" https://api.github.com/user`

Or run the scanner with `GITHUB_TOKEN`:

`GITHUB_TOKEN=YOUR_TOKEN node check.js`
