"""companion: talk through your work; it remembers across sessions.

    companion                                   chat (schema aim_live, one thread per session)
    companion --script conversations/x.yaml     replay a scripted conversation (schema aim_app)
    companion --script x.yaml --live            same, but the model writes the replies
    companion --web                             chat in the browser (http://localhost:8765)

In the chat: /why explains the last reply, /new starts a new thread, /quit exits.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import textwrap
from pathlib import Path

import yaml

from .agent import Companion, Remembered
from .config import LIVE_EXTRACTION_INSTRUCTIONS, load_config, open_memory
from .why import find_origins, render_why

TTY = sys.stdout.isatty()


def dim(text: str) -> str:
    return f"\033[2m{text}\033[0m" if TTY else text


def diff_summary(rem: Remembered) -> str:
    counts = {k: len(rem.diff.get(k, [])) for k in ("created", "updated", "deleted")}
    changes = ", ".join(f"{n} {k}" for k, n in counts.items() if n) or "nothing new"
    return f"remembered in {rem.seconds:.1f}s: {changes}"


def chat(args: argparse.Namespace) -> None:
    cfg = load_config(args.db_user, args.user_id)
    pool, memory = open_memory(cfg, source="live")
    comp = Companion(memory, user_id=cfg.user_id, agent_id=cfg.agent_id, model=cfg.llm_model,
                     extraction_instructions=LIVE_EXTRACTION_INSTRUCTIONS)
    width = min(shutil.get_terminal_size().columns, 100)
    try:
        thread_id = comp.new_thread()
        print(dim(f"companion · {cfg.db_user} · user {cfg.user_id} · thread {thread_id[:8]}… · /why /new /quit"))
        while True:
            try:
                line = input("\nyou › ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                break
            if not line:
                continue
            if line in ("/quit", "/exit"):
                break
            if line == "/new":
                print(dim(f"new thread {comp.new_thread()[:8]}…"))
                continue
            if line == "/why":
                ids = [r.id for r in comp.last.results] if comp.last else []
                print(render_why(comp.last, find_origins(pool, ids), comp.thread.thread_id if comp.thread else None, width))
                continue
            reply = comp.respond(line)
            print()
            for para in reply.text.splitlines() or [""]:
                print(textwrap.fill(para, width=width) if para else "")
            print(dim("remembering…"), end="\r" if TTY else "\n", flush=True)
            print(dim(diff_summary(comp.remember(reply))) + " " * 10)
    finally:
        memory.close()
        pool.close()


def run_script(args: argparse.Namespace) -> None:
    convo = yaml.safe_load(Path(args.script).read_text())
    cfg = load_config(args.db_user or "aim_app", args.user_id or convo["user_id"])
    pool, memory = open_memory(cfg, source="live" if args.live else "replay")
    comp = Companion(memory, user_id=cfg.user_id, agent_id=convo.get("agent_id", cfg.agent_id), model=cfg.llm_model)
    try:
        thread_id = comp.new_thread()
        print(f"{Path(args.script).stem}  {cfg.db_user}  user {cfg.user_id}  thread {thread_id}")
        print("  turn  retrieved  prompt tok  flat tok  created  updated  deleted   secs")
        messages = convo["messages"]
        for i in range(0, len(messages) - 1, 2):
            user, scripted = messages[i], messages[i + 1]
            reply = comp.respond(user["content"], None if args.live else scripted["content"])
            rem = comp.remember(reply)
            turn = memory.inspector.last_turn
            prompt = turn.prompt if turn else {}
            print(f"  {rem.turn or '-':>4}  {len(reply.results):>9}  {prompt.get('prompt_tokens') or '-':>10}  "
                  f"{prompt.get('flat_history_tokens') or '-':>8}  {len(rem.diff.get('created', [])):>7}  "
                  f"{len(rem.diff.get('updated', [])):>7}  {len(rem.diff.get('deleted', [])):>7}  {rem.seconds:5.1f}")
        if convo.get("explicit_memory"):
            comp.thread.add_memory(convo["explicit_memory"], memory_type="fact")
    finally:
        memory.close()
        pool.close()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="companion", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--script", help="YAML conversation to run instead of chatting")
    parser.add_argument("--live", action="store_true", help="with --script: the model writes replies")
    parser.add_argument("--web", action="store_true", help="serve the chat as a web page instead")
    parser.add_argument("--host", default="127.0.0.1", help="with --web: address to listen on (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="with --web: port (default 8765)")
    parser.add_argument("--db-user", help="schema (default: aim_live for chat, aim_app for --script)")
    parser.add_argument("--user-id", help="memory user id (default: COMPANION_USER_ID or 'me'; the YAML's for --script)")
    args = parser.parse_args(argv)
    if args.live and not args.script:
        parser.error("--live only applies to --script")
    if args.web and args.script:
        parser.error("--web and --script don't mix")
    if args.web:
        from .web import serve
        serve(load_config(args.db_user, args.user_id), host=args.host, port=args.port)
        return
    (run_script if args.script else chat)(args)


if __name__ == "__main__":
    main()
