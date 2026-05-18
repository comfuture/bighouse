#!/usr/bin/env python3
"""Scaffold a Bighouse GameDefinition and starter tests."""

from __future__ import annotations

import re
import sys
from pathlib import Path


def find_repo_root(start: Path) -> Path:
    for candidate in [start, *start.parents]:
        if (candidate / "package.json").exists() and (candidate / "src" / "games").exists():
            return candidate
    raise RuntimeError("could not find bighouse repository root")


ROOT = find_repo_root(Path(__file__).resolve())
SKILL_DIR = Path(__file__).resolve().parents[1]


def usage() -> None:
    print('usage: scaffold_game.py <game-id> "Display Name"', file=sys.stderr)


def to_camel(game_id: str) -> str:
    parts = game_id.split("-")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


def to_pascal(game_id: str) -> str:
    return "".join(part.capitalize() for part in game_id.split("-"))


def render(template_name: str, game_id: str, display_name: str) -> str:
    template = (SKILL_DIR / "skeletons" / template_name).read_text()
    return (
        template.replace("__GAME_ID__", game_id)
        .replace("__DISPLAY_NAME__", display_name)
        .replace("__CAMEL__", to_camel(game_id))
        .replace("__PASCAL__", to_pascal(game_id))
    )


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        usage()
        return 2

    game_id = argv[1]
    display_name = argv[2]
    if not re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", game_id):
        print("game-id must be lowercase kebab-case, for example 'my-game'", file=sys.stderr)
        return 2

    targets = {
        ROOT / "src" / "games" / f"{game_id}.ts": render("game-definition.ts", game_id, display_name),
        ROOT / "test" / f"{game_id}.test.ts": render("game-test.ts", game_id, display_name),
    }

    for path in targets:
        if path.exists():
            print(f"refusing to overwrite existing file: {path}", file=sys.stderr)
            return 1

    for path, content in targets.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        print(f"created {path.relative_to(ROOT)}")

    camel = to_camel(game_id)
    print()
    print("Next steps:")
    print(f'1. Add `import {{ {camel}Definition }} from "./{game_id}";` to src/games/index.ts')
    print(f"2. Add `registerGame({camel}Definition);` to src/games/index.ts")
    print("3. Replace exampleAction with real actions, validation, state transitions, and winner logic")
    print("4. Run `pnpm typecheck && pnpm test`")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
