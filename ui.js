/* 买多了退不掉 · ui.js
 * 决策树式输入（4 问决定出现哪些卡片）+ 采购清单式输出（逐行可勾选）。
 * 纯原生 DOM；数字输入用 text + inputmode，校验交给 core.validate。
 */
'use strict';
(function () {
  var C = window.AppCore;
  var LS_KEY = 'material-pick-v1';
  var state = { cfg: null, checks: {}, res: null, scenario: 'default' };
  window.__exports = 0;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
  function esc(s) { return String(s === null || s === undefined ? '' : s); }

  /* ── 字段类型的显示单位 ─────────────────────────────── */
  var LEN_LABEL = { m: '米', cm: '厘米', mm: '毫米' };

  /* ═══ 状态读写 ═══ */
  function freshCfg() { return JSON.parse(JSON.stringify(C.DEFAULTS)); }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.cfg) return null;
      return o;
    } catch (e) { return null; }
  }

  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ cfg: state.cfg, checks: state.checks, scenario: state.scenario, v: 1 }));
    } catch (e) { /* 隐私模式下会失败，不影响使用 */ }
  }

  /* ═══ 表单绑定 ═══ */
  var inputs = [];
  function collectInputs() {
    inputs = Array.prototype.slice.call(document.querySelectorAll('[data-k]'));
  }

  function setInput(k, v) {
    var nodes = document.querySelectorAll('[data-k="' + k + '"]');
    Array.prototype.forEach.call(nodes, function (n) {
      if (n.tagName === 'INPUT') {
        if (n.type === 'checkbox') n.checked = !!v; else n.value = v === null || v === undefined ? '' : String(v);
      } else if (n.tagName === 'SELECT') {
        n.value = String(v);
        if (n.value !== String(v)) {
          // 布尔型 select（layLong）
          n.value = (v === true || v === 'true' || v === 1 || v === '1') ? '1' : '0';
        }
      } else if (n.tagName === 'BUTTON') {
        n.setAttribute('aria-pressed', (v === true || v === 'true' || v === 1 || v === '1') ? 'true' : 'false');
      }
    });
  }

  var BOOL_KEYS = ['hasFloor', 'hasWallTile', 'hasPaint', 'hasBase', 'hasGrout', 'layLong', 'ceilingOn', 'baseFromOffcut', 'groutWallOn'];

  function readForm() {
    var cfg = {};
    Object.keys(C.DEFAULTS).forEach(function (k) { cfg[k] = C.DEFAULTS[k]; });
    Object.keys(state.cfg || {}).forEach(function (k) { if (k in cfg) cfg[k] = state.cfg[k]; });
    // 文本/下拉/按钮
    Array.prototype.forEach.call(document.querySelectorAll('[data-k]'), function (n) {
      var k = n.getAttribute('data-k');
      if (!(k in cfg)) return;
      if (n.tagName === 'INPUT') { cfg[k] = n.value; return; }
      if (n.tagName === 'SELECT') {
        if (BOOL_KEYS.indexOf(k) >= 0) cfg[k] = (n.value === '1'); else cfg[k] = n.value;
        return;
      }
      if (n.tagName === 'BUTTON') {
        // floorKind 这一组是三选一 chip：它的取值不能按「按下=真」折算，
        // 否则 cfg.floorKind 会先变成 true/false，再由下面的 chip 组覆盖 —— 中间态会把
        // 派生的 hasFloor 带歪（曾导致点「地面先不铺」被判成「铺瓷砖」）。这里直接跳过。
        if (k === 'floorKind') return;
        cfg[k] = (n.getAttribute('aria-pressed') === 'true');
      }
    });
    // floorKind 由三选一 chip 决定；hasFloor 与之一致
    var fkBtns = document.querySelectorAll('#q-floor .chip');
    if (fkBtns.length) {
      var chosen = null;
      Array.prototype.forEach.call(fkBtns, function (b) { if (b.getAttribute('aria-pressed') === 'true') chosen = b.getAttribute('data-v'); });
      if (chosen) cfg.floorKind = chosen;
    }
    if (['tile', 'plank', 'none'].indexOf(cfg.floorKind) < 0) cfg.floorKind = cfg.hasFloor === false ? 'none' : 'tile';
    cfg.hasFloor = (cfg.floorKind === 'tile' || cfg.floorKind === 'plank');
    return cfg;
  }

  function syncBoolChips(cfg) {
    // floorKind（三选一）
    var fk = ['tile', 'plank', 'none'].indexOf(cfg.floorKind) >= 0 ? cfg.floorKind
      : (cfg.hasFloor === false ? 'none' : 'tile');
    setFloorKindChips(fk);
    [['hasWallTile', '#q-walltile'], ['hasPaint', '#q-paint'], ['hasBase', '#q-extras'], ['hasGrout', '#q-extras'],
     ['ceilingOn', '#q-ceiling'], ['baseFromOffcut', '#q-offcut'], ['groutWallOn', '#q-groutwall']].forEach(function (pair) {
      var k = pair[0];
      if (!(k in cfg)) return;
      Array.prototype.forEach.call(document.querySelectorAll(pair[1] + ' [data-k="' + k + '"]'), function (b) {
        b.setAttribute('aria-pressed', cfg[k] ? 'true' : 'false');
      });
    });
  }

  function syncVisibility(cfg) {
    var isTile = cfg.floorKind === 'tile' && cfg.hasFloor !== false;
    var isPlank = cfg.floorKind === 'plank' && cfg.hasFloor !== false;
    $('sec-ftile').classList.toggle('hidden', !isTile);
    $('sec-plank').classList.toggle('hidden', !isPlank);
    $('sec-wtile').classList.toggle('hidden', !cfg.hasWallTile);
    $('sec-paint').classList.toggle('hidden', !cfg.hasPaint);
    $('sec-base').classList.toggle('hidden', !cfg.hasBase);
    $('sec-grout').classList.toggle('hidden', !cfg.hasGrout);
    $('q-ceiling').classList.toggle('hidden', !cfg.hasPaint);
  }

  /* 面积类字段：数值以「当前单位²」计（m² / cm² / mm²），切单位时按平方换算 */
  var AREA_KEYS = ['door', 'window', 'ceilingArea'];
  function convertAreaFields(from, to) {
    var ratio = (UNIT_TO_MM[from] / UNIT_TO_MM[to]);
    ratio = ratio * ratio;
    AREA_KEYS.forEach(function (k) {
      var nodes = document.querySelectorAll('[data-k="' + k + '"]');
      Array.prototype.forEach.call(nodes, function (n) {
        if (n.tagName !== 'INPUT') return;
        var v = parseFloat(String(n.value).replace(/[,\s]/g, ''));
        if (!isFinite(v)) return;
        var nv = v * ratio;
        nv = Math.abs(nv) < 1e-9 ? 0 : Math.round(nv * 1e6) / 1e6;
        n.value = String(nv);
      });
    });
  }

  /* floorKind 是三选一 chip：控件用 data-v 表示「这个按钮代表哪个取值」，
   * 所以不能用 setInput（它按「控件值 == 配置值」匹配，对按钮无效）。 */
  function setFloorKindChips(kind) {
    Array.prototype.forEach.call(document.querySelectorAll('#q-floor .chip'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === kind));
    });
  }

  function syncUnitLabels(cfg) {
    var t = LEN_LABEL[cfg.unit] || '米';
    Array.prototype.forEach.call(document.querySelectorAll('[data-unitlen]'), function (n) { n.textContent = t; });
    // 面积类字段的单位标注也跟着走：m² / cm² / mm²
    var A = { m: 'm²', cm: 'cm²', mm: 'mm²' };
    var a = A[cfg.unit] || 'm²';
    Array.prototype.forEach.call(document.querySelectorAll('[data-unitarea]'), function (n) { n.textContent = a; });
    var uSel = document.getElementById('f-unit');
    if (uSel) uSel.setAttribute('data-prev-unit', cfg.unit);
  }

  /* ═══ 渲染 ═══ */
  function render() {
    var cfg = readForm();
    state.cfg = cfg;
    syncBoolChips(cfg);
    syncVisibility(cfg);
    syncUnitLabels(cfg);

    var res = C.compute(cfg);
    state.res = res;

    // 字段标红
    Array.prototype.forEach.call(document.querySelectorAll('[data-k]'), function (n) {
      n.classList.remove('bad');
    });
    var errBox = $('err-box'), warnBox = $('warn-box');
    if (!res.ok) {
      errBox.classList.remove('hidden');
      errBox.textContent = '';
      var h = el('b', null, '这 ' + res.errors.length + ' 个地方得先改一下：');
      errBox.appendChild(h);
      var ul = el('ul');
      var seen = {};
      res.errors.forEach(function (e) {
        if (seen[e.field + e.msg]) return; seen[e.field + e.msg] = 1;
        ul.appendChild(el('li', null, e.msg));
        var nodes = document.querySelectorAll('[data-k="' + e.field + '"]');
        Array.prototype.forEach.call(nodes, function (n) { n.classList.add('bad'); });
      });
      errBox.appendChild(ul);
      $('res-body').classList.add('hidden');
      dock(null);
      warnBox.classList.add('hidden');
      persist();
      return;
    }
    errBox.classList.add('hidden');
    $('res-body').classList.remove('hidden');

    if (res.warn && res.warn.length) {
      warnBox.classList.remove('hidden');
      warnBox.textContent = '';
      warnBox.appendChild(el('b', null, '提醒（不影响计算）：'));
      var wl = el('ul');
      res.warn.forEach(function (w) { wl.appendChild(el('li', null, w.msg)); });
      warnBox.appendChild(wl);
    } else { warnBox.classList.add('hidden'); }

    $('v-title').textContent = res.summary.title;
    $('v-sub').textContent = res.summary.sub;

    // 要点
    var ins = $('ins-list'); ins.textContent = '';
    res.insights.forEach(function (x) {
      var li = el('li');
      li.appendChild(el('b', null, x.title));
      li.appendChild(el('span', null, x.body));
      ins.appendChild(li);
    });
    if (!res.insights.length) ins.appendChild(el('li', null, '当前选择下没有需要提醒的要点。'));

    // 采购清单表
    var tb = $('tbl-buy').querySelector('tbody'); tb.textContent = '';
    res.items.forEach(function (it) {
      var tr = el('tr');
      function td(txt, cls, col) { var c = el('td', cls, txt); if (col) c.setAttribute('data-c', col); return c; }
      tr.appendChild(td(it.name, null, '材料'));
      tr.appendChild(td(it.spec, null, '规格 / 口径'));
      tr.appendChild(td(it.needText, 'num', '理论用量'));
      tr.appendChild(td(it.buyText, 'num', '建议购买'));
      tr.appendChild(td(it.extraPct === null || it.extraPct === undefined ? '—' : C.fmtPct(it.extraPct, 2) + '（' + it.extraLabel + '）', 'num', '多买几成'));
      tr.appendChild(td(it.lossPct === null || it.lossPct === undefined ? '—' : C.fmtPct(it.lossPct, 2), 'num', '切没了'));
      tr.appendChild(td(C.fmtMoney(it.unitPrice) + ' ' + it.priceUnit, 'num', '单价'));
      tr.appendChild(td(C.fmtMoney(it.cost), 'num', '小计'));
      tb.appendChild(tr);
    });
    $('tf-material').textContent = C.fmtMoney(res.totals.materialCost) + ' 元';

    // 勾选清单
    var bl = $('buy-list'); bl.textContent = '';
    res.buyList.forEach(function (b) {
      var li = el('li', state.checks[b.key] ? 'done' : '');
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = !!state.checks[b.key];
      cb.setAttribute('data-buy', b.key);
      cb.addEventListener('change', function () {
        state.checks[b.key] = cb.checked;
        li.className = cb.checked ? 'done' : '';
        persist();
      });
      var mid = el('div');
      mid.appendChild(el('div', 'bn', b.name));
      mid.appendChild(el('div', 'bd', b.buy));
      var cost = el('div', 'bc', C.fmtMoney(b.cost) + ' 元');
      li.appendChild(cb); li.appendChild(mid); li.appendChild(cost);
      bl.appendChild(li);
    });
    if (!res.buyList.length) bl.appendChild(el('li', null, '当前没勾任何材料。把上面的问题改一改。'));

    // 损耗证据
    var ev = $('ev-list'); ev.textContent = '';
    res.evidence.forEach(function (e) {
      var li = el('li');
      li.appendChild(el('b', null, e.name + '：'));
      li.appendChild(document.createTextNode(e.text));
      ev.appendChild(li);
    });

    // 合计表
    var tt = $('tbl-totals').querySelector('tbody'); tt.textContent = '';
    function totRow(name, val, note) {
      var tr = el('tr');
      var c1 = el('td', null, name); c1.setAttribute('data-c', '项');
      var c2 = el('td', 'num', C.fmtMoney(val)); c2.setAttribute('data-c', '金额');
      var c3 = el('td', null, note); c3.setAttribute('data-c', '说明');
      tr.appendChild(c1); tr.appendChild(c2); tr.appendChild(c3); tt.appendChild(tr);
    }
    totRow('材料小计', res.totals.materialCost, res.totals.itemCount + ' 样，整件买（整块/整箱/整桶/整包/整根/整管）之后的总价');
    totRow('铺贴人工与辅料', res.totals.layCost, (res.tile ? '地面 ' + C.fmtNum(res.geo.floorAreaM2, 3) + ' m² × ' + C.fmtMoney(state.res.cfg.layPrice) + ' 元/m²' : '未算地面砖') + (res.wall ? '；墙砖 ' + C.fmtNum(res.wall.wallTileAreaM2, 3) + ' m²' : ''));
    totRow('合计', res.totals.totalCost, '铺贴面积 ' + C.fmtNum(res.totals.coverAreaM2, 3) + ' m²，摊到每平米 ' + C.fmtMoney(res.totals.moneyPerM2) + ' 元');

    // 建议
    var al = $('adv-list'); al.textContent = '';
    if (!res.advice.length) al.appendChild(el('p', 'hint', '当前配置下没有能明显少花钱或更稳的单项改动。'));
    res.advice.forEach(function (a) {
      var box = el('div', 'adv');
      box.appendChild(el('b', null, a.title));
      box.appendChild(el('p', null, a.body));
      var btn = el('button', 'sm pri', '采用：' + Object.keys(a.patch).map(function (k) {
        var v = a.patch[k];
        if (typeof v === 'boolean') return (v ? '打开' : '关闭') + ' ' + k;
        return k + ' = ' + v;
      }).join('、'));
      btn.addEventListener('click', function () {
        Object.keys(a.patch).forEach(function (k) { state.cfg[k] = a.patch[k]; setInput(k, a.patch[k]); });
        render();
      });
      box.appendChild(btn);
      al.appendChild(box);
    });

    // 自检
    var cl = $('chk-list'); cl.textContent = '';
    var okN = 0;
    res.selfChecks.forEach(function (s) {
      if (s.ok) okN++;
      var d = el('div');
      var mark = el('span', s.ok ? 'ok' : 'no', s.ok ? '✓ ' : '✗ ');
      d.appendChild(mark);
      d.appendChild(document.createTextNode(s.name + (s.detail ? '（' + s.detail + '）' : '')));
      cl.appendChild(d);
    });
    var sum = el('div');
    sum.appendChild(el('b', null, '自检 ' + okN + '/' + res.selfChecks.length + ' 通过'));
    cl.insertBefore(sum, cl.firstChild);

    // 分步算式
    var st = $('tbl-steps').querySelector('tbody'); st.textContent = '';
    res.items.forEach(function (it) {
      var tr = el('tr');
      var c1 = el('td', null, it.name); c1.setAttribute('data-c', '材料');
      var c2 = el('td', 'mono', it.formula); c2.setAttribute('data-c', '算式');
      tr.appendChild(c1); tr.appendChild(c2); st.appendChild(tr);
    });

    dock(res);
    persist();
  }

  function dock(res) {
    if (!res || !res.ok) {
      $('d-count').textContent = '—'; $('d-money').textContent = '—'; $('d-perm2').textContent = '—';
      return;
    }
    $('d-count').textContent = res.totals.itemCount + ' 样';
    $('d-money').textContent = C.fmtMoney(res.totals.materialCost);
    $('d-perm2').textContent = res.totals.moneyPerM2 === null ? '—' : C.fmtMoney(res.totals.moneyPerM2);
  }

  /* ═══ 导出 ═══ */
  function stamp() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1200);
    window.__exports++;
  }

  function csvText() {
    var r = state.res, L = [];
    L.push('项目,' + JSON.stringify(r.cfg.label || ''));
    L.push('导出时间,' + stamp());
    L.push('');
    L.push('# 采购清单');
    L.push('材料,规格口径,理论用量,建议购买,多买几成%,切没了%,单价,单价单位,小计元,算式');
    r.items.forEach(function (i) {
      L.push([i.name, i.spec, i.needText, i.buyText,
        i.extraPct === null ? '' : C.fmtNum(i.extraPct, 4),
        i.lossPct === null ? '' : C.fmtNum(i.lossPct, 4),
        C.fmtNum(i.unitPrice, 4), i.priceUnit, C.fmtNum(i.cost, 2), i.formula].map(function (x) { return '"' + String(x).replace(/"/g, '""') + '"'; }).join(','));
    });
    L.push('');
    L.push('# 合计');
    L.push('材料小计元,' + C.fmtNum(r.totals.materialCost, 2));
    L.push('铺贴人工辅料元,' + C.fmtNum(r.totals.layCost, 2));
    L.push('合计元,' + C.fmtNum(r.totals.totalCost, 2));
    L.push('铺贴面积m2,' + C.fmtNum(r.totals.coverAreaM2, 4));
    L.push('每平米元,' + (r.totals.moneyPerM2 === null ? '' : C.fmtNum(r.totals.moneyPerM2, 2)));
    L.push('');
    L.push('# 关键读数');
    L.push('房间长m,' + r.cfg.roomL) ; L.push('房间宽m,' + r.cfg.roomW);
    L.push('地面面积m2,' + C.fmtNum(r.geo.floorAreaM2, 4));
    L.push('墙面面积m2,' + C.fmtNum(r.geo.wallAreaM2, 4));
    L.push('可刷面积m2,' + C.fmtNum(r.geo.paintAreaM2, 4));
    if (r.tile) {
      L.push('瓷砖每方向片数,' + r.tile.nx + 'x' + r.tile.ny);
      L.push('瓷砖网格片数,' + r.tile.gridCount);
      L.push('瓷砖整砖片数,' + r.tile.wholeCount);
      L.push('瓷砖切砖片数,' + r.tile.cutCount);
      L.push('瓷砖横切剩余mm,' + C.fmtNum(r.tile.rx, 2));
      L.push('瓷砖纵切剩余mm,' + C.fmtNum(r.tile.ry, 2));
      L.push('瓷砖切没了的片数,' + C.fmtNum(r.tile.discardTiles, 4));
      L.push('瓷砖可复用边角料m2,' + C.fmtNum(r.tile.reuseArea, 6));
    }
    L.push('');
    L.push('# 自检');
    r.selfChecks.forEach(function (s) { L.push([s.ok ? 'PASS' : 'FAIL', s.name, s.detail].map(function (x) { return '"' + String(x).replace(/"/g, '""') + '"'; }).join(',')); });
    L.push('');
    L.push('# 边界');
    L.push('本页为估算；不联网、不查行情价、不内置施工规范；默认值为虚构示例。');
    return L.join('\n');
  }

  function mdText() {
    var r = state.res, L = [];
    L.push('# ' + (r.cfg.label || '装修材料采购量') + ' · 要买多少');
    L.push('');
    L.push('> 导出时间 ' + stamp() + '；本页为估算，不联网、不查行情价、不内置施工规范；默认值为虚构示例。');
    L.push('');
    L.push('**' + r.summary.title + '**');
    L.push('');
    L.push(r.summary.sub);
    L.push('');
    L.push('## 最要紧的几条');
    r.insights.forEach(function (x) { L.push('- **' + x.title + '** —— ' + x.body); });
    L.push('');
    L.push('## 采购清单');
    L.push('| 材料 | 规格 / 口径 | 理论用量 | 建议购买 | 多买几成 | 切没了 | 单价 | 小计 |');
    L.push('|---|---|---|---|---|---|---|---|');
    r.items.forEach(function (i) {
      L.push('| ' + i.name + ' | ' + i.spec + ' | ' + i.needText + ' | ' + i.buyText + ' | ' +
        (i.extraPct === null ? '—' : C.fmtPct(i.extraPct, 2)) + ' | ' +
        (i.lossPct === null ? '—' : C.fmtPct(i.lossPct, 2)) + ' | ' +
        C.fmtMoney(i.unitPrice) + ' ' + i.priceUnit + ' | ' + C.fmtMoney(i.cost) + ' |');
    });
    L.push('');
    L.push('材料小计 **' + C.fmtMoney(r.totals.materialCost) + ' 元**；铺贴人工辅料 ' + C.fmtMoney(r.totals.layCost) +
      ' 元；合计 **' + C.fmtMoney(r.totals.totalCost) + ' 元**，按 ' + C.fmtNum(r.totals.coverAreaM2, 3) + ' m² 摊每平米 ' +
      C.fmtMoney(r.totals.moneyPerM2) + ' 元。');
    L.push('');
    L.push('## 损耗和余量是从哪来的');
    r.evidence.forEach(function (e) { L.push('- **' + e.name + '**：' + e.text); });
    L.push('');
    L.push('## 每一步怎么来的');
    r.items.forEach(function (i) { L.push('- `' + i.name + '`：' + i.formula); });
    L.push('');
    L.push('## 算式自检（' + r.selfChecks.filter(function (s) { return s.ok; }).length + '/' + r.selfChecks.length + ' 通过）');
    r.selfChecks.forEach(function (s) { L.push('- ' + (s.ok ? '✓' : '✗') + ' ' + s.name + (s.detail ? '（' + s.detail + '）' : '')); });
    return L.join('\n');
  }

  function jsonText() {
    var r = state.res;
    return JSON.stringify({
      app: '买多了退不掉', slug: 'material-pick', version: '1.0.0',
      exported_at: new Date().toISOString(),
      cfg: r.cfg, checks: state.checks,
      geo: r.geo, items: r.items, tile: r.tile || null, wall: r.wall || null, plank: r.plank || null,
      paint: r.paint || null, base: r.base || null, grout: r.grout || null,
      totals: r.totals, insights: r.insights, advice: r.advice, evidence: r.evidence,
      selfChecks: r.selfChecks
    }, null, 2);
  }

  /* ═══ 结果卡 PNG（1080×1350） ═══ */
  function drawCard() {
    var r = state.res;
    var W = 1080, H = 1350, dpr = 1;
    var cv = document.createElement('canvas');
    cv.width = W * dpr; cv.height = H * dpr;
    var g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = '#f6f5f2'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff'; g.fillRect(28, 28, W - 56, H - 56);
    g.strokeStyle = '#e6e2db'; g.lineWidth = 2; g.strokeRect(28, 28, W - 56, H - 56);

    var FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
    function setFont(px, weight) { g.font = (weight || 400) + ' ' + px + 'px ' + FONT; }
    /* 中英混排时给「拉丁字母/数字/运算符」与汉字之间补一个细空格，
     * 否则 '8.6 L，整桶买 2 桶' 这类会被 measureText 挤成难看的空档。 */
    function spaceCJK(t) {
      return String(t)
        .replace(/([\u4e00-\u9fa5])([A-Za-z0-9(\u00d7\u00f7=+\-\/])/g, '$1 $2')
        .replace(/([A-Za-z0-9)%\u00b2])([\u4e00-\u9fa5])/g, '$1 $2');
    }
    function wrap(text, x, y, maxW, lh, maxLines) {
      var t = spaceCJK(String(text === null || text === undefined ? '' : text));
      var line = '', lines = [];
      for (var i = 0; i < t.length; i++) {
        var test = line + t[i];
        if (g.measureText(test).width > maxW && line) { lines.push(line); line = t[i]; }
        else line = test;
        if (maxLines && lines.length >= maxLines) break;
      }
      if (line && (!maxLines || lines.length < maxLines)) lines.push(line);
      if (maxLines && lines.length >= maxLines) {
        var last = lines[lines.length - 1];
        while (last.length > 1 && g.measureText(last + '…').width > maxW) last = last.slice(0, -1);
        lines[lines.length - 1] = last + '…';
      }
      lines.forEach(function (l, i) { g.fillText(l, x, y + i * lh); });
      return y + lines.length * lh;
    }

    var x = 70, maxW = W - 140, y = 108;
    g.fillStyle = '#9a5b12'; setFont(24, 700); g.fillText('买多了退不掉', x, y);
    g.fillStyle = '#867f76'; setFont(20, 400); g.textAlign = 'right';
    g.fillText('material-pick · 虚构示例', W - 70, y); g.textAlign = 'left';
    y += 26;
    g.strokeStyle = '#e6e2db'; g.beginPath(); g.moveTo(x, y); g.lineTo(W - 70, y); g.stroke();
    y += 52;

    g.fillStyle = '#1a1712'; setFont(40, 700);
    y = wrap(r.summary.title, x, y, maxW, 52, 2) + 6;
    g.fillStyle = '#565049'; setFont(23, 400);
    y = wrap(r.summary.sub, x, y, maxW, 34, 2) + 26;

    g.fillStyle = '#9a5b12'; setFont(22, 700); g.fillText('要买的东西', x, y); y += 34;
    g.fillStyle = '#1a1712';
    r.buyList.slice(0, 6).forEach(function (b) {
      setFont(25, 600);
      g.fillText('· ' + b.name, x, y);
      g.fillStyle = '#565049'; setFont(22, 400);
      var t = b.buy + '（' + C.fmtMoney(b.cost) + ' 元）';
      if (g.measureText(t).width > maxW - 250) { while (t.length > 4 && g.measureText(t + '…').width > maxW - 250) t = t.slice(0, -1); t += '…'; }
      g.fillText(t, x + 250, y);
      g.fillStyle = '#1a1712';
      y += 36;
    });
    y += 18;

    g.fillStyle = '#9a5b12'; setFont(22, 700); g.fillText('为什么不是「面积 ÷ 砖面积」', x, y); y += 34;
    g.fillStyle = '#1a1712';
    if (r.tile) {
      setFont(23, 400);
      y = wrap('地面砖网格 ' + r.tile.nx + '×' + r.tile.ny + '=' + r.tile.gridCount + ' 块（' + r.tile.wholeCount +
        ' 块整砖 + ' + r.tile.cutCount + ' 块要切），边界切剩 ' + C.fmtNum(r.tile.rx, 0) + '/' + C.fmtNum(r.tile.ry, 0) +
        ' mm，切没了约 ' + C.fmtNum(r.tile.discardTiles, 1) + ' 块，所以买 ' + r.tile.buyTiles + ' 块。', x, y, maxW, 33, 3) + 12;
    }
    if (r.plank) {
      setFont(23, 400);
      y = wrap('地板要 ' + C.fmtNum(r.plank.needArea, 2) + ' m²（' + r.plank.needPieces + ' 片），每箱 ' + r.cfg.perBox +
        ' 片只能整箱买，所以 ' + r.plank.boxesBuy + ' 箱，多 ' + r.plank.sparePieces + ' 片。', x, y, maxW, 33, 3) + 12;
    }
    if (r.paint) {
      setFont(23, 400);
      y = wrap('乳胶漆可刷 ' + C.fmtNum(r.geo.paintAreaM2, 1) + ' m² × ' + r.cfg.coats + ' 遍 ÷ 每遍每升 ' +
        C.fmtNum(r.cfg.paintCoverage, 0) + ' m² = ' + C.fmtNum(r.paint.liters, 1) + ' L，整桶买 ' + r.paint.packs + ' 桶。', x, y, maxW, 33, 3) + 12;
    }
    if (r.base) {
      setFont(23, 400);
      y = wrap('踢脚线 ' + C.fmtNum(r.base.needLen, 1) + ' 米，按每根\u00a0' + C.fmtNum(r.cfg.baseLen, 2) + '\u00a0米买 ' + r.base.pieces + ' 根。', x, y, maxW, 33, 2) + 12;
    }
    y += 20;

    /* 补一段「用掉多少 / 买多少」的对照表，把中间那段空白填成有用的东西 */
    g.fillStyle = '#9a5b12'; setFont(22, 700); g.fillText('用掉多少 vs 买多少', x, y); y += 36;
    setFont(21, 400);
    var lines = [];
    lines.push('地面砖：网格要摆满 ' + r.tile.gridCount + ' 块 → 实际买 ' + r.tile.buyTiles + ' 块（多 ' + C.fmtNum(r.tile.extraPct, 2) + '%）');
    if (r.plank) lines.push('地板：需要 ' + r.plank.needPieces + ' 片 → 整箱买 ' + r.plank.piecesBought + ' 片（多 ' + r.plank.sparePieces + ' 片）');
    if (r.paint) lines.push('乳胶漆：用 ' + C.fmtNum(r.paint.liters, 2) + ' L → 整桶买 ' + C.fmtNum(r.paint.boughtL, 2) + ' L（' + r.paint.packs + ' 桶）');
    if (r.base) lines.push('踢脚线：要 ' + C.fmtNum(r.base.needLen, 2) + ' 米 → 买 ' + C.fmtNum(r.base.boughtLen, 2) + ' 米（' + r.base.pieces + ' 根）');
    if (r.grout) lines.push('美缝剂：缝长 ' + C.fmtNum(r.grout.jointLen, 1) + ' 米 → 买 ' + C.fmtNum(r.grout.tubes * r.grout.perTube, 1) + ' 米（' + r.grout.tubes + ' 管）');
    g.fillStyle = '#1a1712';
    lines.slice(0, 5).forEach(function (t) { g.fillText('· ' + t, x, y); y += 32; });
    y += 14;

    g.fillStyle = '#9a5b12'; setFont(22, 700); g.fillText('合计', x, y); y += 36;
    g.fillStyle = '#1a1712'; setFont(34, 700);
    g.fillText(C.fmtMoney(r.totals.totalCost) + ' 元', x, y);
    g.fillStyle = '#565049'; setFont(21, 400);
    g.fillText('材料 ' + C.fmtMoney(r.totals.materialCost) + ' + 铺贴 ' + C.fmtMoney(r.totals.layCost) +
      '，按 ' + C.fmtNum(r.totals.coverAreaM2, 1) + ' m² 摊每平米 ' + C.fmtMoney(r.totals.moneyPerM2) + ' 元', x + 260, y);
    y += 30;

    var by = H - 116;
    g.strokeStyle = '#e6e2db'; g.beginPath(); g.moveTo(x, by - 26); g.lineTo(W - 70, by - 26); g.stroke();
    g.fillStyle = '#867f76'; setFont(19, 400);
    wrap('估算，不是施工报价；不联网、不查行情价、不评价品牌商家。默认数据为虚构示例。自检 ' +
      r.selfChecks.filter(function (s) { return s.ok; }).length + '/' + r.selfChecks.length + ' 通过。', x, by, maxW, 27, 2);

    return cv;
  }

  function exportPng() {
    var cv = drawCard();
    cv.toBlob(function (b) {
      var url = URL.createObjectURL(b);
      var a = document.createElement('a');
      a.href = url; a.download = '买多了退不掉-结果卡-1080x1350.png';
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
      window.__exports++;
    }, 'image/png');
  }

  /* ═══ 场景 ═══ */
  function buildScenarios() {
    var box = $('scenarios'); box.textContent = '';
    C.SCENARIOS.forEach(function (s) {
      var b = el('button', null, s.name);
      b.setAttribute('data-sc', s.id);
      b.title = s.note;
      b.setAttribute('aria-pressed', String(state.scenario === s.id));
      b.addEventListener('click', function () {
        state.scenario = s.id;
        state.checks = {};
        var cfg = C.normCfg(Object.assign({}, C.DEFAULTS, s.patch));
        state.cfg = cfg;
        applyCfgToForm(cfg);
        Array.prototype.forEach.call(box.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-sc') === s.id)); });
        render();
      });
      box.appendChild(b);
    });
  }

  function applyCfgToForm(cfg) {
    var safe = C.normCfg(cfg);
    if (['tile', 'plank', 'none'].indexOf(safe.floorKind) < 0) safe.floorKind = safe.hasFloor === false ? 'none' : 'tile';
    safe.hasFloor = (safe.floorKind === 'tile' || safe.floorKind === 'plank');
    Object.keys(safe).forEach(function (k) { setInput(k, safe[k]); });
    setFloorKindChips(safe.floorKind);   // 按钮类控件要单独设
    // 布尔 select / chip 特殊处理
    setInput('layLong', safe.layLong);
    state.cfg = safe;
  }

  /* ═══ 初始化 ═══ */
  function init() {
    collectInputs();
    buildScenarios();

    var saved = loadLocal();
    if (saved && saved.cfg) {
      state.checks = saved.checks || {};
      state.scenario = saved.scenario || 'default';
      applyCfgToForm(saved.cfg);
      Array.prototype.forEach.call($('scenarios').querySelectorAll('button'), function (x) {
        x.setAttribute('aria-pressed', String(x.getAttribute('data-sc') === state.scenario));
      });
    } else {
      applyCfgToForm(freshCfg());
    }

    // 输入事件
    Array.prototype.forEach.call(document.querySelectorAll('[data-k]'), function (n) {
      if (n.tagName === 'BUTTON') {
        n.addEventListener('click', function () {
          var k = n.getAttribute('data-k'), v = n.getAttribute('data-v');
          if (k === 'floorKind') {
            state.cfg.floorKind = v;                       // 'tile' | 'plank' | 'none'
            state.cfg.hasFloor = (v === 'tile' || v === 'plank');
          } else {
            var cur = n.getAttribute('aria-pressed') === 'true';
            state.cfg[k] = !cur;
            // 「要贴墙砖 / 不贴」这类成对按钮：点哪个就是哪个
            if (n.parentNode && n.parentNode.querySelectorAll('[data-k="' + k + '"]').length > 1) state.cfg[k] = (v === '1');
          }
          applyCfgToForm(state.cfg);
          render();
        });
      } else if (n.tagName === 'INPUT' && n.type === 'file') {
        /* 由下面的 import 逻辑处理 */
      } else {
        var evName = (n.tagName === 'SELECT') ? 'change' : 'input';
        n.addEventListener(evName, function (ev) {
          // 切长度单位时，把「面积类」字段（门窗、天花板）一起换算，否则几何关系会被弄坏
          if (ev && ev.target && ev.target.getAttribute('data-k') === 'unit') {
            var from = ev.target.getAttribute('data-prev-unit') || 'm';
            var to = ev.target.value;
            convertAreaFields(from, to);
            ev.target.setAttribute('data-prev-unit', to);
          }
          render();
        });
      }
    });

    $('btn-reset').addEventListener('click', function () {
      state.checks = {}; state.scenario = 'default';
      applyCfgToForm(freshCfg());
      Array.prototype.forEach.call($('scenarios').querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-sc') === 'default')); });
      render();
    });
    $('btn-save').addEventListener('click', function () { persist(); flash($('btn-save'), '已存在本机'); });
    $('btn-csv').addEventListener('click', function () { download('买多了退不掉-采购清单.csv', '\ufeff' + csvText(), 'text/csv;charset=utf-8'); });
    $('btn-md').addEventListener('click', function () { download('买多了退不掉-说明.md', mdText(), 'text/markdown;charset=utf-8'); });
    $('btn-json').addEventListener('click', function () { download('买多了退不掉-备份.json', jsonText(), 'application/json;charset=utf-8'); });
    $('btn-png').addEventListener('click', exportPng);

    $('btn-import').addEventListener('click', function () { $('file-import').click(); });
    $('file-import').addEventListener('change', function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var o = JSON.parse(String(fr.result));
          if (o && o.cfg) {
            state.checks = o.checks || {};
            applyCfgToForm(o.cfg);
            render();
            flash($('btn-import'), '已恢复');
          } else { flash($('btn-import'), '文件里没有 cfg'); }
        } catch (e) { flash($('btn-import'), '不是合法的 JSON'); }
        ev.target.value = '';
      };
      fr.readAsText(f);
    });

    render();
  }

  function flash(btn, msg) {
    var old = btn.textContent;
    btn.textContent = msg;
    setTimeout(function () { btn.textContent = old; }, 1100);
  }

  window.__app = { render: render, state: state, readForm: readForm, applyCfgToForm: applyCfgToForm, csvText: csvText, mdText: mdText, jsonText: jsonText, drawCard: drawCard };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
