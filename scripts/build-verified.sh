#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec bash "${script_dir}/sites-env.sh" -- bash "$0" "$@"
fi

next="${SITES_PROJECT_ROOT}/node_modules/.bin/next"
if [[ ! -x "${next}" ]]; then
  echo "Next.js is unavailable. Run npm ci before building." >&2
  exit 69
fi
node "${script_dir}/prepare-release.mjs"
node "${script_dir}/run-bounded.mjs" \
  "${SITES_BUILD_TIMEOUT:-3m}" \
  "${SITES_BUILD_KILL_AFTER:-10s}" \
  "${next}" build --webpack
bash "${script_dir}/validate-artifact.sh"
