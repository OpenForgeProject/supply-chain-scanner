# Supply Chain Scanner

By default, this scanner loads affected package versions directly from the GitHub csv folder and then checks your node_modules.

## Quick Start (curl)

1. Download the script

`curl -L -o check.js https://raw.githubusercontent.com/OpenForgeProject/supply-chain-scanner/main/check.js`

2. Run it in your target project

`node check.js`
or
`node check.js -r`

## Recursively scan multiple projects

`node check.js --scan-path /path/to/projects -r`

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

**Basic Auth + OAuth2Token**

`curl -u <token>:x-oauth-basic https://api.github.com/user`

**Set and Send OAuth2Token in Header**

`curl -H "Authorization: token OAUTH-TOKEN" https://api.github.com`

**Set and Send OAuth2Token as URL Parameter**

`curl https://api.github.com/?access_token=OAUTH-TOKEN`

** via GitHub CLI

`GITHUB_TOKEN=YOUR_TOKEN node check.js`
