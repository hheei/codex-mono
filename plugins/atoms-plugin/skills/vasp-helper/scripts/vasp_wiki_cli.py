#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import re
import sys
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

DESCRIPTION = "Print VASP wiki pages as markdown, using assets/vasp-wiki as cache."


class WikiToMarkdown(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.stack: list[tuple[str, dict[str, str]]] = []
        self.in_content = False
        self.skip_depth = 0
        self.current_tag: str | None = None
        self.current_text: list[str] = []
        self.blocks: list[str] = []
        self.table_mode = False
        self.table_rows: list[list[str]] = []
        self.table_row: list[str] = []
        self.cell_text: list[str] = []

    def handle_starttag(self, tag: str, attrs_in: list[tuple[str, str | None]]) -> None:
        attrs = {k: (v or "") for k, v in attrs_in}
        self.stack.append((tag, attrs))

        if tag == "div" and attrs.get("id") == "mw-content-text":
            self.in_content = True

        if not self.in_content:
            return

        if tag in {"script", "style", "nav", "noscript"}:
            self.skip_depth += 1
            return

        css = attrs.get("class", "")
        if any(k in css for k in ["toc", "reflist", "navbox", "mw-editsection", "reference"]):
            self.skip_depth += 1
            return

        if self.skip_depth > 0:
            return

        if tag in {"h1", "h2", "h3", "h4", "p", "li", "pre"}:
            self._flush_text_block()
            self.current_tag = tag
            self.current_text = []
        elif tag == "br" and self.current_text is not None:
            self.current_text.append("\n")
        elif tag == "table":
            self._flush_text_block()
            self.table_mode = True
            self.table_rows = []
        elif tag == "tr" and self.table_mode:
            self.table_row = []
        elif tag in {"th", "td"} and self.table_mode:
            self.cell_text = []

    def handle_endtag(self, tag: str) -> None:
        if self.stack:
            popped_tag, _ = self.stack.pop()
            if popped_tag == "div" and not any(t == "div" and a.get("id") == "mw-content-text" for t, a in self.stack):
                self.in_content = False

        if not self.in_content and tag != "div":
            return

        if self.skip_depth > 0 and tag in {"script", "style", "nav", "noscript", "div", "ul", "ol", "span"}:
            self.skip_depth -= 1
            return

        if self.skip_depth > 0:
            return

        if tag == self.current_tag and self.current_tag:
            text = self._clean("".join(self.current_text))
            if text:
                if self.current_tag == "h1":
                    self.blocks.append(f"# {text}")
                elif self.current_tag == "h2":
                    self.blocks.append(f"## {text}")
                elif self.current_tag == "h3":
                    self.blocks.append(f"### {text}")
                elif self.current_tag == "h4":
                    self.blocks.append(f"#### {text}")
                elif self.current_tag == "li":
                    self.blocks.append(f"- {text}")
                elif self.current_tag == "pre":
                    self.blocks.append(f"```\n{text}\n```")
                else:
                    self.blocks.append(text)
            self.current_tag = None
            self.current_text = []

        if self.table_mode and tag in {"th", "td"}:
            self.table_row.append(self._clean("".join(self.cell_text)))
            self.cell_text = []
        elif self.table_mode and tag == "tr":
            if any(c for c in self.table_row):
                self.table_rows.append(self.table_row)
            self.table_row = []
        elif self.table_mode and tag == "table":
            if self.table_rows:
                head = self.table_rows[0]
                body = self.table_rows[1:]
                self.blocks.append("| " + " | ".join(head) + " |")
                self.blocks.append("| " + " | ".join(["---"] * len(head)) + " |")
                for row in body:
                    if len(row) < len(head):
                        row = row + [""] * (len(head) - len(row))
                    self.blocks.append("| " + " | ".join(row[: len(head)]) + " |")
            self.table_mode = False
            self.table_rows = []

    def handle_data(self, data: str) -> None:
        if not self.in_content or self.skip_depth > 0:
            return
        if self.table_mode and any(t in {"th", "td"} for t, _ in self.stack):
            self.cell_text.append(data)
            return
        if self.current_tag:
            self.current_text.append(data)

    def _flush_text_block(self) -> None:
        if self.current_tag and self.current_text:
            text = self._clean("".join(self.current_text))
            if text:
                self.blocks.append(text)
        self.current_tag = None
        self.current_text = []

    @staticmethod
    def _clean(text: str) -> str:
        text = html.unescape(text)
        text = text.replace("\xa0", " ")
        text = re.sub(r"[ \t\r\f\v]+", " ", text)
        text = re.sub(r"\n\s*\n+", "\n", text)
        return text.strip()


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def render_page(page: str, cache_dir: Path) -> tuple[str, str]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached_file = cache_dir / f"{page.lower()}.md"
    if cached_file.exists():
        return "cached", cached_file.read_text(encoding="utf-8")

    url = f"https://vasp.at/wiki/{page}"
    try:
        html_text = fetch(url)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return "skipped-missing", f"{page} ({url})"
        raise

    parser = WikiToMarkdown()
    parser.feed(html_text)

    title = page
    match = re.search(r"<title>\s*(.*?)\s*</title>", html_text, re.IGNORECASE | re.DOTALL)
    if match:
        title = html.unescape(match.group(1)).strip()
        title = re.sub(r"\s*-\s*VASP Wiki\s*$", "", title)
    for block in parser.blocks:
        if block.startswith("# "):
            title = block[2:].strip()
            break

    content_blocks = [block for block in parser.blocks if block and block != "The VASP Manual"]
    markdown = "\n\n".join([f"# {title}", "", f"Source: {url}", ""] + content_blocks).strip() + "\n"
    cached_file.write_text(markdown, encoding="utf-8")
    return "converted", markdown


def print_pages(pages: list[str], cache_dir: Path) -> int:
    rendered: list[str] = []
    for page in pages:
        status, detail = render_page(page, cache_dir)
        if status == "skipped-missing":
            print(f"skip missing {detail}", file=sys.stderr)
            return 1
        rendered.append(detail)

    output = "\n".join(text.rstrip() for text in rendered if text).rstrip()
    output = re.sub(r"\n{3,}", "\n\n", output)
    sys.stdout.write(output + "\n")
    return 0


def configure_parser(parser: argparse.ArgumentParser) -> argparse.ArgumentParser:
    parser.add_argument(
        "pages",
        nargs="+",
        help="Wiki page keys or slugs, e.g. ENCUT ISMEAR The_VASP_Manual",
    )
    parser.add_argument(
        "--cache-dir",
        default="assets/vasp-wiki",
        help="Cache directory to reuse before downloading.",
    )
    return parser


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    return configure_parser(parser)


def run(args: argparse.Namespace) -> int:
    repo_root = Path(__file__).resolve().parents[1]
    cache_dir = Path(args.cache_dir)
    if not cache_dir.is_absolute():
        cache_dir = repo_root / cache_dir

    try:
        return print_pages(list(args.pages), cache_dir)
    except KeyboardInterrupt:
        return 130


def main(argv: list[str] | None = None) -> int:
    return run(build_parser().parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
