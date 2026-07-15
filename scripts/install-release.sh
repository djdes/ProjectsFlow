#!/usr/bin/env bash
set -euo pipefail

# Installs an already unpacked release into the production directory. The caller must hold
# .deploy.lock for the whole install/migrate/restart transaction, so GitHub Actions and a
# manual Windows deploy cannot delete or replace each other's files.
stage_input="${1:?release stage is required}"
target_input="${2:?deploy target is required}"

stage="$(cd "$stage_input" && pwd -P)"
target="$(cd "$target_input" && pwd -P)"

case "$stage" in
  "$target"/.deploy-stage-*) ;;
  *)
    echo "Unsafe release stage: $stage" >&2
    exit 1
    ;;
esac

if [[ "$target" == "/" ]]; then
  echo "Refusing to install a release into /" >&2
  exit 1
fi

required=(
  "server/dist/index.js"
  "client/dist/index.html"
  "landing/dist/index.html"
  "scripts/migrate.mjs"
  "package.json"
  "package-lock.json"
  "server/package.json"
  "ecosystem.config.cjs"
)
for path in "${required[@]}"; do
  [[ -f "$stage/$path" ]] || { echo "Release is missing $path" >&2; exit 1; }
done
[[ -d "$stage/db" ]] || { echo "Release is missing db/" >&2; exit 1; }

# Preserve .env, node_modules and runtime data. Replace only versioned release artifacts.
rm -rf -- \
  "$target/db" \
  "$target/scripts" \
  "$target/server/dist" \
  "$target/client/dist" \
  "$target/landing/dist"
mkdir -p -- "$target/server" "$target/client" "$target/landing"

mv -- "$stage/db" "$target/db"
mv -- "$stage/scripts" "$target/scripts"
mv -- "$stage/server/dist" "$target/server/dist"
mv -- "$stage/client/dist" "$target/client/dist"
mv -- "$stage/landing/dist" "$target/landing/dist"
mv -- "$stage/package.json" "$target/package.json"
mv -- "$stage/package-lock.json" "$target/package-lock.json"
mv -- "$stage/server/package.json" "$target/server/package.json"
mv -- "$stage/ecosystem.config.cjs" "$target/ecosystem.config.cjs"

