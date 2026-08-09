#!/usr/bin/env python3
"""마크다운 원고 → 제출용 PDF.

제출물 3·4(게임 소개서 / AI 활용 기술 문서)를 만드는 스크립트다.
원고는 docs/*.md 하나뿐이고 PDF는 그것을 렌더한 결과이므로, 문서를 고치면
이 스크립트를 다시 돌리기만 하면 된다 (수동 편집본을 따로 관리하지 않는다).

의존: python-markdown, Google Chrome (헤드리스 print-to-pdf).
    python3 scripts/md2pdf.py
"""
from __future__ import annotations

import html
import re
import subprocess
import sys
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "submission"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

PLAY = "https://ry-eon.github.io/NAN2026-NHN-Game-X-AI-Hackathon/"
REPO = "https://github.com/ry-eon/NAN2026-NHN-Game-X-AI-Hackathon"

# (원고, 출력 파일명, 표지 제목, 표지 부제)
DOCS = [
    (
        "docs/10-game-intro.md",
        "게임소개서_최후의벽최후의사람.pdf",
        "최후의 벽, 최후의 사람",
        "게임 소개서 — 개요 · 플레이 방법 · 실행 방법",
    ),
    (
        "docs/09-ai-tech-doc.md",
        "AI활용기술문서_최후의벽최후의사람.pdf",
        "AI 활용 기술 문서",
        "「최후의 벽, 최후의 사람」 — 도구 · 프롬프트 · 검증 기록",
    ),
]

CSS = """
@page { size: A4; margin: 18mm 16mm 20mm; }
* { box-sizing: border-box; }
body {
  font-family: "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif;
  font-size: 10.5pt; line-height: 1.65; color: #1a1c20; margin: 0;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
/* ---- 표지: 한 장을 통째로 쓴다 */
.cover { height: 247mm; display: flex; flex-direction: column; justify-content: center;
         page-break-after: always; text-align: center; }
.cover .kicker { font-size: 10pt; letter-spacing: 3px; color: #6b7280; margin-bottom: 14mm; }
.cover h1 { font-size: 30pt; margin: 0 0 6mm; letter-spacing: -0.5px; color: #111318; }
.cover .sub { font-size: 12pt; color: #4b5563; margin-bottom: 16mm; }
.cover .rule { width: 46mm; height: 2px; background: #b08d3e; margin: 0 auto 16mm; }
.cover .meta { font-size: 10pt; color: #374151; line-height: 2; }
.cover .meta a { color: #1d4e8c; text-decoration: none; word-break: break-all; }
/* ---- 본문 */
h1 { font-size: 17pt; margin: 0 0 4mm; padding-bottom: 2mm; border-bottom: 2px solid #1a1c20; }
h2 { font-size: 13.5pt; margin: 9mm 0 3mm; padding-bottom: 1.5mm;
     border-bottom: 1px solid #d1d5db; page-break-after: avoid; }
h3 { font-size: 11.5pt; margin: 6mm 0 2mm; color: #1f2937; page-break-after: avoid; }
p { margin: 0 0 3mm; }
ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
li { margin-bottom: 1mm; }
strong { color: #111318; }
hr { border: 0; border-top: 1px solid #e5e7eb; margin: 7mm 0; }
a { color: #1d4e8c; }
blockquote { margin: 3mm 0; padding: 2.5mm 4mm; background: #f7f8fa;
             border-left: 3px solid #b08d3e; color: #374151; }
blockquote p { margin: 0 0 1.5mm; }
blockquote p:last-child { margin-bottom: 0; }
table { width: 100%; border-collapse: collapse; margin: 3mm 0 4mm;
        font-size: 9pt; page-break-inside: avoid; }
th, td { border: 1px solid #d1d5db; padding: 1.8mm 2.5mm; text-align: left; vertical-align: top; }
th { background: #eef1f5; font-weight: 600; }
tr:nth-child(even) td { background: #fafbfc; }
code { font-family: "SF Mono", Menlo, monospace; font-size: 8.8pt;
       background: #f1f3f5; padding: 0.3mm 1.2mm; border-radius: 2px; }
pre { background: #f7f8fa; border: 1px solid #e5e7eb; border-radius: 3px;
      padding: 3mm; overflow: hidden; page-break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 8.5pt; line-height: 1.45; }
"""


# 제출본에서 빼는 내부 섹션 — 우리 작업용 메모라 심사자에게 보일 것이 아니다.
# (미완료 체크박스가 그대로 나가면 "덜 된 제출물"로 읽힌다)
INTERNAL_HEADINGS = ("제출 전 체크리스트", "남은 항목")


def strip_internal(raw: str) -> str:
    """내부용 섹션을 헤딩부터 다음 같은 수준 헤딩(또는 끝)까지 잘라낸다."""
    for name in INTERNAL_HEADINGS:
        pattern = re.compile(
            r"^(#{2,3})\s*[^\n]*" + re.escape(name) + r"[^\n]*\n"  # 헤딩 줄
            r"(?:(?!^#{1,3}\s).*\n?)*",  # 다음 헤딩 전까지
            re.M,
        )
        raw = pattern.sub("", raw)
    # 잘라낸 자리에 남은 연속 구분선·빈 줄 정리
    raw = re.sub(r"(?:^---\s*\n\s*){2,}", "---\n\n", raw, flags=re.M)
    return raw.rstrip() + "\n"


def build_html(md_path: Path, title: str, subtitle: str) -> str:
    raw = md_path.read_text(encoding="utf-8")
    # 원고 맨 위의 상태 안내 블록(> 원고 상태: …)은 제출본에서 뺀다 — 내부 메모다
    raw = re.sub(r"^> NHN NAN 2026[^\n]*\n(> [^\n]*\n)*", "", raw, count=1, flags=re.M)
    # 첫 h1은 표지가 대신하므로 제거
    raw = re.sub(r"^# [^\n]*\n", "", raw, count=1)
    raw = strip_internal(raw)
    body = markdown.markdown(raw, extensions=["tables", "fenced_code", "sane_lists"])
    cover = f"""
    <div class="cover">
      <div class="kicker">NHN NAN 2026 · 게임 × AI 해커톤 사전과제</div>
      <h1>{html.escape(title)}</h1>
      <div class="sub">{html.escape(subtitle)}</div>
      <div class="rule"></div>
      <div class="meta">
        개인 참가 · ry-eon<br>
        플레이 <a href="{PLAY}">{PLAY}</a><br>
        소스 · 커밋 기록 <a href="{REPO}">{REPO}</a><br>
        2026-08-10
      </div>
    </div>
    """
    return (
        '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
        f"<title>{html.escape(title)}</title><style>{CSS}</style></head>"
        f"<body>{cover}{body}</body></html>"
    )


def main() -> int:
    if not Path(CHROME).exists():
        print(f"Chrome을 찾을 수 없다: {CHROME}", file=sys.stderr)
        return 1
    OUT.mkdir(exist_ok=True)
    for rel, pdf_name, title, subtitle in DOCS:
        src = ROOT / rel
        if not src.exists():
            print(f"원고 없음: {rel}", file=sys.stderr)
            return 1
        tmp_html = OUT / (pdf_name.replace(".pdf", ".html"))
        tmp_html.write_text(build_html(src, title, subtitle), encoding="utf-8")
        pdf = OUT / pdf_name
        subprocess.run(
            [
                CHROME, "--headless", "--disable-gpu", "--no-pdf-header-footer",
                f"--print-to-pdf={pdf}", tmp_html.as_uri(),
            ],
            check=True, capture_output=True,
        )
        tmp_html.unlink()
        kb = pdf.stat().st_size // 1024
        print(f"  ✓ {pdf.relative_to(ROOT)}  ({kb} KB)  ← {rel}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
