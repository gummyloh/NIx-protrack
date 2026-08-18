#!/usr/bin/env bash
# Fetches the binary icon assets from the current production deployment at
# build time, so direct-upload deploys never need to hand-transcribe base64
# binaries (see project reference: "Lesson learned: binary assets in direct
# deploys"). If an icon already exists locally (e.g. local dev with the repo
# checkout), it's kept as-is. curl -f makes the build fail loudly if an
# asset can't be fetched, which keeps production on the previous deploy.
set -euo pipefail

BASE="https://nixma-project-tracker.vercel.app"
ASSETS=(favicon.ico favicon-16.png favicon-32.png apple-touch-icon.png icon-192.png)

mkdir -p public
for f in "${ASSETS[@]}"; do
  if [ -s "public/$f" ]; then
    echo "fetch-icons: public/$f already present, keeping local copy"
    continue
  fi
  echo "fetch-icons: downloading $f"
  curl -fsSL --retry 3 -o "public/$f" "$BASE/$f"
done

echo "fetch-icons: done"
ls -la public
