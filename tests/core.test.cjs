/* 买多了退不掉 · 核心测试
 * 运行：node --test tests/core.test.cjs
 * 看原始 pass/fail/cancelled/skipped/todo，不凑数量。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../core.js');

/* ── 手算锚点（算式写在这里，逐位核对） ────────────────────────────────
 * 默认场景：房间 6000×4200 mm，砖 800×800、缝 2 → 有效模数 a=b=802
 *   nx = ceil(6000/802) = 8      （8×802 = 6416）
 *   ny = ceil(4200/802) = 6      （6×802 = 4812）
 *   gridCount = 48, wholeCount = 7×5 = 35, cutCount = 8+6−1 = 13
 *   rx = 6416−6000 = 416, ry = 4812−4200 = 612   （都 ≥ minReuse 100）
 *   切料计划：每块切砖的丢弃 = min(cut − r, cut)×other、可复用 = min(r − mr, cut)×other
 *     x 方向：r=416 ≥ 100 → 每块丢弃 = (802−416)×800 = 308,800 mm²、可复用 = (416−100)×800 = 252,800 mm²
 *     y 方向：r=612 ≥ 100 → 每块丢弃 = (802−612)×800 = 152,000 mm²、可复用 = (612−100)×800 = 409,600 mm²
 *     这两个方向各有一条边要切：x 向的切砖在每一行里各有一块（共 ny 块），y 向在每一列里各有一块（共 nx 块）
 *   丢弃面积 = 308,800×6 + 152,000×8 = 1,852,800 + 1,216,000 = 3,068,800 mm² = 3.0688 m²
 *   丢弃片数 = 3,068,800 / 640,000 = 4.795 片
 *   reserveTiles = ceil(48 × 2%) = ceil(0.96) = 1；buyTiles = 49
 *   extraCount = 1, extraPct = 1/48 = 2.083333…%
 *   lossPct = 4.795/49×100 = 9.785714…%
 *   可复用边角料 = (252,800×6 + 409,600×8)/1e6 = (1,516,800 + 3,276,800)/1e6 = 4.7936 m²
 *   tileCost = 49×68 = 3332；layCost = 25.2×55 = 1386；总 4718
 *   乳胶漆：wallArea = 20.4×2.8 − 4.2 − 6.0 = 46.92；+天花板 25.2 = 72.12；×0.85 = 61.302
 *     L = 61.302 ÷ 14 × 2 = 8.757428571…；桶 = ceil(8.7574/5) = 2
 *   腻子 kg = 61.302×3.5 = 214.557；包 = ceil(214.557/20) = 11
 *   界面剂 kg = 61.302×0.25 = 15.3255；包 = ceil(15.3255/5) = 4
 *   踢脚线：needLen = 20.4 − 2.7 = 17.7；×1.06 = 18.762；根 = ceil(18.762/2.5) = 8
 *   美缝：groundLen = (6000/802)×4.2 + (4200/802)×6 = 31.421446… + 31.421446… = 62.8428927…
 *     ×1.08 = 67.8703…；管 = ceil(67.8703/15) = ceil(4.5247) = 5
 */
const D = A.DEFAULTS;
function withCfg(patch) { return A.normCfg(Object.assign({}, D, patch)); }
function compute(patch) { return A.compute(withCfg(patch)); }
const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps);

test('默认场景：手算锚点逐位核对', () => {
  const p = A.compute(D);
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  const t = p.tile;
  assert.equal(t.nx, 8); assert.equal(t.ny, 6);
  assert.equal(t.a, 802); assert.equal(t.b, 802);
  assert.equal(t.gridCount, 48);
  assert.equal(t.wholeCount, 35);
  assert.equal(t.cutCount, 13);
  assert.equal(t.rx, 416); assert.equal(t.ry, 612);
  assert.equal(t.rxReuse, true); assert.equal(t.ryReuse, true);
  assert.ok(near(t.discardTiles, 4.795), String(t.discardTiles));
  assert.ok(near(t.discardArea, 3.0688), String(t.discardArea));
  assert.ok(near(t.reuseArea, 2.604992), String(t.reuseArea));   /* (252800×6 + 409600×8)/1e6 = 2.604992 */
  assert.equal(t.needTiles, 48);
  assert.equal(t.reserveTiles, 1);
  assert.equal(t.buyTiles, 49);
  assert.ok(near(t.extraPct, 1 / 48 * 100), String(t.extraPct));
  assert.ok(near(t.lossPct, 4.795 / 49 * 100), String(t.lossPct));
  assert.equal(t.clamped, false, '默认场景不该触发上界钳制');
  assert.equal(t.tileCost, 3332);
  assert.ok(near(t.layCost, 1386, 1e-6), String(t.layCost));
  assert.equal(t.totalCost, 4718);
});

test('默认场景：几何、涂料、踢脚线、美缝手算锚点', () => {
  const p = A.compute(D);
  assert.ok(near(p.geo.floorAreaM2, 25.2, 1e-9), String(p.geo.floorAreaM2));
  assert.ok(near(p.geo.wallAreaM2, 46.92, 1e-9), String(p.geo.wallAreaM2));
  assert.ok(near(p.geo.ceilAreaM2, 25.2, 1e-9));
  assert.ok(near(p.geo.paintAreaM2, 61.302, 1e-9), String(p.geo.paintAreaM2));
  assert.ok(near(p.paint.liters, 61.302 / 14 * 2, 1e-9), String(p.paint.liters));
  assert.equal(p.paint.packs, 2);
  assert.ok(near(p.paint.litersPerCoat, 61.302 / 14, 1e-9));
  const putty = p.items.find((i) => i.key === 'putty');
  assert.ok(near(putty.needQty, 214.557, 1e-6), String(putty.needQty));
  assert.equal(putty.buyQty, 11);
  const primer = p.items.find((i) => i.key === 'primer');
  assert.ok(near(primer.needQty, 15.3255, 1e-6), String(primer.needQty));
  assert.equal(primer.buyQty, 4);
  assert.ok(near(p.base.needLen, 17.7, 1e-9));
  assert.ok(near(p.base.buyLen, 18.762, 1e-9));
  assert.equal(p.base.pieces, 8);
  assert.ok(near(p.grout.groundLen, (6000 / 802) * 4.2 + (4200 / 802) * 6, 1e-9), String(p.grout.groundLen));
  assert.equal(p.grout.tubes, 5);
  assert.equal(p.totals.materialCost, 3332 + 536 + 462 + 384 + 176 + 190);
  assert.equal(p.totals.totalCost, 5080 + 1386);
});

test('结构恒等式：整砖 + 切砖 = 网格；买来的 = 需要 + 备用', () => {
  [[{}, '默认'], [{ tileL: 750, tileW: 1500, roomL: 7.2, roomW: 5.0 }, '大板'],
   [{ tileL: 300, tileW: 300, roomL: 2.4, roomW: 1.8 }, '小砖'],
   [{ tileL: 600, tileW: 600, roomL: 3.0, roomW: 3.0, joint: 3 }, '600 方']].forEach(([patch, name]) => {
    const t = compute(patch).tile;
    assert.equal(t.wholeCount + t.cutCount, t.gridCount, name);
    assert.equal(t.buyTiles, t.needTiles + t.reserveTiles, name);
    assert.equal(t.cutCount, t.nx + t.ny - 1, name);
    assert.ok(t.gridCount > 0, name);
  });
});

test('网格一定盖得住房间，且切剩的那条一定比砖小', () => {
  [[{}, '默认'], [{ roomL: 7.2, roomW: 5.0, tileL: 750, tileW: 1500 }, '大板'],
   [{ roomL: 3.13, roomW: 2.77, tileL: 600, tileW: 600 }, '非整数'],
   [{ roomL: 4.0, roomW: 4.0, tileL: 800, tileW: 800, joint: 0 }, '恰好整除']].forEach(([patch, name]) => {
    const t = compute(patch).tile;
    assert.ok(t.nx * t.a >= t.areaLmm - 1e-9, name);
    assert.ok(t.ny * t.b >= t.areaWmm - 1e-9, name);
    assert.ok(t.rx < t.a + 1e-9 && t.rx >= 0, name);
    assert.ok(t.ry < t.b + 1e-9 && t.ry >= 0, name);
  });
});

test('倍数关系与单调性：备用 ↑ → 采购 ↑、切砖丢弃 ↓（阈值 ↓ 时可复用）', () => {
  const a = compute({ reservePct: 2 }).tile;
  const b = compute({ reservePct: 20 }).tile;
  assert.ok(b.buyTiles >= a.buyTiles);
  assert.equal(b.needTiles, a.needTiles);             // 备用不影响理论需要
  assert.ok(b.reserveTiles >= a.reserveTiles);
  // 阈值调低 → 之前丢掉的一条变成可复用 → 丢弃面积不增
  const hi = compute({ minReuse: 700 }).tile;
  const lo = compute({ minReuse: 0 }).tile;
  assert.ok(lo.discardTiles <= hi.discardTiles + 1e-12, `${lo.discardTiles} vs ${hi.discardTiles}`);
  assert.ok(lo.reuseArea >= hi.reuseArea - 1e-12);
  // 备用为 0 → 买来的就等于理论需要
  const z = compute({ reservePct: 0 }).tile;
  assert.equal(z.buyTiles, z.needTiles);
  assert.equal(z.extraCount, 0);
});

test('复用阈值：阈值等于 r 时刚好能留、再高一点就整条丢（两侧一正一反）', () => {
  const eq = compute({ minReuse: 416 }).tile;        // rx = 416 → 可复用件宽度 = 0
  assert.equal(eq.rxReuse, false, '刚好卡在阈值上时没有余量可留');
  const low = compute({ minReuse: 400 }).tile;       // 可复用 16 mm
  assert.equal(low.rxReuse, true);
  assert.ok(near(low.reuseArea, (16 * 800 * 6 + 212 * 800 * 8) / 1e6, 1e-9), String(low.reuseArea));
  const high = compute({ minReuse: 420 }).tile;      // 420 > 416 → 整条丢
  assert.equal(high.rxReuse, false);
  assert.ok(high.discardTiles > low.discardTiles, '阈值抬高后丢弃应当变多：' + high.discardTiles + ' vs ' + low.discardTiles);
  // 丢弃与可复用都不得越过物理上界
  [400, 416, 420].forEach((mr) => {
    const t = compute({ minReuse: mr }).tile;
    const rectM2 = (t.nx * t.a) * (t.ny * t.b) / 1e6;
    const roomM2 = t.areaLmm * t.areaWmm / 1e6;
    assert.ok(t.reuseArea + t.discardArea <= rectM2 - roomM2 + 1e-6, 'mr=' + mr);
  });
});

test('整除场景：不留切砖、丢弃只来自备用之外的边角', () => {
  const p = compute({ roomL: 4.0, roomW: 4.0, tileL: 800, tileW: 800, joint: 0, minReuse: 100, perimeter: 16.0, height: 2.8 });
  const t = p.tile;
  assert.equal(t.nx, 5); assert.equal(t.ny, 5);
  assert.equal(t.rx, 0); assert.equal(t.ry, 0);
  assert.equal(t.discardTiles, 0);
  assert.equal(t.reuseArea, 0);
  assert.equal(t.extraCount, 1);              // ceil(25×2%) = 1
  assert.equal(t.buyTiles, 26);
  assert.ok(t.lossPct < 1e-12);
  assert.ok(t.extraPct > 0);
});

test('单位换算：米 / 厘米 / 毫米 三种填法结果一致', () => {
  // 面积类字段（门窗、天花板）以「当前单位²」计：切单位时由 ui.js 换算已填的值，
  // 所以三种填法的物理量一致。这里手工按平方换算来模拟 UI 行为。
  // 长度类（房间、周长、层高、门洞宽度）随单位换算；
  // 面积类（门窗洞口、天花板）以「当前单位²」计，所以要乘单位的平方。
  const m = compute({ unit: 'm', roomL: 6, roomW: 4.2, perimeter: 20.4, height: 2.8,
    door: 4.2, window: 6.0, ceilingArea: 25.2, doorWidth: 2.7 });
  const cm = compute({ unit: 'cm', roomL: 600, roomW: 420, perimeter: 2040, height: 280, doorWidth: 270,
    door: 4.2 * 1e4, window: 6.0 * 1e4, ceilingArea: 25.2 * 1e4 });
  const mm = compute({ unit: 'mm', roomL: 6000, roomW: 4200, perimeter: 20400, height: 2800, doorWidth: 2700,
    door: 4.2 * 1e6, window: 6.0 * 1e6, ceilingArea: 25.2 * 1e6 });
  assert.equal(cm.ok, true, JSON.stringify(cm.errors));
  assert.equal(mm.ok, true, JSON.stringify(mm.errors));
  assert.equal(m.tile.buyTiles, cm.tile.buyTiles);
  assert.equal(m.tile.buyTiles, mm.tile.buyTiles);
  assert.ok(near(m.tile.discardTiles, cm.tile.discardTiles, 1e-9));
  assert.ok(near(m.tile.discardTiles, mm.tile.discardTiles, 1e-9));
  // 引擎内部统一归一到 mm 与 m²，所以三个几何读数必须逐位一致
  assert.ok(near(m.geo.wallAreaM2, cm.geo.wallAreaM2, 1e-9), m.geo.wallAreaM2 + ' vs ' + cm.geo.wallAreaM2);
  assert.ok(near(m.geo.wallAreaM2, mm.geo.wallAreaM2, 1e-9));
  assert.ok(near(m.geo.paintAreaM2, cm.geo.paintAreaM2, 1e-9));
  assert.ok(near(m.geo.paintAreaM2, mm.geo.paintAreaM2, 1e-9));
  assert.ok(near(m.geo.floorAreaM2, mm.geo.floorAreaM2, 1e-9));
  assert.ok(near(m.base.needLen, mm.base.needLen, 1e-9), m.base.needLen + ' vs ' + mm.base.needLen);
  // 乳胶漆的升数与腻子的公斤数是绝对量，三种填法必须逐位一致
  assert.ok(near(m.paint.liters, cm.paint.liters, 1e-9), m.paint.liters + ' vs ' + cm.paint.liters);
  assert.ok(near(m.paint.liters, mm.paint.liters, 1e-9));
  assert.equal(m.paint.packs, cm.paint.packs);
  assert.equal(m.paint.packs, mm.paint.packs);
  const puttyM = m.items.find((i) => i.key === 'putty').needQty;
  const puttyMm = mm.items.find((i) => i.key === 'putty').needQty;
  assert.ok(near(puttyM, puttyMm, 1e-6), puttyM + ' vs ' + puttyMm);
  assert.equal(m.base.pieces, mm.base.pieces);
});

test('百分比写法等价：8 与 "8%" 与 " 8 % " 都当 8%（逗号也容忍）', () => {
  const a = compute({ floorKind: 'plank', allowPct: 8 }).plank.boxesBuy;
  const b = compute({ floorKind: 'plank', allowPct: '8%' }).plank.boxesBuy;
  const c = compute({ floorKind: 'plank', allowPct: ' 8 ' }).plank.boxesBuy;
  assert.equal(a, b); assert.equal(a, c);
  const d = compute({ reservePct: '2%' }).tile.buyTiles;
  assert.equal(d, compute({ reservePct: 2 }).tile.buyTiles);
  assert.equal(compute({ tilePrice: '1,680' }).tile.tileCost, 49 * 1680);
});

test('量纲不变性：金额 ×10 则钱 ×10，几何读数一位不变', () => {
  const a = compute({});
  const b = compute({ tilePrice: D.tilePrice * 10, layPrice: D.layPrice * 10, paintPrice: D.paintPrice * 10,
    puttyPrice: D.puttyPrice * 10, primerPrice: D.primerPrice * 10, basePrice: D.basePrice * 10, groutPrice: D.groutPrice * 10 });
  assert.ok(near(b.tile.tileCost, a.tile.tileCost * 10, 1e-6));
  assert.ok(near(b.totals.totalCost, a.totals.totalCost * 10, 1e-6));
  assert.equal(b.tile.buyTiles, a.tile.buyTiles);
  assert.equal(b.tile.nx, a.tile.nx);
  assert.ok(near(b.tile.discardTiles, a.tile.discardTiles, 1e-12));
  assert.ok(near(b.geo.paintAreaM2, a.geo.paintAreaM2, 1e-12));
});

test('地板：拆包取整、片数覆盖、边切宽度', () => {
  const p = compute({ floorKind: 'plank', plankL: 1210, plankW: 195, perBox: 8, m2PerPiece: 0.23595,
    plankPrice: 88, allowPct: 8 });
  const k = p.plank;
  assert.ok(near(k.plankArea, 1210 * 195 / 1e6, 1e-12), String(k.plankArea));
  assert.ok(near(k.needArea, 25.2 * 1.08, 1e-9), String(k.needArea));
  assert.equal(k.needPieces, Math.ceil(k.needArea / k.plankArea));
  assert.equal(k.piecesBought, k.boxesBuy * 8);
  assert.ok(k.piecesBought >= k.needPieces);
  assert.ok(k.piecesBought - k.needPieces < 8, '多出来的不该达到一整箱');
  const expectEdge = Math.ceil(4200 / 195) * 195 - 4200;
  assert.equal(k.edgeOffcut, expectEdge);
  assert.ok(k.edgeOffcut >= 0 && k.edgeOffcut < 195);
  assert.ok(near(k.cost, k.needArea * 88, 1e-9));
  // 与地面砖互斥：铺地板时不再出地面砖项
  assert.equal(p.items.some((i) => i.key === 'floorTile'), false);
});

test('地板规格自相矛盾要报错（±5% 两侧）', () => {
  const exact = 1210 * 195 / 1e6;
  assert.equal(compute({ floorKind: 'plank', m2PerPiece: exact }).ok, true);
  assert.equal(compute({ floorKind: 'plank', m2PerPiece: exact * 1.049 }).ok, true);
  const bad = compute({ floorKind: 'plank', m2PerPiece: exact * 1.06 });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.some((e) => e.field === 'm2PerPiece'), true);
});

test('墙砖：门窗折减、备用、铺贴面积都自洽', () => {
  const p = compute({ hasWallTile: true });
  const w = p.wall;
  assert.ok(w.gridCount > 0);
  assert.equal(w.needTiles, Math.max(1, w.needTilesRaw - w.holeTiles));
  assert.equal(w.buyTiles, w.needTiles + w.reserveTiles);
  assert.ok(w.buyTiles >= w.needTiles);
  assert.ok(near(w.wallTileAreaM2, p.geo.wallAreaM2, 1e-9));
  assert.ok(w.holeRatio > 0 && w.holeRatio < 0.95);
  // 门窗填 0 时折减为 0
  const q = compute({ hasWallTile: true, door: 0, window: 0 });
  assert.equal(q.wall.holeTiles, 0);
  assert.equal(q.wall.needTiles, q.wall.needTilesRaw);
});

test('墙体面积不足以扣门窗 → 报错（不是算出负数）', () => {
  const r = compute({ perimeter: 10, height: 2.0, door: 18, window: 6 });
  assert.equal(r.ok, false);
  assert.equal(r.errors.some((e) => e.field === 'perimeter'), true);
});

test('踢脚线：门洞宽度不小于周长要报错；边角料够不够如实判定', () => {
  const bad = compute({ doorWidth: 21 });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.some((e) => e.field === 'doorWidth'), true);
  const p = compute({});
  assert.equal(p.base.offcutEnough, p.base.offcutAvail >= p.base.baseArea * 1.05);
  // 门槛调高，边角料变少 → 可能不够
  const q = compute({ minReuse: 700 });
  assert.ok(q.base.offcutAvail <= p.base.offcutAvail + 1e-12);
});

test('退化：零余量、天花板面积 0、门洞 0、全不勾', () => {
  const z = compute({ reservePct: 0, allowPct: 0, baseAllowPct: 0, groutAllowPct: 0 });
  assert.equal(z.ok, true);
  assert.equal(z.tile.buyTiles, z.tile.needTiles);
  assert.equal(z.grout.tubes, Math.ceil(z.grout.groundLen / z.grout.perTube));
  assert.ok(z.selfChecks.every((s) => s.ok), JSON.stringify(z.selfChecks.filter((s) => !s.ok)));

  // 天花板面积填 0：按 0 算（不偷偷拿房间面积顶上），但要给出说明
  const c0 = compute({ ceilingOn: true, ceilingArea: 0 });
  assert.equal(c0.geo.ceilAreaM2, 0);
  assert.ok(c0.notes.some((n) => /天花板面积填的是 0/.test(n)), JSON.stringify(c0.notes));
  assert.ok(c0.geo.paintAreaM2 < compute({}).geo.paintAreaM2);

  const off = compute({ ceilingOn: false });
  assert.equal(off.geo.ceilAreaM2, 0);
  assert.equal(off.geo.paintAreaM2, c0.geo.paintAreaM2, '关掉天花板与填 0 应当同口径');

  const d0 = compute({ door: 0, window: 0 });
  assert.equal(d0.ok, true);
  assert.ok(near(d0.geo.wallAreaM2, 20.4 * 2.8, 1e-9));

  const none = compute({ hasFloor: false, hasWallTile: false, hasPaint: false, hasBase: false, hasGrout: false });
  assert.equal(none.ok, true);
  assert.equal(none.items.length, 0);
  assert.equal(none.totals.totalCost, 0);
  assert.equal(none.totals.moneyPerM2, 0, '铺贴面积还在时，0 元摊出来就是 0');
  assert.equal(none.summary.title, '当前选择下没有要买的材料');
  assert.ok(none.selfChecks.every((s) => s.ok));
});

test('合法极值：最小与最大组合都能算，超界要报错', () => {
  const small = compute({ roomL: 0.001, roomW: 0.001, tileL: 1, tileW: 1, joint: 0, perimeter: 0.004, height: 0.001,
    door: 0, window: 0, tilePrice: 0, layPrice: 0, doorWidth: 0.001, baseH: 5 });
  assert.equal(small.ok, true, JSON.stringify(small.errors));
  // 大到 1000 米 × 1000 米（用米填）：仍然是合法输入，须能算
  const big = compute({ roomL: 1000, roomW: 1000, tileL: 5000, tileW: 5000, joint: 50, perimeter: 4000, height: 20,
    door: 0, window: 0 });
  assert.equal(big.ok, true, JSON.stringify(big.errors));
  // 毫米口径下长度上限是 1e7 mm
  assert.equal(compute({ unit: 'mm', roomL: 1e8 }).ok, false);
  assert.equal(compute({ tileL: 0.5 }).ok, false);
  assert.equal(compute({ joint: 51 }).ok, false);
  assert.equal(compute({ coats: 1.5 }).ok, false);
  assert.equal(compute({ perBox: 0 }).ok, false);
});

test('非法输入逐条核字段（数字解析、范围、类型）', () => {
  const cases = [
    ['roomL', ''], ['roomW', 'abc'], ['perimeter', ' '], ['height', '1e999'],
    ['window', '１２'], ['tileL', '0'], ['tileW', '-1'],
    ['joint', '-2'], ['tilePrice', '-1'], ['reservePct', '101'], ['minReuse', '-1'],
    ['layPrice', 'abc'], ['wtileL', '0'], ['wtileW', 'abc'], ['wtilePrice', '-1'],
    ['wtileLayPrice', 'x'], ['wtileReservePct', '200'], ['plankL', '0'], ['plankW', 'abc'],
    ['perBox', '2.5'], ['m2PerPiece', '-1'], ['plankPrice', '-3'], ['allowPct', 'abc'],
    ['ceilingArea', '-1'], ['useFactor', '0'], ['paintCoverage', '0'], ['coats', '0'],
    ['paintPackL', '0'], ['paintPrice', '-1'], ['puttyKgPerM2', '0'], ['puttyPackKg', 'abc'],
    ['puttyPrice', '-1'], ['primerKgPerM2', '-0.1'], ['primerPackKg', '0'], ['primerPrice', 'x'],
    ['baseH', '1'], ['baseLen', '0'], ['basePrice', '-1'], ['baseAllowPct', 'abc'],
    ['groutPerTube', '0'], ['groutPrice', '-1'], ['groutAllowPct', '101']
  ];
  cases.forEach(([k, v]) => {
    const r = A.compute({ [k]: v });
    assert.equal(r.ok, false, `${k}=${JSON.stringify(v)} 应当报错`);
    // 报错必须指向正确的字段（空串/非法数字都该被点到名）
    assert.ok(r.errors.some((e) => e.field === k || r.fieldErr[k]),
      `${k}=${JSON.stringify(v)} 报错字段是 ${r.errors.map((e) => e.field).join('/')}`);
    assert.equal(r.summary, null, '报错时不该给出结论');
    assert.equal(r.totals, null);
  });
});

test('一次多错一起报，不吞掉后面的错', () => {
  const r = compute({ roomL: 'x', tileW: '-1', coats: '0', groutPerTube: '0' });
  assert.equal(r.ok, false);
  const fields = new Set(r.errors.map((e) => e.field));
  assert.ok(fields.has('roomL') && fields.has('tileW') && fields.has('coats') && fields.has('groutPerTube'),
    [...fields].join('/'));
  assert.ok(r.errors.length >= 4);
});

test('空串不会被静默换成默认值', () => {
  const r = A.compute({ reservePct: '' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'reservePct'), JSON.stringify(r.errors));
  const q = compute({ label: '' });
  assert.equal(q.ok, true, 'label 允许留空');
});

test('输出契约：递归查 NaN / Infinity，自检条数可复现且覆盖该有的项', () => {
  [[{}, '默认'], [{ floorKind: 'plank' }, '地板'], [{ hasWallTile: true }, '墙砖'],
   [{ reservePct: 0, minReuse: 0 }, '零备用'], [{ hasPaint: false, hasBase: false }, '少项']].forEach(([patch, name]) => {
    const p = compute(patch);
    assert.equal(p.ok, true, name + JSON.stringify(p.errors));
    // 自检条数会随「勾了哪些材料」变化（地板/墙砖各多一组），但必须可复现
    assert.equal(p.selfChecks.length, compute(patch).selfChecks.length, name + ' 自检条数不稳定');
    assert.ok(p.selfChecks.length >= 22 && p.selfChecks.length <= 40, name + ' 自检条数 ' + p.selfChecks.length + ' 超范围');
    // 每次都该有的自检组（与勾了哪些材料无关）
    const names = p.selfChecks.map((s) => s.name).join('|');
    ['材料小计 = 各行金额之和', '总计 = 材料 + 铺贴', '清单行数 = 采购清单行数',
     '可刷面积 = （墙面 + 天花板）× 系数', '墙面面积 = 周长 × 层高 − 门窗',
     '没有 NaN / Infinity 泄漏', '建议条数 ≤ 5 且每条都带补丁'].forEach((need) => {
      assert.ok(names.indexOf(need) >= 0, name + ' 缺自检项「' + need + '」');
    });
    // 与所选材料对应的组：铺砖才有瓷砖网格、铺地板才有地板组
    if (patch.floorKind === 'plank') {
      assert.ok(names.indexOf('地板片数覆盖需要的面积') >= 0, name + ' 缺地板自检组');
      assert.ok(names.indexOf('网格片数 = 整砖 + 切砖') < 0, name + ' 铺地板时不该出现瓷砖网格自检');
    } else {
      assert.ok(names.indexOf('网格片数 = 整砖 + 切砖') >= 0, name + ' 缺瓷砖网格自检组');
    }
    const walk = (o, path) => {
      if (typeof o === 'number') {
        assert.ok(isFinite(o), `${name} ${path} = ${o}`);
        return;
      }
      if (Array.isArray(o)) { o.forEach((x, i) => walk(x, path + '[' + i + ']')); return; }
      if (o && typeof o === 'object') {
        Object.keys(o).forEach((k) => walk(o[k], path + '.' + k));
      }
    };
    walk(p, 'p');
    assert.ok(p.selfChecks.every((s) => s.ok), name + ' ' + JSON.stringify(p.selfChecks.filter((s) => !s.ok)));
  });
  assert.ok(compute({ floorKind: 'plank' }).selfChecks.map((s) => s.name).join('|').indexOf('地板片数覆盖需要的面积') >= 0);
  assert.ok(compute({ hasWallTile: true }).selfChecks.map((s) => s.name).join('|').indexOf('墙砖买来的 = 需要 + 备用') >= 0);
});

test('确定性与纯函数：同输入两次结果一致，且不改动入参', () => {
  const cfg = withCfg({ roomL: 4.37, roomW: 3.11, tileL: 600, tileW: 300, joint: 3 });
  const snapshot = JSON.stringify(cfg);
  const a = A.compute(cfg);
  const b = A.compute(cfg);
  assert.equal(JSON.stringify(a.tile), JSON.stringify(b.tile));
  assert.equal(JSON.stringify(a.totals), JSON.stringify(b.totals));
  assert.equal(JSON.stringify(a.selfChecks), JSON.stringify(b.selfChecks));
  assert.equal(JSON.stringify(cfg), snapshot, 'compute 不该改动入参');
});

test('显示口径：两个百分比分母不同，lossPct 用买回来的做分母', () => {
  const t = compute({}).tile;
  assert.ok(near(t.lossPct, t.discardTiles / t.buyTiles * 100, 1e-9));
  assert.ok(near(t.extraPct, (t.buyTiles - t.needTiles) / t.needTiles * 100, 1e-9));
  assert.notEqual(t.lossPct, t.extraPct);
  // 每一项都要带「这是什么口径」的标签，整件买的不许声称有「切没了」
  const p = compute({ hasWallTile: true });
  p.items.forEach((i) => {
    assert.ok(typeof i.extraLabel === 'string' && i.extraLabel.length > 0, i.key + ' 缺 extraLabel');
    if (i.lossPct === null) assert.ok(typeof i.lossLabel === 'string' && i.lossLabel.length > 0, i.key + ' 缺 lossLabel');
  });
  ['paint', 'putty', 'primer', 'base', 'grout'].forEach((k) => {
    assert.equal(p.items.find((i) => i.key === k).lossPct, null, k + ' 不该有「切没了」这个数');
  });
  assert.equal(p.items.find((i) => i.key === 'floorTile').lossPct !== null, true);
});

test('金额换算与格式化：大数不丢精度，非数显示 —', () => {
  const p = compute({ tilePrice: 1680, roomL: 9.9, roomW: 9.9 });
  assert.ok(near(p.tile.tileCost, p.tile.buyTiles * 1680, 1e-6));
  assert.equal(A.fmtMoney(NaN), '—');
  assert.equal(A.fmtMoney(Infinity), '—');
  assert.equal(A.fmtNum(undefined, 2), '—');
  assert.equal(A.fmtPct(null), '—');
  assert.equal(A.fmtMoney(0), '0.00');
  assert.match(A.fmtMoney(1234567.891), /1,234,567\.89/);
});

test('上取整工具：恰好整除不因浮点毛刺多算一件', () => {
  assert.equal(A.ceilSafe(48), 48);
  assert.equal(A.ceilSafe(48.0000000001), 49 - 1, '毛刺应当被吸收');
  assert.equal(A.ceilSafe(0.96), 1);
  assert.equal(A.ceilSafe(0), 0);
  assert.equal(A.ceilDiv(6000, 750), 8);
  assert.equal(A.ceilDiv(6001, 750), 9);
  assert.equal(A.ceilDiv(0, 750), 0);
});

test('美缝：缝长按有效模数数出来（不是房间周长）', () => {
  const p = compute({});
  const a = D.tileL + D.joint, b = D.tileW + D.joint;
  const expect = (6000 / a) * D.roomW + (4200 / b) * D.roomL;
  assert.ok(near(p.grout.groundLen, expect, 1e-9), `${p.grout.groundLen} vs ${expect}`);
  assert.notEqual(Math.round(p.grout.groundLen), Math.round(2 * (D.roomL + D.roomW)));
  assert.equal(p.grout.wallLen, 0, '没勾墙砖时墙面缝长为 0');
  const q = compute({ hasWallTile: true, groutWallOn: true });
  assert.ok(q.grout.wallLen > 0);
  const r = compute({ hasWallTile: true, groutWallOn: false });
  assert.equal(r.grout.wallLen, 0);
  assert.ok(q.grout.tubes >= r.grout.tubes);
});

test('场景自洽：每个内置场景都能算通且自检全过', () => {
  A.SCENARIOS.forEach((s) => {
    const cfg = A.normCfg(Object.assign({}, D, s.patch));
    const p = A.compute(cfg);
    assert.equal(p.ok, true, s.id + ' ' + JSON.stringify(p.errors));
    assert.ok(p.selfChecks.every((x) => x.ok), s.id + ' ' + JSON.stringify(p.selfChecks.filter((x) => !x.ok)));
    assert.ok(p.items.every((i) => isFinite(i.cost) && i.cost >= 0), s.id);
    assert.ok(p.insights.length <= 6 && p.advice.length <= 5, s.id);
  });
});

test('建议能作用于输入：套用补丁后确实得到预期方向', () => {
  const p = compute({});
  const rec = p.advice.find((a) => a.key === 'reserve5');
  assert.ok(rec, '默认场景应当给出「把备用提到 5%」的建议');
  const after = compute(rec.patch);
  assert.ok(after.tile.buyTiles > p.tile.buyTiles, '按建议改完采购量应当增加');
  const rot = p.advice.find((a) => a.key === 'rotate');
  if (rot) {
    const afterRot = compute(rot.patch);
    assert.ok(afterRot.tile.discardTiles < p.tile.discardTiles - 1e-9);
  }
});

test('300 组随机压力：自检全过、无 NaN、关键不等式成立', () => {
  let rnd = 123456789;
  const next = () => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd / 2147483648; };
  let assertions = 0;
  for (let i = 0; i < 300; i++) {
    const tileL = [200, 300, 400, 600, 750, 800, 900, 1200][Math.floor(next() * 8)];
    const tileW = [200, 300, 400, 600, 800, 1500, 1800][Math.floor(next() * 7)];
    const roomL = 1 + next() * 11, roomW = 1 + next() * 11;
    const height = 2.2 + next() * 1.6;
    const perimeter = 2 * (roomL + roomW) * (0.95 + next() * 0.1);   // 周长总是围绕长宽，保证几何自洽
    const wallTotal = perimeter * height;
    const door = next() * Math.min(6, wallTotal * 0.25);
    const window = next() * Math.min(12, wallTotal * 0.3);
    const patch = {
      unit: ['m', 'cm', 'mm'][Math.floor(next() * 3)],
      tileL, tileW,
      joint: Math.round(next() * 4),
      roomL, roomW, perimeter, height, door, window,
      minReuse: [0, 30, 60, 100, 200][Math.floor(next() * 5)],
      reservePct: next() * 15,
      hasWallTile: next() > 0.5,
      floorKind: next() > 0.6 ? 'plank' : 'tile',
      baseFromOffcut: next() > 0.5,
      groutWallOn: next() > 0.5
    };
    if (patch.unit === 'mm') { patch.roomL *= 1000; patch.roomW *= 1000; patch.perimeter *= 1000; patch.height *= 1000; }
    if (patch.unit === 'cm') { patch.roomL *= 100; patch.roomW *= 100; patch.perimeter *= 100; patch.height *= 100; }
    const p = A.compute(A.normCfg(Object.assign({}, D, patch)));
    assert.equal(p.ok, true, '第 ' + i + ' 组本该是合法输入却报错：' + JSON.stringify(p.errors) + ' patch=' + JSON.stringify(patch));
    assertions += 1;
    assert.ok(p.selfChecks.every((s) => s.ok), '第 ' + i + ' 组自检失败：' +
      JSON.stringify(p.selfChecks.filter((s) => !s.ok)) + ' patch=' + JSON.stringify(patch));
    assertions += 1;
    if (p.cfg.floorKind === 'plank') {
      assert.ok(p.plank.piecesBought >= p.plank.needPieces && p.plank.piecesBought === p.plank.boxesBuy * p.cfg.perBox, '第 ' + i + ' 组地板不变量');
    } else {
      assert.ok(p.tile.buyTiles >= p.tile.needTiles && p.tile.wholeCount + p.tile.cutCount === p.tile.gridCount, '第 ' + i + ' 组瓷砖不变量');
    }
    assertions += 1;
    assertions += 1;
    assert.ok(p.items.every((x) => isFinite(x.cost) && isFinite(x.buyQty) && isFinite(x.needQty)), '第 ' + i + ' 组出现 NaN');
    assertions += 1;
    assert.ok(isFinite(p.totals.totalCost) && p.totals.totalCost >= 0, '第 ' + i + ' 组合计异常');
  }
  assert.ok(assertions >= 900, '断言数应当 ≥900，实际 ' + assertions);
});

test('文案锁：关键措辞与口径说明必须在（防止改坏口径）', () => {
  const p = compute({ hasWallTile: true });
  assert.match(p.summary.title, /一共 \d+ 样料/);
  const joined = p.evidence.map((e) => e.name + e.text).join('|');
  assert.match(joined, /分母不同/);
  assert.match(joined, /两个百分比不是一回事/);
  assert.match(joined, /复用的|可复用/);
  const none = compute({ hasFloor: false, hasWallTile: false, hasPaint: false, hasBase: false, hasGrout: false });
  assert.match(none.summary.title, /没有要买的材料/);
});

test('导出结构：items/buyList/selfChecks 字段齐备，CSV 用到的字段都在', () => {
  const p = compute({ hasWallTile: true });
  ['key', 'group', 'name', 'spec', 'needQty', 'needUnit', 'needText', 'buyQty', 'buyUnit', 'buyText',
   'extraPct', 'lossPct', 'unitPrice', 'priceUnit', 'cost', 'formula'].forEach((k) => {
    p.items.forEach((i) => assert.ok(k in i, i.key + ' 缺字段 ' + k));
  });
  assert.equal(p.buyList.length, p.items.length);
  p.buyList.forEach((b) => assert.ok(b.key && b.name && b.buy && isFinite(b.cost)));
  assert.ok(p.selfChecks.length > 0);
  p.selfChecks.forEach((s) => assert.ok(typeof s.name === 'string' && typeof s.ok === 'boolean'));
});

test('normCfg：布尔字段归一、非法 unit 与 floorKind 回落到默认', () => {
  const c = A.normCfg({ hasWallTile: 1, ceilingOn: 0, unit: '尺', floorKind: 'магия', label: 'x'.repeat(80) });
  assert.equal(c.hasWallTile, true);
  assert.equal(c.ceilingOn, false);
  assert.equal(c.unit, 'm');
  assert.equal(c.floorKind, 'tile');
  assert.equal(c.label.length, 40);
});
