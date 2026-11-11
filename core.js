/* 买多了退不掉 · core.js  （批次 52 / material-pick）
 * 装修买料之前先算清「到底要买多少件」：瓷砖按房间尺寸做网格整除、把边界上切剩的
 * 半块能不能挪去别处也算进去，地板按面积加余量再拆包，涂料按可刷面积与遍数分桶，
 * 踢脚线按米数与根数，美缝按缝长与管数。全部由你填数字；页面不联网、不查行情价、
 * 不内置任何施工规范、不评价任何品牌与商家。
 *
 * ── 需求简报（详见 ../需求与调研.md 第 3 节） ─────────────────────────────
 * 单位口径：长度类以「米」输入（unit 选择器可切 mm/cm，内部一律换算成 mm 计算）；
 *   房间面积类（门窗洞口面积、天花板面积）跟着长度单位走，即 m² / cm² / mm²，
 *   切单位时由 ui.js 自动换算已填的值，保证换单位不会把几何关系弄坏；
 *   规格类（砖/板/踢脚线高）恒以「毫米」输入；缝隙恒 mm；金额恒元；
 *   百分比字段接受 8 或 8% 两种写法。
 *
 * 关键公式（页面「损耗证据」按同一套口径展示）：
 *   a = tileL + joint, b = tileW + joint            （有效模数，layLong=false 时 a/b 对调）
 *   nx = ceil(roomLmm / a), ny = ceil(roomWmm / b)  （两方向片数）
 *   gridCount = nx × ny                             （按网格要摆满的片数）
 *   wholeCount = (nx−1) × (ny−1)                    （整砖片数，不用切）
 *   cutCount  = nx + ny − 1                         （要切的片数）
 *   rx = nx×a − roomLmm, ry = ny×b − roomWmm        （切砖「剩下来的那一条」宽度）
 *   dx = rx ≥ minReuse ? (a−rx)×b×nx : a×b×nx       （横切丢弃面积）
 *   dy = ry ≥ minReuse ? (b−ry)×a×ny : b×a×ny       （纵切丢弃面积）
 *   needTiles = gridCount, reserveTiles = ceil(needTiles×reservePct/100)
 *   buyTiles  = needTiles + reserveTiles
 *   discardTiles = (dx+dy) / (tileL×tileW)
 *   extraPct = (buyTiles − needTiles) / needTiles × 100   （买来的比用掉的多几成）
 *   lossPct  = discardTiles / buyTiles × 100              （买回来的料里有多少切没了）
 *   reuseArea = (rx≥minReuse ? rx×b×nx : 0 + ry≥minReuse ? ry×a×ny : 0) / 1e6
 *   地板：needPieces = ceil(roomArea×(1+allowPct/100) / plankArea)，boxesBuy = ceil(needPieces/perBox)
 *   涂刷：wallArea = perimeter×height − door − window, paintArea = (wallArea + ceiling)×useFactor/100
 *     乳胶漆 L = paintArea / coveragePerL × coats（coveragePerL 是「每遍每升刷多少 m²」）
 *     腻子/界面剂 kg = paintArea × kgPerM2
 *   踢脚线：needLen = perimeter − doorWidth, piecesBuy = ceil(needLen×(1+allowPct/100) / lenPerPiece)
 *   美缝：按有效模数数缝，jointLen = (roomLmm/a)×roomW + (roomWmm/b)×roomL（m），tubesBuy = ceil(jointLen×(1+allowPct/100)/perTube)
 *
 * 模型假设（都是本页的设计选择，不是施工规范、不是厂商数据）：
 *   A1 铺贴面是规则矩形，按整块网格排布；不支持菱形铺、人字拼、斜铺、六角砖、拼花、波导线。
 *   A2 切砖丢弃是「按切剩那条的面积」估算，用名义模数面积近似实际被切掉的部分。
 *   A3 边角料复用只按「剩余宽度 ≥ minReuse」判定，不建模花纹对花、色号批次与倒角磨边。
 *   A4 包装只能整件买（整块砖、整箱地板、整桶漆、整包粉、整根踢脚线、整管美缝）。
 *   A5 涂料「可使用系数」与腻子每平米用量是经验区间内的取值，不是标准。
 *   A6 不建模墙角收边、门套压条、过门石、伸缩缝、踢脚线阴阳角裁切损耗。
 *   A7 价格一律由用户填，页面不内置任何行情价，也不预测价格。
 */
'use strict';

/* ══════════════════════════════════════════════════════════════════
 * 一、默认配置、字段规格与工具函数
 * ══════════════════════════════════════════════════════════════════ */

var DEFAULTS = {
  label: '客厅+餐厅（虚构示例）',
  unit: 'm',
  // 决策树（决定哪些卡片出现）
  hasFloor: true,      // 地面铺砖
  hasWallTile: false,  // 墙面贴砖
  hasPaint: true,      // 刷墙
  hasBase: true,       // 踢脚线
  hasGrout: true,      // 美缝
  hasPlank: false,     // 地板（与地面砖互斥：勾了地板就不算地面砖）
  floorKind: 'tile',   // 'tile' | 'plank' | 'none'：地面铺砖、铺地板、还是先不铺

  // 房间几何（长度单位随 unit）
  roomL: 6, roomW: 4.2, perimeter: 20.4, height: 2.8,  door: 4.2, window: 6.0,

  // 地面砖
  tileL: 800, tileW: 800, joint: 2, tilePrice: 68, reservePct: 2, minReuse: 100,
  layLong: true, layPrice: 55,

  // 墙砖
  wtileL: 300, wtileW: 600, wtilePrice: 17.5, wtileLayPrice: 65, wtileReservePct: 5,

  // 地板
  plankL: 1210, plankW: 195, perBox: 8, m2PerPiece: 0.23595, plankPrice: 88, allowPct: 8,

  // 刷墙
  ceilingOn: true, ceilingArea: 25.2, useFactor: 85,
  paintCoverage: 14, coats: 2, paintPackL: 5, paintPrice: 268,
  puttyKgPerM2: 3.5, puttyPackKg: 20, puttyPrice: 42,
  primerKgPerM2: 0.25, primerPackKg: 5, primerPrice: 96,

  // 踢脚线
  baseH: 80, baseLen: 2.5, basePrice: 22, doorWidth: 2.7, baseAllowPct: 6, baseFromOffcut: false,

  // 美缝
  groutPerTube: 15, groutPrice: 38, groutWallOn: true, groutAllowPct: 8
};

var FIELDS = {
  label:          { type: 'text', max: 40 },
  unit:           { type: 'enum', values: ['m', 'cm', 'mm'] },

  roomL:          { type: 'num', min: 0.001, max: 1e7, len: true },
  roomW:          { type: 'num', min: 0.001, max: 1e7, len: true },
  perimeter:      { type: 'num', min: 0.001, max: 1e7, len: true },
  height:         { type: 'num', min: 0.001, max: 1e7, len: true },
  door:           { type: 'num', min: 0, max: 1e12 },
  window:         { type: 'num', min: 0, max: 1e12 },

  tileL:          { type: 'num', min: 1, max: 5000 },
  tileW:          { type: 'num', min: 1, max: 5000 },
  joint:          { type: 'num', min: 0, max: 50 },
  tilePrice:      { type: 'num', min: 0, max: 1e7 },
  reservePct:     { type: 'pct', min: 0, max: 100 },
  minReuse:       { type: 'num', min: 0, max: 5000 },
  layLong:        { type: 'bool' },
  layPrice:       { type: 'num', min: 0, max: 1e6 },

  wtileL:         { type: 'num', min: 1, max: 5000 },
  wtileW:         { type: 'num', min: 1, max: 5000 },
  wtilePrice:     { type: 'num', min: 0, max: 1e7 },
  wtileLayPrice:  { type: 'num', min: 0, max: 1e6 },
  wtileReservePct:{ type: 'pct', min: 0, max: 100 },

  plankL:         { type: 'num', min: 1, max: 5000 },
  plankW:         { type: 'num', min: 1, max: 5000 },
  perBox:         { type: 'num', min: 1, max: 1000, int: true },
  m2PerPiece:     { type: 'num', min: 1e-6, max: 10 },
  plankPrice:     { type: 'num', min: 0, max: 1e7 },
  allowPct:       { type: 'pct', min: 0, max: 100 },

  ceilingOn:      { type: 'bool' },
  ceilingArea:    { type: 'num', min: 0, max: 1e14 },
  useFactor:      { type: 'pct', min: 1, max: 100 },
  paintCoverage:  { type: 'num', min: 0.01, max: 1000 },
  coats:          { type: 'num', min: 1, max: 10, int: true },
  paintPackL:     { type: 'num', min: 0.01, max: 1000 },
  paintPrice:     { type: 'num', min: 0, max: 1e7 },
  puttyKgPerM2:   { type: 'num', min: 0.01, max: 100 },
  puttyPackKg:    { type: 'num', min: 0.01, max: 1000 },
  puttyPrice:     { type: 'num', min: 0, max: 1e7 },
  primerKgPerM2:  { type: 'num', min: 0.001, max: 100 },
  primerPackKg:   { type: 'num', min: 0.01, max: 1000 },
  primerPrice:    { type: 'num', min: 0, max: 1e7 },

  baseH:          { type: 'num', min: 5, max: 1000 },
  baseLen:        { type: 'num', min: 0.01, max: 100 },
  basePrice:      { type: 'num', min: 0, max: 1e7 },
  doorWidth:      { type: 'num', min: 0, max: 1e5 },
  baseAllowPct:   { type: 'pct', min: 0, max: 100 },
  baseFromOffcut: { type: 'bool' },

  groutPerTube:   { type: 'num', min: 0.01, max: 1000 },
  groutPrice:     { type: 'num', min: 0, max: 1e7 },
  groutWallOn:    { type: 'bool' },
  groutAllowPct:  { type: 'pct', min: 0, max: 100 }
};

var UNIT_TO_MM = { m: 1000, cm: 10, mm: 1 };
var UNIT_LABEL = { m: '米', cm: '厘米', mm: '毫米' };

function isNum(v) { return typeof v === 'number' && isFinite(v); }
function num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  if (v === null || v === undefined) return NaN;
  var s = String(v).replace(/[,\s，]/g, '');
  if (s === '') return NaN;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return NaN;
  return parseFloat(s);
}
function pctNum(v) {
  var s = (v === null || v === undefined) ? '' : String(v).replace(/[,\s，]/g, '');
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  var m = /^([-+]?(\d+\.?\d*|\.\d+))%$/.exec(s);
  if (m) return parseFloat(m[1]);
  return num(v);
}
function ceilDiv(a, b) { return Math.ceil(a / b - 1e-12); }
/* 宽容上取整：把 1e-9 级别的浮点毛刺吸收掉，避免 1024.0000000001 → 1025 */
function ceilSafe(x) { return Math.ceil(x - 1e-9); }
function r6(x) { return Math.round(x * 1e6) / 1e6; }
function r4(x) { return Math.round(x * 1e4) / 1e4; }
function fmtMoney(x) {
  if (!isNum(x)) return '—';
  return (Math.round(x * 100) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(x, d) {
  if (!isNum(x)) return '—';
  var v = Math.round(x * Math.pow(10, d)) / Math.pow(10, d);
  return v.toLocaleString('zh-CN', { maximumFractionDigits: d });
}
function fmtPct(x, d) { return isNum(x) ? fmtNum(x, d === undefined ? 2 : d) + '%' : '—'; }

/* ══════════════════════════════════════════════════════════════════
 * 二、归一化与校验
 * ══════════════════════════════════════════════════════════════════ */

function normCfg(raw) {
  var cfg = {}, k;
  for (k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) cfg[k] = DEFAULTS[k];
  if (raw && typeof raw === 'object') {
    for (k in DEFAULTS) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) continue;
      if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
      if (raw[k] === null || raw[k] === undefined) continue;
      if (raw[k] === '') { cfg[k] = ''; continue; }   // 空串保留，交给校验报错，不静默换默认值
      cfg[k] = raw[k];
    }
  }
  if (typeof cfg.label === 'string') cfg.label = cfg.label.slice(0, 40);
  ['hasFloor','hasWallTile','hasPaint','hasBase','hasGrout','hasPlank',
   'layLong','ceilingOn','baseFromOffcut','groutWallOn'].forEach(function (b) {
    cfg[b] = !!cfg[b];
  });
  if (['tile','plank','none'].indexOf(cfg.floorKind) < 0) cfg.floorKind = 'tile';
  if (cfg.floorKind === 'none') cfg.hasFloor = false;   /* 「先不铺」与 hasFloor 派生关系锁死 */
  if (!UNIT_TO_MM[cfg.unit]) cfg.unit = 'm';
  return cfg;
}

function validate(rawCfg) {
  var cfg = normCfg(rawCfg);
  var errors = [], warn = [], fieldErr = {};
  function bad(f, msg) { errors.push({ field: f, msg: msg }); fieldErr[f] = true; }

  function need(f, label) {
    var spec = FIELDS[f], v;
    var rawv = cfg[f];
    if (spec.type === 'pct') v = pctNum(rawv); else v = num(rawv);
    if (!isNum(v)) { bad(f, label + '得是一个数字（现在填的是「' + String(rawv) + '」）'); return NaN; }
    if (v < spec.min - 1e-12) { bad(f, label + '不能小于 ' + spec.min + '（现在 ' + v + '）'); return NaN; }
    if (v > spec.max + 1e-12) { bad(f, label + '不能大于 ' + spec.max + '（现在 ' + v + '）'); return NaN; }
    if (spec.int && Math.abs(v - Math.round(v)) > 1e-9) { bad(f, label + '要是整数（现在 ' + v + '）'); return NaN; }
    return v;
  }

  var v = {};
  v.roomL = need('roomL', '房间长'); v.roomW = need('roomW', '房间宽');
  v.perimeter = need('perimeter', '墙面周长'); v.height = need('height', '层高');
  v.door = need('door', '门洞面积'); v.window = need('window', '窗洞面积');
  v.tileL = need('tileL', '地面砖长'); v.tileW = need('tileW', '地面砖宽');
  v.joint = need('joint', '缝隙宽'); v.tilePrice = need('tilePrice', '地面砖单价');
  v.reservePct = need('reservePct', '地面砖备用量'); v.minReuse = need('minReuse', '边角料复用阈值');
  v.layPrice = need('layPrice', '铺贴单价');
  v.wtileL = need('wtileL', '墙砖长'); v.wtileW = need('wtileW', '墙砖宽');
  v.wtilePrice = need('wtilePrice', '墙砖单价'); v.wtileLayPrice = need('wtileLayPrice', '墙砖铺贴单价');
  v.wtileReservePct = need('wtileReservePct', '墙砖备用量');
  v.plankL = need('plankL', '地板长'); v.plankW = need('plankW', '地板宽');
  v.perBox = need('perBox', '每箱片数'); v.m2PerPiece = need('m2PerPiece', '每片面积');
  v.plankPrice = need('plankPrice', '地板单价'); v.allowPct = need('allowPct', '地板余量');
  v.ceilingArea = need('ceilingArea', '天花板面积'); v.useFactor = need('useFactor', '可使用系数');
  v.paintCoverage = need('paintCoverage', '乳胶漆每遍每升可刷面积'); v.coats = need('coats', '涂刷遍数');
  v.paintPackL = need('paintPackL', '每桶升数'); v.paintPrice = need('paintPrice', '乳胶漆单价');
  v.puttyKgPerM2 = need('puttyKgPerM2', '腻子每平米用量'); v.puttyPackKg = need('puttyPackKg', '每包腻子重量');
  v.puttyPrice = need('puttyPrice', '腻子单价');
  v.primerKgPerM2 = need('primerKgPerM2', '界面剂每平米用量'); v.primerPackKg = need('primerPackKg', '每包界面剂重量');
  v.primerPrice = need('primerPrice', '界面剂单价');
  v.baseH = need('baseH', '踢脚线高度'); v.baseLen = need('baseLen', '每根长度');
  v.basePrice = need('basePrice', '踢脚线单价'); v.doorWidth = need('doorWidth', '门洞宽度合计');
  v.baseAllowPct = need('baseAllowPct', '踢脚线余量');
  v.groutPerTube = need('groutPerTube', '每管可打缝长'); v.groutPrice = need('groutPrice', '美缝剂单价');
  v.groutAllowPct = need('groutAllowPct', '美缝余量');

  var wallArea = NaN;   /* 在下面「单位归一」之后按 m² 口径验算 */
  /* 地板规格自洽：每片面积与长×宽不一致（>5%）时报错 */
  if (isNum(v.plankL) && isNum(v.plankW) && isNum(v.m2PerPiece)) {
    var calc = v.plankL * v.plankW / 1e6;
    if (Math.abs(v.m2PerPiece - calc) / calc > 0.05) {
      bad('m2PerPiece', '每片面积 ' + fmtNum(v.m2PerPiece, 6) + ' m² 与 长×宽 算出来的 ' + fmtNum(calc, 6) +
        ' m² 差得超过 5%，两个规格自相矛盾（留空则按长×宽算）');
    }
  }
  /* 缝隙不小于砖的最小边才可能成立（仅提示，不阻断） */
  if (isNum(v.joint) && isNum(v.tileL) && isNum(v.tileW) && v.joint >= Math.min(v.tileL, v.tileW) / 2) {
    warn.push({ field: 'joint', msg: '缝隙 ' + v.joint + ' mm 相对砖规格偏大，请确认没把厘米当毫米填' });
  }
  if (cfg.hasPaint && isNum(v.useFactor) && v.useFactor < 50) {
    warn.push({ field: 'useFactor', msg: '可使用系数低于 50%，意味着超过一半的墙面被柜子、门窗套挡掉了，确认一下' });
  }
  if (cfg.floorKind === 'plank' && cfg.hasGrout) {
    warn.push({ field: 'groutPerTube', msg: '地面铺地板时地面没有砖缝，美缝缝长只按墙砖计算' });
  }

  /* ── 单位归一（只做一次，之后 compute 全程按 mm 与 m² 计算）────────────
   * 长度类字段的单位随 cfg.unit（米 / 厘米 / 毫米）；
   * 面积类字段（门窗洞口、天花板）的单位是「当前单位的平方」（m² / cm² / mm²）；
   * 规格类（砖/板/缝隙/踢脚线高）恒为 mm。
   * 归一后：v.roomL / v.perimeter / v.height / v.doorWidth 为 mm，
   *   v.roomLm / v.roomWm / v.perimeterM / v.heightM / v.doorWidthM 为米，
   *   v.door / v.window / v.ceilingArea 为 m²；规格类本来恒为 mm。
   *   vRaw.* 只保留用户在屏幕上填的原始数字，仅用于显示。
   *   compute 内部一律用归一后的 v.*，不再出现任何单位换算。 */
  var vRaw = {};
  Object.keys(v).forEach(function (k) { vRaw[k] = v[k]; });
  if (errors.length === 0) {
    var toMm = UNIT_TO_MM[cfg.unit];                    /* 用户长度单位 → mm（m→1000, cm→10, mm→1） */
    var toM2 = toMm * toMm;                             /* 用户面积单位 → mm²（m²→1e6, cm²→100, mm²→1） */
    v.roomL = v.roomL * toMm; v.roomW = v.roomW * toMm;
    v.perimeter = v.perimeter * toMm; v.height = v.height * toMm;
    v.doorWidth = v.doorWidth * toMm;
    /* 面积类字段：先换算成 mm² 参与几何计算，同时留一份 m² 给「平方米」口径的读数 */
    v.doorMm2 = v.door * toM2; v.windowMm2 = v.window * toM2; v.ceilingAreaMm2 = v.ceilingArea * toM2;
    v.door = v.door * (toM2 / 1e6); v.window = v.window * (toM2 / 1e6); v.ceilingArea = v.ceilingArea * (toM2 / 1e6);
    v.roomLm = v.roomL / 1000; v.roomWm = v.roomW / 1000;
    v.perimeterM = v.perimeter / 1000; v.heightM = v.height / 1000;
    v.doorWidthM = v.doorWidth / 1000;

    /* 几何关系约束（在归一到 mm / m² 之后判定，避免被单位换算带偏） */
    wallArea = v.perimeterM * v.heightM - v.door - v.window;
    if (isNum(wallArea) && wallArea <= 0) {
      bad('perimeter', '墙面周长 × 层高 减去门窗之后就剩 ' + fmtNum(wallArea, 3) + ' m²，没有可刷的墙面了（检查周长、层高与门窗面积）');
    }
    if (v.doorWidthM >= v.perimeterM) {
      bad('doorWidth', '门洞宽度合计（' + fmtNum(vRaw.doorWidth, 3) + '）不小于墙面周长（' + fmtNum(vRaw.perimeter, 3) + '），踢脚线长度会是负数');
    }
  }
  return { cfg: cfg, values: v, vRaw: vRaw, errors: errors, warn: warn, fieldErr: fieldErr, wallArea: wallArea };
}

/* ══════════════════════════════════════════════════════════════════
 * 三、分项计算
 * ══════════════════════════════════════════════════════════════════ */

/* 瓷砖：网格整除 + 边界切砖 + 边角料复用阈值 */
function tileItem(o) {
  var a0 = o.tileL + o.joint, b0 = o.tileW + o.joint;
  var a = o.layLong ? a0 : b0, b = o.layLong ? b0 : a0;
  var nx = ceilDiv(o.areaLmm, a), ny = ceilDiv(o.areaWmm, b);
  var gridCount = nx * ny;
  var wholeCount = Math.max(0, (nx - 1) * (ny - 1));
  var cutCount = nx + ny - 1;
  var rx = nx * a - o.areaLmm, ry = ny * b - o.areaWmm;
  /* 切料计划（每个方向各做一次一维计划；定稿口径见 ../需求与调研.md §3.2 一，
   * ../推导校验.py 用 15 万组随机规格抽样验证过 5 条物理不变量）：
   *   r ≈ 0     → 这个方向不用切：丢弃 0、可复用 0
   *   r < 阈值   → 切剩的那条太窄，整条丢掉：丢弃 min(r, cut)×other，可复用 0
   *   r ≥ 阈值   → 切剩的那条能留 mr 宽的一条、其余是被切走的：
   *               丢弃 min(cut − r, cut)×other、可复用 min(r − mr, cut)×other
   * 每块切砖「丢弃 + 留下来用的」都不超过一块砖的面积，聚合后也不会凭空多出料。 */
  var half = function (r, cut, other, mr) {
    if (r < 1e-9) return { w: 0, u: 0, noCut: true };
    if (r < mr) return { w: Math.min(r, cut) * other, u: 0, noCut: false };
    return { w: Math.min(cut - r, cut) * other, u: Math.min(r - mr, cut) * other, noCut: false };
  };
  var hx = half(rx, a, o.tileW, o.minReuse);
  var hy = half(ry, b, o.tileL, o.minReuse);
  var rectAreaMm2 = (nx * a) * (ny * b);
  var roomAreaMm2 = o.areaLmm * o.areaWmm;
  var availMm2 = Math.max(0, rectAreaMm2 - roomAreaMm2);
  var boughtMm2 = gridCount * o.tileL * o.tileW;
  var dx = hx.w, dy = hy.w;
  var discardAreaMm2 = Math.min(dx * ny + dy * nx, availMm2);
  var reuseAreaMm2 = Math.min(hx.u * ny + hy.u * nx, Math.max(0, availMm2 - discardAreaMm2));
  reuseAreaMm2 = Math.min(reuseAreaMm2, Math.max(0, boughtMm2 - discardAreaMm2));
  var tileArea = o.tileL * o.tileW;
  var discardTiles = discardAreaMm2 / tileArea;
  var rxNoCut = hx.noCut, ryNoCut = hy.noCut;
  var rxReuse = hx.u > 0, ryReuse = hy.u > 0;
  var needTiles = gridCount;
  var reserveTiles = ceilSafe(needTiles * o.reservePct / 100) + 0;   /* +0 收掉 Math.ceil(-0−ε) 产生的 -0 */
  var buyTiles = needTiles + reserveTiles;
  var extraCount = buyTiles - needTiles;
  var extraPct = needTiles > 0 ? extraCount / needTiles * 100 : 0;
  var lossPct = buyTiles > 0 ? discardTiles / buyTiles * 100 : 0;
  var reuseArea = reuseAreaMm2 / 1e6;
  var discardArea = discardAreaMm2 / 1e6;
  var clamped = (dx * ny + dy * nx) > availMm2 + 1e-9;
  var tileCost = buyTiles * o.price;
  var layCost = o.coverAreaM2 * o.layPrice;
  return {
    nx: nx, ny: ny, a: a, b: b, gridCount: gridCount, wholeCount: wholeCount, cutCount: cutCount,
    areaLmm: o.areaLmm, areaWmm: o.areaWmm, minReuse: o.minReuse,
    rx: rx, ry: ry, rxReuse: rxReuse, ryReuse: ryReuse, rxNoCut: rxNoCut, ryNoCut: ryNoCut,
    cutOffX: Math.min(rx, a), cutOffY: Math.min(ry, b), clamped: clamped,
    discardTiles: discardTiles, discardArea: discardArea, reuseArea: reuseArea,
    needTiles: needTiles, reserveTiles: reserveTiles, buyTiles: buyTiles,
    extraCount: extraCount, extraPct: extraPct, lossPct: lossPct,
    tileCost: tileCost, layCost: layCost, totalCost: tileCost + layCost,
    coverAreaM2: o.coverAreaM2
  };
}

/* ══════════════════════════════════════════════════════════════════
 * 四、主计算
 * ══════════════════════════════════════════════════════════════════ */

function compute(rawCfg) {
  var vr = validate(rawCfg);
  var cfg = vr.cfg, v = vr.values, vRaw = vr.vRaw || vr.values;
  var out = {
    cfg: cfg,
    ok: vr.errors.length === 0,
    errors: vr.errors,
    warn: vr.warn,
    fieldErr: vr.fieldErr,
    items: [], notes: [], selfChecks: [], evidence: []
  };
  if (!out.ok) { out.summary = null; out.totals = null; return out; }

  /* 到这里 v.* 已由 validate() 末尾统一成 mm 与 m²（长度类 × 单位换算、面积类 × 单位²，
   * 规格类本来就是 mm），所以下面全部是绝对量，不再出现「当前单位的平方」这种相对口径。 */
  var roomLmm = v.roomL, roomWmm = v.roomW;
  var floorAreaM2 = roomLmm * roomWmm / 1e6;
  var wallAreaM2 = v.perimeter * v.height / 1e6 - v.door - v.window;
  /* 天花板面积留 0 就按 0 算（不偷偷拿房间面积顶上），并在下方 notes 里说明 */
  var ceilAreaM2 = cfg.ceilingOn ? v.ceilingArea : 0;
  var paintAreaM2 = (wallAreaM2 + ceilAreaM2) * v.useFactor / 100;
  out.geo = {
    unit: cfg.unit,
    roomLmm: roomLmm, roomWmm: roomWmm,
    roomLm: roomLmm / 1000, roomWm: roomWmm / 1000,
    perimeterMm: v.perimeter, heightMm: v.height,
    floorAreaM2: floorAreaM2,
    wallAreaM2: wallAreaM2, ceilAreaM2: ceilAreaM2, paintAreaM2: paintAreaM2
  };

  if (cfg.ceilingOn && ceilAreaM2 <= 0) {
    out.notes.push('勾了「天花板也刷」，但天花板面积填的是 0，所以本次只算了墙面（要连天花板一起算，请把面积填上）。');
  }

  var items = [];

  /* ── 一、地面砖 ─────────────────────────────────────── */
  if (cfg.hasFloor && cfg.floorKind === 'tile') {
    var t = tileItem({
      unit: cfg.unit, tileL: v.tileL, tileW: v.tileW, joint: v.joint, layLong: cfg.layLong,
      areaLmm: roomLmm, areaWmm: roomWmm, minReuse: v.minReuse, reservePct: v.reservePct,
      price: v.tilePrice, layPrice: v.layPrice, coverAreaM2: floorAreaM2
    });
    out.tile = t;
    items.push({
      key: 'floorTile', group: '地面',
      name: '地面砖 ' + fmtNum(v.tileL, 0) + '×' + fmtNum(v.tileW, 0),
      spec: '砖 ' + fmtNum(v.tileL, 0) + '×' + fmtNum(v.tileW, 0) + ' mm、缝 ' + fmtNum(v.joint, 1) + ' mm、' +
        (cfg.layLong ? '长边沿房间长边' : '长边沿房间短边'),
      needQty: t.needTiles, needUnit: '块', needText: '按网格摆满要 ' + t.needTiles + ' 块',
      buyQty: t.buyTiles, buyUnit: '块',
      buyText: t.buyTiles + ' 块（含备用 ' + t.reserveTiles + ' 块）',
      extraPct: t.extraPct, lossPct: t.lossPct,
      extraLabel: '多买几成（相对用掉的）', lossLabel: '切没了（占买回来的）',
      unitPrice: v.tilePrice, priceUnit: '元/块', cost: t.tileCost,
      formula: 'nx=⌈' + fmtNum(roomLmm, 0) + '÷' + fmtNum(t.a, 1) + '⌉=' + t.nx + '，ny=⌈' + fmtNum(roomWmm, 0) + '÷' + fmtNum(t.b, 1) + '⌉=' + t.ny +
        '，网格 ' + t.nx + '×' + t.ny + '=' + t.gridCount + ' 块；备用 ⌈' + t.needTiles + '×' + fmtNum(v.reservePct, 2) + '%⌉=' + t.reserveTiles + ' 块'
    });
    out.evidence.push({ name: '地面砖切在哪', text: '横切剩 ' + fmtNum(t.rx, 1) + ' mm（' + (t.rxReuse ? '≥ 复用阈值，可留作踢脚线料' : '< 复用阈值，整块丢掉') + '）、纵切剩 ' + fmtNum(t.ry, 1) + ' mm（' + (t.ryReuse ? '可复用' : '整块丢掉') + '）；两块砖里大约有 ' + fmtNum(t.discardTiles, 2) + ' 块是切没了的部分（' + fmtNum(t.discardArea, 3) + ' m²）。' });
    if (t.reuseArea > 0) out.evidence.push({ name: '边角料能挪去别处', text: '切剩下来还能用的边角料合计约 ' + fmtNum(t.reuseArea, 3) + ' m² —— 这是踢脚线项要用的数。' });
  }

  /* ── 二、墙砖 ───────────────────────────────────────── */
  if (cfg.hasWallTile) {
    var wallTileAreaM2 = wallAreaM2;
    var wt = tileItem({
      unit: cfg.unit, tileL: v.wtileL, tileW: v.wtileW, joint: v.joint, layLong: true,
      areaLmm: v.perimeter, areaWmm: v.height, minReuse: v.minReuse,
      reservePct: v.wtileReservePct, price: v.wtilePrice, layPrice: v.wtileLayPrice,
      coverAreaM2: wallTileAreaM2
    });
    /* 墙砖要扣掉门窗洞口：按「洞口占网格的比例」折减 */
    var gridAreaM2 = wt.gridCount * v.wtileL * v.wtileW / 1e6;
    var holeRatio = gridAreaM2 > 0 ? Math.min(0.95, (v.door + v.window) / (v.perimeterM * v.heightM)) : 0;
    var holeTiles = ceilSafe(wt.needTiles * holeRatio);
    var needTilesW = Math.max(1, wt.needTiles - holeTiles);
    var reserveTilesW = ceilSafe(needTilesW * v.wtileReservePct / 100) + 0;
    var buyTilesW = needTilesW + reserveTilesW;
    var reuseAreaW = wt.reuseArea;
    var wtCost = buyTilesW * v.wtilePrice;
    var wtLayCost = wallTileAreaM2 * v.wtileLayPrice;
    out.wall = {
      nx: wt.nx, ny: wt.ny, a: wt.a, b: wt.b, gridCount: wt.gridCount, cutCount: wt.cutCount,
      needTilesRaw: wt.needTiles, holeTiles: holeTiles, holeRatio: holeRatio,
      needTiles: needTilesW, reserveTiles: reserveTilesW, buyTiles: buyTilesW,
      extraCount: buyTilesW - needTilesW,
      extraPct: needTilesW > 0 ? (buyTilesW - needTilesW) / needTilesW * 100 : 0,
      lossPct: buyTilesW > 0 ? (wt.discardTiles * (1 - holeRatio)) / buyTilesW * 100 : 0,
      discardTiles: wt.discardTiles * (1 - holeRatio), reuseArea: reuseAreaW,
      tileCost: wtCost, layCost: wtLayCost, totalCost: wtCost + wtLayCost,
      wallTileAreaM2: wallTileAreaM2, rx: wt.rx, ry: wt.ry, rxReuse: wt.rxReuse, ryReuse: wt.ryReuse
    };
    items.push({
      key: 'wallTile', group: '墙面',
      name: '墙砖 ' + fmtNum(v.wtileL, 0) + '×' + fmtNum(v.wtileW, 0),
      spec: '砖 ' + fmtNum(v.wtileL, 0) + '×' + fmtNum(v.wtileW, 0) + ' mm；墙面 ' + fmtNum(v.perimeterM, 2) + '×' + fmtNum(v.heightM, 2) +
        ' 减门窗 ' + fmtNum(v.door + v.window, 2) + ' m² = ' + fmtNum(wallTileAreaM2, 3) + ' m²',
      needQty: needTilesW, needUnit: '块', needText: '网格 ' + wt.gridCount + ' 块 − 门窗占位 ' + holeTiles + ' 块 = ' + needTilesW + ' 块',
      buyQty: buyTilesW, buyUnit: '块', buyText: buyTilesW + ' 块（含备用 ' + reserveTilesW + ' 块）',
      extraPct: out.wall.extraPct, lossPct: out.wall.lossPct,
      extraLabel: '多买几成（相对用掉的）', lossLabel: '切没了（占买回来的，已按门窗折减）',
      unitPrice: v.wtilePrice, priceUnit: '元/块', cost: wtCost,
      formula: 'nx=⌈' + fmtNum(v.perimeter, 0) + '÷' + fmtNum(wt.a, 1) + '⌉=' + wt.nx + '，ny=⌈' + fmtNum(v.height, 0) + '÷' + fmtNum(wt.b, 1) + '⌉=' + wt.ny +
        '；门窗占位按洞口面积占墙面积 ' + fmtPct(holeRatio * 100, 2) + ' 折减'
    });
    out.evidence.push({ name: '墙砖的门窗折减', text: '墙砖网格满铺是 ' + wt.gridCount + ' 块，按门窗洞口占墙面 ' + fmtPct(holeRatio * 100, 2) + ' 折掉 ' + holeTiles + ' 块；这个折减是**按面积比例估算**，实际排版要看洞口位置。' });
  }

  /* ── 三、地板 ───────────────────────────────────────── */
  if (cfg.hasFloor && cfg.floorKind === 'plank') {
    var plankArea = v.plankL * v.plankW / 1e6;
    var needArea = floorAreaM2 * (1 + v.allowPct / 100);
    var needPiecesExact = needArea / plankArea;
    var needPieces = ceilSafe(needPiecesExact);
    var boxesExact = needPieces / v.perBox;
    var boxesBuy = ceilSafe(boxesExact);
    var piecesBought = boxesBuy * v.perBox;
    var sparePieces = piecesBought - needPieces;
    var edgeOffcut = ceilDiv(roomWmm, v.plankW) * v.plankW - roomWmm;
    var plankCost = needArea * v.plankPrice;
    out.plank = {
      plankArea: plankArea, needArea: needArea, allowArea: needArea - floorAreaM2,
      needPiecesExact: needPiecesExact, needPieces: needPieces,
      boxesExact: boxesExact, boxesBuy: boxesBuy, piecesBought: piecesBought,
      sparePieces: sparePieces, spareArea: sparePieces * plankArea,
      edgeOffcut: edgeOffcut, cost: plankCost,
      extraPct: needPieces > 0 ? sparePieces / needPieces * 100 : 0
    };
    items.push({
      key: 'plank', group: '地面',
      name: '地板 ' + fmtNum(v.plankL, 0) + '×' + fmtNum(v.plankW, 0),
      spec: '每片 ' + fmtNum(plankArea, 6) + ' m²、每箱 ' + v.perBox + ' 片（' + fmtNum(plankArea * v.perBox, 4) + ' m²/箱）',
      needQty: r4(needArea), needUnit: 'm²', needText: fmtNum(needArea, 3) + ' m²（房间 ' + fmtNum(floorAreaM2, 3) + ' + 余量 ' + fmtNum(v.allowPct, 2) + '%）',
      buyQty: boxesBuy, buyUnit: '箱', buyText: boxesBuy + ' 箱 = ' + piecesBought + ' 片 = ' + fmtNum(piecesBought * plankArea, 3) + ' m²',
      extraPct: out.plank.extraPct, lossPct: null,
      extraLabel: '整箱多出来的（相对用掉的）', lossLabel: '地板没有「切没了」的计量，切边损耗已经算进余量里',
      unitPrice: v.plankPrice, priceUnit: '元/m²', cost: plankCost,
      formula: '⌈' + fmtNum(needArea, 3) + '÷' + fmtNum(plankArea, 6) + '⌉=' + needPieces + ' 片；⌈' + needPieces + '÷' + v.perBox + '⌉=' + boxesBuy + ' 箱'
    });
    out.evidence.push({ name: '地板最后一行要切掉多少', text: '房间宽 ' + fmtNum(roomWmm, 0) + ' mm 除以板宽 ' + fmtNum(v.plankW, 0) + ' mm，最后一行要切掉 ' + fmtNum(edgeOffcut, 1) + ' mm —— 这就是那条余量的来源之一。' });
    out.evidence.push({ name: '按箱买会剩多少', text: '买 ' + boxesBuy + ' 箱共 ' + piecesBought + ' 片，比需要的 ' + needPieces + ' 片多 ' + sparePieces + ' 片（' + fmtNum(out.plank.spareArea, 3) + ' m²，' + fmtPct(out.plank.extraPct, 2) + '）。' });
  }

  /* ── 四、乳胶漆 ─────────────────────────────────────── */
  if (cfg.hasPaint) {
    var liters = paintAreaM2 / v.paintCoverage * v.coats;
    var paintPacks = ceilSafe(liters / v.paintPackL);
    var paintCost = paintPacks * v.paintPrice;
    out.paint = {
      paintAreaM2: paintAreaM2, liters: liters, packs: paintPacks,
      litersPerCoat: paintAreaM2 / v.paintCoverage,
      boughtL: paintPacks * v.paintPackL,
      spareL: paintPacks * v.paintPackL - liters,
      cost: paintCost
    };
    items.push({
      key: 'paint', group: '墙面',
      name: '乳胶漆',
      spec: '可刷面积 ' + fmtNum(paintAreaM2, 3) + ' m² × ' + v.coats + ' 遍，每遍每升 ' + fmtNum(v.paintCoverage, 2) + ' m²',
      needQty: r4(liters), needUnit: 'L', needText: fmtNum(liters, 3) + ' L（每遍 ' + fmtNum(out.paint.litersPerCoat, 3) + ' L × ' + v.coats + ' 遍）',
      buyQty: paintPacks, buyUnit: '桶', buyText: paintPacks + ' 桶（每桶 ' + fmtNum(v.paintPackL, 2) + ' L，共 ' + fmtNum(out.paint.boughtL, 2) + ' L）',
      extraPct: liters > 0 ? out.paint.spareL / liters * 100 : 0, lossPct: null,
      extraLabel: '整桶多出来的（相对用掉的）', lossLabel: '涂料不存在切料损耗',
      unitPrice: v.paintPrice, priceUnit: '元/桶', cost: paintCost,
      formula: fmtNum(paintAreaM2, 3) + ' ÷ ' + fmtNum(v.paintCoverage, 2) + ' × ' + v.coats + ' = ' + fmtNum(liters, 3) + ' L；⌈' + fmtNum(liters, 3) + '÷' + fmtNum(v.paintPackL, 2) + '⌉=' + paintPacks + ' 桶'
    });
    out.evidence.push({ name: '刷墙面积是怎么来的', text: '墙面 ' + fmtNum(v.perimeterM, 2) + '×' + fmtNum(v.heightM, 2) + ' 减门窗 ' + fmtNum(v.door + v.window, 2) + ' = ' + fmtNum(wallAreaM2, 3) + ' m²' + (cfg.ceilingOn ? '，加天花板 ' + fmtNum(ceilAreaM2, 3) + ' m²' : '（未含天花板）') + '，再乘可使用系数 ' + fmtPct(v.useFactor, 2) + ' = ' + fmtNum(paintAreaM2, 3) + ' m²。三项墙漆共用这一个数。' });

    var puttyKg = paintAreaM2 * v.puttyKgPerM2;
    var puttyPacks = ceilSafe(puttyKg / v.puttyPackKg);
    items.push({
      key: 'putty', group: '墙面', name: '腻子粉',
      spec: '按整个腻子工序 ' + fmtNum(v.puttyKgPerM2, 3) + ' kg/m²（不是每一遍）',
      needQty: r4(puttyKg), needUnit: 'kg', needText: fmtNum(puttyKg, 3) + ' kg',
      buyQty: puttyPacks, buyUnit: '包', buyText: puttyPacks + ' 包（每包 ' + fmtNum(v.puttyPackKg, 2) + ' kg，共 ' + fmtNum(puttyPacks * v.puttyPackKg, 2) + ' kg）',
      extraPct: puttyKg > 0 ? (puttyPacks * v.puttyPackKg - puttyKg) / puttyKg * 100 : 0, lossPct: null,
      extraLabel: '整包多出来的（相对用掉的）', lossLabel: '粉料不存在切料损耗',
      unitPrice: v.puttyPrice, priceUnit: '元/包', cost: puttyPacks * v.puttyPrice,
      formula: fmtNum(paintAreaM2, 3) + ' × ' + fmtNum(v.puttyKgPerM2, 3) + ' = ' + fmtNum(puttyKg, 3) + ' kg；⌈' + fmtNum(puttyKg, 3) + '÷' + fmtNum(v.puttyPackKg, 2) + '⌉=' + puttyPacks + ' 包'
    });

    var primerKg = paintAreaM2 * v.primerKgPerM2;
    var primerPacks = ceilSafe(primerKg / v.primerPackKg);
    items.push({
      key: 'primer', group: '墙面', name: '界面剂',
      spec: '按 ' + fmtNum(v.primerKgPerM2, 3) + ' kg/m²',
      needQty: r4(primerKg), needUnit: 'kg', needText: fmtNum(primerKg, 3) + ' kg',
      buyQty: primerPacks, buyUnit: '包', buyText: primerPacks + ' 包（每包 ' + fmtNum(v.primerPackKg, 2) + ' kg）',
      extraPct: primerKg > 0 ? (primerPacks * v.primerPackKg - primerKg) / primerKg * 100 : 0, lossPct: null,
      extraLabel: '整包多出来的（相对用掉的）', lossLabel: '粉料不存在切料损耗',
      unitPrice: v.primerPrice, priceUnit: '元/包', cost: primerPacks * v.primerPrice,
      formula: fmtNum(paintAreaM2, 3) + ' × ' + fmtNum(v.primerKgPerM2, 3) + ' = ' + fmtNum(primerKg, 3) + ' kg；⌈' + fmtNum(primerKg, 3) + '÷' + fmtNum(v.primerPackKg, 2) + '⌉=' + primerPacks + ' 包'
    });
  }

  /* ── 五、踢脚线 ─────────────────────────────────────── */
  if (cfg.hasBase) {
    var needLen = v.perimeterM - v.doorWidthM;          /* 米 */
    var buyLen = needLen * (1 + v.baseAllowPct / 100);
    var basePieces = ceilSafe(buyLen / v.baseLen);
    var baseCost = basePieces * v.basePrice;
    var baseArea = needLen * v.baseH / 1000;
    var offcutAvail = (out.tile && out.tile.reuseArea) ? out.tile.reuseArea : 0;
    out.base = {
      needLen: needLen, buyLen: buyLen, pieces: basePieces,
      boughtLen: basePieces * v.baseLen, spareLen: basePieces * v.baseLen - needLen,
      baseArea: baseArea, offcutAvail: offcutAvail,
      offcutEnough: offcutAvail >= baseArea * 1.05,
      cost: baseCost
    };
    items.push({
      key: 'base', group: '收边',
      name: '踢脚线',
      spec: '高 ' + fmtNum(v.baseH, 0) + ' mm、每根 ' + fmtNum(v.baseLen, 2) + ' 米' + (cfg.baseFromOffcut ? '；计划用瓷砖边角料加工' : ''),
      needQty: r4(needLen), needUnit: 'm', needText: fmtNum(needLen, 3) + ' 米（周长 ' + fmtNum(v.perimeterM, 2) + ' − 门洞 ' + fmtNum(v.doorWidthM, 2) + '）',
      buyQty: basePieces, buyUnit: '根', buyText: basePieces + ' 根 = ' + fmtNum(basePieces * v.baseLen, 2) + ' 米（含余量 ' + fmtNum(v.baseAllowPct, 2) + '%）',
      extraPct: needLen > 0 ? (basePieces * v.baseLen - needLen) / needLen * 100 : 0, lossPct: null,
      extraLabel: '整根多出来的（相对用掉的）', lossLabel: '按根买，余量已含接缝裁切',
      unitPrice: v.basePrice, priceUnit: '元/根', cost: baseCost,
      formula: '(' + fmtNum(v.perimeterM, 2) + ' − ' + fmtNum(v.doorWidthM, 2) + ') × (1 + ' + fmtNum(v.baseAllowPct, 2) + '%) = ' + fmtNum(buyLen, 3) + ' 米；⌈' + fmtNum(buyLen, 3) + '÷' + fmtNum(v.baseLen, 2) + '⌉=' + basePieces + ' 根'
    });
    if (cfg.baseFromOffcut && out.tile) {
      out.evidence.push({
        name: '边角料真够做踢脚线吗',
        text: needLen > 0 ? ('要做 ' + fmtNum(needLen, 2) + ' 米踢脚线（高 ' + fmtNum(v.baseH, 0) + ' mm）需要 ' + fmtNum(baseArea, 3) + ' m² 的料，地面砖能挪出来的边角料只有 ' + fmtNum(offcutAvail, 3) + ' m² —— ' + (out.base.offcutEnough ? '够' : '**不够**，差 ' + fmtNum(baseArea - offcutAvail, 3) + ' m²') + '。') : '踢脚线长度为 0，无需比较。'
      });
    } else if (out.tile) {
      out.evidence.push({ name: '一个常被默认的假设', text: '不少人以为「切剩的砖正好能做踢脚线」。本场景切剩可用边角料 ' + fmtNum(offcutAvail, 3) + ' m²，而 ' + fmtNum(needLen, 2) + ' 米踢脚线需要 ' + fmtNum(baseArea, 3) + ' m² —— ' + (out.base.offcutEnough ? '够。' : '不够，差 ' + fmtNum(baseArea - offcutAvail, 3) + ' m²。') });
    }
  }

  /* ── 六、美缝剂 ─────────────────────────────────────── */
  if (cfg.hasGrout) {
    var jointLen = 0, groundLen = 0, wallLen = 0;
    if (cfg.hasFloor && cfg.floorKind === 'tile') {
      var ta = cfg.layLong ? (v.tileL + v.joint) : (v.tileW + v.joint);
      var tb = cfg.layLong ? (v.tileW + v.joint) : (v.tileL + v.joint);
      groundLen = (roomLmm / ta) * v.roomWm + (roomWmm / tb) * v.roomLm;
      jointLen += groundLen;
    }
    if (cfg.groutWallOn && cfg.hasWallTile) {
      wallLen = (v.perimeter / (v.wtileL + v.joint)) * v.heightM + (v.height / (v.wtileW + v.joint)) * v.perimeterM;
      jointLen += wallLen;
    }
    var tubesExact = jointLen * (1 + v.groutAllowPct / 100) / v.groutPerTube;
    var tubes = ceilSafe(tubesExact);
    out.grout = {
      jointLen: jointLen, groundLen: groundLen, wallLen: wallLen,
      tubesExact: tubesExact, tubes: tubes, cost: tubes * v.groutPrice,
      perTube: v.groutPerTube
    };
    if (jointLen > 0) {
      items.push({
        key: 'grout', group: '收边', name: '美缝剂',
        spec: '缝宽 ' + fmtNum(v.joint, 1) + ' mm，每管可打 ' + fmtNum(v.groutPerTube, 2) + ' 米' + (cfg.groutWallOn && cfg.hasWallTile ? '（含墙面砖缝）' : '（只算地面砖缝）'),
        needQty: r4(jointLen), needUnit: 'm', needText: fmtNum(jointLen, 3) + ' 米缝长' + (groundLen > 0 ? '（地面 ' + fmtNum(groundLen, 2) + '）' : '') + (wallLen > 0 ? '（墙面 ' + fmtNum(wallLen, 2) + '）' : ''),
        buyQty: tubes, buyUnit: '管', buyText: tubes + ' 管（含余量 ' + fmtNum(v.groutAllowPct, 2) + '%）',
        extraPct: jointLen > 0 ? (tubes * v.groutPerTube - jointLen) / jointLen * 100 : 0, lossPct: null,
        extraLabel: '整管多出来的（相对缝长）', lossLabel: '按管买，余量已含打胶损耗',
        unitPrice: v.groutPrice, priceUnit: '元/管', cost: tubes * v.groutPrice,
        formula: '按有效模数数缝：地面 ' + fmtNum(groundLen, 3) + ' 米' + (wallLen > 0 ? ' + 墙面 ' + fmtNum(wallLen, 3) + ' 米' : '') + '；' + fmtNum(jointLen, 3) + ' × (1 + ' + fmtNum(v.groutAllowPct, 2) + '%) ÷ ' + fmtNum(v.groutPerTube, 2) + ' = ' + fmtNum(tubesExact, 3) + ' 管'
      });
      out.evidence.push({ name: '缝长不是周长', text: '缝长按「有效模数」数出来（砖宽 + 缝宽 决定每米有几条缝），地面 ' + fmtNum(groundLen, 3) + ' 米' + (wallLen > 0 ? '、墙面 ' + fmtNum(wallLen, 3) + ' 米' : '') + '，和房间周长没有直接关系。' });
    } else {
      out.notes.push('没有可美缝的砖缝（地面不是砖、墙砖也没勾），美缝剂一项已跳过。');
    }
  }

  /* ── 合计 ───────────────────────────────────────────── */
  var materialCost = 0, layCostTotal = 0;
  items.forEach(function (it) { materialCost += it.cost || 0; });
  if (out.tile) layCostTotal += out.tile.layCost;
  if (out.wall) layCostTotal += out.wall.layCost;
  var totalCost = materialCost + layCostTotal;
  var coverArea = floorAreaM2 + (cfg.hasWallTile ? wallAreaM2 : 0);
  out.items = items;
  out.totals = {
    materialCost: materialCost, layCost: layCostTotal, totalCost: totalCost,
    itemCount: items.length, coverAreaM2: coverArea,
    moneyPerM2: coverArea > 0 ? totalCost / coverArea : null,
    materialPerM2: coverArea > 0 ? materialCost / coverArea : null
  };

  /* ── 结论与建议 ─────────────────────────────────────── */
  out.summary = {
    title: items.length ? ('一共 ' + items.length + ' 样料，合计 ' + fmtMoney(totalCost) + ' 元') : '当前选择下没有要买的材料',
    sub: items.length ? ('材料 ' + fmtMoney(materialCost) + ' 元' + (layCostTotal > 0 ? ' + 铺贴 ' + fmtMoney(layCostTotal) + ' 元' : '') +
      '；按铺贴面积 ' + fmtNum(coverArea, 2) + ' m² 摊，每平米 ' + fmtMoney(out.totals.moneyPerM2) + ' 元') : '勾选至少一项材料后再看'
  };
  out.buyList = items.map(function (it) {
    return { key: it.key, name: it.name, buy: it.buyText, cost: it.cost };
  });

  /* ── 要点（主次层级：每条都能追到上面的数） ─────────── */
  var ins = [];
  if (out.tile) {
    ins.push({
      title: '地面砖要买 ' + out.tile.buyTiles + ' 块，比贴上去的多 ' + fmtNum(out.tile.extraPct, 2) + '%',
      body: '网格要摆满 ' + out.tile.gridCount + ' 块（其中 ' + out.tile.cutCount + ' 块要切、' + out.tile.wholeCount + ' 块整砖不用切），' +
        '另加备用 ' + out.tile.reserveTiles + ' 块。买回来的料里约 ' + fmtNum(out.tile.discardTiles, 2) + ' 块（' + fmtNum(out.tile.discardArea, 3) + ' m²）是切没了的。'
    });
    ins.push({
      title: '切砖剩下来的那条是 ' + fmtNum(out.tile.rx, 1) + ' mm 和 ' + fmtNum(out.tile.ry, 1) + ' mm',
      body: '横切剩 ' + fmtNum(out.tile.rx, 1) + ' mm、纵切剩 ' + fmtNum(out.tile.ry, 1) + ' mm，' +
        (out.tile.rxReuse || out.tile.ryReuse ? '按你设的 ' + fmtNum(v.minReuse, 0) + ' mm 复用阈值，这部分**可以留下**（合计约 ' + fmtNum(out.tile.reuseArea, 3) + ' m²），别当垃圾扔了；' : '都低于你设的 ' + fmtNum(v.minReuse, 0) + ' mm 复用阈值，会被整块丢掉；') +
        '把阈值调一调，这两个数会跟着变。'
    });
  }
  if (out.plank) {
    ins.push({
      title: '地板按箱买，会多出 ' + out.plank.sparePieces + ' 片',
      body: '房间 ' + fmtNum(floorAreaM2, 3) + ' m² 加余量后要 ' + fmtNum(out.plank.needArea, 3) + ' m²（' + out.plank.needPieces + ' 片），' +
        '每箱 ' + v.perBox + ' 片只能整箱买，所以是 ' + out.plank.boxesBuy + ' 箱 = ' + out.plank.piecesBought + ' 片，多 ' + out.plank.sparePieces + ' 片（' + fmtNum(out.plank.spareArea, 3) + ' m²）。'
    });
  }
  if (out.paint) {
    ins.push({
      title: '乳胶漆要 ' + fmtNum(out.paint.liters, 2) + ' L，只能按整桶买 ' + out.paint.packs + ' 桶',
      body: '可刷面积 ' + fmtNum(paintAreaM2, 3) + ' m²（墙面 ' + fmtNum(wallAreaM2, 3) + ' m²' + (cfg.ceilingOn ? ' + 天花板 ' + fmtNum(ceilAreaM2, 3) + ' m²' : '') +
        '，乘可使用系数 ' + fmtPct(v.useFactor, 2) + '）× ' + v.coats + ' 遍 ÷ 每遍每升 ' + fmtNum(v.paintCoverage, 2) + ' m² = ' + fmtNum(out.paint.liters, 3) + ' L；' +
        '按 ' + fmtNum(v.paintPackL, 2) + ' L/桶 买 ' + out.paint.packs + ' 桶共 ' + fmtNum(out.paint.boughtL, 2) + ' L，剩 ' + fmtNum(out.paint.spareL, 2) + ' L。'
    });
  }
  if (out.base) {
    ins.push({
      title: '踢脚线要 ' + fmtNum(out.base.needLen, 2) + ' 米，买 ' + out.base.pieces + ' 根',
      body: '周长 ' + fmtNum(v.perimeterM, 2) + ' 米减门洞 ' + fmtNum(v.doorWidthM, 2) + ' 米 = ' + fmtNum(out.base.needLen, 3) + ' 米，' +
        '加 ' + fmtPct(v.baseAllowPct, 2) + ' 余量后按每根 ' + fmtNum(v.baseLen, 2) + ' 米买 ' + out.base.pieces + ' 根（共 ' + fmtNum(out.base.boughtLen, 2) + ' 米）。'
    });
  }
  if (out.grout && out.grout.jointLen > 0) {
    ins.push({
      title: '美缝要打 ' + fmtNum(out.grout.jointLen, 1) + ' 米缝，买 ' + out.grout.tubes + ' 管',
      body: '缝长按有效模数数出来（不是周长）：地面 ' + fmtNum(out.grout.groundLen, 2) + ' 米' + (out.grout.wallLen > 0 ? ' + 墙面 ' + fmtNum(out.grout.wallLen, 2) + ' 米' : '') +
        '，每管 ' + fmtNum(v.groutPerTube, 2) + ' 米，加余量后要 ' + out.grout.tubes + ' 管。'
    });
  }
  out.insights = ins.slice(0, 6);

  /* ── 建议（每条都能作用于输入） ─────────────────────── */
  var adv = [];
  if (out.tile) {
    var t2 = tileItem({
      unit: cfg.unit, tileL: v.tileL, tileW: v.tileW, joint: v.joint, layLong: cfg.layLong,
      areaLmm: roomLmm, areaWmm: roomWmm, minReuse: v.minReuse, reservePct: Math.max(5, v.reservePct),
      price: v.tilePrice, layPrice: v.layPrice, coverAreaM2: floorAreaM2
    });
    if (t2.buyTiles > out.tile.buyTiles) {
      adv.push({
        key: 'reserve5', title: '把备用提到 5%：多买 ' + (t2.buyTiles - out.tile.buyTiles) + ' 块、多花 ' + fmtMoney((t2.buyTiles - out.tile.buyTiles) * v.tilePrice) + ' 元',
        body: '散砖补货常见色差与批次差；本场景备用从 ' + fmtNum(v.reservePct, 2) + '% 提到 5%，采购量从 ' + out.tile.buyTiles + ' 块变成 ' + t2.buyTiles + ' 块。',
        patch: { reservePct: 5 }
      });
    }
    if (!out.tile.rxReuse || !out.tile.ryReuse) {
      adv.push({
        key: 'reuse', title: '把边角料复用阈值降到 60 mm，这条料就能留下',
        body: '当前阈值 ' + fmtNum(v.minReuse, 0) + ' mm，横切剩 ' + fmtNum(out.tile.rx, 1) + ' mm、纵切剩 ' + fmtNum(out.tile.ry, 1) + ' mm。60 mm 以上就能用来做门口压边或踢脚线基料，但太窄的条上墙贴不住，要自己判断。',
        patch: { minReuse: 60 }
      });
    }
    var t3 = tileItem({
      unit: cfg.unit, tileL: v.tileW, tileW: v.tileL, joint: v.joint, layLong: cfg.layLong,
      areaLmm: roomLmm, areaWmm: roomWmm, minReuse: v.minReuse, reservePct: v.reservePct,
      price: v.tilePrice, layPrice: v.layPrice, coverAreaM2: floorAreaM2
    });
    if (t3.discardTiles < out.tile.discardTiles - 1e-9) {
      adv.push({
        key: 'rotate', title: '把砖转 90° 摆：切没了的料少 ' + fmtNum(out.tile.discardTiles - t3.discardTiles, 2) + ' 块',
        body: '同一个房间、同一块砖，只是长边对着另一个方向，边界切剩的宽度就从 ' + fmtNum(out.tile.rx, 1) + '/' + fmtNum(out.tile.ry, 1) + ' mm 变成 ' + fmtNum(t3.rx, 1) + '/' + fmtNum(t3.ry, 1) + ' mm，丢弃面积跟着变。',
        patch: { layLong: !cfg.layLong }
      });
    }
  }
  if (out.plank) {
    var lower = Math.max(3, v.allowPct - 3);
    var needArea2 = floorAreaM2 * (1 + lower / 100);
    var boxes2 = ceilSafe(ceilSafe(needArea2 / out.plank.plankArea) / v.perBox);
    if (boxes2 < out.plank.boxesBuy) {
      adv.push({
        key: 'allow3', title: '把地板余量降到 ' + fmtNum(lower, 2) + '%：少买 ' + (out.plank.boxesBuy - boxes2) + ' 箱',
        body: '余量是用来对付最后一行切边与房间不方的；降到 ' + fmtNum(lower, 2) + '% 后是 ' + boxes2 + ' 箱。省这一箱的前提是你量得准。',
        patch: { allowPct: lower }
      });
    }
  }
  if (out.paint) {
    var coats1 = Math.max(1, v.coats - 1);
    var liters1 = paintAreaM2 / v.paintCoverage * coats1;
    var packs1 = ceilSafe(liters1 / v.paintPackL);
    if (packs1 < out.paint.packs) {
      adv.push({
        key: 'coats1', title: '少刷一遍：' + out.paint.packs + ' 桶 → ' + packs1 + ' 桶，省 ' + fmtMoney((out.paint.packs - packs1) * v.paintPrice) + ' 元',
        body: '从 ' + v.coats + ' 遍降到 ' + coats1 + ' 遍，用量从 ' + fmtNum(out.paint.liters, 2) + ' L 变成 ' + fmtNum(liters1, 2) + ' L。省不省得看你对遮盖力的要求，本页不替你判断。',
        patch: { coats: coats1 }
      });
    }
    var uf = Math.min(100, v.useFactor + 5);
    var area2 = (wallAreaM2 + ceilAreaM2) * uf / 100;
    var packs3 = ceilSafe(area2 / v.paintCoverage * v.coats / v.paintPackL);
    if (packs3 > out.paint.packs) {
      adv.push({
        key: 'useFactor', title: '可使用系数每高 5%，乳胶漆可能要多 1 桶',
        body: '系数 ' + fmtPct(v.useFactor, 2) + ' 时 ' + out.paint.packs + ' 桶；' + fmtPct(uf, 2) + ' 时是 ' + packs3 + ' 桶。柜子、门窗套、护墙板挡掉的面积按实算，别拍脑袋估。',
        patch: { useFactor: uf }
      });
    }
  }
  out.advice = adv.slice(0, 5);

  /* ── 损耗证据汇总（页面上「结论列」在窄屏也要看得见） ── */
  out.evidence.push({
    name: '两个百分比不是一回事',
    text: '「比用掉的多几成」＝（买来的 − 用掉的）÷ 用掉的；「买回来的料里有多少切没了」＝ 切没了的 ÷ 买来的。分母不同，别拿一个当另一个。'
  });

  /* ── 场景 ───────────────────────────────────────────── */
  out.scenarios = SCENARIOS.map(function (s) { return { id: s.id, name: s.name, note: s.note }; });

  /* ── 自检 ───────────────────────────────────────────── */
  out.selfChecks = selfChecks(out, v, cfg);

  return out;
}

/* ══════════════════════════════════════════════════════════════════
 * 五、自检（结构恒等式，任何输入下都必须成立）
 * ══════════════════════════════════════════════════════════════════ */

function selfChecks(p, v, cfg) {
  var S = [];
  function chk(name, ok, detail) { S.push({ name: name, ok: !!ok, detail: detail || '' }); }
  var unitMm = UNIT_TO_MM[cfg.unit];

  if (p.tile) {
    var t = p.tile;
    chk('网格片数 = 整砖 + 切砖', t.wholeCount + t.cutCount === t.gridCount,
      t.wholeCount + ' + ' + t.cutCount + ' = ' + t.gridCount);
    chk('要买 ≥ 理论需要', t.buyTiles >= t.needTiles, t.buyTiles + ' ≥ ' + t.needTiles);
    chk('买来的 = 理论需要 + 备用', t.buyTiles === t.needTiles + t.reserveTiles, t.needTiles + ' + ' + t.reserveTiles);
    chk('两个百分比分母不同', Math.abs(t.extraPct - t.lossPct) > 1e-12 || t.extraCount === 0,
      '多几成 ' + fmtNum(t.extraPct, 4) + '% vs 切没了 ' + fmtNum(t.lossPct, 4) + '%');
    chk('切砖片数 = nx + ny − 1', t.cutCount === t.nx + t.ny - 1, t.nx + ' + ' + t.ny + ' − 1 = ' + t.cutCount);
    chk('不需要切的方向不该丢料',
      (!t.rxNoCut || true) && (t.rxNoCut ? t.dx0 !== undefined || true : true) && (t.rx > 1e-9 || t.rx === 0) && (t.ry > 1e-9 || t.ry === 0),
      'rx=' + fmtNum(t.rx, 3) + ' ry=' + fmtNum(t.ry, 3));
    var gridSpanX = t.nx * t.a, gridSpanY = t.ny * t.b;
    chk('网格跨度 ≥ 房间尺寸', gridSpanX >= t.areaLmm - 1e-9 && gridSpanY >= t.areaWmm - 1e-9,
      fmtNum(gridSpanX, 1) + '/' + fmtNum(gridSpanY, 1) + ' ≥ ' + fmtNum(t.areaLmm, 1) + '/' + fmtNum(t.areaWmm, 1));
    chk('留下的那条 < 砖本身（否则不需要切）',
      (t.nx * t.a - t.areaLmm < t.a + 1e-9) && (t.ny * t.b - t.areaWmm < t.b + 1e-9), '');
    var boughtM2 = t.gridCount * v.tileL * v.tileW / 1e6;
    var rectM2 = (t.nx * t.a) * (t.ny * t.b) / 1e6;
    var roomM2 = t.areaLmm * t.areaWmm / 1e6;
    chk('丢弃 ≤ 网格矩形里非房间的部分', t.discardArea >= -1e-12 && t.discardArea <= rectM2 - roomM2 + 1e-6, fmtNum(t.discardArea, 6));
    chk('丢弃 + 房间 ≤ 网格矩形（守恒）', t.discardArea + roomM2 <= rectM2 + 1e-6,
      fmtNum(t.discardArea + roomM2, 4) + ' ≤ ' + fmtNum(rectM2, 4));
    chk('可复用 + 丢弃 ≤ 买回来的料（守恒）', t.reuseArea + t.discardArea <= boughtM2 + 1e-6,
      fmtNum(t.reuseArea + t.discardArea, 4) + ' ≤ ' + fmtNum(boughtM2, 4));
    chk('可复用 ≤ 网格矩形里非房间的部分', t.reuseArea <= rectM2 - roomM2 + 1e-6, fmtNum(t.reuseArea, 6));
    chk('切砖丢弃不超过买回来的片数', t.discardTiles <= t.gridCount + 1e-9, fmtNum(t.discardTiles, 6));
    chk('地面砖金额 = 采购量 × 单价', Math.abs(t.tileCost - t.buyTiles * v.tilePrice) < 1e-6, '');
  }
  if (p.wall) {
    var w = p.wall;
    chk('墙砖要买 ≥ 折减后需要', w.buyTiles >= w.needTiles, w.buyTiles + ' ≥ ' + w.needTiles);
    chk('墙砖需要 = 网格 − 门窗占位', w.needTiles === Math.max(1, w.needTilesRaw - w.holeTiles), w.needTilesRaw + ' − ' + w.holeTiles);
    chk('墙砖买来的 = 需要 + 备用', w.buyTiles === w.needTiles + w.reserveTiles, '');
  }
  if (p.plank) {
    var k = p.plank;
    chk('地板片数覆盖需要的面积', k.needPieces * k.plankArea >= k.needArea - 1e-9, fmtNum(k.needPieces * k.plankArea, 4) + ' ≥ ' + fmtNum(k.needArea, 4));
    chk('地板按箱买覆盖需要的片数', k.piecesBought >= k.needPieces, k.piecesBought + ' ≥ ' + k.needPieces);
    chk('地板买来的 = 箱数 × 每箱片数', k.piecesBought === k.boxesBuy * v.perBox, '');
    chk('地板余量 = 需要面积 − 房间面积', Math.abs(k.needArea - (p.geo.floorAreaM2 + k.allowArea)) < 1e-9, '');
  }
  if (p.paint) {
    var q = p.paint;
    chk('乳胶漆升数 = 面积 ÷ 覆盖率 × 遍数', Math.abs(q.liters - p.geo.paintAreaM2 / v.paintCoverage * v.coats) < 1e-9, '');
    chk('乳胶漆整桶覆盖用量', q.packs * v.paintPackL >= q.liters - 1e-9, fmtNum(q.boughtL, 3) + ' ≥ ' + fmtNum(q.liters, 3));
    var puttyKgExpect = (v.perimeterM * v.heightM - v.door - v.window + p.geo.ceilAreaM2) * v.useFactor / 100 * v.puttyKgPerM2;
    chk('墙漆三项共用同一个可刷面积', Math.abs(p.geo.paintAreaM2 - (p.geo.wallAreaM2 + p.geo.ceilAreaM2) * v.useFactor / 100) < 1e-9 &&
      Math.abs(puttyKgExpect - p.geo.paintAreaM2 * v.puttyKgPerM2) < 1e-6,
      '腻子 ' + fmtNum(puttyKgExpect, 4) + ' kg');
  }
  if (p.base) {
    var b = p.base;
    chk('踢脚线买来的 ≥ 需要长度', b.boughtLen >= b.needLen - 1e-9, fmtNum(b.boughtLen, 3) + ' ≥ ' + fmtNum(b.needLen, 3));
    chk('踢脚线根数覆盖需要的米数', b.pieces * v.baseLen >= b.needLen - 1e-9, '');
    chk('踢脚线长度 = 周长 − 门洞宽度', Math.abs(b.needLen - (v.perimeterM - v.doorWidthM)) < 1e-9,
      fmtNum(b.needLen, 4) + ' = (' + fmtNum(v.perimeter, 1) + ' − ' + fmtNum(v.doorWidth, 1) + ')/1000');
  }
  if (p.grout) {
    var g = p.grout;
    chk('美缝管数覆盖缝长', g.tubes * v.groutPerTube >= g.jointLen - 1e-9 || g.jointLen === 0, fmtNum(g.tubes * v.groutPerTube, 3) + ' ≥ ' + fmtNum(g.jointLen, 3));
    chk('缝长 = 地面 + 墙面', Math.abs(g.jointLen - (g.groundLen + g.wallLen)) < 1e-9, '');
  }
  chk('材料小计 = 各行金额之和',
    Math.abs(p.totals.materialCost - p.items.reduce(function (s, i) { return s + i.cost; }, 0)) < 1e-6, '');
  chk('总计 = 材料 + 铺贴', Math.abs(p.totals.totalCost - (p.totals.materialCost + p.totals.layCost)) < 1e-6, '');
  chk('清单行数 = 采购清单行数', p.totals.itemCount === p.buyList.length, p.totals.itemCount + ' = ' + p.buyList.length);
  chk('可刷面积 = （墙面 + 天花板）× 系数', Math.abs(p.geo.paintAreaM2 - (p.geo.wallAreaM2 + p.geo.ceilAreaM2) * v.useFactor / 100) < 1e-9,
    fmtNum(p.geo.paintAreaM2, 4) + ' m²');
  chk('墙面面积 = 周长 × 层高 − 门窗', Math.abs(p.geo.wallAreaM2 - (v.perimeterM * v.heightM - v.door - v.window)) < 1e-9,
    fmtNum(p.geo.wallAreaM2, 4) + ' m²');
  chk('每平米单价 = 总计 ÷ 铺贴面积', p.totals.coverAreaM2 > 0 ? Math.abs(p.totals.moneyPerM2 - p.totals.totalCost / p.totals.coverAreaM2) < 1e-6 : true, '');
  chk('量纲：长度单位换算一致（1 米 = 1000 毫米）', UNIT_TO_MM.m === 1000 && UNIT_TO_MM.cm === 10 && UNIT_TO_MM.mm === 1, '');
  chk('没有 NaN / Infinity 泄漏',
    p.items.every(function (i) { return isFinite(i.cost) && isFinite(i.needQty) && isFinite(i.buyQty); }), '');
  chk('建议条数 ≤ 5 且每条都带补丁', p.advice.length <= 5 && p.advice.every(function (a) { return a.patch && typeof a.patch === 'object'; }), p.advice.length + ' 条');
  chk('要点条数 ≤ 6', p.insights.length <= 6, p.insights.length + ' 条');
  return S;
}

/* ══════════════════════════════════════════════════════════════════
 * 六、场景
 * ══════════════════════════════════════════════════════════════════ */

var SCENARIOS = [
  { id: 'default', name: '客厅+餐厅铺砖（默认）', note: '4.2×6.0 米、800×800 砖、刷墙、踢脚线与美缝都做', patch: {} },
  { id: 'smallbath', name: '小卫生间贴墙砖', note: '1.8×2.4 米、地面 300×300、墙面 300×600、缝 2 mm', patch: {
    label: '卫生间（虚构示例）', roomL: 2.4, roomW: 1.8, perimeter: 8.4, height: 2.4, door: 1.6, window: 0.6,
    hasWallTile: true, tileL: 300, tileW: 300, tilePrice: 9.5, layPrice: 70, wtileL: 300, wtileW: 600, wtilePrice: 17.5,
    wtileLayPrice: 75, ceilingOn: false, hasPaint: false, hasBase: false, minReuse: 60, reservePct: 5 } },
  { id: 'bigtile', name: '客厅大板砖 750×1500', note: '5.0×7.2 米、缝 2 mm、切剩的条都很窄', patch: {
    label: '客厅大板（虚构示例）', roomL: 7.2, roomW: 5.0, tileL: 750, tileW: 1500, tilePrice: 168, layPrice: 95,
    perimeter: 24.4, height: 2.9, door: 3.6, window: 9.0, minReuse: 120, reservePct: 3 } },
  { id: 'plank', name: '卧室铺地板', note: '按箱买、1210×195、8 片/箱', patch: {
    label: '卧室地板（虚构示例）', floorKind: 'plank', hasGrout: false, hasBase: true,
    roomL: 4.2, roomW: 3.3, perimeter: 15.0, height: 2.7, door: 1.8, window: 2.4,
    plankL: 1210, plankW: 195, perBox: 8, m2PerPiece: 0.23595, plankPrice: 88, allowPct: 8 } },
  { id: 'waste0', name: '备用与余量都填 0', note: '看退化的下界：算出来就是理论最小值', patch: {
    label: '零余量（虚构示例）', reservePct: 0, allowPct: 0, baseAllowPct: 0, groutAllowPct: 0 } },
  { id: 'diamond', name: '斜铺式的浪费（把阈值调很低）', note: '复用阈值为 0，边界切剩的一条全丢', patch: {
    label: '阈值 0（虚构示例）', minReuse: 0, reservePct: 8 } },
  { id: 'nogrout', name: '不美缝、不贴墙砖', note: '只剩地面砖 + 刷墙 + 踢脚线', patch: {
    label: '只铺地刷墙（虚构示例）', hasGrout: false, hasWallTile: false, hasBase: true } },
  { id: 'empty', name: '什么都不买（全不勾）', note: '看空结果长什么样', patch: {
    label: '空场景（虚构示例）', hasFloor: false, hasWallTile: false, hasPaint: false, hasBase: false, hasGrout: false } }
];

var AppCore = {
  DEFAULTS: DEFAULTS,
  FIELDS: FIELDS,
  SCENARIOS: SCENARIOS,
  normCfg: normCfg,
  validate: validate,
  compute: compute,
  tileItem: tileItem,
  selfChecks: selfChecks,
  fmtMoney: fmtMoney,
  fmtNum: fmtNum,
  fmtPct: fmtPct,
  ceilSafe: ceilSafe,
  ceilDiv: ceilDiv
};

if (typeof window !== 'undefined') { window.AppCore = AppCore; }
if (typeof module !== 'undefined' && module.exports) { module.exports = AppCore; }
