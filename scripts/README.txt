FINAL QA / PRODUCTION READINESS
=================================

Place files:

scripts/production-readiness.mjs
scripts/production-smoke.mjs
docs/PRODUCTION-READINESS.md

Optional reference:
production-env-template.txt


1) LOCAL / PRE-DEPLOY
---------------------

node scripts/production-readiness.mjs --strict --lint --build

Expected:
FAIL=0
WARN=0 (when using --strict)


2) DEPLOY TO STAGING / PRODUCTION
---------------------------------

Then:

PowerShell:
$env:BASE_URL="https://YOUR-DOMAIN"
node scripts/production-smoke.mjs

Git Bash:
BASE_URL="https://YOUR-DOMAIN" node scripts/production-smoke.mjs


3) MANUAL END-TO-END
--------------------

Follow:

docs/PRODUCTION-READINESS.md


IMPORTANT
---------

The static checker deliberately does NOT print environment values.

It scans process.env names used by the project but treats missing
values as informational because many existing settings have safe
defaults.

For deployment-specific mandatory variables, optionally set:

READINESS_REQUIRED_ENVS=ENV_A,ENV_B,ENV_C

before running the checker.
