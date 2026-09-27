#!/bin/sh
# Clones the upstream projects this app imports data from, pinned to the
# commits in upstream.lock, into ./upstream (git-ignored).
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/upstream"
grep -v '^#' "$root/tools/upstream.lock" | while read -r name url commit; do
  [ -n "$name" ] || continue
  dir="$root/upstream/$name"
  if [ ! -d "$dir/.git" ]; then
    git init -q "$dir"
    git -C "$dir" remote add origin "$url"
  fi
  if [ "$(git -C "$dir" rev-parse -q --verify HEAD 2>/dev/null || true)" != "$commit" ]; then
    echo "fetching $name @ $commit"
    git -C "$dir" fetch -q --depth 1 origin "$commit"
    git -C "$dir" checkout -q FETCH_HEAD
  fi
done
