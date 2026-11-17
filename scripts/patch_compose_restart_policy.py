#!/usr/bin/env python3
"""Give every workspace service a restart policy.

Why
---
`cloudflared` had `restart: unless-stopped`; nothing else did. So the first
unhandled error took the whole site down *permanently* — the container reached
`Exited (1)` and nothing brought it back, because Docker does not restart a
container without a policy. Observed in production: the app died with

    Error: Connection terminated unexpectedly

(an unhandled Postgres connection drop, which is exactly the class of event the
app's own process-level handler deliberately does not swallow — see
`src/lib/processErrors.ts`, where an uncaught exception exits rather than
continuing in an unknown state). The correct place to recover from that is the
supervisor, not the application.

Adding the policy turns a permanent outage into a restart, and is idempotent so
re-running is harmless.
"""
import re
import shutil
import sys

PATH = "docker-compose.yml"
BACKUP = "docker-compose.yml.bak-restart"

# (service key, the first key that appears inside that service's block, used as
# the insertion anchor)
SERVICES = {
    "app": "    build:",
    "postgres": "    image: pgvector/pgvector:pg16",
    "openfga": "    image: openfga/openfga:v1.5",
    "meilisearch": "    image: getmeili/meilisearch:v1.8",
}

POLICY = "    restart: unless-stopped\n"


def main() -> int:
    with open(PATH) as fh:
        src = fh.read()

    shutil.copyfile(PATH, BACKUP)

    added, already = [], []
    for name, anchor in SERVICES.items():
        # Locate this service's block, bounded by the next top-level service key.
        m = re.search(rf"^  {re.escape(name)}:\n", src, re.M)
        if not m:
            print(f"FAIL: service {name!r} not found", file=sys.stderr)
            return 1
        nxt = re.search(r"^  [a-z0-9][a-z0-9-]*:\n", src[m.end():], re.M)
        end = m.end() + (nxt.start() if nxt else len(src))
        block = src[m.start():end]
        if "restart:" in block:
            already.append(name)
            continue
        if block.count(anchor) != 1:
            print(f"FAIL: anchor {anchor!r} not unique in {name}", file=sys.stderr)
            return 1
        new_block = block.replace(anchor, POLICY + anchor, 1)
        src = src[:m.start()] + new_block + src[end:]
        added.append(name)

    with open(PATH, "w") as fh:
        fh.write(src)

    print(f"backup: {BACKUP}")
    print(f"added restart:unless-stopped -> {', '.join(added) or '(none)'}")
    if already:
        print(f"already had a policy -> {', '.join(already)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())