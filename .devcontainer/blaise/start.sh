#!/usr/bin/env bash
cd "$(dirname "$0")/../.." || exit 1
for f in /usr/local/share/nvm/nvm.sh "$HOME/.nvm/nvm.sh"; do [ -s "$f" ] && . "$f" >/dev/null 2>&1; done
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then NODE="$(find ${BLAISE_NODE_DIRS:-/usr/local/share/nvm /usr/local/n /home/codespace/.nvm /opt /usr/local/lib} -maxdepth 6 -type f -name node 2>/dev/null | sort | tail -1)"; fi
if [ -z "$NODE" ] && command -v apt-get >/dev/null 2>&1; then (sudo apt-get update -y && sudo apt-get install -y nodejs) >> /tmp/blaise-agent.log 2>&1; NODE="$(command -v node || true)"; fi
if [ -z "$NODE" ] && command -v apk >/dev/null 2>&1; then sudo apk add --no-cache nodejs >> /tmp/blaise-agent.log 2>&1; NODE="$(command -v node || true)"; fi
if pgrep -f blaise/agent.mjs >/dev/null; then exit 0; fi
if [ -z "$NODE" ]; then echo "blaise: Node was not found and could not be installed" >> /tmp/blaise-agent.log; exit 1; fi
(setsid nohup "$NODE" .devcontainer/blaise/agent.mjs >> /tmp/blaise-agent.log 2>&1 &)
