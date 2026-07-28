# -*- coding: utf-8 -*-
import re, io, html, os, json

def esc(s):
    return html.escape(s, quote=False)

def inline(text):
    text = esc(text)
    # code spans first so ** inside code is untouched
    text = re.sub(r'`([^`]+)`', lambda m: '<code>' + m.group(1) + '</code>', text)
    # bold
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    # italic (single asterisk; runs after bold so no ** remain)
    text = re.sub(r'\*([^*\n]+?)\*', r'<em>\1</em>', text)
    return text

def is_table_sep(line):
    s = line.strip()
    return bool(re.match(r'^\|?[\s:\-|]+\|?$', s)) and '-' in s

def split_row(line):
    s = line.strip()
    if s.startswith('|'):
        s = s[1:]
    if s.endswith('|'):
        s = s[:-1]
    return [c.strip() for c in s.split('|')]

def render_table(rows):
    header = split_row(rows[0])
    body = [split_row(r) for r in rows[2:]]
    out = ['<div class="tablewrap"><table>']
    out.append('<thead><tr>' + ''.join('<th>' + inline(c) + '</th>' for c in header) + '</tr></thead>')
    out.append('<tbody>')
    for r in body:
        cells = ''
        for c in r:
            cls = ''
            cl = c.strip().lower().strip('*')
            if cl == 'да':
                cls = ' class="yes"'
            elif cl == 'нет':
                cls = ' class="no"'
            cells += '<td' + cls + '>' + inline(c) + '</td>'
        out.append('<tr>' + cells + '</tr>')
    out.append('</tbody></table></div>')
    return '\n'.join(out)

def render_blockquote(lines):
    # strip leading '> '
    inner = []
    for ln in lines:
        s = re.sub(r'^>\s?', '', ln)
        inner.append(s)
    text = '\n'.join(inner)
    warn = '⚠️' in text or '⚠' in text
    if warn:
        # avoid a duplicate warning glyph — the callout renders its own icon
        text = re.sub(r'^\s*⚠️?\s*', '', text)
    cls = 'callout warn' if warn else 'callout note'
    # split into paragraphs on blank lines
    paras = re.split(r'\n\s*\n', text.strip())
    body = ''.join('<p>' + inline(p.replace('\n', ' ')) + '</p>' for p in paras if p.strip())
    icon = '⚠️' if warn else 'ℹ️'
    # remove a leading duplicate warn emoji from body text? keep as is but add marker icon
    return '<aside class="' + cls + '"><span class="callout-ico" aria-hidden="true">' + icon + '</span><div class="callout-body">' + body + '</div></aside>'

def indent_of(line):
    return len(line) - len(line.lstrip(' '))

def parse_list(lines):
    # lines: consecutive list lines (top-level ordered/unordered at indent 0, nested at indent>=2)
    # returns html string
    items = []  # each: {type:'ol'|'ul', text, children:[...] }
    i = 0
    n = len(lines)
    # group top-level items with their nested lines
    top = []
    for ln in lines:
        ind = indent_of(ln)
        m_ol = re.match(r'^\s*(\d+)\.\s+(.*)$', ln)
        m_ul = re.match(r'^\s*[-*]\s+(.*)$', ln)
        if ind == 0 and (m_ol or m_ul):
            typ = 'ol' if m_ol else 'ul'
            txt = (m_ol.group(2) if m_ol else m_ul.group(1))
            top.append({'type': typ, 'text': txt, 'children': []})
        else:
            # nested / continuation
            if top:
                top[-1]['children'].append(ln)
    # render, grouping consecutive same-type top items
    out = []
    idx = 0
    while idx < len(top):
        typ = top[idx]['type']
        group = []
        while idx < len(top) and top[idx]['type'] == typ:
            group.append(top[idx]); idx += 1
        tag = 'ol' if typ == 'ol' else 'ul'
        out.append('<' + tag + '>')
        for it in group:
            li = '<li>' + inline(it['text'])
            if it['children']:
                # children are nested list lines (strip indent) - assume unordered nesting
                child_lines = [re.sub(r'^\s{2,4}', '', c) for c in it['children']]
                li += parse_list(child_lines)
            li += '</li>'
            out.append(li)
        out.append('</' + tag + '>')
    return ''.join(out)

def convert(md):
    lines = md.replace('\r\n', '\n').split('\n')
    html_parts = []
    toc = []
    para = []
    h2count = 0

    def flush_para():
        if para:
            txt = ' '.join(x.strip() for x in para).strip()
            if txt:
                html_parts.append('<p>' + inline(txt) + '</p>')
            para.clear()

    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        stripped = line.strip()

        # heading
        m = re.match(r'^(#{1,6})\s+(.*)$', line)
        if m:
            flush_para()
            level = len(m.group(1))
            txt = m.group(2).strip()
            if level == 1:
                html_parts.append('<h1>' + inline(txt) + '</h1>')
            elif level == 2:
                h2count += 1
                hid = 'sec-' + str(h2count)
                toc.append((hid, txt))
                html_parts.append('<h2 id="' + hid + '"><span class="h2-tab" aria-hidden="true"></span>' + inline(txt) + '</h2>')
            elif level == 3:
                html_parts.append('<h3>' + inline(txt) + '</h3>')
            else:
                html_parts.append('<h4>' + inline(txt) + '</h4>')
            i += 1
            continue

        # horizontal rule
        if stripped == '---':
            flush_para()
            html_parts.append('<hr>')
            i += 1
            continue

        # table
        if stripped.startswith('|') and i + 1 < n and is_table_sep(lines[i+1]):
            flush_para()
            tbl = [line]
            i += 1
            tbl.append(lines[i])  # sep
            i += 1
            while i < n and lines[i].strip().startswith('|'):
                tbl.append(lines[i]); i += 1
            html_parts.append(render_table(tbl))
            continue

        # blockquote
        if stripped.startswith('>'):
            flush_para()
            bq = [line]
            i += 1
            while i < n and (lines[i].strip().startswith('>')):
                bq.append(lines[i]); i += 1
            html_parts.append(render_blockquote(bq))
            continue

        # list (top-level)
        if re.match(r'^\s*([-*]|\d+\.)\s+', line) and indent_of(line) == 0:
            flush_para()
            block = [line]
            i += 1
            while i < n:
                l2 = lines[i]
                if l2.strip() == '':
                    # peek: if next non-blank continues list at indent>0 keep, else stop
                    break
                if re.match(r'^\s*([-*]|\d+\.)\s+', l2) or indent_of(l2) >= 2:
                    block.append(l2); i += 1
                else:
                    break
            html_parts.append(parse_list(block))
            continue

        # blank
        if stripped == '':
            flush_para()
            i += 1
            continue

        # paragraph accumulate
        para.append(line)
        i += 1

    flush_para()
    return '\n'.join(html_parts), toc


TEMPLATE = r'''<style>
:root{
  --paper:#FAF8F3; --surface:#FFFFFF; --surface-2:#F3EFE7;
  --ink:#1E2321; --ink-soft:#5A655F; --ink-faint:#8A938E;
  --accent:#0E6B62; --accent-ink:#0A544D; --accent-soft:#E2EFEC;
  --border:#E7E1D6; --border-soft:#EFEAE0;
  --warn-bg:#FBEEDD; --warn-border:#DE8F38; --warn-ink:#8A4B12;
  --note-border:#0E6B62;
  --yes:#2F7D4F; --no:#B0483C;
  --serif:'Iowan Old Style','Palatino Linotype','Book Antiqua',Palatino,Georgia,'Times New Roman',serif;
  --sans:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
  --mono:ui-monospace,'Cascadia Code','Source Code Pro',Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){
  :root{
    --paper:#121618; --surface:#191F21; --surface-2:#1E2528;
    --ink:#E9EDEB; --ink-soft:#9EAAA5; --ink-faint:#6E7A75;
    --accent:#49C9BD; --accent-ink:#6FD6CC; --accent-soft:#152F2C;
    --border:#29312F; --border-soft:#232B29;
    --warn-bg:#2A2015; --warn-border:#B97C38; --warn-ink:#E7B888;
    --note-border:#49C9BD; --yes:#67BE89; --no:#D98077;
  }
}
:root[data-theme="light"]{
  --paper:#FAF8F3; --surface:#FFFFFF; --surface-2:#F3EFE7;
  --ink:#1E2321; --ink-soft:#5A655F; --ink-faint:#8A938E;
  --accent:#0E6B62; --accent-ink:#0A544D; --accent-soft:#E2EFEC;
  --border:#E7E1D6; --border-soft:#EFEAE0;
  --warn-bg:#FBEEDD; --warn-border:#DE8F38; --warn-ink:#8A4B12;
  --note-border:#0E6B62; --yes:#2F7D4F; --no:#B0483C;
}
:root[data-theme="dark"]{
  --paper:#121618; --surface:#191F21; --surface-2:#1E2528;
  --ink:#E9EDEB; --ink-soft:#9EAAA5; --ink-faint:#6E7A75;
  --accent:#49C9BD; --accent-ink:#6FD6CC; --accent-soft:#152F2C;
  --border:#29312F; --border-soft:#232B29;
  --warn-bg:#2A2015; --warn-border:#B97C38; --warn-ink:#E7B888;
  --note-border:#49C9BD; --yes:#67BE89; --no:#D98077;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);
  font-size:17px;line-height:1.68;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.wrap{max-width:1140px;margin:0 auto;padding:0 24px 96px}

/* Hero */
.hero{padding:56px 0 30px;border-bottom:1px solid var(--border)}
.eyebrow{font-family:var(--mono);font-size:12.5px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--accent-ink);font-weight:600;margin:0 0 18px}
.punch{display:flex;gap:9px;align-items:center;margin:0 0 20px}
.punch i{width:11px;height:11px;border-radius:50%;border:1.5px dashed var(--accent);opacity:.55;display:block}
.punch i.filled{background:var(--accent);border-style:solid;opacity:.9}
.punch span{font-family:var(--mono);font-size:12px;color:var(--ink-faint);letter-spacing:.04em;margin-left:6px}
h1{font-family:var(--serif);font-weight:600;font-size:clamp(30px,4.6vw,46px);line-height:1.08;
  letter-spacing:-.01em;margin:0;text-wrap:balance;max-width:20ch}
.lede{font-size:18.5px;color:var(--ink-soft);max-width:60ch;margin:18px 0 0;line-height:1.55}
.meta{display:flex;flex-wrap:wrap;gap:8px 10px;margin-top:24px}
.chip{font-family:var(--mono);font-size:11.5px;letter-spacing:.03em;color:var(--ink-soft);
  background:var(--surface-2);border:1px solid var(--border);border-radius:999px;padding:5px 12px}

/* Layout */
.grid{display:grid;grid-template-columns:236px minmax(0,1fr);gap:52px;margin-top:44px;align-items:start}
nav.toc{position:sticky;top:24px;font-size:14px}
nav.toc .toc-title{font-family:var(--mono);font-size:11px;letter-spacing:.15em;text-transform:uppercase;
  color:var(--ink-faint);margin:0 0 12px;padding-left:14px}
nav.toc ol{list-style:none;margin:0;padding:0;counter-reset:toc}
nav.toc li{counter-increment:toc;margin:1px 0}
nav.toc a{display:block;text-decoration:none;color:var(--ink-soft);padding:6px 12px 6px 14px;
  border-left:2px solid var(--border);border-radius:0 6px 6px 0;line-height:1.35;transition:all .15s}
nav.toc a:hover{color:var(--ink);background:var(--surface-2);border-left-color:var(--accent)}
nav.toc a.active{color:var(--accent-ink);border-left-color:var(--accent);background:var(--accent-soft);font-weight:600}

.content{min-width:0;max-width:74ch}
.content h2{font-family:var(--serif);font-weight:600;font-size:26px;line-height:1.16;letter-spacing:-.005em;
  margin:54px 0 4px;padding-top:8px;position:relative;scroll-margin-top:20px;text-wrap:balance}
.content h2 .h2-tab{display:inline-block;width:26px;height:3px;background:var(--accent);border-radius:2px;
  position:absolute;top:-6px;left:0}
.content h3{font-family:var(--sans);font-weight:700;font-size:17.5px;letter-spacing:.06em;text-transform:uppercase;
  color:var(--accent-ink);margin:36px 0 6px}
.content h4{font-family:var(--serif);font-weight:600;font-size:19px;color:var(--ink);margin:28px 0 2px;
  padding-left:15px;position:relative;line-height:1.25;text-wrap:balance}
.content h4::before{content:"";position:absolute;left:0;top:.28em;bottom:.28em;width:4px;border-radius:3px;
  background:var(--accent)}
.content h4+p{margin-top:8px}
.content p{margin:13px 0}
.content>p:first-of-type{margin-top:8px}
.content strong{font-weight:700;color:var(--ink)}
a{color:var(--accent-ink);text-underline-offset:2px}
code{font-family:var(--mono);font-size:.86em;background:var(--surface-2);border:1px solid var(--border-soft);
  border-radius:5px;padding:1px 6px;color:var(--ink)}
hr{border:0;height:1px;background:var(--border);margin:40px 0}

/* lists */
.content ul,.content ol{margin:13px 0;padding-left:0;list-style:none}
.content ul>li,.content ol>li{position:relative;padding-left:30px;margin:8px 0}
.content ul>li::before{content:"";position:absolute;left:8px;top:.72em;width:6px;height:6px;border-radius:50%;
  background:var(--accent);opacity:.8}
.content ol{counter-reset:ol}
.content ol>li{counter-increment:ol}
.content ol>li::before{content:counter(ol);position:absolute;left:0;top:.05em;width:22px;height:22px;
  font-family:var(--mono);font-size:12px;font-weight:600;color:var(--accent-ink);background:var(--accent-soft);
  border:1px solid var(--accent);border-radius:6px;display:flex;align-items:center;justify-content:center}
.content li>ul,.content li>ol{margin:8px 0 4px}
.content li>ul>li::before{background:transparent;border:1.4px solid var(--accent);width:5px;height:5px;top:.68em}

/* tables */
.tablewrap{overflow-x:auto;margin:20px 0;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
table{border-collapse:collapse;width:100%;font-size:15px;line-height:1.5}
thead th{background:var(--accent-soft);color:var(--accent-ink);font-weight:700;text-align:left;
  padding:11px 15px;border-bottom:1px solid var(--border);white-space:nowrap;font-size:13.5px;
  letter-spacing:.02em;vertical-align:bottom}
tbody td{padding:11px 15px;border-bottom:1px solid var(--border-soft);vertical-align:top;
  font-variant-numeric:tabular-nums}
tbody tr:last-child td{border-bottom:0}
tbody tr:nth-child(even){background:var(--surface-2)}
td.yes{color:var(--yes);font-weight:700}
td.no{color:var(--no);font-weight:700}
table strong{color:inherit}

/* callouts */
.callout{display:flex;gap:14px;margin:22px 0;padding:16px 18px;border-radius:12px;
  border:1px solid var(--border);background:var(--surface)}
.callout .callout-ico{font-size:18px;line-height:1.5;flex:0 0 auto}
.callout .callout-body{min-width:0}
.callout p{margin:6px 0}
.callout p:first-child{margin-top:0}
.callout p:last-child{margin-bottom:0}
.callout.note{background:var(--accent-soft);border-color:var(--accent);border-left-width:4px}
.callout.warn{background:var(--warn-bg);border-color:var(--warn-border);border-left-width:4px}
.callout.warn strong{color:var(--warn-ink)}

/* mobile toc */
details.toc-m{display:none;margin:28px 0 0;border:1px solid var(--border);border-radius:12px;
  background:var(--surface);padding:2px 16px}
details.toc-m summary{font-family:var(--mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--accent-ink);padding:14px 0;cursor:pointer;font-weight:600}
details.toc-m ol{margin:0 0 14px;padding-left:20px}
details.toc-m a{color:var(--ink-soft);text-decoration:none;line-height:2}

footer.pg{margin-top:60px;padding-top:22px;border-top:1px solid var(--border);
  font-size:13.5px;color:var(--ink-faint);display:flex;flex-wrap:wrap;gap:6px 16px;font-family:var(--mono)}

@media (max-width:900px){
  .grid{grid-template-columns:1fr;gap:0}
  nav.toc{display:none}
  details.toc-m{display:block}
  .content{max-width:none}
  body{font-size:16px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
</style>

<div class="wrap">
  <header class="hero">
    <p class="eyebrow">__EYEBROW__</p>
    <div class="punch"><i class="filled"></i><i class="filled"></i><i class="filled"></i><i></i><i></i><span>__PUNCH__</span></div>
    <h1>__H1__</h1>
    <p class="lede">__LEDE__</p>
    <div class="meta">__CHIPS__</div>
  </header>

  <div class="grid">
    <nav class="toc" aria-label="Содержание">
      <p class="toc-title">Содержание</p>
      <ol>__TOC__</ol>
    </nav>
    <main class="content">
      <details class="toc-m"><summary>Содержание</summary><ol>__TOCM__</ol></details>
      __BODY__
      <footer class="pg">__FOOTER__</footer>
    </main>
  </div>
</div>

<script>
(function(){
  var links=[].slice.call(document.querySelectorAll('nav.toc a'));
  var map={};links.forEach(function(a){var id=a.getAttribute('href').slice(1);map[id]=a;});
  var heads=[].slice.call(document.querySelectorAll('main.content h2'));
  if(!('IntersectionObserver' in window)||!heads.length)return;
  var io=new IntersectionObserver(function(es){
    es.forEach(function(e){
      if(e.isIntersecting){
        links.forEach(function(a){a.classList.remove('active');});
        var a=map[e.target.id];if(a)a.classList.add('active');
      }
    });
  },{rootMargin:'-10% 0px -80% 0px',threshold:0});
  heads.forEach(function(h){io.observe(h);});
})();
</script>
'''

def wrap_full(fragment, doc_title, robots_noindex=False):
    robots = '\n<meta name="robots" content="noindex">' if robots_noindex else ''
    return (
        '<!doctype html>\n<html lang="ru">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        + robots + '\n'
        '<title>' + esc(doc_title) + '</title>\n'
        '</head>\n<body>\n' + fragment + '\n</body>\n</html>\n'
    )

def build_page(md_path, out_path, eyebrow, punch, lede, chips, footer,
               doc_title=None, ts_out=None, robots_noindex=False, strip_h1_lede=True):
    with io.open(md_path, 'r', encoding='utf-8') as f:
        md = f.read()
    body, toc = convert(md)
    # extract h1 for hero, remove from body
    h1m = re.search(r'<h1>(.*?)</h1>', body, re.S)
    h1 = h1m.group(1) if h1m else eyebrow
    body = re.sub(r'<h1>.*?</h1>\s*', '', body, count=1, flags=re.S)
    # remove the first lede paragraph (subtitle) and first <hr> from body (moved to hero)
    body = re.sub(r'^\s*<p>.*?</p>\s*', '', body, count=1, flags=re.S)
    body = re.sub(r'^\s*<hr>\s*', '', body, count=1, flags=re.S)
    toc_html = ''.join('<li><a href="#' + hid + '">' + esc(re.sub('<.*?>', '', t)) + '</a></li>' for hid, t in toc)
    chips_html = ''.join('<span class="chip">' + esc(c) + '</span>' for c in chips)
    footer_html = ''.join('<span>' + esc(x) + '</span>' for x in footer)
    page = TEMPLATE
    page = page.replace('__EYEBROW__', esc(eyebrow))
    page = page.replace('__PUNCH__', esc(punch))
    page = page.replace('__H1__', h1)
    page = page.replace('__LEDE__', esc(lede))
    page = page.replace('__CHIPS__', chips_html)
    page = page.replace('__TOC__', toc_html)
    page = page.replace('__TOCM__', toc_html)
    page = page.replace('__BODY__', body)
    page = page.replace('__FOOTER__', footer_html)

    full = wrap_full(page, doc_title or (eyebrow + ' — ' + re.sub('<.*?>', '', h1)), robots_noindex)
    with io.open(out_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(full)

    if ts_out:
        os.makedirs(os.path.dirname(ts_out), exist_ok=True)
        ts = (
            '// AUTO-GENERATED — не редактировать вручную.\n'
            '// Источник: docs/' + os.path.basename(md_path) + '\n'
            '// Генератор: scripts/build-package-docs.py (конвертер Markdown → self-contained HTML).\n'
            '// Обновление: перегенерировать из .md, не править этот файл.\n'
            'export const html = ' + json.dumps(full, ensure_ascii=False) + '\n'
        )
        with io.open(ts_out, 'w', encoding='utf-8', newline='\n') as f:
            f.write(ts)

    leftover_bold = body.count('**')
    leftover_pipe = len(re.findall(r'(?m)^\|', body))
    print('WROTE', out_path, '| bytes', len(full.encode('utf-8')), '| toc', len(toc),
          '| leftover ** =', leftover_bold, '| leftover table-pipe lines =', leftover_pipe,
          '| ts', ts_out or '-')
    return out_path


# Пути вычисляются относительно расположения скрипта — repo/scripts/build-package-docs.py.
import tempfile
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
base = os.path.join(REPO, 'docs')
scr = tempfile.gettempdir()  # превью-HTML (для локального просмотра), в репозиторий не идёт
appapp = os.path.join(REPO, 'app', 'src', 'app')

build_page(
    os.path.join(base, 'package-subscriptions-user-guide.md'),
    os.path.join(scr, 'package-subs-user-guide.html'),
    eyebrow='Инструкция · CRM «Умная Я»',
    punch='пакет = N занятий на срок',
    lede='Как настроить пакетные абонементы и работать с ними каждый день: включение типа, шаблоны пакетов, продажа, списание занятий, срок годности и частые вопросы.',
    chips=['Для владельца, управляющего и администратора', 'Пакетный тип абонементов', 'v1'],
    footer=['CRM «Умная Я» · umnayacrm.ru', 'Инструкция для пользователей'],
    doc_title='Пакетные абонементы — инструкция · CRM «Умная Я»',
    ts_out=os.path.join(appapp, 'help', 'package-subscriptions', 'content.generated.ts'),
)

build_page(
    os.path.join(base, 'package-subscriptions-reports-for-anna.md'),
    os.path.join(scr, 'package-subs-reports.html'),
    eyebrow='Методическая записка · CRM «Умная Я»',
    punch='интервал вместо месяца',
    lede='Как читать отчётность центра на пакетных абонементах: какие отчёты работают штатно, какие адаптированы под срок действия пакета, а какие остаются «месячными» и дают пустоту.',
    chips=['Для методолога / владельца', 'Отчёты · пакетный тип', 'v1'],
    footer=['CRM «Умная Я» · umnayacrm.ru', 'Логика отчётов'],
    doc_title='Отчёты при пакетном типе — методичка · CRM «Умная Я»',
    ts_out=os.path.join(appapp, 'internal-docs', 'package-reports', 'content.generated.ts'),
    robots_noindex=True,
)
