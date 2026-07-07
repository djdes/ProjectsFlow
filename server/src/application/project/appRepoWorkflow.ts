// GitHub Actions workflow, который кладётся в каждый app-репо проекта (self-serve воркер-раннер).
// Гибридная схема сборки результата: тяжёлый `npm install` + build выполняется в БЕСПЛАТНОМ
// облаке GitHub (эфемерно, node_modules у нас не оседает), а собранная статика выкладывается
// как artifact `pf-site`. Диспетчер потом забирает МАЛЕНЬКИЙ dist-артефакт и публикует его на
// поддомене — вместо локальной сборки. Если workflow нет / прогон упал — publish-site.ps1
// откатывается на локальную сборку (грациозная деградация).
//
// Детект статического вывода зеркалит publish-site.ps1: если есть package.json со `scripts.build`
// — собираем и берём dist/build/out/public с index.html; иначе — статика из корня репо.
export const APP_REPO_WORKFLOW_PATH = '.github/workflows/pf-build-site.yml';

export const APP_REPO_WORKFLOW_YAML = `# Сгенерировано ProjectsFlow. Собирает статику проекта и кладёт её как artifact "pf-site";
# диспетчер ProjectsFlow забирает артефакт и публикует результат на <slug>.projectsflow.ru.
name: Build ProjectsFlow site

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Собрать статику в _pf_site
        run: |
          set -e
          mkdir -p _pf_site
          if [ -f package.json ] && node -e "const s=(require('./package.json').scripts)||{};process.exit(s.build?0:1)"; then
            if [ -f package-lock.json ]; then npm ci; else npm install; fi
            npm run build
            SRC=""
            for d in dist build out public; do
              if [ -f "$d/index.html" ]; then SRC="$d"; break; fi
            done
            if [ -z "$SRC" ]; then echo "build produced no index.html"; exit 1; fi
            cp -a "$SRC/." _pf_site/
          elif [ -f index.html ]; then
            rsync -a --exclude='.git' --exclude='.github' --exclude='node_modules' --exclude='_pf_site' ./ _pf_site/
          else
            echo "no static output (no build script and no root index.html)"; exit 1
          fi

      - name: Выложить артефакт pf-site
        uses: actions/upload-artifact@v4
        with:
          name: pf-site
          path: _pf_site
          if-no-files-found: error
          retention-days: 3
`;
