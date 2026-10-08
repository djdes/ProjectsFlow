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
  # Не документация, а рантайм-ресурс: сервер вкладывает контракт в задачу на перевод проекта
  # со своего сервера на бэкенд платформы. Требуем явно — релиз без него молча ломает кнопку.
  "docs/app-backend-contract.md"
  "package.json"
  "package-lock.json"
  "server/package.json"
  "ecosystem.config.cjs"
)
for path in "${required[@]}"; do
  [[ -f "$stage/$path" ]] || { echo "Release is missing $path" >&2; exit 1; }
done
[[ -d "$stage/db" ]] || { echo "Release is missing db/" >&2; exit 1; }

# Keep content-addressed files for existing tabs. Publish index.html last, by rename,
# so a reader never sees a new entry document before its assets are installed.
install_frontend() {
  local source="$1" destination="$2" asset_dir="$3" entry asset relative
  mkdir -p -- "$destination/$asset_dir"
  if [[ -d "$source/$asset_dir" ]]; then
    cp -an -- "$source/$asset_dir/." "$destination/$asset_dir/"
    while IFS= read -r -d '' asset; do
      relative="${asset#"$source/$asset_dir/"}"
      touch -r "$asset" -- "$destination/$asset_dir/$relative"
    done < <(find "$source/$asset_dir" -type f -print0)
  fi
  while IFS= read -r -d '' entry; do
    cp -a -- "$entry" "$destination/"
  done < <(find "$source" -mindepth 1 -maxdepth 1 ! -name index.html ! -name "$asset_dir" -print0)
  cp -- "$source/index.html" "$destination/.index-next.html"
  mv -f -- "$destination/.index-next.html" "$destination/index.html"

  # Only old, unreferenced build assets are eligible for bounded retention cleanup.
  while IFS= read -r -d '' asset; do
    relative="${asset#"$destination/$asset_dir/"}"
    if [[ ! -e "$source/$asset_dir/$relative" ]]; then rm -f -- "$asset"; fi
  done < <(find "$destination/$asset_dir" -type f -mtime +30 -print0)
}

install_frontend "$stage/client/dist" "$target/client/dist" assets
install_frontend "$stage/landing/dist" "$target/landing/dist" _astro

# Preserve .env, node_modules and runtime data. Replace only versioned release artifacts.
rm -rf -- \
  "$target/db" \
  "$target/scripts" \
  "$target/docs" \
  "$target/server/dist"
mkdir -p -- "$target/server" "$target/client" "$target/landing"

mv -- "$stage/db" "$target/db"
mv -- "$stage/scripts" "$target/scripts"
mv -- "$stage/docs" "$target/docs"
mv -- "$stage/server/dist" "$target/server/dist"
mv -- "$stage/package.json" "$target/package.json"
mv -- "$stage/package-lock.json" "$target/package-lock.json"
mv -- "$stage/server/package.json" "$target/server/package.json"
mv -- "$stage/ecosystem.config.cjs" "$target/ecosystem.config.cjs"

