"""Print recent opencode session ids for a working directory.

The goal-autocontinue controller takes an explicit `--session` id, and opencode
keeps sessions in the `session_v2` table rather than in per-session directories.
This resolves them so the controller can be invoked without hand-copying an id.

Directory matching mirrors the controller's own rule: stored paths use forward
slashes, so compare normalised paths rather than raw strings.
"""

import os
import sqlite3
import sys

DB = os.path.expanduser("~/.local/share/opencode/opencode.db")


def norm_dir(value: str) -> str:
    """Normalise a stored directory for comparison (forward slashes, lowercased)."""
    return (value or "").replace("\\", "/").rstrip("/").lower()


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: list-sessions.py <working-dir> [limit]")
        return 2
    wanted = norm_dir(os.path.abspath(sys.argv[1]))
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 10

    connection = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)
    try:
        rows = connection.execute(
            "SELECT id, title, time_created, directory, parent_id"
            " FROM session_v2 WHERE parent_id IS NULL"
            " ORDER BY time_created DESC"
        ).fetchall()
    finally:
        connection.close()

    hits = [row for row in rows if norm_dir(row[3]) == wanted]
    if not hits:
        print("no session for", wanted)
        print("sample directories:", [row[3] for row in rows[:5]])
        return 1
    for session_id, title, created, _directory, _parent in hits[:limit]:
        print(f"{session_id}\t{created}\t{(title or '')[:70]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
